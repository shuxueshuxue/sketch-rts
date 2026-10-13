import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';
import { createMipHalfProviders, prepareMipHalfDependencyRoot, mipHalfOptimizeDepsV2 } from './art-card-mip-half-provider-v2.mjs';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gateMode=arg('--mode')??'candidate';
if(!['reference','production','candidate'].includes(gateMode))throw new Error('Use --mode reference|production|candidate');
const maxBanks = Number(arg('--max-banks') ?? 1), mipMode = arg('--mips') ?? 'native';
if(maxBanks!==1||mipMode!=='native')throw new Error('Half-margin proof keeps one-bank implicit sampling; the complete gate module selects residency');
if (!Number.isInteger(maxBanks) || maxBanks < 1 || maxBanks > 8 || !['native', 'full'].includes(mipMode)) throw new Error('Use --max-banks 1..8 and --mips native|full');
const variant = { name: arg('--variant') ?? `mip-half-${gateMode}`, maxBanks, mips: mipMode,
  ordering: 'production stable snapshot ordering', referenceOverrides: mipMode === 'full' ? ['residentMip returns 0'] : [] };
const scene = arg('--scene') ?? 'canonical';
if (!['canonical','mixed'].includes(scene)) throw new Error('Use --scene canonical|mixed');
const fixtureName = scene === 'mixed' ? 'art-viewport-bank-mixed-fixture.js' : 'art-viewport-bank-canonical-fixture.js';
if (!/^art-viewport-[a-z-]+\.js$/.test(fixtureName)) throw new Error('Fixture must be a viewport script basename');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? `docs/art/refactor/followup/card-streaming/stall-followup/mip-half-viewport-v2/${gateMode}/raw.json`);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0,900,9900').split(',').map(Number);
const paced = process.argv.includes('--paced'), cpuFrames = Number(arg('--cpu-frames') ?? 360), realFrames = Number(arg('--real-frames') ?? 18);
const outputDir=dirname(output);
await mkdir(dirname(outputDir),{recursive:true});await mkdir(outputDir); // Never overwrite evidence.
const scratch=await mkdtemp('/tmp/sketch-mip-half-viewport-v2-');
let gateProviders;
const candidateSource=resolve(arg('--candidate-source')??'/tmp/card-mip-half-margin-candidate.ts');
const providerHelperBytes=await readFile(resolve(harnessRoot,'scripts/art-card-mip-half-provider-v2.mjs'));
const parentHarnessBytes=await readFile(resolve(harnessRoot,'scripts/art-card-bank-viewport-proof.mjs'));
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => { await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ gateIsolation:gateProviders?.metadata,providerHelperSha256:hash(providerHelperBytes),parentHarnessSha256:hash(parentHarnessBytes), variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  gateProviders=await createMipHalfProviders({sourceRoot,harnessRoot,candidateSource,mode:gateMode,scratch,outputDir});
  await gateProviders.archive();
  await writeFile(resolve(outputDir,'provider-helper.mjs'),providerHelperBytes);
  await writeFile(resolve(outputDir,'parent-viewport-harness.mjs'),parentHarnessBytes);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)));
  await writeFile(resolve(outputDir, 'fixture.js'), await readFile(resolve(harnessRoot, 'scripts', fixtureName)));
  await writeFile(resolve(outputDir, 'bank-variant.js'), variantHelper);
  await writeFile(resolve(outputDir, 'viewport-metadata.js'), viewportMetadata);
  await writeFile(resolve(outputDir, 'fact-fixture.js'), await readFile(resolve(harnessRoot, 'scripts', scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js')));
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Fixed visible world benchmark</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`);
  const dependencyRoot=await prepareMipHalfDependencyRoot(scratch,sourceRoot);
  server = await createServer({ configFile: false, root: scratch, optimizeDeps:mipHalfOptimizeDepsV2(), publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant) },
    plugins: [gateProviders.plugin, { name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot,...gateProviders.allowed] } } });
  await server.listen();
  await gateProviders.inspectStartup(server,dependencyRoot);
  await writeOutput({completed:false,dependencyPreparationComplete:true});
  const address = server.httpServer.address();
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
  await evaluate(`import('/@fs${harnessRoot}/scripts/art-card-bank-viewport-metadata.js').then(()=>window.cardBankPerformanceMetadata.installed)`);
  await gateProviders.inspectRuntime(evaluate);
  const browserVersion = await command('Browser.getVersion');
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    const result = await evaluate(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames, realFrames, paced })})`);
    const screenshots = {};
    for (const [name, png] of Object.entries(result.screenshots)) { const bytes = Buffer.from(png.split(',')[1], 'base64'), filename = `${sourceCommit.slice(0, 8)}-hidden-${count}-cycle-${cycle}-${name}.png`; await writeFile(resolve(outputDir, filename), bytes); screenshots[name] = { path: filename, sha256: hash(bytes) }; }
    result.screenshots = screenshots; result.pixelProofSha256 = hash(JSON.stringify(result.pixelProof)); delete result.pixelProof;
    await page('HeapProfiler.collectGarbage'); result.heapAfterGc = await page('Runtime.getHeapUsage'); cycles.push(result); await writeOutput({ browserVersion, completed: false });
  }
  if (!process.argv.includes('--skip-simulation')) for (const count of counts) { console.log(`SIM hidden=${count}`); simulation.push({ hiddenCount: count, ...await evaluate(`window.viewportReview.simulation(${count})`) }); }
  await evaluate('window.viewportReview.teardown()'); await page('HeapProfiler.collectGarbage');
  const files = ['src/client/world-presentation.ts', 'src/client/world3d/world-layer.ts', 'src/client/world-renderer.ts', 'src/client/unit-animation.ts', 'src/client/combat-presentation.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  await gateProviders.finish(server);
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `Independent same-8345 complete-gate policy comparison. Mode reference uses the complete production gate with final base 0; production uses one-level margin; candidate uses half-level margin. Every mode keeps one-bank original implicit sampling, exact original GPU-generated mip copies, source geometry, painting, ordering, picking and inputs. No per-frame wrapper. A reference/candidate comparison concerns full versus half-native residency; only production/candidate isolates the margin. Anisotropic filtering and mip generation are implementation dependent; pixel equivalence requires separate proof. Warm finer cards do not demote. Variant setup precedes prepare/first draw; resource metadata is collected only by untimed counter calls. ${scene==='mixed'?'Mixed 20 authored kinds, 100 visible units in idle/walk/attack/cast/carry groups':'Canonical 100 visible units (footman/lancer/archer/priest), matching visible release/hit facts'}, hidden populations ${counts.join('/')}, ${repeats} independent WorldPresentation lifetimes per population. Preparation performs 18 real draws at n=0..51 then 60 CPU warmup frames; this does not prewarm every later pose. ${cpuFrames} paced=${paced} measured CPU frames from n=114, one fresh snapshot per three frames. CPU samples disable renderer.render only: rasterization, texture transfers and possible driver backpressure remain. ${realFrames} real three-pass frames begin at n=480; with mixed cpuFrames=60, this deliberately preserves the original fixture's n=173->480 pose-streaming jump (~5.1 seconds), including its first cold-stream sample. Full presentation and nested World3DLayer costs are not additive. Real complete wall includes Canvas work, GPU fence completion and event-loop scheduling, not GPU timer-query duration or hardware FPS. Camera blank/return images and same-source facts are verified strictly. Snapshot construction, simulation, capture and GC are outside measured draws.` });
  if (violations.length) throw new Error(violations.join('\n'));
  console.log(JSON.stringify({ output, cycles: cycles.map(({ hiddenCount, cycle, cpu, real }) => ({ hiddenCount, cycle, cpu: cpu.fullPresentation, real: real.fullPresentationCompleteWall })) }));
} catch (error) { await writeOutput({ completed: false, failure: String(error) }); throw error; }
finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise(done => { browser.once('exit', done); setTimeout(done, 5000).unref(); });
    browser.kill(); await closed;
  }
  await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
