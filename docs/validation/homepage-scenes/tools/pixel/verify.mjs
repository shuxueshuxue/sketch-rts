// Run only in the browser window assigned by the parent/review agent.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const arg = name => {
  const position = process.argv.indexOf('--' + name);
  return position < 0 ? undefined : process.argv[position + 1];
};
for (const name of ['baseline', 'candidate', 'out'])
  if (!arg(name)) throw new Error('Required: --baseline ROOT --candidate ROOT --out NEW');
const roots = { baseline: resolve(arg('baseline')), candidate: resolve(arg('candidate')) };
const output = resolve(arg('out'));
await mkdir(output); // Never overwrite earlier evidence.
const require = createRequire(resolve(roots.candidate, 'package.json'));
const { createServer } = await import(require.resolve('vite'));
const WebSocket = require('ws');
const sha = data => createHash('sha256').update(data).digest('hex');
const moduleSource = await readFile(resolve(toolDirectory, 'browser-proof.js'), 'utf8');
const harnessHash = sha(await readFile(fileURLToPath(import.meta.url)));
const browserModuleHash = sha(moduleSource);
const densities = [2, 4], cases = [];
for (const model of [
  { modelKey: 'menu/marine', kind: 'footman', color: '#4f8581' },
  { modelKey: 'menu/carpenter', kind: 'worker', color: '#4f8581' },
  { modelKey: 'menu/pirate', kind: 'footman', color: '#856144' }
]) for (const density of densities) for (const variant of [0, 1, 2])
  cases.push({ id: 'corpse-' + model.modelKey.split('/')[1] + '-d' + density + '-v' + variant,
    type: 'corpse', ...model, density, variant, tileSize: 128, presentation: {} });
for (const density of densities) {
  cases.push({ id: 'unit-footman-idle-d' + density, type: 'unit', kind: 'footman',
    density, tileSize: 128, color: '#4f8581', facing: 1, pose: { mode: 'idle', frame: 1 }, presentation: {} });
  cases.push({ id: 'unit-worker-work-d' + density, type: 'unit', kind: 'worker',
    density, tileSize: 128, color: '#856144', facing: -1, pose: { mode: 'work', frame: 2 }, presentation: {} });
  cases.push({ id: 'unit-footman-upattack-d' + density, type: 'unit', kind: 'footman',
    density, tileSize: 176, color: '#4f8581', facing: -1,
    pose: { mode: 'attack', frame: 2, variant: 1, aim: -4 }, presentation: {} });
  cases.push({ id: 'model-carpenter-work-d' + density, type: 'model', kind: 'worker',
    modelKey: 'menu/carpenter', density, tileSize: 128, color: '#4f8581', facing: 1,
    pose: { mode: 'work', frame: 2 }, presentation: {} });
  for (const [kind, state] of [['crate', null], ['tree', null], ['campfire', 'lit']])
    cases.push({ id: 'environment-' + kind + '-d' + density, type: 'environment',
      kind, state: state ?? undefined, density, tileSize: 128 });
  cases.push({ id: 'pool-crate-d' + density, type: 'pool', density, tileSize: 128 });
}
const selectedCases = cases.filter(spec =>
  (arg('corpses-only') !== 'true' || spec.type === 'corpse') &&
  (!arg('model') || spec.type === 'corpse' && spec.modelKey === 'menu/' + arg('model')));
