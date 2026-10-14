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
const mode = arg('--mode') ?? 'candidate';
if (!['reference', 'candidate'].includes(mode)) throw new Error('Use --mode reference|candidate');
const cachePolicy = mode === 'reference' ? 'original' : 'candidate';
const maxBanks = 1, mipMode = mode === 'reference' ? 'full' : 'native';
if (arg('--max-banks') && arg('--max-banks') !== '1' || arg('--mips') && arg('--mips') !== mipMode) throw new Error('Pipeline selector fixes one bank and the selected mip policy');
const variant = { name: `pipeline-${mode}`, maxBanks, mips: mipMode, ordering: 'current corrected stable snapshot ordering', referenceOverrides: mode === 'reference' ? ['residentMip returns 0', '5b stats/recordPeaks', '5b mask', '48 MiB original cache'] : [] };
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
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-card-pipeline-formal/proof.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0').split(',').map(Number);
const paced = process.argv.includes('--paced'), cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
const outputDir = dirname(output);
await mkdir(dirname(outputDir), { recursive: true });
await mkdir(outputDir); // Intentionally exclusive: preserve earlier headers and failed outputs.
const scratch = await mkdtemp('/tmp/sketch-pipeline-formal-');
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
const baselineMaskPath = resolve(extraBaselineRoot, maskFile), baselineBatchesPath = resolve(extraBaselineRoot, batchesFile);
const baselineMaskSource = await readFile(baselineMaskPath), baselineBatchesSource = await readFile(baselineBatchesPath);
for (const [file, bytes] of [[maskFile, baselineMaskSource], [batchesFile, baselineBatchesSource]]) if (!bytes.equals(execFileSync('git', ['show', `${expectedBaselineCommit}:${file}`], { cwd: extraBaselineRoot }))) throw new Error('Baseline provider differs from frozen corpus: ' + file);
const selectedMaskPath = mode === 'reference' ? baselineMaskPath : resolve(sourceRoot, maskFile);
const pipelineLoadedModules = [], pipelineResolveRecords = [];
const frozenPipelineSources = new Map([[normalizePath(baselineMaskPath), baselineMaskSource], [normalizePath(baselineBatchesPath), baselineBatchesSource], [normalizePath(resolve(sourceRoot, maskFile)), currentMaskSource]]);
const peakHelperSource = await readFile(resolve(harnessRoot, 'scripts/art-card-latency-variant.js'));
const pipelineLoaderSource = `
const baselineRoot=__CARD_RLE_BASELINE_SOURCE_ROOT__,sourceRoot=__BENCHMARK_SOURCE_ROOT__;
const oldMask=await import(/* @vite-ignore */ '/@fs'+baselineRoot+'/src/client/world3d/card-pick-mask.ts');
const newMask=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/card-pick-mask.ts');
if(oldMask.cardMaskHit.toString()!==newMask.cardMaskHit.toString())throw new Error('Public mask picking function changed');
` + peakHelperSource.toString('utf8').replace('const policy=__CARD_LATENCY_POLICY__;', "const policy=__CARD_RLE_POLICY__==='original'?'original':'production';").replace('const baselineRoot=__CARD_LATENCY_BASELINE_SOURCE_ROOT__;', '') .replace('const sourceRoot=__BENCHMARK_SOURCE_ROOT__;', '').replace('setups.push({policy,instances,outsideDraw:true});', 'setups.push({policy,instances,outsideDraw:true,residentMipSource:layer.residentMip.toString()});') + `
const {PaintedCardBatches:Current}=await import(/* @vite-ignore */ '/@fs'+sourceRoot+'/src/client/world3d/painted-card-batches.ts');
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
window.pipelineMethods={};
for(const [name,Class] of [['baseline',Baseline],['current',Current]]){
 window.pipelineMethods[name]={};
 for(const key of ['stats','recordPeaks']){const source=Class.prototype[key].toString();window.pipelineMethods[name][key]={name:Class.prototype[key].name,source,sha256:await sha(source)};}
}
`;
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
  async resolveId(request, importer) {
    if (request === 'three' && importer && cleanModulePath(importer).startsWith(normalizePath(extraBaselineRoot) + '/')) {
      const resolved = await this.resolve(request, resolve(sourceRoot, batchesFile), { skipSelf: true });
      const current = await this.resolve('three', resolve(sourceRoot, batchesFile), { skipSelf: true });
      if (!resolved || resolved.id !== current?.id) throw new Error('Baseline/current Three identity mismatch');
      pipelineResolveRecords.push({ request, importer, resolvedId: resolved.id, currentResolvedId: current.id, sameThreeIdentity: true });
      return resolved;
    }
    if (request === './card-pick-mask' && importer && cleanModulePath(importer) === normalizePath(resolve(sourceRoot, batchesFile))) {
      pipelineResolveRecords.push({ request, importer, resolvedId: selectedMaskPath, redirected: mode === 'reference' });
      return selectedMaskPath;
    }
    if (request !== './card-raster-cache' || !importer || cleanModulePath(importer) !== normalizePath(resolve(sourceRoot, batchesFile))) return null;
    resolveRecords.push({ request, importer, policy: cachePolicy, redirected: true, resolvedId: selectedCachePath, providerSha256: selectedCacheSha256 });
    return selectedCachePath;
  },
  async load(id) {
    const clean = cleanModulePath(id);
    if (clean.startsWith(normalizePath(extraBaselineRoot) + '/src/') && /\.ts$/.test(clean) && !frozenPipelineSources.has(clean)) {
      const relative = clean.slice(normalizePath(extraBaselineRoot).length + 1);
      const bytes = await readFile(clean);
      if (!bytes.equals(execFileSync('git', ['show', `${expectedBaselineCommit}:${relative}`], { cwd: extraBaselineRoot }))) throw new Error('Baseline imported dependency is dirty: ' + relative);
      frozenPipelineSources.set(clean, bytes);
    }
    if (frozenPipelineSources.has(clean)) {
      const bytes = frozenPipelineSources.get(clean);
      pipelineLoadedModules.push({ path: clean, sha256: hash(bytes), servedFromSnapshot: true });
      if (clean === normalizePath(baselineCachePath)) loadedCacheModules.push({ id, path: clean, sha256: hash(bytes), servedFromRunStartSnapshot: true });
      return bytes.toString('utf8');
    }
    if (clean === normalizePath(baselineCachePath) || clean === normalizePath(candidateSource)) {
      const original = clean === normalizePath(baselineCachePath);
      loadedCacheModules.push({ id, path: clean, sha256: original ? baselineCacheSha256 : candidateCacheSha256, servedFromRunStartSnapshot: true });
      // Vite compiles precisely these archived TS bytes, not a later file edit.
      return (original ? baselineCacheSource : candidateCacheSource).toString('utf8');
    }
    return null;
  },
};
const cacheIsolation = { mode, policy: cachePolicy, peakPolicy: mode === 'reference' ? '5b exact prototype references' : 'current production', maskPolicy: mode === 'reference' ? '5b module' : 'current production', pipelineResolveRecords, pipelineLoadedModules, pipelineLoaderSha256: hash(pipelineLoaderSource), peakHelperSha256: hash(peakHelperSource), baselineMaskSha256: hash(baselineMaskSource), baselineBatchesSha256: hash(baselineBatchesSource), selectedMaskPath,
  extraBaselineRoot, extraBaselineCommit, candidateSource,
  extraBaselineDirty: execFileSync('git', ['status', '--porcelain'], { cwd: extraBaselineRoot, encoding: 'utf8' }),
  baselineCacheSha256, corpusCacheSha256, currentCacheSha256, candidateCacheSha256,
  actualProviderPath: selectedCachePath, actualProviderSha256: selectedCacheSha256,
  currentBatchesSha256: hash(currentBatchesSource), currentMaskSha256: hash(currentMaskSource),
  loaderSha256: hash(cacheLoaderSource), parentHarnessSha256: hash(parentHarnessSource), resolveRecords, loadedCacheModules,
  comparisonKind: 'Combined pipeline comparison: full/original peaks/original mask/48 MiB versus native/current peaks/current mask/16 MiB; not single-variable isolation',
  candidateExactSingleConstructorDifference: true,
  expectedBudgets: { original: originalBudgetBytes, candidate: candidateBudgetBytes, selected: expectedBudgetBytes },
  candidateBudgetArgumentPurpose: 'Validation expectation only; the complete provider class supplies its own default constructor budget without any override.',
  expectedMaximumEncodedEntries: 1024, expectedMaximumProbationEntries: null,
  scope: 'Combined same-current-core pipeline comparison, not a decomposition of isolated gains. Corrected stable ordering remains identical, not restoration of a historical ordering bug. Cache source differs only in budget. Full/native mip selection, peak method providers and mask module differ by mode. No per-frame observer. GPU bytes, layout, calls and resources may differ and are reported raw; PNG RGBA, facts and clocks require strict equality. Actual picking requires separate correctness proof.' };
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => {
  await mkdir(resolve(outputDir, 'pipeline-module-snapshots'), { recursive: true });
  cacheIsolation.pipelineSourceSnapshots = [];
  for (const [path, bytes] of frozenPipelineSources) {
    const filename = hash(bytes) + '.ts';
    await writeFile(resolve(outputDir, 'pipeline-module-snapshots', filename), bytes);
    cacheIsolation.pipelineSourceSnapshots.push({ path, sha256: hash(bytes), snapshot: 'pipeline-module-snapshots/' + filename });
    if (!bytes.equals(await readFile(path))) errors.push('Pipeline provider changed during run: ' + path);
  } await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ cacheIsolation, variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(scratch, 'pipeline-loader.js'), pipelineLoaderSource);
  await writeFile(resolve(outputDir, 'pipeline-loader.js'), pipelineLoaderSource);
  await writeFile(resolve(outputDir, 'peak-helper.js'), peakHelperSource);
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
  await evaluate(`import('/pipeline-loader.js').then(()=>window.cardLatencyVariant.installed)`);
  cacheIsolation.methodFingerprints = await evaluate('window.pipelineMethods');
  if (!pipelineResolveRecords.some(record => record.request === './card-pick-mask' && record.resolvedId === selectedMaskPath)) throw new Error('Selected mask provider was not resolved');
  if (!pipelineResolveRecords.some(record => record.sameThreeIdentity)) throw new Error('Baseline Three identity resolution was not recorded');
  cacheIsolation.peakSetup = await evaluate('window.cardLatencyVariant.description');
  cacheIsolation.moduleSetup = await evaluate('window.cardRleFormal');
  cacheIsolation.moduleSetup.peakPolicy = cacheIsolation.peakPolicy;
  cacheIsolation.moduleSetup.maskPolicy = cacheIsolation.maskPolicy;
  if (!resolveRecords.length || resolveRecords.some(record => cleanModulePath(record.resolvedId) !== normalizePath(selectedCachePath))) throw new Error('Cache resolver did not apply the declared policy');
  const browserVersion = await command('Browser.getVersion');
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    const result = await evaluate(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames, realFrames, paced })})`);
    result.pipelineSetups = await evaluate('window.cardLatencyVariant.drainSetups()');
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
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `Combined pipeline ${mode}, same current core/assets and corrected stable ordering. Reference selects one full-resolution bank, direct frozen 5b stats/recordPeaks prototype references, frozen 5b mask and original 48 MiB cache. Candidate selects one native-mip bank, current peak/mask and the exact original cache with default 16 MiB only. Not single-variable isolation; do not sum prior epoch percentages or assign this gain to one component. All preparation, warmup, first cold sample, CPU no-op render section, complete GPU frames and empty/return clocks come from the unchanged fact fixture. No added per-frame observers. GPU allocations/layout/calls may differ, retained raw; PNG RGBA/facts/clocks must compare strictly. Real wall includes GPU-completion polling/scheduling. Budgets strictly checked 48/16; probation not applicable. Samples ${cpuFrames} CPU, ${realFrames} real, ${repeats} lifetimes per population; external ABBA scheduling.` });
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
