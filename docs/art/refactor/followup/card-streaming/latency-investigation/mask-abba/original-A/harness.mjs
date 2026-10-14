import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, normalizePath } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maxBanks = Number(arg('--max-banks') ?? 1), mipMode = arg('--mips') ?? 'native';
if (!Number.isInteger(maxBanks) || maxBanks < 1 || maxBanks > 8 || !['native', 'full'].includes(mipMode)) throw new Error('Use --max-banks 1..8 and --mips native|full');
const variant = { name: arg('--variant') ?? `ordered-bank-${maxBanks}-${mipMode}`, maxBanks, mips: mipMode,
  ordering: 'production stable snapshot ordering', referenceOverrides: mipMode === 'full' ? ['residentMip returns 0'] : [] };
if (maxBanks !== 1 || mipMode !== 'native') throw new Error('Mask policy isolation requires one native-mip bank');
const maskPolicy = arg('--mask-policy') ?? 'production';
if (!['original', 'production'].includes(maskPolicy)) throw new Error('Use --mask-policy original|production');
const extraBaselineRoot = resolve(arg('--baseline-source') ?? '/tmp/sketch-latency-baseline');
const scene = arg('--scene') ?? 'mixed';
if (!['canonical','mixed'].includes(scene)) throw new Error('Use --scene canonical|mixed');
const fixtureName = scene === 'mixed' ? 'art-viewport-bank-mixed-fixture.js' : 'art-viewport-bank-canonical-fixture.js';
if (!/^art-viewport-[a-z-]+\.js$/.test(fixtureName)) throw new Error('Fixture must be a viewport script basename');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-card-mask-formal/proof.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0,900,9900').split(',').map(Number);
const paced = process.argv.includes('--paced'), cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
const outputDir = dirname(output), scratch = await mkdtemp('/tmp/sketch-viewport-browser-');
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const maskFile = 'src/client/world3d/card-pick-mask.ts';
const batchesFile = 'src/client/world3d/painted-card-batches.ts';
const baselineMaskPath = resolve(extraBaselineRoot, maskFile), currentMaskPath = resolve(sourceRoot, maskFile);
const expectedBaselineCommit = '5b356c7795068bb2a532ad1d486b3c22936cf735';
const extraBaselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: extraBaselineRoot, encoding: 'utf8' }).trim();
if (extraBaselineCommit !== expectedBaselineCommit) throw new Error('Baseline mask must use the frozen 5b356c7 corpus');
const baselineMaskSource = await readFile(baselineMaskPath), currentMaskSource = await readFile(currentMaskPath);
const currentBatchesSource = await readFile(resolve(sourceRoot, batchesFile));
const baselineMaskSha256 = hash(baselineMaskSource), currentMaskSha256 = hash(currentMaskSource);
const corpusMaskSha256 = hash(execFileSync('git', ['show', `${expectedBaselineCommit}:${maskFile}`], { cwd: extraBaselineRoot }));
if (baselineMaskSha256 !== corpusMaskSha256) throw new Error('Baseline mask file differs from frozen corpus bytes');
if (currentMaskSha256 !== allClientSourceSha256[maskFile] || hash(currentBatchesSource) !== allClientSourceSha256[batchesFile]) throw new Error('Current source changed while initial snapshot was read');
const parentHarnessSource = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-proof.mjs'));
const maskLoaderSource = `// Balanced untimed module preparation, not a production fallback. No functions are called.
const baselineRoot=__CARD_MASK_BASELINE_SOURCE_ROOT__,sourceRoot=__BENCHMARK_SOURCE_ROOT__,policy=__CARD_MASK_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-pick-mask.ts');
const current=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/card-pick-mask.ts');
if(typeof baseline.packCardPickMask!=='function'||typeof current.packCardPickMask!=='function')throw new Error('Mask module exports unavailable');
if(baseline.cardMaskHit.toString()!==current.cardMaskHit.toString())throw new Error('Public cardMaskHit implementation changed: this comparison must isolate packing');
window.cardMaskFormal={ready:true,policy,peakPolicy:'current production, untouched',
 providerRoot:policy==='original'?baselineRoot:sourceRoot,providerFile:'src/client/world3d/card-pick-mask.ts',
 baselineModuleImportedWithoutCalling:true,currentModuleImportedWithoutCalling:true,publicCardMaskHitFunctionSourceIdentical:true,
 setup:'Vite pre-resolve override only for the current PaintedCardBatches import of ./card-pick-mask; no instance or per-frame monkey patch.'};
`;
const resolveRecords = [], loadedMaskModules = [];
const cleanModulePath = id => normalizePath(id.split('?')[0].replace(/^\/@fs(?=\/)/, ''));
const selectedMaskPath = maskPolicy === 'original' ? baselineMaskPath : currentMaskPath;
const maskResolver = {
  name: 'exact-current-painted-card-mask-policy', enforce: 'pre',
  async resolveId(request, importer) {
    if (request !== './card-pick-mask' || !importer || cleanModulePath(importer) !== normalizePath(resolve(sourceRoot, batchesFile))) return null;
    const productionResolution = maskPolicy === 'production' ? await this.resolve(request, importer, { skipSelf: true }) : null;
    const resolvedId = maskPolicy === 'original' ? baselineMaskPath : productionResolution?.id;
    if (!resolvedId || cleanModulePath(resolvedId) !== normalizePath(selectedMaskPath)) throw new Error('Unexpected mask resolver provider');
    resolveRecords.push({ request, importer, policy: maskPolicy, redirected: maskPolicy === 'original', resolvedId,
      providerSha256: maskPolicy === 'original' ? baselineMaskSha256 : currentMaskSha256 });
    // Production keeps the ordinary resolver. Only this exact import redirects.
    return maskPolicy === 'original' ? baselineMaskPath : null;
  },
  load(id) {
    const clean = cleanModulePath(id);
    if (clean === normalizePath(baselineMaskPath) || clean === normalizePath(currentMaskPath)) loadedMaskModules.push({ id, path: clean });
    return null;
  },
};
const maskIsolation = { policy: maskPolicy, peakPolicy: 'current production, untouched', extraBaselineRoot, extraBaselineCommit,
  extraBaselineDirty: execFileSync('git', ['status', '--porcelain'], { cwd: extraBaselineRoot, encoding: 'utf8' }),
  baselineMaskSha256, corpusMaskSha256, currentMaskSha256, actualProviderPath: selectedMaskPath,
  actualProviderSha256: maskPolicy === 'original' ? baselineMaskSha256 : currentMaskSha256,
  currentBatchesSha256: hash(currentBatchesSource), loaderSha256: hash(maskLoaderSource), parentHarnessSha256: hash(parentHarnessSource),
  resolveRecords, loadedMaskModules,
  scope: 'Unprofiled same-current-source mask packing isolation. Both policies keep current peak accounting and one native-mip bank; a compile-time diagnostic resolver replaces only the exact current PaintedCardBatches mask import for original. Neither policy has per-frame observation or extra picking.' };
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => { await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ maskIsolation, variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(scratch, 'mask-loader.js'), maskLoaderSource);
  await writeFile(resolve(outputDir, 'mask-loader.js'), maskLoaderSource);
  await writeFile(resolve(outputDir, 'parent-harness.mjs'), parentHarnessSource);
  await mkdir(resolve(outputDir, 'source-snapshot'), { recursive: true });
  await writeFile(resolve(outputDir, 'source-snapshot/baseline-card-pick-mask.ts'), baselineMaskSource);
  await writeFile(resolve(outputDir, 'source-snapshot/current-card-pick-mask.ts'), currentMaskSource);
  await writeFile(resolve(outputDir, 'source-snapshot/current-painted-card-batches.ts'), currentBatchesSource);
  await writeFile(resolve(outputDir, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)));
  await writeFile(resolve(outputDir, 'fixture.js'), await readFile(resolve(harnessRoot, 'scripts', fixtureName)));
  await writeFile(resolve(outputDir, 'bank-variant.js'), variantHelper);
  await writeFile(resolve(outputDir, 'viewport-metadata.js'), viewportMetadata);
  await writeFile(resolve(outputDir, 'fact-fixture.js'), await readFile(resolve(harnessRoot, 'scripts', scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js')));
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Fixed visible world benchmark</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant), __CARD_MASK_POLICY__: JSON.stringify(maskPolicy), __CARD_MASK_BASELINE_SOURCE_ROOT__: JSON.stringify(extraBaselineRoot) },
    plugins: [maskResolver, { name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot, extraBaselineRoot] } } });
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
  await evaluate(`import('/@fs${harnessRoot}/scripts/art-card-bank-viewport-metadata.js').then(()=>window.cardBankPerformanceMetadata.installed)`);
  await evaluate(`import('/mask-loader.js').then(()=>window.cardMaskFormal.ready)`);
  maskIsolation.moduleSetup = await evaluate('window.cardMaskFormal');
  if (!resolveRecords.length || resolveRecords.some(record => record.redirected !== (maskPolicy === 'original'))) throw new Error('Mask resolver did not apply the declared policy');
  const browserVersion = await command('Browser.getVersion');
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    const result = await evaluate(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames, realFrames, paced })})`);
    const screenshots = {};
    for (const [name, png] of Object.entries(result.screenshots)) { const bytes = Buffer.from(png.split(',')[1], 'base64'), filename = `${sourceCommit.slice(0, 8)}-hidden-${count}-cycle-${cycle}-${name}.png`; await writeFile(resolve(outputDir, filename), bytes); screenshots[name] = { path: filename, sha256: hash(bytes) }; }
    result.screenshots = screenshots; result.pixelProofSha256 = hash(JSON.stringify(result.pixelProof)); result.capturedVisibleSnapshotSha256 = hash(JSON.stringify({ units: result.pixelProof.visibleUnitFacts, effects: result.pixelProof.visibleEffectFacts, tick: result.pixelProof.tick })); // Keep raw visible facts.
    await page('HeapProfiler.collectGarbage'); result.heapAfterGc = await page('Runtime.getHeapUsage'); cycles.push(result); await writeOutput({ browserVersion, completed: false });
  }
  if (!process.argv.includes('--skip-simulation')) for (const count of counts) { console.log(`SIM hidden=${count}`); simulation.push({ hiddenCount: count, ...await evaluate(`window.viewportReview.simulation(${count})`) }); }
  await evaluate('window.viewportReview.teardown()'); await page('HeapProfiler.collectGarbage');
  const files = ['src/client/world-presentation.ts', 'src/client/world3d/world-layer.ts', 'src/client/world-renderer.ts', 'src/client/unit-animation.ts', 'src/client/combat-presentation.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  const finalClientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
  const finalClientSourceSha256 = Object.fromEntries(await Promise.all(finalClientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  maskIsolation.finalClientSourceSha256 = finalClientSourceSha256;
  maskIsolation.currentSourceStayedFrozen = JSON.stringify(finalClientSourceSha256) === JSON.stringify(allClientSourceSha256);
  maskIsolation.baselineSourceStayedFrozen = hash(await readFile(baselineMaskPath)) === baselineMaskSha256;
  if (!maskIsolation.currentSourceStayedFrozen || !maskIsolation.baselineSourceStayedFrozen) errors.push('Source bytes changed during mask-policy measurement');
  if (!resolveRecords.length || resolveRecords.some(record => record.redirected !== (maskPolicy === 'original') || cleanModulePath(record.resolvedId) !== normalizePath(selectedMaskPath))) errors.push('Invalid mask provider resolution evidence');
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `Unprofiled same-current-source mask packing policy isolation (${maskPolicy}). Both sides retain current production peak accounting, art, threshold, allocation, transfer, draw order, timers and completion behavior. Vite redirects only current PaintedCardBatches './card-pick-mask' to the frozen 5b mask module for original; production follows the normal resolver. Both modules are imported without invocation before cycles to balance preparation. Public cardMaskHit function source must remain identical. No per-frame observer or extra timer/picking calls. Frozen fixture clocks are unchanged: 18 preparation draws at n=0..51, 60 CPU warmups, ${cpuFrames} paced=${paced} CPU samples starting n=114, ${realFrames} real frames starting n=480, then unchanged three camera captures. Default two lifetimes per hidden population; ABBA scheduled externally. CPU samples still replace renderer.render with the original no-op; complete wall includes Canvas, submission, true completion and scheduler effects, not pure GPU time. Raw visible snapshot facts and pixel hashes, resource counters, resolver/provider/source SHA evidence are retained. This harness does not invent new picking facts: separate camera correctness proofs validate actual picks and transparent-mask behavior.` });
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