if (!selectedCases.length) throw new Error('No cases selected');
const browserFlags = ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--remote-debugging-port=0'];
async function collectSource(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard',
    'src', 'public/art/world3d'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  const hashes = Object.fromEntries(await Promise.all(files.map(async path =>
    [path, sha(await readFile(resolve(root, path)))])));
  return { root, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), hashes };
}
async function launch(root, label) {
  const scratch = await mkdtemp('/workspace/homepage-raster-parity-');
  const errors = [], failures = [], logs = [];
  let server, browser, socket, browserStderr = '', sequence = 0;
  const pending = new Map();
  const cleanup = async () => {
    for (const request of pending.values()) clearTimeout(request.timeout);
    socket?.close();
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      await new Promise(done => {
        const timer = setTimeout(() => browser.kill('SIGKILL'), 5000);
        browser.once('exit', () => { clearTimeout(timer); done(); });
        browser.kill('SIGTERM');
      });
    }
    await server?.close();
    await writeFile(resolve(output, label + '-chromium.stderr.txt'), browserStderr);
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    server = await createServer({ root, configFile: false,
      cacheDir: resolve(scratch, 'vite'),
      define: { 'import.meta.env.VITE_SKETCH_RTS_DEPLOYMENT': JSON.stringify('static') },
      plugins: [{ name: 'external-raster-pixel-proof', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0];
          if (path === '/__raster_pixel_proof.html') {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><meta charset="utf-8"><title>Raster byte proof</title>' +
              '<link rel="icon" href="data:,"><script type="module" src="/__raster_pixel_proof.js"></script>');
          } else if (path === '/__raster_pixel_proof.js') {
            response.setHeader('Content-Type', 'text/javascript'); response.end(moduleSource);
          } else next();
        });
      } }], server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    browser = spawn(arg('chromium') ?? '/usr/bin/chromium', [...browserFlags,
      '--user-data-dir=' + resolve(scratch, 'chromium'), 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 30000);
      browser.once('error', error => { clearTimeout(timeout); reject(error); });
      browser.stderr.on('data', bytes => {
        browserStderr += bytes.toString();
        const match = browserStderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timeout); done(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
    socket.on('message', bytes => {
      const data = JSON.parse(bytes.toString());
      if (data.id) {
        const request = pending.get(data.id);
        if (request) {
          pending.delete(data.id); clearTimeout(request.timeout);
          data.error ? request.reject(new Error(JSON.stringify(data.error))) : request.done(data.result);
        }
        return;
      }
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params);
      if (data.method === 'Runtime.consoleAPICalled') {
        logs.push(data.params);
        if (data.params.type === 'error') errors.push(data.params);
      }
      if (data.method === 'Network.loadingFailed') failures.push(data.params);
    });
    const command = (method, params = {}, sessionId) => new Promise((done, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 90000);
      pending.set(id, { done, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    const evaluate = async expression => {
      const response = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    };
    await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
    await page('Network.setCacheDisabled', { cacheDisabled: true });
    await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: 'http://127.0.0.1:' + server.httpServer.address().port + '/__raster_pixel_proof.html' });
    await evaluate(`new Promise((done,reject)=>{const limit=performance.now()+60000;function check(){if(window.__rasterProof?.ready)return done(true);if(performance.now()>limit)return reject(new Error('Proof module did not load'));setTimeout(check,20)}check()})`);
    return { evaluate, errors, failures, logs, browser: await command('Browser.getVersion'),
      runtime: await evaluate('__rasterProof.runtime'), close: cleanup };
  } catch (error) { await cleanup(); throw error; }
}
function withoutContextAttributes(value) {
  if (Array.isArray(value)) return value.map(withoutContextAttributes);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'willReadFrequently').map(([key, child]) => [key, withoutContextAttributes(child)]));
  return value;
}
async function storeCase(label, result) {
  for (const collection of ['outputs', 'crops']) for (const [ordinal, raster] of result[collection].entries()) {
    const bytes = Buffer.from(raster.rgbaBase64, 'base64'); delete raster.rgbaBase64;
    if (bytes.length !== raster.width * raster.height * 4) throw new Error('Invalid RGBA byte count');
    const file = label + '/' + result.spec.id + '-' + collection + '-' + ordinal + '.rgba.gz';
    await writeFile(resolve(output, file), gzipSync(bytes));
    raster.rgba = { file, bytes: bytes.length, sha256: sha(bytes) };
  }
  await writeFile(resolve(output, label, result.spec.id + '.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
const records = {}, sources = {}, failures = [], byteComparisons = [];
try {
  for (const label of ['baseline', 'candidate']) sources[label] = await collectSource(roots[label]);
  const changedFiles = [...new Set([...Object.keys(sources.baseline.hashes), ...Object.keys(sources.candidate.hashes)])]
    .filter(file => sources.baseline.hashes[file] !== sources.candidate.hashes[file]);
  if (JSON.stringify(changedFiles) !== JSON.stringify(['src/client/art/raster-cache.ts']))
    throw new Error('Expected only RasterCache source difference: ' + JSON.stringify(changedFiles));
  const oldRaster = await readFile(resolve(roots.baseline, changedFiles[0]), 'utf8');
  const newRaster = await readFile(resolve(roots.candidate, changedFiles[0]), 'utf8');
  const removeLineComments = text => text.replace(/^[ \t]*\/\/[^\n]*(?:\n|$)/gm, '');
  if (removeLineComments(oldRaster.replace('this.reset(canvas).drawImage(source,', 'this.reset(canvas,true).drawImage(source,')) !== removeLineComments(newRaster))
    throw new Error('Candidate does more than the single crop readback hint plus line comments');
  await writeFile(resolve(output, 'inputs.json'), JSON.stringify({ roots, sources, changedFiles,
    cases: selectedCases, harnessHash, browserModuleHash, browserFlags, node: process.version,
    viteVersion: require('vite/package.json').version, wsVersion: require('ws/package.json').version,
    method: 'Fresh Chromium process/profile and Vite module cache for each source. Atlas cleared for each case. Cold then warm outer CPU canvas; crops read only after both draws. Real crop pool reused in two bounded cases. Standalone module: no game simulation or main-page animation.' }, null, 2) + '\n');
  await writeFile(resolve(output, 'executed-browser-proof.js'), moduleSource);
  await writeFile(resolve(output, 'executed-verify.mjs'), await readFile(fileURLToPath(import.meta.url)));
  for (const label of ['baseline', 'candidate']) {
    await mkdir(resolve(output, label));
    const session = await launch(roots[label], label);
    const run = { browser: session.browser, runtime: session.runtime, cases: [] };
    records[label] = run;
    try {
      for (const spec of selectedCases) {
        const result = await session.evaluate('__rasterProof.' + (spec.type === 'pool' ? 'runPoolCase' : 'runCase') + '(' + JSON.stringify(spec) + ')');
        run.cases.push(await storeCase(label, result));
        console.log(JSON.stringify({ label, case: spec.id, outputs: result.outputs.length,
          crops: result.crops.length, status: 'captured' }));
      }
    } finally {
      run.errors = session.errors; run.networkFailures = session.failures; run.console = session.logs;
      await session.close();
      await writeFile(resolve(output, label + '-runtime.json'), JSON.stringify(run, null, 2) + '\n');
    }
    if (run.errors.length || run.networkFailures.length) failures.push({ label, errors: run.errors, networkFailures: run.networkFailures });
  }
  const { gunzipSync } = await import('node:zlib');
  for (let i = 0; i < selectedCases.length; i++) {
    const a = records.baseline.cases[i], b = records.candidate.cases[i];
    const clean = record => withoutContextAttributes({ ...record,
      outputs: record.outputs.map(({ rgba, ...raster }) => raster),
      crops: record.crops.map(({ rgba, ...raster }) => raster) });
    if (JSON.stringify(clean(a)) !== JSON.stringify(clean(b))) failures.push({ case: a.spec.id, reason: 'Metadata/anchors/dimensions/alpha/cache trace differ' });
    for (const collection of ['outputs', 'crops']) {
      if (a[collection].length !== b[collection].length) { failures.push({ case: a.spec.id, collection, reason: 'Raster count differs' }); continue; }
      for (let j = 0; j < a[collection].length; j++) {
        const oldBytes = gunzipSync(await readFile(resolve(output, a[collection][j].rgba.file)));
        const newBytes = gunzipSync(await readFile(resolve(output, b[collection][j].rgba.file)));
        let changedBytes = 0, changedPixels = 0, alphaDifferences = 0, maximumDelta = 0;
        const firstDifferences = [];
        for (let k = 0; k < Math.max(oldBytes.length, newBytes.length); k++) {
          if (oldBytes[k] === newBytes[k]) continue;
          changedBytes++; if (k % 4 === 3) alphaDifferences++;
          maximumDelta = Math.max(maximumDelta, Math.abs((oldBytes[k] ?? 0) - (newBytes[k] ?? 0)));
          if (firstDifferences.length < 16) firstDifferences.push({ byte: k, pixel: Math.floor(k / 4), channel: k % 4,
            baseline: oldBytes[k], candidate: newBytes[k] });
        }
        for (let k = 0; k < Math.max(oldBytes.length, newBytes.length); k += 4)
          if ([0, 1, 2, 3].some(c => oldBytes[k + c] !== newBytes[k + c])) changedPixels++;
        const comparison = { case: a.spec.id, collection, ordinal: j, baselineFile: a[collection][j].rgba.file,
          candidateFile: b[collection][j].rgba.file, bytes: oldBytes.length, changedBytes,
          changedPixels, alphaDifferences, maximumDelta, firstDifferences };
        byteComparisons.push(comparison);
        if (changedBytes) failures.push(comparison);
      }
    }
    if (a.spec.type !== 'pool') for (const crop of b.crops)
      if (crop.contextAttributes?.willReadFrequently !== true) failures.push({ case: a.spec.id, reason: 'Candidate crop did not retain readback hint' });
    for (const outer of [...a.outputs, ...b.outputs])
      if (outer.contextAttributes?.willReadFrequently !== true) failures.push({ case: a.spec.id, reason: 'Outer canvas is not readback-backed' });
  }
  const end = {}; for (const label of ['baseline', 'candidate']) end[label] = await collectSource(roots[label]);
  const unchanged = JSON.stringify(sources) === JSON.stringify(end);
  if (!unchanged) failures.push({ reason: 'Source changed during comparison', end });
  const proof = { pass: failures.length === 0, sources, end, unchanged, harnessHash, browserModuleHash,
    cases: selectedCases.length, rasterComparisons: byteComparisons.length,
    totalBytesCompared: byteComparisons.reduce((sum, comparison) => sum + comparison.bytes, 0),
    byteComparisons, failures,
    limits: 'Real Chromium Canvas proof for the specified finite inputs in this runtime. Context attributes intentionally differ only in the crop readback hint. All dimensions, anchors, alpha and every RGBA byte must match. This proves neither other browsers nor GPU timing; performance requires the separately scheduled native ABBA.' };
  await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ pass: proof.pass, cases: proof.cases, rasterComparisons: proof.rasterComparisons,
    totalBytesCompared: proof.totalBytesCompared, failures: failures.length, output }));
  if (!proof.pass) process.exitCode = 1;
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack,
    sources, records, failures, byteComparisons, harnessHash, browserModuleHash }, null, 2) + '\n');
  console.error(error); process.exitCode = 1;
}
