import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const result = { renderer: 'Chromium SwiftShader', units: 280, ships: 24, viewport: { width: 1280, height: 720 },
    method: '120 static and 120 fresh-tick CPU draws per cycle; renderer.render disabled only during CPU timing, real WebGL draw before/after; all disposed layer references retained intentionally to measure explicit release; GC requested through CDP',
    errors, failed, requests, cycles, teardown, heapAfterTeardown: await pageCommand('Runtime.getHeapUsage') };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  if (arg('--screenshot')) { const screenshot = await evaluate('window.runtimeReview.lastScreenshot'); await writeFile(resolve(arg('--screenshot')), Buffer.from(screenshot.split(',')[1], 'base64')); }
  if (errors.length || cycles.some(cycle => cycle.glError)) throw new Error(JSON.stringify({ errors, glErrors: cycles.map(cycle => cycle.glError) }));
  console.log(JSON.stringify({ output, modelHttpRequests: requests.length, modelsInstalled: cycles.at(-1).after.installedModels, heapAfterGc: cycles.map(cycle => cycle.heapAfterGc.usedSize), cpu: cycles.map(cycle => ({ static: cycle.staticCpu.meanMs, updated: cycle.updatedCpu.meanMs })) }));
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise(resolveClosed => { browser.once('exit', resolveClosed); setTimeout(resolveClosed, 5000).unref(); }); browser.kill(); await closed;
  }
  await server?.close(); await rm(scratch, { recursive: true, force: true });
}
