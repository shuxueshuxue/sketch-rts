import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';

// CHROMIUM_PATH=/usr/bin/chromium node scripts/cold-planning-restore-browser.mjs
// Measures restored client scheduling through real requestAnimationFrame;
// synchronous reference/setup work and canvas paint are reported separately.
const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(arg('--out') || 'assets/naval-runtime/cold-planning-restore.json');
const screenshot = resolve(arg('--screenshot') || 'assets/naval-runtime/cold-planning-restore.png');
const sourceFiles = ['src/client/net/lockstep-client.ts', 'src/shared/ship-planning-job.ts', 'src/shared/ship-navigation.ts',
  'src/shared/sailing.ts', 'src/shared/ship-planning-budget.ts', 'src/shared/ship-queued-course.ts', 'src/shared/sim.ts',
  'src/shared/sim/checksum.ts', 'src/shared/types.ts'];
const scripts = ['scripts/cold-planning-restore-fixture.js', 'scripts/cold-planning-restore-browser.mjs'];
const fingerprints = async files => Object.fromEntries(await Promise.all(files.map(async file =>
  [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
const sourceBefore = await fingerprints(sourceFiles), scriptBefore = await fingerprints(scripts);
await mkdir(resolve(root, 'work'), { recursive: true });
const scratch = await mkdtemp(resolve(root, 'work/cold-planning-restore-'));
const errors = [];
let server, browser, socket;

try {
  server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } },
    plugins: [{ name: 'cold-restore-fixture-page', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
        if (request.url !== '/__cold_restore.html') { next(); return; }
        response.setHeader('Content-Type', 'text/html');
        response.end('<meta charset="UTF-8"><title>Cold navigation restore</title><canvas width="680" height="160"></canvas><script type="module" src="/scripts/cold-planning-restore-fixture.js"></script>');
      });
    } }] });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');
  browser = spawn(arg('--chromium') || process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--no-sandbox',
    '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error('Chromium startup exceeded 30 seconds')), 30000);
    browser.once('error', error => { clearTimeout(timeout); reject(error); });
    browser.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chromium exited before DevTools opened (${code})`)); });
    browser.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-16384);
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolveEndpoint(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
  let serial = 0;
  const pending = new Map(), listeners = new Set();
  socket.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '));
  });
  socket.on('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('DevTools connection closed')); }
    pending.clear();
  });
  const command = (method, params = {}, sessionId) => new Promise((resolveRequest, reject) => {
    const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools command timed out: ${method}`)); }, 60000);
    pending.set(id, { resolve: resolveRequest, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  await command('Target.activateTarget', { targetId });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const pageCommand = (method, params) => command(method, params, sessionId);
  await pageCommand('Page.enable'); await pageCommand('Runtime.enable');
  await pageCommand('Emulation.setDeviceMetricsOverride', { width: 696, height: 176, deviceScaleFactor: 1, mobile: false });
  let loadListener, loadTimeout;
  const loaded = new Promise((resolveLoaded, reject) => {
    loadListener = event => { if (event.method === 'Page.loadEventFired' && event.sessionId === sessionId) resolveLoaded(); };
    listeners.add(loadListener);
    loadTimeout = setTimeout(() => reject(new Error('Fixture navigation exceeded 30 seconds')), 30000);
  });
  try { await Promise.all([pageCommand('Page.navigate', { url: `http://127.0.0.1:${address.port}/__cold_restore.html` }), loaded]); }
  finally { clearTimeout(loadTimeout); listeners.delete(loadListener); }
  const evaluation = await pageCommand('Runtime.evaluate', {
    expression: `new Promise((resolve,reject)=>{const deadline=performance.now()+45000;const check=()=>{if(window.__coldRestoreResult?.done)return resolve(window.__coldRestoreResult);if(performance.now()>deadline)return reject(new Error('Cold restore fixture timed out'));setTimeout(check,20)};check()})`,
    awaitPromise: true, returnByValue: true,
  });
  if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  const result = evaluation.result.value;
  const sourceAfter = await fingerprints(sourceFiles), scriptAfter = await fingerprints(scripts);
  result.sourceSha256 = sourceBefore;
  result.scriptSha256 = scriptBefore;
  result.sourceChangedDuringRun = sourceFiles.filter(file => sourceBefore[file] !== sourceAfter[file]);
  result.scriptsChangedDuringRun = scripts.filter(file => scriptBefore[file] !== scriptAfter[file]);
  result.reproduce = 'CHROMIUM_PATH=/usr/bin/chromium node scripts/cold-planning-restore-browser.mjs';
  result.recordedAt = new Date().toISOString();
  result.node = process.version;
  result.errors = errors;
  result.passed &&= errors.length === 0 && result.sourceChangedDuringRun.length === 0 && result.scriptsChangedDuringRun.length === 0;
  const captured = await pageCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 696, height: 176, scale: 1 } });
  await mkdir(dirname(output), { recursive: true }); await mkdir(dirname(screenshot), { recursive: true });
  await writeFile(screenshot, Buffer.from(captured.data, 'base64'));
  // Keep all measured frame records while excluding full snapshots and graphs.
  await writeFile(output, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({ output, screenshot, passed: result.passed, reconstructedVisitedNodes: result.reconstructedVisitedNodes,
    waitingRenders: result.waitingRenders, synchronousColdFirstFrameMs: result.synchronousColdFirstFrameMs,
    maximumClientRenderUpdateMs: result.maximumClientRenderUpdateMs, maximumMeasuredRenderTotalMs: result.maximumMeasuredRenderTotalMs,
    over50: result.clientRenderUpdatesOver50Ms, errors, sourceChangedDuringRun: result.sourceChangedDuringRun, error: result.error }));
  if (!result.passed) process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolveExit => { browser.once('exit', resolveExit); setTimeout(resolveExit, 5000).unref(); });
    browser.kill(); await exited;
  }
  await server?.close(); await rm(scratch, { recursive: true, force: true });
}
