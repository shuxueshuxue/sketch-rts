import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
const originalSource = resolve(arg('--original-source') ?? '/tmp/card-upload-row-band-original.ts');
const candidateSource = resolve(arg('--candidate-source') ?? '/tmp/card-upload-row-band-candidate.ts');
const regionSource = resolve(arg('--region-source') ?? '/tmp/card-upload-row-band-region.ts');
const sourceMetadataPath = resolve(arg('--metadata') ?? '/tmp/card-upload-row-band-source.json');
const extraBaselineRoot = dirname(originalSource);
const scene = arg('--scene') ?? 'mixed';
if (!['canonical','mixed'].includes(scene)) throw new Error('Use --scene canonical|mixed');
const fixtureName = scene === 'mixed' ? 'art-viewport-bank-mixed-fixture.js' : 'art-viewport-bank-canonical-fixture.js';
if (!/^art-viewport-[a-z-]+\.js$/.test(fixtureName)) throw new Error('Fixture must be a viewport script basename');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-card-upload-row-band-formal/proof.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0').split(',').map(Number);
const pilot = process.argv.includes('--pilot');
const paced = true, cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
const expectedSourceCommit = execFileSync('git', ['rev-parse', '8345a0d^{commit}'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
if (sourceCommit !== expectedSourceCommit || execFileSync('git', ['diff', 'HEAD', '--', 'src'], { cwd: sourceRoot }).length || execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src'], { cwd: sourceRoot }).length) throw new Error('Row-band formal requires clean frozen 8345a0d source');
if (scene !== 'mixed' || repeats !== (pilot?1:2) || counts.length !== 1 || counts[0] !== 0 || cpuFrames !== 60 || realFrames !== 12) throw new Error('Row-band requires original mixed hidden0 60CPU/12real schedule: 2 lifetimes for formal, or explicit --pilot --repeats 1');
const outputDir = dirname(output);
await mkdir(dirname(outputDir), { recursive: true });
await mkdir(outputDir); // Intentionally exclusive: preserve earlier headers and failed outputs.
const scratch = await mkdtemp('/tmp/sketch-upload-row-band-formal-v2-');
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const uploaderFile = 'src/client/world3d/card-mip-uploader.ts';
const regionFile = 'src/client/world3d/card-upload-region.ts';
const batchesFile = 'src/client/world3d/painted-card-batches.ts';
const maskFile = 'src/client/world3d/card-pick-mask.ts', cacheFile = 'src/client/world3d/card-raster-cache.ts';
const baselineUploaderPath = originalSource, currentUploaderPath = resolve(sourceRoot, uploaderFile);
const currentRegionPath = resolve(sourceRoot, regionFile), baselineRegionPath = regionSource;
const candidateRegionPath = regionSource;
const expectedBaselineCommit = expectedSourceCommit, extraBaselineCommit = expectedSourceCommit;
const sourceMetadataBytes = await readFile(sourceMetadataPath), sourceMetadata = JSON.parse(sourceMetadataBytes);
const sourceMetadataSha256 = hash(sourceMetadataBytes);
const baselineUploaderSource = await readFile(baselineUploaderPath), currentUploaderSource = await readFile(currentUploaderPath);
const candidateUploaderSource = await readFile(candidateSource);
const currentRegionSource = await readFile(currentRegionPath), baselineRegionSource = await readFile(baselineRegionPath);
let candidateRegionSource;
try { candidateRegionSource = await readFile(candidateRegionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const currentBatchesSource = await readFile(resolve(sourceRoot, batchesFile));
const currentMaskSource = await readFile(resolve(sourceRoot, maskFile)), currentCacheSource = await readFile(resolve(sourceRoot, cacheFile));
const baselineUploaderSha256 = hash(baselineUploaderSource), currentUploaderSha256 = hash(currentUploaderSource), candidateUploaderSha256 = hash(candidateUploaderSource);
const currentRegionSha256 = hash(currentRegionSource), baselineRegionSha256 = hash(baselineRegionSource), candidateRegionSha256 = candidateRegionSource ? hash(candidateRegionSource) : null;
const corpusUploaderSha256 = hash(execFileSync('git', ['show', `${expectedBaselineCommit}:${uploaderFile}`], { cwd: sourceRoot }));
if (baselineUploaderSha256 !== corpusUploaderSha256 || currentUploaderSha256 !== corpusUploaderSha256) throw new Error('Original baseline/current uploader must match frozen 8345 bytes');
if (baselineRegionSha256 !== currentRegionSha256 || (candidateRegionSha256 !== null && candidateRegionSha256 !== currentRegionSha256)) throw new Error('Upload-region dependency must remain exact current/baseline bytes');
if (sourceMetadata.sourceCommit !== expectedSourceCommit || sourceMetadata.sourceSha256 !== baselineUploaderSha256 || sourceMetadata.candidateSha256 !== candidateUploaderSha256 || sourceMetadata.regionSha256 !== currentRegionSha256) throw new Error('Row-band metadata source identities differ');
if (sourceMetadata.candidateExactWarmSetupReplacement !== true || typeof sourceMetadata.oldWarmSetup !== 'string' || typeof sourceMetadata.newWarmSetup !== 'string' || baselineUploaderSource.toString('utf8').split(sourceMetadata.oldWarmSetup).length !== 2 || baselineUploaderSource.toString('utf8').replace(sourceMetadata.oldWarmSetup,sourceMetadata.newWarmSetup) !== candidateUploaderSource.toString('utf8')) throw new Error('Candidate differs outside its one warm setup');
for (const bytes of [baselineUploaderSource,candidateUploaderSource]) if (!bytes.toString('utf8').startsWith("import * as THREE from 'three';")) throw new Error('Provider bare Three import changed');
for (const [file, bytes] of [[uploaderFile,currentUploaderSource],[regionFile,currentRegionSource],[batchesFile,currentBatchesSource],[maskFile,currentMaskSource],[cacheFile,currentCacheSource]]) if (hash(bytes) !== allClientSourceSha256[file]) throw new Error('Source changed while initial snapshot was read: '+file);
if ([baselineUploaderPath,currentUploaderPath,currentRegionPath,baselineRegionPath].includes(candidateSource)) throw new Error('Candidate must be a separate standalone uploader TS module');
const parentHarnessSource = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-proof.mjs'));
const uploadLoaderSource = `// Balanced module imports. Neither uploader class nor texture factory is invoked.
const originalPath=__CARD_UPLOAD_ORIGINAL_SOURCE__,candidatePath=__CARD_UPLOAD_CANDIDATE_SOURCE__,policy=__CARD_UPLOAD_POLICY__;
const baseline=await import(/* @vite-ignore */ '/@fs'+originalPath);
const candidate=await import(/* @vite-ignore */ '/@fs'+candidatePath);
for(const module of [baseline,candidate]){
 for(const name of ['CardMipUploader','createCardArray','cardTextureBytes'])if(typeof module[name]!=='function')throw new Error('Uploader module export missing '+name);
 for(const method of ['uploadLayer','copyLayers','stats','dispose','releaseSize'])if(typeof module.CardMipUploader.prototype[method]!=='function')throw new Error('Uploader interface missing '+method);
}
window.cardUploadFormal={ready:true,policy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',cachePolicy:'current production, untouched',
 providerPath:policy==='original'?originalPath:candidatePath,
 baselineModuleImportedWithoutInstantiation:true,candidateModuleImportedWithoutInstantiation:true,textureFactoriesCalledBySetup:false,
 setup:'Vite pre-resolve selects the complete uploader module only for current PaintedCardBatches ./card-mip-uploader. Provider region imports resolve to frozen current region bytes; external three resolves through the current source package. No instance/per-call monkey patch.'};
`;
const trackedSourceFiles=execFileSync('git',['ls-files','src'],{cwd:sourceRoot,encoding:'utf8'}).trim().split('\n').sort();
const sourceByteSnapshots=new Map(await Promise.all(trackedSourceFiles.map(async file=>[normalizePath(resolve(sourceRoot,file)),await readFile(resolve(sourceRoot,file))])));
const runtimeHelperNames=['art-viewport-bank-mixed-fixture.js','art-viewport-bank-canonical-fixture.js','art-viewport-streaming-fixture.js','art-viewport-fixture.js','art-card-bank-variant.js','art-card-bank-viewport-metadata.js','art-gpu-completion.mjs'];
const runtimeHelperBytes=new Map(await Promise.all(runtimeHelperNames.map(async name=>[normalizePath(resolve(harnessRoot,'scripts',name)),await readFile(resolve(harnessRoot,'scripts',name))])));
const sourceInventory={version:2,expectedCommit:expectedSourceCommit,sourceSha256:Object.fromEntries([...sourceByteSnapshots].map(([path,bytes])=>[path.slice(normalizePath(sourceRoot).length+1),hash(bytes)])),sourcePublicTree:execFileSync('git',['rev-parse','HEAD:public'],{cwd:sourceRoot,encoding:'utf8'}).trim(),sourceSnapshots:[],helperSnapshots:[],loadedModules:[],resolveRecords:[],thirdPartyModules:[],moduleGraph:[],dependencyPreparation:{protocol:'explicit-startup-three-gltf-v2-captured',include:['three','three/addons/loaders/GLTFLoader.js'],noDiscovery:true,beforeBrowserLaunch:true}};
const dependencyInputs=new Map();
if(execFileSync('git',['diff','HEAD','--','src','public'],{cwd:sourceRoot}).length)throw new Error('V2 requires clean frozen src/public');
async function archiveCompleteInventory(){
 for(const [path,bytes]of sourceByteSnapshots){const file=path.slice(normalizePath(sourceRoot).length+1),snapshot='complete-source-snapshot/'+file;await mkdir(dirname(resolve(outputDir,snapshot)),{recursive:true});await writeFile(resolve(outputDir,snapshot),bytes);sourceInventory.sourceSnapshots.push({path,relativePath:file,sha256:hash(bytes),snapshot});}
 for(const [path,bytes]of runtimeHelperBytes){const snapshot='runtime-helper-snapshots/'+path.split('/').at(-1);await mkdir(dirname(resolve(outputDir,snapshot)),{recursive:true});await writeFile(resolve(outputDir,snapshot),bytes);sourceInventory.helperSnapshots.push({path,sha256:hash(bytes),snapshot});}
}
async function snapshotOptimizedDependencies(vite,label){
 const optimizer=vite.environments?.client?.depsOptimizer,expectedEntries=sourceInventory.dependencyPreparation.include;
 if(!optimizer||!optimizer.options.noDiscovery||JSON.stringify(optimizer.options.include)!==JSON.stringify(expectedEntries))throw new Error('V2 explicit dependency policy differs');
 const meta=optimizer.metadata;if(Object.keys(meta.discovered).length)throw new Error('V2 has unfinished discovered dependencies');
 if(JSON.stringify(Object.keys(meta.optimized).sort())!==JSON.stringify([...expectedEntries].sort()))throw new Error('V2 startup dependencies incomplete');
 const entries=[],chunks=[];
 for(const [kind,collection,rows]of [['optimized',meta.optimized,entries],['chunks',meta.chunks,chunks]])for(const [name,info]of Object.entries(collection)){
  if(info.processing)throw new Error('Optimized dependency still processing: '+name);const bytes=await readFile(info.file),sha256=hash(bytes),snapshot='optimized-dependency-snapshots/'+sha256+'.js';
  await mkdir(dirname(resolve(outputDir,snapshot)),{recursive:true});await writeFile(resolve(outputDir,snapshot),bytes);
  rows.push({name,kind,file:info.file,source:info.src??null,browserHash:info.browserHash,fileHash:info.fileHash??null,resolvedId:optimizer.getOptimizedDepId(info),bytes:bytes.length,sha256,snapshot});
 }
 return{label,hash:meta.hash,lockfileHash:meta.lockfileHash,configHash:meta.configHash,browserHash:meta.browserHash,entries,chunks,discovered:[],optimizationComplete:true};
}
async function finishCompleteInventory(vite){
 sourceInventory.finalSourceSha256=Object.fromEntries(await Promise.all(trackedSourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))])));
 sourceInventory.sourceStayedFrozen=JSON.stringify(sourceInventory.sourceSha256)===JSON.stringify(sourceInventory.finalSourceSha256)&&!execFileSync('git',['diff','HEAD','--','src','public'],{cwd:sourceRoot}).length;
 sourceInventory.helpersStayedFrozen=true;for(const [path,bytes]of runtimeHelperBytes)if(!bytes.equals(await readFile(path)))sourceInventory.helpersStayedFrozen=false;
 sourceInventory.thirdPartyModules=await Promise.all([...dependencyInputs.values()].map(async row=>({...row,unchangedAtFinish:hash(await readFile(row.path))===row.sha256})));
 sourceInventory.moduleGraph=[...vite.moduleGraph.idToModuleMap.values()].map(module=>({id:module.id,url:module.url,importers:[...module.importers].map(item=>item.id),dependencies:[...module.importedModules].map(item=>item.id)}));
 sourceInventory.sameContextThreeResolvedIds=[...new Set(sourceInventory.resolveRecords.filter(row=>row.request==='three').map(row=>row.resolvedId))];
 sourceInventory.dependencyPreparation.finish=await snapshotOptimizedDependencies(vite,'after-final-draw');
 const stable=value=>JSON.stringify({...value,label:undefined});sourceInventory.dependencyPreparation.stayedStable=stable(sourceInventory.dependencyPreparation.startup)===stable(sourceInventory.dependencyPreparation.finish);
 const expectedThree=sourceInventory.dependencyPreparation.startup.entries.find(row=>row.name==='three')?.resolvedId;
 if(!sourceInventory.sourceStayedFrozen||!sourceInventory.helpersStayedFrozen||sourceInventory.thirdPartyModules.some(row=>!row.unchangedAtFinish))throw new Error('V2 source/helper/dependency changed');
 if(!sourceInventory.dependencyPreparation.stayedStable||sourceInventory.sameContextThreeResolvedIds.length!==1||sourceInventory.sameContextThreeResolvedIds[0]!==expectedThree)throw new Error('V2 optimized dependency or full Three identity changed');
}
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
      sourceInventory.resolveRecords.push({request,importer,resolvedId:resolved.id,purpose:'current-context-public-three'});
      return resolved;
    }
    const eligible=from.startsWith(normalizePath(sourceRoot)+'/src/')||from.startsWith(normalizePath(scratch)+'/')||runtimeHelperBytes.has(from);
    if(eligible){const resolved=await this.resolve(request,request==='three'?currentUploaderPath:importer,{skipSelf:true});sourceInventory.resolveRecords.push({request,importer,resolvedId:resolved?.id??null,purpose:request==='three'?'current-context-public-three':'original-module-dependency'});return resolved;}
    return null;
  },
  async load(id) {
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
    const bytes=sourceByteSnapshots.get(clean)??runtimeHelperBytes.get(clean);
    if(bytes){sourceInventory.loadedModules.push({id,path:clean,sha256:hash(bytes),frozenRunStartBytes:true,kind:sourceByteSnapshots.has(clean)?'production-source':'original-fixture-helper'});return bytes.toString('utf8');}
    if(clean.startsWith(normalizePath(sourceRoot)+'/src/'))throw new Error('Source outside frozen tracked inventory: '+clean);
    if((clean.includes('/node_modules/')||clean.includes('/.vite-cache/'))&&/\.(?:m?js)$/.test(clean))try{dependencyInputs.set(clean,{id,path:clean,sha256:hash(await readFile(clean))});}catch{}
    return null;
  },
};
const uploadIsolation = {sourceInventory,version:2,policy:uploadPolicy,peakPolicy:'current production, untouched',maskPolicy:'current production, untouched',cachePolicy:'current production, untouched',
  extraBaselineRoot,extraBaselineCommit,originalSource,candidateSource,regionSource,sourceMetadataPath,sourceMetadataSha256,sourceMetadata,expectedSourceCommit,
  pilot,pilotScope:pilot?'Single-lifetime pilot only; not balanced ABBA or final acceptance':'Two-lifetime arm; ABBA order is scheduled externally',
  candidateExactWarmSetupReplacement:true,actualPhysicalRectangleAndCallsExpectedUnchanged:true,
  baselineUploaderSha256,corpusUploaderSha256,currentUploaderSha256,candidateUploaderSha256,
  dependencies:{currentRegionPath,baselineRegionPath,candidateRegionPath,currentRegionSha256,baselineRegionSha256,candidateRegionSha256,candidateRegionFilePresent:candidateRegionSource!==undefined},
  actualProviderPath:selectedUploaderPath,actualProviderSha256:selectedUploaderSha256,
  currentBatchesSha256:hash(currentBatchesSource),currentMaskSha256:hash(currentMaskSource),currentCacheSha256:hash(currentCacheSource),
  loaderSha256:hash(uploadLoaderSource),parentHarnessSha256:hash(parentHarnessSource),resolveRecords,dependencyResolveRecords,loadedUploaderModules,
  startupDependencies:{protocol:'explicit-startup-three-gltf-v2',include:['three','three/addons/loaders/GLTFLoader.js'],noDiscovery:true,
    nodeModulesTarget:resolve(sourceRoot,'node_modules'),nodeModulesLink:resolve(scratch,'node_modules'),cacheDir:resolve(scratch,'.vite-cache'),
    scope:'One startup dependency batch through the frozen source package; separate scratch cache, no absolute Three alias or source/package modification.'},
  scope:'Complete upload-module isolation on clean frozen8345 production. Only warm CPU source view/row origin differ; full GPU source domain, original mip chain, ROI bytes and call count are expected unchanged, not assumed. No per-call hooks/extra GL/fences or historical cache/peak/mask providers. Source view byteLength is not physical transport bytes; validate pixels, native mips, resource/call/order facts and full-frame timing separately.'};
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => { await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ uploadIsolation, variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...extra }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await archiveCompleteInventory();
  await writeFile(resolve(scratch, 'upload-loader.js'), uploadLoaderSource);
  await writeFile(resolve(outputDir, 'upload-loader.js'), uploadLoaderSource);
  await writeFile(resolve(outputDir, 'parent-harness.mjs'), parentHarnessSource);
  await writeFile(resolve(outputDir,'candidate-source-metadata.json'),sourceMetadataBytes);
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
  // Resolve explicit startup entries from the same installed source package.
  // Keep optimizer writes outside that node_modules link and out of the source.
  await symlink(resolve(sourceRoot,'node_modules'),resolve(scratch,'node_modules'),'dir');
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant), __CARD_UPLOAD_POLICY__: JSON.stringify(uploadPolicy), __CARD_UPLOAD_ORIGINAL_SOURCE__: JSON.stringify(originalSource), __CARD_UPLOAD_CANDIDATE_SOURCE__: JSON.stringify(candidateSource) },
    cacheDir:resolve(scratch,'.vite-cache'),optimizeDeps:{include:['three','three/addons/loaders/GLTFLoader.js'],noDiscovery:true},
    plugins: [uploadResolver, { name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot, extraBaselineRoot, dirname(candidateSource)] } } });
  await server.listen();
  sourceInventory.dependencyPreparation.temporaryDependencyRoot={path:resolve(scratch,'node_modules'),target:resolve(sourceRoot,'node_modules'),temporaryRootOnly:true};
  sourceInventory.dependencyPreparation.startup=await snapshotOptimizedDependencies(server,'before-browser-launch');
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
  // Presentation-only comparison: no simulation is run in either arm.
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
  uploadIsolation.finalSourceMetadataSha256 = hash(await readFile(sourceMetadataPath));
  uploadIsolation.sourceMetadataStayedFrozen = uploadIsolation.finalSourceMetadataSha256 === sourceMetadataSha256;
  if (!uploadIsolation.sourceMetadataStayedFrozen) errors.push('Row-band source metadata changed during measurement');
  if (!uploadIsolation.baselineRegionStayedFrozen || !uploadIsolation.candidateRegionStayedFrozen) errors.push('Uploader region dependency changed during measurement');
  if (!uploadIsolation.currentSourceStayedFrozen || !uploadIsolation.baselineSourceStayedFrozen || !uploadIsolation.candidateSourceStayedFrozen) errors.push('Source bytes changed during upload-policy measurement');
  if (!resolveRecords.length || resolveRecords.some(record => cleanModulePath(record.resolvedId) !== normalizePath(selectedUploaderPath))) errors.push('Invalid uploader provider resolution evidence');
  await finishCompleteInventory(server);
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `Unprofiled complete uploader-module isolation (${uploadPolicy}), not production integration. Both sides retain the same current peak accounting, mask and cache implementations, art, thresholds, ordering, timers and original fixture. Vite redirects only current PaintedCardBatches './card-mip-uploader' to the frozen8345 uploader or standalone row-band candidate; required uploader/texture-factory/byte-count exports are checked without invocation. Original uploader bytes must match current production exactly. Both external modules are imported before preparation without instantiation; their unchanged region helper is pinned to current run-start bytes, and their Three import resolves through the current production package. No function wrappers, per-call observer, extra flush, fence or render. Raw counters remain complete; copy calls and ROI transport bytes are expected unchanged while CPU view bounds/skiprows differ. These invariants, PNG RGBA, native mip bytes, GPU pages/order and mask/cache ownership need actual separate validation rather than assumed equality. Shorter exposed source byteLength is not a measured reduction of physical transport. Frozen clocks: 18 preparation draws n=0..51, 60 CPU warmups, ${cpuFrames} paced=${paced} CPU samples n=114, ${realFrames} real samples n=480 including the first cold pose-streaming jump, then unchanged empty/return probes. Default two lifetimes and hidden0, ABBA externally scheduled. Complete wall includes Canvas/submission/completion/scheduling; CPU samples retain the original renderer.render no-op. Snapshot/capture/GC stay outside timing. Output directories are exclusive; previous raw headers and failures are never overwritten.` });
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
