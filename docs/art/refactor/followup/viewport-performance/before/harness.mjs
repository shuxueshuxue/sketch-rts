import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-viewport.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0,900,9900').split(',').map(Number);
const outputDir = dirname(output), scratch = await mkdtemp('/tmp/sketch-viewport-browser-');
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
const hash = data => createHash('sha256').update(data).digest('hex');
const writeOutput = async extra => { await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Fixed visible world benchmark</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/art-viewport-fixture.js"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot) },
    plugins: [{ name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot] } } });
  await server.listen(); const address = server.httpServer.address();
  browser = spawn(arg('--chromium') ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((done, reject) => { const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 30000); browser.once('error', reject); browser.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); done(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  let serial = 0; const pending = new Map();
  socket.on('message', data => { const message = JSON.parse(String(data)); if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.done(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed') failed.push(message.params.errorText);
    if (message.method === 'Runtime.consoleAPICalled') { const values = message.params.args.map(arg => arg.value ?? arg.description); if (message.params.type === 'error') errors.push(values.join(' ')); if (values[0]?.startsWith?.('VIEWPORT ')) console.log(values.join(' ')); } });
  const command = (method, params = {}, sessionId) => new Promise((done, reject) => { const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 600000); pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }), { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable'); await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${address.port}` });
  const evaluate = async expression => { const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.viewportReview?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Fixture init timeout"));setTimeout(check,20)};check()})');
  const browserVersion = await command('Browser.getVersion');
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    const result = await evaluate(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames: Number(arg('--cpu-frames') ?? 360), realFrames: Number(arg('--real-frames') ?? 18) })})`);
    const screenshots = {};
    for (const [name, png] of Object.entries(result.screenshots)) { const bytes = Buffer.from(png.split(',')[1], 'base64'), filename = `${sourceCommit.slice(0, 8)}-hidden-${count}-cycle-${cycle}-${name}.png`; await writeFile(resolve(outputDir, filename), bytes); screenshots[name] = { path: filename, sha256: hash(bytes) }; }
    result.screenshots = screenshots; result.pixelProofSha256 = hash(JSON.stringify(result.pixelProof)); delete result.pixelProof;
    await page('HeapProfiler.collectGarbage'); result.heapAfterGc = await page('Runtime.getHeapUsage'); cycles.push(result); await writeOutput({ browserVersion, completed: false });
  }
  if (!process.argv.includes('--skip-simulation')) for (const count of counts) { console.log(`SIM hidden=${count}`); simulation.push({ hiddenCount: count, ...await evaluate(`window.viewportReview.simulation(${count})`) }); }
  await evaluate('window.viewportReview.teardown()'); await page('HeapProfiler.collectGarbage');
  const files = ['src/client/world-presentation.ts', 'src/client/world3d/world-layer.ts', 'src/client/world-renderer.ts', 'src/client/unit-animation.ts', 'src/client/combat-presentation.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: 'Frozen 100 visible units, same visible release/hit facts, 0/900/9900 offscreen units (8 kinds, stationary/moving/charge/attack/cast states). Two independent WorldPresentation lifetimes per size. CPU 360 measured frames after real-draw preparation and 60 CPU warmup frames, one fresh snapshot per three frames (20 Hz). Full WorldPresentation and nested World3DLayer submission timed separately. 18 real three-pass frames verify actual WebGL completion; Canvas/GPU deferred cost is included in complete-wall upper bound. Camera blank+return probes and composited PNGs. preserveDrawingBuffer enabled only for capture. Snapshot construction, GC and simulation excluded from presentation. SwiftShader results are not hardware FPS.' });
  if (violations.length) throw new Error(violations.join('\n'));
  console.log(JSON.stringify({ output, cycles: cycles.map(({ hiddenCount, cycle, cpu, real }) => ({ hiddenCount, cycle, cpu: cpu.fullPresentation, real: real.fullPresentationCompleteWall })) }));
} catch (error) { await writeOutput({ completed: false, failure: String(error) }); throw error; }
finally { socket?.close(); if (browser && browser.exitCode === null) browser.kill(); await server?.close(); await rm(scratch, { recursive: true, force: true }); }
