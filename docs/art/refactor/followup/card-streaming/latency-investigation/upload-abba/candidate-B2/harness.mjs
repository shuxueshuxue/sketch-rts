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
if (maxBanks !== 1 || mipMode !== 'native') throw new Error('Upload policy isolation requires one native-mip bank');
const uploadPolicy = arg('--upload-policy') ?? 'original';
if (!['original', 'candidate'].includes(uploadPolicy)) throw new Error('Use --upload-policy original|candidate');
const extraBaselineRoot = resolve(arg('--baseline-source') ?? '/tmp/sketch-latency-baseline');
const candidateSource = resolve(arg('--candidate-source') ?? '/tmp/card-upload-chunk-candidate.ts');
const scene = arg('--scene') ?? 'mixed';
if (!['canonical','mixed'].includes(scene)) throw new Error('Use --scene canonical|mixed');
const fixtureName = scene === 'mixed' ? 'art-viewport-bank-mixed-fixture.js' : 'art-viewport-bank-canonical-fixture.js';
if (!/^art-viewport-[a-z-]+\.js$/.test(fixtureName)) throw new Error('Fixture must be a viewport script basename');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-card-upload-formal/proof.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0').split(',').map(Number);
const paced = process.argv.includes('--paced'), cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
const outputDir = dirname(output);
await mkdir(dirname(outputDir), { recursive: true });
await mkdir(outputDir); // Intentionally exclusive: preserve earlier headers and failed outputs.
const scratch = await mkdtemp('/tmp/sketch-upload-formal-');
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const uploaderFile = 'src/client/world3d/card-mip-uploader.ts';
const regionFile = 'src/client/world3d/card-upload-region.ts';
const batchesFile = 'src/client/world3d/painted-card-batches.ts';
const maskFile = 'src/client/world3d/card-pick-mask.ts', cacheFile = 'src/client/world3d/card-raster-cache.ts';
const baselineUploaderPath = resolve(extraBaselineRoot, uploaderFile), currentUploaderPath = resolve(sourceRoot, uploaderFile);
const currentRegionPath = resolve(sourceRoot, regionFile), baselineRegionPath = resolve(extraBaselineRoot, regionFile);
const candidateRegionPath = resolve(dirname(candidateSource), 'card-upload-region.ts');
const expectedBaselineCommit = '5b356c7795068bb2a532ad1d486b3c22936cf735';
const extraBaselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: extraBaselineRoot, encoding: 'utf8' }).trim();
if (extraBaselineCommit !== expectedBaselineCommit) throw new Error('Original uploader must use the frozen 5b356c7 corpus');
const baselineUploaderSource = await readFile(baselineUploaderPath), currentUploaderSource = await readFile(currentUploaderPath);
const candidateUploaderSource = await readFile(candidateSource);
const currentRegionSource = await readFile(currentRegionPath), baselineRegionSource = await readFile(baselineRegionPath);
let candidateRegionSource;
try { candidateRegionSource = await readFile(candidateRegionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const currentBatchesSource = await readFile(resolve(sourceRoot, batchesFile));
const currentMaskSource = await readFile(resolve(sourceRoot, maskFile)), currentCacheSource = await readFile(resolve(sourceRoot, cacheFile));
const baselineUploaderSha256 = hash(baselineUploaderSource), currentUploaderSha256 = hash(currentUploaderSource), candidateUploaderSha256 = hash(candidateUploaderSource);
const currentRegionSha256 = hash(currentRegionSource), baselineRegionSha256 = hash(baselineRegionSource), candidateRegionSha256 = candidateRegionSource ? hash(candidateRegionSource) : null;
const corpusUploaderSha256 = hash(execFileSync('git', ['show', `${expectedBaselineCommit}:${uploaderFile}`], { cwd: extraBaselineRoot }));
if (baselineUploaderSha256 !== corpusUploaderSha256 || currentUploaderSha256 !== corpusUploaderSha256) throw new Error('Original baseline/current uploader must match frozen 5b bytes');
if (baselineRegionSha256 !== currentRegionSha256 || (candidateRegionSha256 !== null && candidateRegionSha256 !== currentRegionSha256)) throw new Error('Upload-region dependency must remain exact current/baseline bytes');
for (const [file, bytes] of [[uploaderFile,currentUploaderSource],[regionFile,currentRegionSource],[batchesFile,currentBatchesSource],[maskFile,currentMaskSource],[cacheFile,currentCacheSource]]) if (hash(bytes) !== allClientSourceSha256[file]) throw new Error('Source changed while initial snapshot was read: '+file);
if ([baselineUploaderPath,currentUploaderPath,currentRegionPath,baselineRegionPath].includes(candidateSource)) throw new Error('Candidate must be a separate standalone uploader TS module');
const parentHarnessSource = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-proof.mjs'));
const uploadLoaderSource = `// Balanced module imports. Neither uploader class nor texture factory is invoked.
const baselineRoot=__CARD_UPLOAD_BASELINE_SOURCE_ROOT__,candidatePath=__CARD_UPLOAD_CANDIDATE_SOURCE__,policy=__CARD_UPLOAD_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-mip-uploader.ts');
const candidate=await import(/* @vite-ignore */ '/@fs'+candidatePath);
for(const module of [baseline,candidate]){
 for(const name of ['CardMipUploader','createCardArray','cardTextureBytes'])if(typeof module[name]!=='function')throw new Error('Uploader module export missing '+name);
 for(const method of ['uploadLayer','copyLayers','stats','dispose','releaseSize'])if(typeof module.CardMipUploader.prototype[method]!=='function')throw new Error('Uploader interface missing '+method);
}
window.cardUploadFormal={ready:true,policy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',cachePolicy:'current production, untouched',
 providerPath:policy==='original'?baselineRoot+'/src/client/world3d/card-mip-uploader.ts':candidatePath,
 baselineModuleImportedWithoutInstantiation:true,candidateModuleImportedWithoutInstantiation:true,textureFactoriesCalledBySetup:false,
 setup:'Vite pre-resolve selects the complete uploader module only for current PaintedCardBatches ./card-mip-uploader. Provider region imports resolve to frozen current region bytes; external three resolves through the current source package. No instance/per-call monkey patch.'};
`;
const resolveRecords = [], dependencyResolveRecords = [], loadedUploaderModules = [];
const cleanModulePath = id => normalizePath(id.split('?')[0].replace(/^\/@fs(?=\/)/, ''));
const selectedUploaderPath = uploadPolicy === 'original' ? baselineUploaderPath : candidateSource;
const selectedUploaderSha256 = uploadPolicy === 'original' ? baselineUploaderSha256 : candidateUploaderSha256;
const providerImporters = new Set([normalizePath(baselineUploaderPath),normalizePath(candidateSource)]);
const uploadResolver = {
  name: 'exact-current-painted-card-upload-policy', enforce: 'pre',
  async resolveId(request, importer) {
    if (!importer) return null;
    const from = cleanModulePath(importer);
    if (request === './card-mip-uploader' && from === normalizePath(resolve(sourceRoot,batchesFile))) {
      resolveRecords.push({request,importer,policy:uploadPolicy,redirected:true,resolvedId:selectedUploaderPath,providerSha256:selectedUploaderSha256});
      return selectedUploaderPath;
    }
    if (providerImporters.has(from) && request === './card-upload-region') {
      dependencyResolveRecords.push({request,importer,resolvedId:currentRegionPath,sha256:currentRegionSha256,scope:'Exact importer-scoped unchanged dependency'});
      return currentRegionPath;
    }
    if (providerImporters.has(from) && request === 'three') {
      // A /tmp standalone module has no node_modules parent. Resolve through
      // the same current-source importer as ordinary production, not another Three copy.
      const resolved = await this.resolve('three',currentUploaderPath,{skipSelf:true});
      if (!resolved) throw new Error('Current production three dependency could not resolve');
      dependencyResolveRecords.push({request,importer,resolvedId:resolved.id,scope:'Same current production package resolver'});
      return resolved;
    }
    return null;
  },
  load(id) {
    const clean = cleanModulePath(id);
    if (clean === normalizePath(currentRegionPath)) {
      loadedUploaderModules.push({id,path:clean,kind:'unchanged-region',sha256:currentRegionSha256,servedFromRunStartSnapshot:true});
      return currentRegionSource.toString('utf8');
    }
    if (clean === normalizePath(baselineUploaderPath) || clean === normalizePath(candidateSource)) {
      const original = clean === normalizePath(baselineUploaderPath);
      loadedUploaderModules.push({id,path:clean,kind:'uploader',sha256:original?baselineUploaderSha256:candidateUploaderSha256,servedFromRunStartSnapshot:true});
      return (original?baselineUploaderSource:candidateUploaderSource).toString('utf8');
    }
    return null;
  },
};
const uploadIsolation = {policy:uploadPolicy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',cachePolicy:'current production, untouched',
  extraBaselineRoot,extraBaselineCommit,candidateSource,extraBaselineDirty:execFileSync('git',['status','--porcelain'],{cwd:extraBaselineRoot,encoding:'utf8'}),
  baselineUploaderSha256,corpusUploaderSha256,currentUploaderSha256,candidateUploaderSha256,
  dependencies:{currentRegionPath,baselineRegionPath,candidateRegionPath,currentRegionSha256,baselineRegionSha256,candidateRegionSha256,candidateRegionFilePresent:candidateRegionSource!==undefined},
  actualProviderPath:selectedUploaderPath,actualProviderSha256:selectedUploaderSha256,
  currentBatchesSha256:hash(currentBatchesSource),currentMaskSha256:hash(currentMaskSource),currentCacheSha256:hash(currentCacheSource),
  loaderSha256:hash(uploadLoaderSource),parentHarnessSha256:hash(parentHarnessSource),resolveRecords,dependencyResolveRecords,loadedUploaderModules,
  scope:'Complete upload-module isolation on one frozen current renderer. Peak/mask/cache are current. No calls are wrapped or observed. Candidate copy-call counters may rise; validate GPU page/order/RGBA/upload-byte equality and mask/cache/resource facts separately, never infer equality from design.'};
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => { await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ uploadIsolation, variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(scratch, 'upload-loader.js'), uploadLoaderSource);
  await writeFile(resolve(outputDir, 'upload-loader.js'), uploadLoaderSource);
  await writeFile(resolve(outputDir, 'parent-harness.mjs'), parentHarnessSource);
  await mkdir(resolve(outputDir, 'source-snapshot'), { recursive: true });
  const sourceSnapshots = [['baseline-card-mip-uploader.ts',baselineUploaderSource],['current-card-mip-uploader.ts',currentUploaderSource],['candidate-card-mip-uploader.ts',candidateUploaderSource],['baseline-card-upload-region.ts',baselineRegionSource],['current-card-upload-region.ts',currentRegionSource],['current-painted-card-batches.ts',currentBatchesSource],['current-card-pick-mask.ts',currentMaskSource],['current-card-raster-cache.ts',currentCacheSource]];
  if (candidateRegionSource) sourceSnapshots.push(['candidate-card-upload-region.ts',candidateRegionSource]);
  for (const [name,bytes] of sourceSnapshots) await writeFile(resolve(outputDir,'source-snapshot',name),bytes);
  await writeFile(resolve(outputDir, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)));
  await writeFile(resolve(outputDir, 'fixture.js'), await readFile(resolve(harnessRoot, 'scripts', fixtureName)));
  await writeFile(resolve(outputDir, 'bank-variant.js'), variantHelper);
  await writeFile(resolve(outputDir, 'viewport-metadata.js'), viewportMetadata);
  await writeFile(resolve(outputDir, 'fact-fixture.js'), await readFile(resolve(harnessRoot, 'scripts', scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js')));
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Fixed visible world benchmark</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant), __CARD_UPLOAD_POLICY__: JSON.stringify(uploadPolicy), __CARD_UPLOAD_BASELINE_SOURCE_ROOT__: JSON.stringify(extraBaselineRoot), __CARD_UPLOAD_CANDIDATE_SOURCE__: JSON.stringify(candidateSource) },
    plugins: [uploadResolver, { name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot, extraBaselineRoot, dirname(candidateSource)] } } });
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
  await evaluate(`import('/upload-loader.js').then(()=>window.cardUploadFormal.ready)`);
  uploadIsolation.moduleSetup = await evaluate('window.cardUploadFormal');
  for (const provider of [baselineUploaderPath,candidateSource]) {
    if (!loadedUploaderModules.some(record=>record.kind==='uploader'&&record.path===normalizePath(provider))) throw new Error('Balanced provider import was not observed: '+provider);
    if (!dependencyResolveRecords.some(record=>cleanModulePath(record.importer)===normalizePath(provider)&&record.request==='./card-upload-region'&&record.sha256===currentRegionSha256)) throw new Error('Pinned region dependency was not observed: '+provider);
    if (!dependencyResolveRecords.some(record=>cleanModulePath(record.importer)===normalizePath(provider)&&record.request==='three')) throw new Error('Production Three dependency resolution was not observed: '+provider);
  }
  if (new Set(dependencyResolveRecords.filter(record=>record.request==='three').map(record=>record.resolvedId)).size!==1) throw new Error('External providers resolved different Three module identities');
  if (!resolveRecords.length || resolveRecords.some(record => cleanModulePath(record.resolvedId) !== normalizePath(selectedUploaderPath))) throw new Error('Uploader resolver did not apply the declared policy');
  const browserVersion = await command('Browser.getVersion');
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    const result = await evaluate(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames, realFrames, paced })})`);
    // Read only the fixture's already-collected untimed counters. Keep every
    // candidate scalar (including any extra partial copy-call count) verbatim.
    result.uploadPolicyResources = Object.fromEntries(['before','empty','returned'].map(phase=>[phase,result[phase].cards]));
    const screenshots = {};
    for (const [name, png] of Object.entries(result.screenshots)) { const bytes = Buffer.from(png.split(',')[1], 'base64'), filename = `${sourceCommit.slice(0, 8)}-hidden-${count}-cycle-${cycle}-${name}.png`; await writeFile(resolve(outputDir, filename), bytes); screenshots[name] = { path: filename, sha256: hash(bytes) }; }
    result.screenshots = screenshots; result.pixelProofSha256 = hash(JSON.stringify(result.pixelProof)); result.capturedVisibleSnapshotSha256 = hash(JSON.stringify({ units: result.pixelProof.visibleUnitFacts, effects: result.pixelProof.visibleEffectFacts, tick: result.pixelProof.tick })); // Retain raw visible facts.
    await page('HeapProfiler.collectGarbage'); result.heapAfterGc = await page('Runtime.getHeapUsage'); cycles.push(result); await writeOutput({ browserVersion, completed: false });
  }
  if (!process.argv.includes('--skip-simulation')) for (const count of counts) { console.log(`SIM hidden=${count}`); simulation.push({ hiddenCount: count, ...await evaluate(`window.viewportReview.simulation(${count})`) }); }
  await evaluate('window.viewportReview.teardown()'); await page('HeapProfiler.collectGarbage');
  const files = ['src/client/world-presentation.ts', 'src/client/world3d/world-layer.ts', 'src/client/world-renderer.ts', 'src/client/unit-animation.ts', 'src/client/combat-presentation.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  const finalClientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
  const finalClientSourceSha256 = Object.fromEntries(await Promise.all(finalClientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  uploadIsolation.finalClientSourceSha256 = finalClientSourceSha256;
  uploadIsolation.currentSourceStayedFrozen = JSON.stringify(finalClientSourceSha256) === JSON.stringify(allClientSourceSha256);
  uploadIsolation.baselineSourceStayedFrozen = hash(await readFile(baselineUploaderPath)) === baselineUploaderSha256;
  uploadIsolation.candidateSourceStayedFrozen = hash(await readFile(candidateSource)) === candidateUploaderSha256;
  uploadIsolation.baselineRegionStayedFrozen = hash(await readFile(baselineRegionPath)) === baselineRegionSha256;
  uploadIsolation.candidateRegionStayedFrozen = candidateRegionSource === undefined || hash(await readFile(candidateRegionPath)) === candidateRegionSha256;
  if (!uploadIsolation.baselineRegionStayedFrozen || !uploadIsolation.candidateRegionStayedFrozen) errors.push('Uploader region dependency changed during measurement');
  if (!uploadIsolation.currentSourceStayedFrozen || !uploadIsolation.baselineSourceStayedFrozen || !uploadIsolation.candidateSourceStayedFrozen) errors.push('Source bytes changed during upload-policy measurement');
  if (!resolveRecords.length || resolveRecords.some(record => cleanModulePath(record.resolvedId) !== normalizePath(selectedUploaderPath))) errors.push('Invalid uploader provider resolution evidence');
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `Unprofiled complete uploader-module isolation (${uploadPolicy}), not production integration. Both sides retain the same current peak accounting, mask and cache implementations, art, thresholds, ordering, timers and original fixture. Vite redirects only current PaintedCardBatches './card-mip-uploader' to the frozen 5b uploader or standalone candidate; required uploader/texture-factory/byte-count exports are checked without invocation. Original uploader bytes must match current production exactly. Both external modules are imported before preparation without instantiation; their unchanged region helper is pinned to current run-start bytes, and their Three import resolves through the current production package. No function wrappers, per-call observer, extra flush, fence or render. Raw candidate counters remain complete; copy calls may increase, while PNG RGBA, GPU pages/order/upload bytes and mask/cache ownership need actual separate comparison rather than assumed equality. Frozen clocks: 18 preparation draws n=0..51, 60 CPU warmups, ${cpuFrames} paced=${paced} CPU samples n=114, ${realFrames} real samples n=480 including the first cold pose-streaming jump, then unchanged empty/return probes. Default two lifetimes and hidden0, ABBA externally scheduled. Complete wall includes Canvas/submission/completion/scheduling; CPU samples retain the original renderer.render no-op. Snapshot/capture/GC stay outside timing. Output directories are exclusive; previous raw headers and failures are never overwritten.` });
  if (violations.length) throw new Error(violations.join('\n'));
  console.log(JSON.stringify({ output, cycles: cycles.map(({ hiddenCount, cycle, cpu, real }) => ({ hiddenCount, cycle, cpu: cpu.fullPresentation, real: real.fullPresentationCompleteWall })) }));
} catch (error) { await writeOutput({ completed: false, failure: String(error), failureStack: error.stack }); throw error; }
finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise(done => { browser.once('exit', done); setTimeout(done, 5000).unref(); });
    browser.kill(); await closed;
  }
  await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
