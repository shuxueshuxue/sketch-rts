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
if (maxBanks !== 1 || mipMode !== 'native') throw new Error('RLE policy isolation requires one native-mip bank');
const cachePolicy = arg('--cache-policy') ?? 'original';
if (!['original', 'candidate'].includes(cachePolicy)) throw new Error('Use --cache-policy original|candidate');
const extraBaselineRoot = resolve(arg('--baseline-source') ?? '/tmp/sketch-latency-baseline');
const candidateSource = resolve(arg('--candidate-source') ?? '/tmp/rle-budget-only16-candidate.ts');
const candidateBudgetBytes = Number(arg('--candidate-budget-bytes') ?? 16777216);
if (candidateBudgetBytes !== 16777216) throw new Error('Budget-only isolation requires exactly 16777216 candidate bytes; this is validation, not a constructor override');
const originalBudgetBytes = 50331648;
const expectedBudgetBytes = cachePolicy === 'original' ? originalBudgetBytes : candidateBudgetBytes;
const scene = arg('--scene') ?? 'mixed';
if (!['canonical','mixed'].includes(scene)) throw new Error('Use --scene canonical|mixed');
const fixtureName = scene === 'mixed' ? 'art-viewport-bank-mixed-fixture.js' : 'art-viewport-bank-canonical-fixture.js';
if (!/^art-viewport-[a-z-]+\.js$/.test(fixtureName)) throw new Error('Fixture must be a viewport script basename');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-card-rle-budget-only-formal/proof.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 1), counts = (arg('--hidden') ?? '0').split(',').map(Number);
const paced = process.argv.includes('--paced'), cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
const outputDir = dirname(output);
await mkdir(dirname(outputDir), { recursive: true });
await mkdir(outputDir); // Intentionally exclusive: preserve earlier headers and failed outputs.
const scratch = await mkdtemp('/tmp/sketch-rle-budget-only-formal-');
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const cacheFile = 'src/client/world3d/card-raster-cache.ts';
const batchesFile = 'src/client/world3d/painted-card-batches.ts';
const maskFile = 'src/client/world3d/card-pick-mask.ts';
const baselineCachePath = resolve(extraBaselineRoot, cacheFile), currentCachePath = resolve(sourceRoot, cacheFile);
const expectedBaselineCommit = '5b356c7795068bb2a532ad1d486b3c22936cf735';
const extraBaselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: extraBaselineRoot, encoding: 'utf8' }).trim();
if (extraBaselineCommit !== expectedBaselineCommit) throw new Error('Original cache must use the frozen 5b356c7 corpus');
const baselineCacheSource = await readFile(baselineCachePath), currentCacheSource = await readFile(currentCachePath);
const candidateCacheSource = await readFile(candidateSource);
const currentBatchesSource = await readFile(resolve(sourceRoot, batchesFile)), currentMaskSource = await readFile(resolve(sourceRoot, maskFile));
const baselineCacheSha256 = hash(baselineCacheSource), currentCacheSha256 = hash(currentCacheSource), candidateCacheSha256 = hash(candidateCacheSource);
const corpusCacheSha256 = hash(execFileSync('git', ['show', `${expectedBaselineCommit}:${cacheFile}`], { cwd: extraBaselineRoot }));
if (baselineCacheSha256 !== corpusCacheSha256 || currentCacheSha256 !== corpusCacheSha256) throw new Error('Original baseline/current cache must match the frozen corpus exactly');
if (currentCacheSha256 !== allClientSourceSha256[cacheFile] || hash(currentBatchesSource) !== allClientSourceSha256[batchesFile] || hash(currentMaskSource) !== allClientSourceSha256[maskFile]) throw new Error('Current source changed while initial snapshot was read');
if (candidateSource === baselineCachePath || candidateSource === currentCachePath) throw new Error('Candidate must be a separate standalone TS file');
const originalConstructor = 'constructor(private budget=48*1024*1024){}';
const candidateConstructor = 'constructor(private budget=16*1024*1024){}';
if (baselineCacheSource.toString('utf8').split(originalConstructor).length !== 2 || !candidateCacheSource.equals(Buffer.from(baselineCacheSource.toString('utf8').replace(originalConstructor, candidateConstructor)))) throw new Error('Budget-only candidate must equal original source bytes except the single default constructor budget 48 to 16 MiB');
const parentHarnessSource = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-proof.mjs'));
const cacheLoaderSource = `// Balanced module preparation. Neither external class is instantiated here.
const baselineRoot=__CARD_RLE_BASELINE_SOURCE_ROOT__,candidatePath=__CARD_RLE_CANDIDATE_SOURCE__,policy=__CARD_RLE_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-raster-cache.ts');
const candidate=await import(/* @vite-ignore */ '/@fs'+candidatePath);
for(const module of [baseline,candidate]){
 if(typeof module.CardRasterCache!=='function')throw new Error('Complete CardRasterCache class export required');
 for(const method of ['get','put','clear','stats'])if(typeof module.CardRasterCache.prototype[method]!=='function')throw new Error('Cache interface missing '+method);
}
window.cardRleFormal={ready:true,policy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',
 providerPath:policy==='original'?baselineRoot+'/src/client/world3d/card-raster-cache.ts':candidatePath,
 baselineModuleImportedWithoutInstantiation:true,candidateModuleImportedWithoutInstantiation:true,
 setup:'Vite pre-resolve selects the complete class module only for the current PaintedCardBatches ./card-raster-cache import. No get-only override, instance monkey patch or per-frame observer.'};
`;
const resolveRecords = [], loadedCacheModules = [];
const cleanModulePath = id => normalizePath(id.split('?')[0].replace(/^\/@fs(?=\/)/, ''));
const selectedCachePath = cachePolicy === 'original' ? baselineCachePath : candidateSource;
const selectedCacheSha256 = cachePolicy === 'original' ? baselineCacheSha256 : candidateCacheSha256;
const cacheResolver = {
  name: 'exact-current-painted-card-rle-policy', enforce: 'pre',
  resolveId(request, importer) {
    if (request !== './card-raster-cache' || !importer || cleanModulePath(importer) !== normalizePath(resolve(sourceRoot, batchesFile))) return null;
    resolveRecords.push({ request, importer, policy: cachePolicy, redirected: true, resolvedId: selectedCachePath, providerSha256: selectedCacheSha256 });
    return selectedCachePath;
  },
  load(id) {
    const clean = cleanModulePath(id);
    if (clean === normalizePath(baselineCachePath) || clean === normalizePath(candidateSource)) {
      const original = clean === normalizePath(baselineCachePath);
      loadedCacheModules.push({ id, path: clean, sha256: original ? baselineCacheSha256 : candidateCacheSha256, servedFromRunStartSnapshot: true });
      // Vite compiles precisely these archived TS bytes, not a later file edit.
      return (original ? baselineCacheSource : candidateCacheSource).toString('utf8');
    }
    return null;
  },
};
const cacheIsolation = { policy: cachePolicy, peakPolicy: 'current production, untouched', maskPolicy: 'current production, untouched',
  extraBaselineRoot, extraBaselineCommit, candidateSource,
  extraBaselineDirty: execFileSync('git', ['status', '--porcelain'], { cwd: extraBaselineRoot, encoding: 'utf8' }),
  baselineCacheSha256, corpusCacheSha256, currentCacheSha256, candidateCacheSha256,
  actualProviderPath: selectedCachePath, actualProviderSha256: selectedCacheSha256,
  currentBatchesSha256: hash(currentBatchesSource), currentMaskSha256: hash(currentMaskSource),
  loaderSha256: hash(cacheLoaderSource), parentHarnessSha256: hash(parentHarnessSource), resolveRecords, loadedCacheModules,
  comparisonKind: 'Budget-only: sole source difference is default constructor budget 48 to 16 MiB',
  candidateExactSingleConstructorDifference: true,
  expectedBudgets: { original: originalBudgetBytes, candidate: candidateBudgetBytes, selected: expectedBudgetBytes },
  candidateBudgetArgumentPurpose: 'Validation expectation only; the complete provider class supplies its own default constructor budget without any override.',
  expectedMaximumEncodedEntries: 1024, expectedMaximumProbationEntries: null,
  scope: 'Budget-only comparison using complete cache classes on the same current renderer; sole source difference is constructor default 48 to 16 MiB, enforced by exact source bytes. Codec, get, put, release, admission and backoff algorithms are unchanged; neither provider has probation metadata; no production integration or per-frame observer. Cache counters, true Canvas misses and CPU ownership may change and are not asserted equal. PNG pixels, picking, facts and GPU page/upload behavior require separate measured comparison, not assumptions.' };
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => { await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ cacheIsolation, variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(scratch, 'cache-loader.js'), cacheLoaderSource);
  await writeFile(resolve(outputDir, 'cache-loader.js'), cacheLoaderSource);
  await writeFile(resolve(outputDir, 'parent-harness.mjs'), parentHarnessSource);
  await mkdir(resolve(outputDir, 'source-snapshot'), { recursive: true });
  for (const [name, bytes] of [['baseline-card-raster-cache.ts', baselineCacheSource], ['current-card-raster-cache.ts', currentCacheSource], ['candidate-card-raster-cache.ts', candidateCacheSource], ['current-painted-card-batches.ts', currentBatchesSource], ['current-card-pick-mask.ts', currentMaskSource]]) await writeFile(resolve(outputDir, 'source-snapshot', name), bytes);
  await writeFile(resolve(outputDir, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)));
  await writeFile(resolve(outputDir, 'fixture.js'), await readFile(resolve(harnessRoot, 'scripts', fixtureName)));
  await writeFile(resolve(outputDir, 'bank-variant.js'), variantHelper);
  await writeFile(resolve(outputDir, 'viewport-metadata.js'), viewportMetadata);
  await writeFile(resolve(outputDir, 'fact-fixture.js'), await readFile(resolve(harnessRoot, 'scripts', scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js')));
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Fixed visible world benchmark</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant), __CARD_RLE_POLICY__: JSON.stringify(cachePolicy), __CARD_RLE_BASELINE_SOURCE_ROOT__: JSON.stringify(extraBaselineRoot), __CARD_RLE_CANDIDATE_SOURCE__: JSON.stringify(candidateSource) },
    plugins: [cacheResolver, { name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
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
  await evaluate(`import('/cache-loader.js').then(()=>window.cardRleFormal.ready)`);
  cacheIsolation.moduleSetup = await evaluate('window.cardRleFormal');
  if (!resolveRecords.length || resolveRecords.some(record => cleanModulePath(record.resolvedId) !== normalizePath(selectedCachePath))) throw new Error('Cache resolver did not apply the declared policy');
  const browserVersion = await command('Browser.getVersion');
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    const result = await evaluate(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames, realFrames, paced })})`);
    result.cachePolicyResources = Object.fromEntries(['before', 'empty', 'returned'].map(phase => [phase, result[phase].cards]));
    result.cacheBudgetValidation = {};
    for (const [phase, cards] of Object.entries(result.cachePolicyResources)) {
      const cache = cards.rasterCache;
      const encodedEntriesValid = Number.isInteger(cache.entries) && cache.entries >= 0 && cache.entries <= 1024;
      const probationApplies = false, probationEntriesValid = null;
      const unexpectedPolicyFields = Object.keys(cache).filter(key => /probation|admission|ghost/i.test(key));
      const noAdmissionMetadata = unexpectedPolicyFields.length === 0;
      const budgetMatches = cache.budget === expectedBudgetBytes;
      const encodedBytesWithinBudget = Number.isFinite(cache.bytes) && cache.bytes >= 0 && cache.bytes <= expectedBudgetBytes;
      result.cacheBudgetValidation[phase] = { expectedBudgetBytes, actualBudgetBytes:cache.budget, budgetMatches,
        encodedBytes:cache.bytes, encodedBytesWithinBudget, encodedEntries:cache.entries, encodedEntryLimit:1024, encodedEntriesValid,
        probationEntries:null, probationApplies, probationEntryLimit:null, probationEntriesValid, noAdmissionMetadata, unexpectedPolicyFields,
        scope:'Untimed captured counters only. Encoded payload budget excludes reconstruction scratch and JS metadata; neither class has a probation table; probation statistics are not applicable.' };
      if (!budgetMatches || !encodedEntriesValid || !encodedBytesWithinBudget || !noAdmissionMetadata) errors.push(`Cache budget/encoded cap or unexpected admission metadata mismatch ${count}/${cycle}/${phase}`);
    }
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
  cacheIsolation.finalClientSourceSha256 = finalClientSourceSha256;
  cacheIsolation.currentSourceStayedFrozen = JSON.stringify(finalClientSourceSha256) === JSON.stringify(allClientSourceSha256);
  cacheIsolation.baselineSourceStayedFrozen = hash(await readFile(baselineCachePath)) === baselineCacheSha256;
  cacheIsolation.candidateSourceStayedFrozen = hash(await readFile(candidateSource)) === candidateCacheSha256;
  if (!cacheIsolation.currentSourceStayedFrozen || !cacheIsolation.baselineSourceStayedFrozen || !cacheIsolation.candidateSourceStayedFrozen) errors.push('Source bytes changed during RLE-policy measurement');
  if (!resolveRecords.length || resolveRecords.some(record => cleanModulePath(record.resolvedId) !== normalizePath(selectedCachePath))) errors.push('Invalid cache provider resolution evidence');
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `Unprofiled budget-only CardRasterCache policy (${cachePolicy}), not production integration. The only source difference is the constructor default budget 48 to 16 MiB; run-start exact byte comparison enforces this. Both sides retain identical current production peak accounting, mask packing, art, thresholds, allocation, transfer, draw order, timers and completion method. Vite redirects only current PaintedCardBatches './card-raster-cache' to the frozen 5b original module or archived standalone candidate class; all methods and defaults come from that complete class. The frozen original must equal current cache source bytes. Both external modules are imported before cycles without instantiating classes. Original complete class has a 50331648-byte (48 MiB) budget; candidate complete class is expected to supply ${candidateBudgetBytes} bytes (default 16777216, 16 MiB). The CLI budget argument validates, never mutates, the constructor default. Before/empty/returned counters strictly validate the selected budget and encoded payload bytes. Encoded entries retain the unchanged 1024 bound. Neither provider has probation metadata; its reported validation fields are null/not applicable, and captured actual stats reject admission, probation or ghost fields. Scratch/JS metadata are not claimed bounded by encoded payload budget. This isolates only the default budget; codec, get, put, release, admission and backoff implementation bytes remain unchanged. Budget-dependent behavior may differ. No per-frame instrumentation is introduced. Cache statistics, true Canvas miss counts and CPU ownership may differ and remain fully reported. Equal PNG RGBA, masked picking, snapshot facts and requested times are correctness requirements to verify separately; page and upload behavior must also be compared from evidence rather than assumed equal. Frozen clocks remain 18 preparation draws at n=0..51, 60 CPU warmups, ${cpuFrames} paced=${paced} CPU samples at n=114 and ${realFrames} real frames at n=480, preserving the original first cold-stream sample and empty/return probes. Default one-lifetime pilot; repeat count ${repeats} is recorded explicitly. Any later ABBA is externally scheduled. The original preparation, warmup, first cold sample and all sample clocks are retained without selection. CPU samples retain the original renderer.render no-op; real complete wall includes Canvas/submission/GPU completion/scheduler overhead. No new observer or picking calls. Output directories are exclusive to preserve prior headers and failed evidence.` });
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
