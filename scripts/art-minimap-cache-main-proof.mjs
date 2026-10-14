/** Actual-main lifecycle + complete Canvas minimap pixel correctness only.
 * No simulation/render/FPS timing. Run only in the parent's browser window. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
const arg = key => { const at = process.argv.indexOf(key); return at < 0 ? undefined : process.argv[at + 1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(arg('--source') ?? root), out = resolve(arg('--out') ?? 'docs/art/refactor/followup/minimap-cache/main-browser');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['src/client/main.ts', 'src/client/minimap-presentation-cache.ts', 'src/client/minimap-art.ts', 'src/client/frontend-world-view.ts',
  'src/client/net/local-adapter.ts', 'src/client/game-adapter.ts', 'src/client/deployment/static-runtime.ts', 'src/client/deployment/runtime.ts',
  'src/shared/presentation.ts', 'src/shared/sim.ts', 'src/shared/sim/command-frame-runtime.ts'];
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (arg('--expect-commit') && commit !== arg('--expect-commit')) throw Error(`Wrong source ${commit}`);
const originalMain = await readFile(resolve(source, 'src/client/main.ts'), 'utf8');
const fixture = await readFile(resolve(root, 'scripts/art-minimap-cache-main-fixture.js'), 'utf8');
const blockPattern = /  const localView = currentRoomId && deploymentRuntime\.isLocalRoom\(currentRoomId\);\n  drawMinimap\(minimapPresentation\.read\(snapshot, localView \? snapshot : undefined\)\);/g;
const blocks = [...originalMain.matchAll(blockPattern)];
if (blocks.length !== 1) throw Error('Expected one exact main derived-minimap block');
const block = blocks[0][0];
const transformedMain = `import { createMapPresentation as __proofOriginalMarks } from '../shared/presentation';\n` +
  originalMain.replace(block, '  __drawPublishedMinimap();').replace('function drawMinimap(marks: MapPresentationMark[]) {',
    'function drawMinimap(marks: MapPresentationMark[]) {\n  __proofObserve(marks);') +
  `\nfunction __drawPublishedMinimap() {\n${block}\n}\n${fixture}`;
const sourceSHA = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(source, file)))])));
await mkdir(out, { recursive: false });
await mkdir(resolve(out, 'source'), { recursive: true });
for (const file of files) { const dest = resolve(out, 'source', file); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, await readFile(resolve(source, file))); }
await writeFile(resolve(out, 'executed-main.ts'), transformedMain);
await writeFile(resolve(out, 'executed-fixture.js'), fixture);
await writeFile(resolve(out, 'executed-driver.mjs'), await readFile(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp('/tmp/minimap-main-proof-');
const errors = [], loadingFailures = [], loaded = new Set();
let server, browser, socket, failure, proof, browserVersion;
const metadata = { source, sourceCommit: commit, sourceSHA256: sourceSHA, originalMainSHA256: hash(originalMain), transformedMainSHA256: hash(transformedMain),
  extractedBlock: block, extractedBlockSHA256: hash(block), fixtureSHA256: hash(fixture), driverSHA256: hash(await readFile(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString() };
try {
  server = await createServer({ root: source, configFile: false, publicDir: resolve(source, 'public'),
    define: { 'import.meta.env.VITE_SKETCH_RTS_DEPLOYMENT': JSON.stringify('static') },
    plugins: [{ name: 'minimap-main-lifecycle-proof', enforce: 'pre',
      transform(code, id) { if (id.split('?')[0] === resolve(source, 'src/client/main.ts')) { if (code !== originalMain) throw Error('Source main changed'); return transformedMain; } },
      configureServer(dev) { dev.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/minimap-proof.html') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(`<meta charset="UTF-8"><div id="app"></div><script>window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};</script><script type="module">import{resources}from'/src/client/resources.ts';await resources.initialize();await import('/src/client/main.ts');</script>`);
      }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [source, root, scratch] } } });
  await server.listen();
  browser = spawn(arg('--chromium') ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-software-rasterizer', '--remote-debugging-port=0', `--user-data-dir=${scratch}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 30000); browser.once('error', reject);
    browser.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); done(match[1]); } });
  });
  socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  let serial = 0; const pending = new Map();
  socket.on('message', bytes => {
    const message = JSON.parse(String(bytes));
    if (message.id) { const request = pending.get(message.id); if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(Error(JSON.stringify(message.error))) : request.done(message.result); } return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    if (message.method === 'Network.loadingFailed') loadingFailures.push(message.params.errorText);
    if (message.method === 'Network.requestWillBeSent') loaded.add(message.params.request.url);
  });
  const command = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 120000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params = {}) => command(method, params, sessionId);
  for (const domain of ['Page', 'Runtime', 'Network']) await page(`${domain}.enable`);
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/minimap-proof.html` });
  const result = await page('Runtime.evaluate', { expression: `new Promise((resolve,reject)=>{const end=Date.now()+60000;const check=()=>{if(window.__runMinimapMainProof)return window.__runMinimapMainProof().then(resolve,reject);if(Date.now()>end)return reject(Error('Real main init timeout'));setTimeout(check,20)};check()})`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  proof = result.result.value; browserVersion = await command('Browser.getVersion');
  for (const image of proof.images) { const bytes = Buffer.from(image.base64, 'base64'); if (hash(bytes) !== image.pngSHA256) throw Error('PNG transport differs'); await writeFile(resolve(out, image.name), bytes); delete image.base64; }
} catch (error) { failure = String(error); }
finally {
  socket?.close();
  if (browser && browser.exitCode === null) { const exited = new Promise(done => { browser.once('exit', done); setTimeout(done, 5000).unref(); }); browser.kill(); await exited; }
  await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
const sourceAfter = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(source, file)))])));
const passed = !!proof?.passed && !failure && !errors.length && !loadingFailures.length && JSON.stringify(sourceAfter) === JSON.stringify(sourceSHA);
const evidence = { ...metadata, ...proof, passed, failure, errors, loadingFailures, browser: browserVersion, loadedModules: [...loaded].sort(),
  sourceSHA256After: sourceAfter, sourceStableAtEnd: JSON.stringify(sourceAfter) === JSON.stringify(sourceSHA), completedAt: new Date().toISOString(),
  scope: 'Actual main local room publication/command/sync/reset correctness and independent unchanged builder + same Chromium Canvas full RGBA. Controlled clock/no RAF, no model payload prepare, no performance/FPS or real GPU assertion.' };
await writeFile(resolve(out, 'proof.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ out, passed, rows: proof?.rows?.length, errors, loadingFailures, failure }));
if (!passed) process.exitCode = 1;
