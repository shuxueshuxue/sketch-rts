import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';

// node --import tsx scripts/browser-runtime-benchmark.mjs --out work/browser-runtime.json
// CHROMIUM_PATH selects an installed Chromium. GPU wall time is not benchmarked.
const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(arg('--out') || 'work/browser-runtime.json');
await mkdir(resolve(root, 'work'), { recursive: true });
const scratch = await mkdtemp(resolve(root, 'work/browser-runtime-'));
let server, browser, socket;
const errors = [], failed = [], requests = [], cycles = [];
let wroteResult = false;

function validate(result) {
  const violations = [];
  const require = (condition, message) => { if (!condition) violations.push(message); };
  const emptyMaps = (owned, label) => {
    for (const [key, count] of Object.entries(owned)) require(count === 0, `${label}: ${key} retains ${count} entries`);
  };
  require(result.errors.length === 0, `Browser errors: ${JSON.stringify(result.errors)}`);
  require(result.failed.length === 0, `Failed network requests: ${JSON.stringify(result.failed)}`);
  require(result.requests.every(request => request.status >= 200 && request.status < 300), 'One or more GLB responses were not successful');
  require(result.cycles.length === 6, 'Expected all six resource cycles');
  const expected = new Set(result.teardown.expectedModels);
  const httpCounts = {};
  for (const request of result.requests) {
    const match = new URL(request.url).pathname.match(/\/art\/world3d\/(.+)\.glb$/);
    require(Boolean(match), `Unrecognized GLB resource URL: ${request.url}`);
    if (match) httpCounts[match[1]] = (httpCounts[match[1]] || 0) + 1;
  }
  for (const key of expected) {
    require(result.teardown.installedModels[key] === 1, `${key}: model was not installed exactly once`);
    require(httpCounts[key] === 1, `${key}: model did not have exactly one HTTP request`);
  }
  for (const key of Object.keys(result.teardown.installedModels)) require(expected.has(key), `Unexpected installed model ${key}`);
  for (const key of Object.keys(httpCounts)) require(expected.has(key), `Unexpected requested model ${key}`);
  for (const cycle of result.cycles) {
    const label = `Cycle ${cycle.index}`;
    require(cycle.glError === 0, `${label}: WebGL error ${cycle.glError}`);
    require(cycle.contextLost === true, `${label}: disposed renderer still has a live WebGL context`);
    require(cycle.before.selection.instances === 280, `${label}: selected actors did not produce all 280 actual markers`);
    require(cycle.before.owned.selectionHulls === 6 && cycle.before.owned.selectionBatches === 7, `${label}: missing ship hull or surface marker batches`);
    require(cycle.before.owned.gangwaySurfaces === 1, `${label}: real gangway was not drawn`);
    require(cycle.before.selection.depthTest === true && cycle.before.selection.depthWrite === false, `${label}: markers bypass normal depth testing`);
    require(cycle.interactionProofs.length === 12, `${label}: incomplete real-render interaction coverage`);
    for (const zone of ['ground', 'deck', 'hull']) for (const role of ['own', 'ally', 'enemy']) {
      require(cycle.interactionProofs.some(proof => proof.hover?.zone === zone && proof.hover.role === role && proof.hover.selected === false), `${label}: missing hover-only ${role} ${zone} proof`);
    }
    require(cycle.interactionProofs.some(proof => proof.hover?.zone === 'bridge' && proof.hover.selected === false), `${label}: missing hover-only sloped bridge crew proof`);
    for (const proof of cycle.interactionProofs) {
      require(['own', 'ally', 'enemy'].every(role => proof.roles.includes(role)), `${label}: actual marker instances lack relation colors`);
      require(['ground', 'deck', 'hull', 'bridge'].every(zone => proof.zones.includes(zone)), `${label}: actual marker instances lack a floor type`);
    }
    for (const kind of ['materials', 'surfaceGeometry', 'hullGeometry', 'instanceMeshes', 'instanceGeometry']) {
      const count = cycle.markerResourcesAfter[kind];
      require(count?.allocated > 0 && count.disposed === count.allocated && count.live === 0, `${label}: ${kind} has missing or incomplete disposal events`);
    }
    emptyMaps(cycle.after.owned, `${label} layer teardown`);
    require(cycle.after.transforms === 0 && cycle.after.sceneChildren === 0 && cycle.after.selection.instances === 0 && cycle.after.selection.disposed === true, `${label}: retained disposed layer still owns scene state`);
    require(cycle.resources.home.failed === 0 && cycle.resources.match.failed === 0, `${label}: resource loader contains failed entries`);
    require(cycle.resources.retainedRawBytes === 0 && cycle.resources.cacheStats.retainedBytes === 0, `${label}: decoded resources retain raw request bytes`);
    require(cycle.resources.cacheStats.active === 0 && cycle.resources.cacheStats.queued === 0, `${label}: resource requests did not settle`);
  }
  require(result.teardown.retainedDisposedLayers === 6, 'Disposed layer references were not all retained for the release check');
  for (const [index, layer] of result.teardown.ownedMaps.entries()) emptyMaps(layer.owned, `Application teardown layer ${index}`);
  emptyMaps(result.teardown.sharedAfter, 'Application shared-model teardown');
  emptyMaps(result.teardown.resources.owned, 'Application request/decode teardown');
  require(result.teardown.resources.cacheStats.active === 0 && result.teardown.resources.cacheStats.queued === 0, 'Application teardown retains pending resource work');
  require(result.teardown.portraitProviderCleared === true, 'Application teardown retains the installed UI portrait provider');
  return { passed: violations.length === 0, violations, expectedModelCount: expected.size, modelHttpCounts: httpCounts };
}
try {
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Runtime benchmark</title><style>body{margin:0;background:#182526}canvas{display:block;width:1280px;height:720px}</style><canvas id="world"></canvas><script type="module" src="/@fs${root}/scripts/browser-runtime-fixture.js"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(root, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(root) },
    plugins: [{ name: 'benchmark-resource-manifest', configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next();
      try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(root, 'public')))); } catch (error) { next(error); }
    }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } } });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');
  browser = spawn(arg('--chromium') || process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chromium startup exceeded 30 seconds')), 30000);
    browser.once('error', error => { clearTimeout(timeout); reject(error); });
    browser.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chromium exited before DevTools opened (${code})`)); });
    browser.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolveEndpoint(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
  let serial = 0;
  const pending = new Map(), listeners = new Set(), urls = new Map();
  socket.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.id) { const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timeout); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); return; }
    for (const listener of listeners) listener(message);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '));
    if (message.method === 'Network.requestWillBeSent') urls.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.responseReceived' && /\.glb(?:\?|$)/.test(message.params.response.url)) requests.push({ url: message.params.response.url, status: message.params.response.status });
    if (message.method === 'Network.loadingFailed') failed.push({ url: urls.get(message.params.requestId), error: message.params.errorText });
  });
  socket.on('close', () => { for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('DevTools connection closed')); } pending.clear(); });
  const command = (method, params = {}, sessionId) => new Promise((resolveRequest, reject) => {
    const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools command timed out: ${method}`)); }, 90000);
    pending.set(id, { resolve: resolveRequest, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  await command('Target.activateTarget', { targetId });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const pageCommand = (method, params) => command(method, params, sessionId);
  await pageCommand('Page.enable'); await pageCommand('Runtime.enable'); await pageCommand('Network.enable');
  await pageCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  let loadListener, loadTimeout;
  const loaded = new Promise((resolveLoaded, reject) => {
    loadListener = event => { if (event.method === 'Page.loadEventFired' && event.sessionId === sessionId) resolveLoaded(); };
    listeners.add(loadListener); loadTimeout = setTimeout(() => reject(new Error('Page navigation exceeded 30 seconds')), 30000);
  });
  try { await Promise.all([pageCommand('Page.navigate', { url: `http://127.0.0.1:${address.port}` }), loaded]); }
  finally { clearTimeout(loadTimeout); listeners.delete(loadListener); }
  const evaluate = async expression => {
    const result = await pageCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.runtimeReview?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error('Fixture initialization timed out'));setTimeout(check,20)};check()})`);
  for (let index = 0; index < 6; index++) {
    const cycle = await evaluate(`window.runtimeReview.cycle(${index})`);
    await pageCommand('HeapProfiler.collectGarbage'); cycle.heapAfterGc = await pageCommand('Runtime.getHeapUsage'); cycles.push(cycle);
  }
  const teardown = await evaluate('window.runtimeReview.teardown()'); await pageCommand('HeapProfiler.collectGarbage');
  const sourceFiles = ['scripts/browser-runtime-fixture.js', 'scripts/browser-runtime-benchmark.mjs', 'src/client/world3d/world-layer.ts', 'src/client/world3d/selection-markers.ts', 'src/client/world3d/model-library.ts', 'src/client/world3d/model-portraits.ts', 'src/client/resources.ts', 'src/client/main.ts', 'src/client/unit-hover-target.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  const result = { renderer: 'Chromium SwiftShader', browser: await command('Browser.getVersion'), node: process.version, units: 280, ships: 24, viewport: { width: 1280, height: 720 }, sourceSha256,
    method: 'Six cycles; ten real-WebGL hover-only cases per cycle for own/ally/enemy ground troops, deck crew and hulls plus sloped bridge crew, with per-instance position/color/height/stroke checks; real full-selection draws before/after CPU samples. 120 fixed-snapshot full-selection and 120 fresh-tick alternating-selection CPU draws per cycle; renderer.render disabled only during CPU timing, excluding GPU work. All disposed layer references retained intentionally to verify explicit release; GC requested through CDP. Teardown follows main.ts layer, request/decode, portrait and shared-model ordering. CPU samples are not device FPS.',
    errors, failed, requests, cycles, teardown, heapAfterTeardown: await pageCommand('Runtime.getHeapUsage') };
  result.validation = validate(result);
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  wroteResult = true;
  if (arg('--screenshot')) { const screenshot = await evaluate('window.runtimeReview.lastScreenshot'); await writeFile(resolve(arg('--screenshot')), Buffer.from(screenshot.split(',')[1], 'base64')); }
  if (!result.validation.passed) throw new Error(JSON.stringify(result.validation.violations));
  console.log(JSON.stringify({ output, passed: true, realRenderInteractionCases: cycles.reduce((sum, cycle) => sum + cycle.interactionProofs.length, 0), modelHttpRequests: requests.length, modelsInstalled: cycles.at(-1).after.installedModels, markerResourcesAfter: cycles.map(cycle => cycle.markerResourcesAfter), heapAfterGc: cycles.map(cycle => cycle.heapAfterGc.usedSize), cpu: cycles.map(cycle => ({ static: cycle.staticCpu.meanMs, updated: cycle.updatedCpu.meanMs })) }));
} catch (error) {
  if (!wroteResult) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ validation: { passed: false, violations: [String(error)] }, errors, failed, requests, completedCycles: cycles }, null, 2) + '\n');
  }
  throw error;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise(resolveClosed => { browser.once('exit', resolveClosed); setTimeout(resolveClosed, 5000).unref(); }); browser.kill(); await closed;
  }
  await server?.close(); await rm(scratch, { recursive: true, force: true });
}
