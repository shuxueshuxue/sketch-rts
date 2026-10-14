/** Read completed ABBA evidence only; no browser/Canvas/profiler/test/benchmark. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const names=['original-A','candidate-B','candidate-B2','original-A2'],inputs={},runs={};
for(const name of names){const path=resolve(here,name,'raw.json'),bytes=await readFile(path);inputs[name]={path,sha256:hash(bytes)};runs[name]=JSON.parse(bytes);}
const violations=[],images=[],resourceChecks=[],providers=[],facts=[];
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b,label)=>{if(canonical(a)!==canonical(b))violations.push(label);};
const oracle=runs['original-A'];
function png(bytes){
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Bad PNG signature');
 let width,height,channels,depth,interlace;const chunks=[];
 for(let i=8;i<bytes.length;){const n=bytes.readUInt32BE(i),kind=bytes.toString('ascii',i+4,i+8),b=bytes.subarray(i+8,i+8+n);if(kind==='IHDR'){width=b.readUInt32BE(0);height=b.readUInt32BE(4);depth=b[8];channels=b[9]===6?4:b[9]===2?3:0;interlace=b[12];}if(kind==='IDAT')chunks.push(b);i+=n+12;if(kind==='IEND')break;}
 if(depth!==8||!channels||interlace!==0)throw new Error('Expected RGB/RGBA 8bit noninterlaced PNG');
 const src=inflateSync(Buffer.concat(chunks)),stride=width*channels,dst=Buffer.alloc(stride*height),rgba=Buffer.alloc(width*height*4);
 if(src.length!==(stride+1)*height)throw new Error('PNG scanline size differs');
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<height;y++){const base=y*stride,at=y*(stride+1),f=src[at];if(f>4)throw new Error('Unsupported PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?dst[base+x-channels]:0,b=y?dst[base+x-stride]:0,c=y&&x>=channels?dst[base+x-stride-channels]:0;dst[base+x]=(src[at+x+1]+(f===0?0:f===1?a:f===2?b:f===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}for(let x=0;x<width;x++){const a=base+x*channels,b=(y*width+x)*4;rgba[b]=dst[a];rgba[b+1]=dst[a+1];rgba[b+2]=dst[a+2];rgba[b+3]=channels===4?dst[a+3]:255;}}
 return{width,height,rgba};
}
const imageOracle=new Map();
function stableCards(cards){return Object.fromEntries(Object.entries(cards).filter(([k])=>!['rasterStages','rasterWorkWallMs','gpuTransferSubmissionWallMs'].includes(k)).map(([k,v])=>[k,k==='rasterCache'?Object.fromEntries(Object.entries(v).filter(([x])=>!['workMs','avoidedPaintMs'].includes(x))):v]));}
const stablePhase=phase=>Object.fromEntries(Object.entries(phase).filter(([k])=>!['submissionMs','completeWallMs'].includes(k)).map(([k,v])=>[k,k==='cards'?stableCards(v):v]));
function deepDifferences(original,actual,path='cards',out=[]){
 if(canonical(original)===canonical(actual))return out;
 if(original&&actual&&typeof original==='object'&&typeof actual==='object'&&!Array.isArray(original)&&!Array.isArray(actual)){
  for(const key of new Set([...Object.keys(original),...Object.keys(actual)]))deepDifferences(original[key],actual[key],`${path}.${key}`,out);
 }else out.push({field:path,original:original??null,actual:actual??null,change:typeof original==='number'&&typeof actual==='number'?actual-original:null});
 return out;
}
const sourceFields=['sourceRoot','entryFixtureName','factFixtureName','sourceCommit','sourceGitDiffSha256','allClientSourceSha256','sourceSha256','harnessSha256','entryFixtureSha256','factFixtureSha256','fixtureSha256','variantHelperSha256','viewportMetadataSha256','viewport','browserVersion','scene','counts','repeats','paced','cpuFrames','realFrames'];
const archived={'harness.mjs':'harnessSha256','fixture.js':'entryFixtureSha256','fact-fixture.js':'factFixtureSha256','bank-variant.js':'variantHelperSha256','viewport-metadata.js':'viewportMetadataSha256'};
for(const name of names){
 const run=runs[name],policy=name.startsWith('original')?'original':'candidate';
 for(const k of sourceFields)equal(run[k],oracle[k],`${name}: different ${k}`);
 if(!run.completed||!run.validation.passed||run.errors.length||run.failed.length||run.scene!=='mixed'||run.cpuFrames!==60||run.realFrames!==12||run.repeats!==2||canonical(run.counts)!=='[0]'||!run.paced||run.simulation.length||run.variant.maxBanks!==1||run.variant.mips!=='native'||run.cycles.length!==2)violations.push(`${name}: invalid original mixed schedule/source proof`);
 for(const[file,key]of Object.entries(archived))if(hash(await readFile(resolve(here,name,file)))!==run[key])violations.push(`${name}: archived ${file} differs`);
 const isolation=run.uploadIsolation;
 const uploaderFile='src/client/world3d/card-mip-uploader.ts',regionFile='src/client/world3d/card-upload-region.ts',batchesFile='src/client/world3d/painted-card-batches.ts',maskFile='src/client/world3d/card-pick-mask.ts',cacheFile='src/client/world3d/card-raster-cache.ts';
 const clean=id=>id.split('?')[0].replace(/^\/@fs(?=\/)/,'');
 const selected=policy==='original'?`${isolation.extraBaselineRoot}/${uploaderFile}`:isolation.candidateSource;
 const selectedSha=policy==='original'?isolation.baselineUploaderSha256:isolation.candidateUploaderSha256;
 if(run.sourceCommit!=='aec09d620801dd07852042732831e5b2de1c4193'||run.sourceGitDiffSha256!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'||isolation.policy!==policy||['peakPolicy','maskPolicy','cachePolicy'].some(k=>isolation[k]!=='current production, untouched')||isolation.extraBaselineDirty||isolation.extraBaselineCommit!=='5b356c7795068bb2a532ad1d486b3c22936cf735'||['currentSourceStayedFrozen','baselineSourceStayedFrozen','candidateSourceStayedFrozen','baselineRegionStayedFrozen','candidateRegionStayedFrozen'].some(k=>!isolation[k]))violations.push(`${name}: source/baseline/policy/dependency freeze invalid`);
 for(const key of ['extraBaselineRoot','extraBaselineCommit','candidateSource','baselineUploaderSha256','corpusUploaderSha256','currentUploaderSha256','candidateUploaderSha256','currentBatchesSha256','currentMaskSha256','currentCacheSha256','loaderSha256','parentHarnessSha256','dependencies'])equal(isolation[key],oracle.uploadIsolation[key],`${name}: different provider/dependency ${key}`);
 equal(isolation.finalClientSourceSha256,run.allClientSourceSha256,`${name}: final client source differs`);
 if(!isolation.candidateUploaderSha256.startsWith('815')||isolation.actualProviderPath!==selected||isolation.actualProviderSha256!==selectedSha||isolation.baselineUploaderSha256!==isolation.corpusUploaderSha256||isolation.currentUploaderSha256!==isolation.baselineUploaderSha256||isolation.currentUploaderSha256!==run.allClientSourceSha256[uploaderFile]||isolation.currentMaskSha256!==run.allClientSourceSha256[maskFile]||isolation.currentBatchesSha256!==run.allClientSourceSha256[batchesFile]||isolation.currentCacheSha256!==run.allClientSourceSha256[cacheFile]||isolation.candidateUploaderSha256===isolation.baselineUploaderSha256)violations.push(`${name}: invalid selected/current provider SHA`);
 const d=isolation.dependencies;
 if(d.currentRegionPath!==`${run.sourceRoot}/${regionFile}`||d.baselineRegionPath!==`${isolation.extraBaselineRoot}/${regionFile}`||d.currentRegionSha256!==run.allClientSourceSha256[regionFile]||d.currentRegionSha256!==d.baselineRegionSha256||(d.candidateRegionFilePresent?d.candidateRegionSha256!==d.currentRegionSha256:d.candidateRegionSha256!==null))violations.push(`${name}: invalid unchanged-region dependency`);
 const archives=[['upload-loader.js',isolation.loaderSha256],['parent-harness.mjs',isolation.parentHarnessSha256],['source-snapshot/baseline-card-mip-uploader.ts',isolation.baselineUploaderSha256],['source-snapshot/current-card-mip-uploader.ts',isolation.currentUploaderSha256],['source-snapshot/candidate-card-mip-uploader.ts',isolation.candidateUploaderSha256],['source-snapshot/baseline-card-upload-region.ts',d.baselineRegionSha256],['source-snapshot/current-card-upload-region.ts',d.currentRegionSha256],['source-snapshot/current-card-pick-mask.ts',isolation.currentMaskSha256],['source-snapshot/current-card-raster-cache.ts',isolation.currentCacheSha256],['source-snapshot/current-painted-card-batches.ts',isolation.currentBatchesSha256]];
 if(d.candidateRegionFilePresent)archives.push(['source-snapshot/candidate-card-upload-region.ts',d.candidateRegionSha256]);
 for(const[file,sha]of archives)if(hash(await readFile(resolve(here,name,file)))!==sha)violations.push(`${name}: archived ${file} differs`);
 if(!isolation.resolveRecords.length||isolation.resolveRecords.some(r=>r.request!=='./card-mip-uploader'||clean(r.importer)!==`${run.sourceRoot}/${batchesFile}`||r.policy!==policy||r.redirected!==true||clean(r.resolvedId)!==selected||r.providerSha256!==selectedSha))violations.push(`${name}: resolver not isolated`);
 const m=isolation.moduleSetup;
 if(!m.ready||m.policy!==policy||m.providerPath!==selected||['peakPolicy','maskPolicy','cachePolicy'].some(k=>m[k]!=='current production, untouched')||!m.baselineModuleImportedWithoutInstantiation||!m.candidateModuleImportedWithoutInstantiation||m.textureFactoriesCalledBySetup!==false)violations.push(`${name}: unbalanced/invalid untimed uploader setup`);
 const expectedLoaded=new Map([[`${isolation.extraBaselineRoot}/${uploaderFile}`,{kind:'uploader',sha:isolation.baselineUploaderSha256}],[isolation.candidateSource,{kind:'uploader',sha:isolation.candidateUploaderSha256}],[d.currentRegionPath,{kind:'unchanged-region',sha:d.currentRegionSha256}]]);
 const loaded=new Set(isolation.loadedUploaderModules.map(r=>clean(r.path)));
 if(loaded.size!==expectedLoaded.size||[...expectedLoaded.keys()].some(p=>!loaded.has(p))||isolation.loadedUploaderModules.some(r=>!r.servedFromRunStartSnapshot||r.kind!==expectedLoaded.get(clean(r.path))?.kind||r.sha256!==expectedLoaded.get(clean(r.path))?.sha))violations.push(`${name}: unexpected loaded uploader/dependency snapshot`);
 const dep=isolation.dependencyResolveRecords,providerPaths=[`${isolation.extraBaselineRoot}/${uploaderFile}`,isolation.candidateSource];
 for(const p of providerPaths)for(const request of ['./card-upload-region','three'])if(!dep.some(r=>clean(r.importer)===p&&r.request===request))violations.push(`${name}: missing provider dependency ${request}`);
 if(dep.some(r=>!providerPaths.includes(clean(r.importer))||!['./card-upload-region','three'].includes(r.request)||r.request==='./card-upload-region'&&(clean(r.resolvedId)!==d.currentRegionPath||r.sha256!==d.currentRegionSha256)))violations.push(`${name}: importer-scoped dependency mismatch`);
 const threeIds=[...new Set(dep.filter(r=>r.request==='three').map(r=>r.resolvedId))];
 if(threeIds.length!==1)violations.push(`${name}: distinct Three module identities`);
 // Each lifetime-run has an independent Vite optimizer directory/query.
 // Within the run the raw IDs, including query, must still match exactly.
 if(dep.filter(r=>r.request==='three').some(r=>r.scope!=='Same current production package resolver')||threeIds.some(id=>!/^\/tmp\/sketch-upload-formal-[^/]+\/\.vite\/deps\/three\.js(?:\?.*)?$/.test(id)))violations.push(`${name}: unexpected current-package Three resolver/cache module`);
 providers.push({name,policy,actualProviderPath:selected,actualProviderSha256:selectedSha,compileTimeResolution:isolation.resolveRecords,moduleSetup:m,loadedUploaderModules:isolation.loadedUploaderModules,dependencyResolveRecords:dep,dependencyEvidence:{regionSha256:d.currentRegionSha256,threeResolvedIdentity:threeIds[0],threeSourceBytesSha256:null,threeNote:'Both external providers use the same exact current-source package resolver ID within each run, including query. Independent run-start Vite optimizer directories/queries differ across runs and are not source inequality. No package-byte SHA or ordinary WorldLayer final browser module/object identity is recorded.'}});
 for(const c of run.cycles){
  const a=oracle.cycles.find(x=>x.cycle===c.cycle&&x.hiddenCount===c.hiddenCount);
  if(!a){violations.push(`${name}: extra lifetime`);continue;}
  equal(c.device,a.device,`${name}/${c.cycle}: device differs`);equal(c.cpu.sampleTicks,a.cpu.sampleTicks,`${name}/${c.cycle}: CPU ticks differ`);
  if(c.cpu.sampleTicks.length!==60||c.cpu.sampleTicks.some((t,i)=>t!==Math.floor((114+i)/3))||c.cpu.valuesMs.length!==60||c.cpu.layerValuesMs.length!==60||c.cpu.canvasValuesMs.length!==60||c.real.completeWallValuesMs.length!==12||c.real.submitValuesMs.length!==12||c.real.intervalsMs.length!==11||c.glError||!c.disposed)violations.push(`${name}/${c.cycle}: clock/samples/GL/disposal invalid`);
  for(const key of ['pixelProof','pixelProofSha256','capturedVisibleSnapshotSha256','assetCoverage'])equal(c[key],a[key],`${name}/${c.cycle}: different ${key}`);
  facts.push({name,cycle:c.cycle,sameFacts:c.pixelProofSha256===a.pixelProofSha256,sameCapturedSnapshot:c.capturedVisibleSnapshotSha256===a.capturedVisibleSnapshotSha256,matchedCpuTicks:c.cpu.sampleTicks.length});
  equal(c.variantSetups,a.variantSetups,`${name}/${c.cycle}: variant setup differs`);
  if(!c.variantSetups.length||c.variantSetups.some(s=>!s.outsideMeasuredDraws||s.maxBanks!==1||s.mips!=='native'||s.cardMaxBanks!==1||s.remainsMaxBanks!==1||s.cardPages||s.cardChunks||s.remainsPages||s.remainsChunks))violations.push(`${name}/${c.cycle}: unbalanced variant resource preparation`);
  for(const k of ['hiddenCount','visibleCount','totalUnits'])equal(c[k],a[k],`${name}/${c.cycle}: scene ${k} differs`);
  if(hash(Buffer.from(JSON.stringify(c.pixelProof)))!==c.pixelProofSha256||hash(Buffer.from(JSON.stringify({units:c.pixelProof.visibleUnitFacts,effects:c.pixelProof.visibleEffectFacts,tick:c.pixelProof.tick})))!==c.capturedVisibleSnapshotSha256)violations.push(`${name}/${c.cycle}: raw fact hash differs`);
  for(const phase of ['before','empty','returned']){
   const current=c[phase],reference=a[phase],x=stableCards(current.cards),y=stableCards(reference.cards);
   equal(c.uploadPolicyResources[phase],current.cards,`${name}/${c.cycle}/${phase}: upload resource alias differs`);
   const rc=current.cards.rasterCache;
   if(rc.budget!==48*1024*1024||rc.entries>1024||rc.entries<0||rc.bytes<0||rc.bytes>rc.budget||rc.ownedBytes<rc.bytes||rc.ownedBytes!==rc.bytes+rc.scratchBytes)violations.push(`${name}/${c.cycle}/${phase}: cache budget/entry/ownership invalid`);
   if(policy==='candidate'&&(!Number.isInteger(current.cards.partialUploadCopyCalls)||current.cards.partialUploadCopyCalls<current.cards.scratchPartialUploads))violations.push(`${name}/${c.cycle}/${phase}: invalid attempted partial copy-call count`);
   const invariantFields=['pages','cards','pixels','drawChunks','pooledDrawChunks','drawCapacity','drawBufferBytes','maxTextureBanks','gpuBytes','allocatedMipBytes','maskBytes','pendingMaskBytes','pendingRgbaBytes','retiredGpuBytes','ownedGpuBytes','peakOwnedGpuBytes','peakRetiredGpuBytes','residencySnapshot','rasterizations','copiedLayers','scratchTextures','scratchGpuBytes','mipInitializedPages','mipLayerUpdates','mipCopyCalls','mipCopyBytes','gpuCompactionLayers','gpuCompactionCopyCalls','arrayBaseUploadBytes','scratchUploadBytes','scratchInitialUploadBytes','scratchFullUploadBytes','scratchPartialUploadBytes','scratchPartialUploadPixels','scratchPartialUploads','scratchUnchangedUploads','scratchFullUploadFallbacks'];
   for(const k of invariantFields)equal(x[k],y[k],`${name}/${c.cycle}/${phase}: visual/GPU layout invariant ${k} differs`);
   equal(Object.fromEntries(Object.entries(stablePhase(current)).filter(([k])=>k!=='cards')),Object.fromEntries(Object.entries(stablePhase(reference)).filter(([k])=>k!=='cards')),`${name}/${c.cycle}/${phase}: phase render/content/order differs`);
   // Cache decisions depend on measured work. Report every change, including
   // unknown/new fields, instead of pretending all ownership and counters match.
   const differences=deepDifferences(y,x);
   const originalPartialCalls=reference.cards.scratchFullUploadFallbacks===0?{derivedFrom:'scratchPartialUploads in original one-call-per-successful-ROI implementation; no fallback recorded',calls:reference.cards.scratchPartialUploads}:null;
   resourceChecks.push({name,cycle:c.cycle,phase,originalPartialCalls,candidatePartialUploadCopyCalls:current.cards.partialUploadCopyCalls??null,layoutComparedFields:invariantFields,allNonTimingCardsIdentical:!differences.length,differences,original:y,actual:x,cacheCost:{original:reference.cards.rasterCache,actual:current.cards.rasterCache},rasterStages:{original:reference.cards.rasterStages,actual:current.cards.rasterStages},rasterWorkWallMs:{original:reference.cards.rasterWorkWallMs,actual:current.cards.rasterWorkWallMs},gpuTransferSubmissionWallMs:{original:reference.cards.gpuTransferSubmissionWallMs,actual:current.cards.gpuTransferSubmissionWallMs}});
  }
  for(const [view,desc]of Object.entries(c.screenshots)){
   const bytes=await readFile(resolve(here,name,desc.path));if(hash(bytes)!==desc.sha256)violations.push(`${name}/${c.cycle}/${view}: PNG hash differs`);
   const decoded=png(bytes),key=`${c.cycle}/${view}`;if(!imageOracle.has(key))imageOracle.set(key,decoded);const original=imageOracle.get(key);
   const identical=decoded.width===original.width&&decoded.height===original.height&&decoded.rgba.equals(original.rgba);if(!identical)violations.push(`${name}/${key}: RGBA differs`);
   images.push({name,cycle:c.cycle,view,width:decoded.width,height:decoded.height,sha256:hash(bytes),rgbaSha256:hash(decoded.rgba),identical});
  }
 }
}
if(images.length!==24||facts.length!==8||resourceChecks.length!==24||facts.reduce((s,r)=>s+r.matchedCpuTicks,0)!==480)violations.push('Missing PNG/fact/resource/clock evidence');
const sum=a=>a.reduce((x,y)=>x+y,0);
function dist(v){if(!v.length||v.some(x=>!Number.isFinite(x)))throw new Error('Nonfinite/missing raw samples');const s=[...v].sort((a,b)=>a-b),p=q=>s[Math.min(s.length-1,Math.floor(s.length*q))];return{samples:v.length,meanMs:sum(v)/v.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:s.at(-1),over16_67:v.filter(x=>x>1000/60).length,over50:v.filter(x=>x>50).length,over100:v.filter(x=>x>100).length};}
const select=(c,values,predicate)=>values.filter((_,i)=>predicate(c,i));
const fields={fullCpu:c=>c.cpu.valuesMs,world3DCpu:c=>c.cpu.layerValuesMs,canvasResidual:c=>c.cpu.canvasValuesMs,
 freshTick:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===0),repeatedTick:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3!==0),phase1:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===1),phase2:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===2),
 realWall:c=>c.real.completeWallValuesMs,realSubmit:c=>c.real.submitValuesMs,realIntervals:c=>c.real.intervalsMs,firstColdReal:c=>c.real.completeWallValuesMs.slice(0,1),subsequentReal:c=>c.real.completeWallValuesMs.slice(1),
 fenceWait:c=>c.real.completion.map(r=>r.waitMs),pollCall:c=>c.real.completion.map(r=>r.pollCallMs),yieldedWall:c=>c.real.completion.map(r=>r.yieldedWallMs),fencePolls:c=>c.real.completion.map(r=>r.polls),emptyWall:c=>[c.empty.completeWallMs],emptySubmit:c=>[c.empty.submissionMs],returnedWall:c=>[c.returned.completeWallMs],returnedSubmit:c=>[c.returned.submissionMs]};
function aggregate(cycles){return Object.fromEntries(Object.entries(fields).map(([k,field])=>[k,dist(cycles.flatMap(field))]));}
const originalCycles=['original-A','original-A2'].flatMap(k=>runs[k].cycles),candidateCycles=['candidate-B','candidate-B2'].flatMap(k=>runs[k].cycles);
const pooled={original:aggregate(originalCycles),candidate:aggregate(candidateCycles)},regressions=[];
for(const k of Object.keys(fields))for(const metric of ['meanMs','p50Ms','p95Ms','p99Ms','maxMs'])if(pooled.candidate[k][metric]>pooled.original[k][metric])regressions.push({field:k,metric,original:pooled.original[k][metric],candidate:pooled.candidate[k][metric],changePct:pooled.original[k][metric]===0?null:(pooled.candidate[k][metric]/pooled.original[k][metric]-1)*100});
const perRun=names.map(name=>({name,policy:runs[name].uploadIsolation.policy,timings:aggregate(runs[name].cycles),lifetimes:runs[name].cycles.map(c=>({cycle:c.cycle,timings:aggregate([c]),before:c.before,empty:c.empty,returned:c.returned,heapAfterGc:c.heapAfterGc})),heapAfterTeardown:runs[name].heapAfterTeardown}));
for(const d of Object.values(inputs))if(hash(await readFile(d.path))!==d.sha256)violations.push('Historical raw changed during analysis');
const result={sourceCommit:oracle.sourceCommit,inputArtifacts:inputs,analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),method:'Same aec09d6 core source ABBA original-A/candidate-B/candidate-B2/original-A2. Both one/native bank, current mask and peak, same allocation/raster/draw/cache/artist code; only the complete CardMipUploader module differs at the exact current PaintedCardBatches import. Complete uploader-module candidate splits warm changed CPU-to-scratch regions. Cache/CPU ownership/cost changes are fully reported because unchanged adaptive cache logic may respond to changed timing. New attempted partial-copy counters are not required to equal original; original has no measured field. GPU rasterization/mip-copy counts, upload bytes, page layout, geometry and render order remain strict invariants. All raw samples pooled across four lifetimes per policy, not averaged quantiles. All 24 PNGs are decoded and compared at zero RGBA tolerance; original-A supplies six phase/lifetime image oracles.',
 validation:{passed:!violations.length,violations,inputHashesUnchanged:true},sourceAndSettings:Object.fromEntries(sourceFields.map(k=>[k,oracle[k]])),baselineProvider:oracle.uploadIsolation,providers,images,facts,resourceChecks,pooled,perRun,matchedCpuSamples:facts.reduce((s,r)=>s+r.matchedCpuTicks,0),allScreenshotsZeroRGBA:images.length===24&&images.every(r=>r.identical),allRecordedPixelHashesEqual:images.every(r=>r.sha256===images.find(x=>x.name==='original-A'&&x.cycle===r.cycle&&x.view===r.view).sha256),measuredRegressions:regressions,
 limits:['ABBA reduces simple order drift but only four lifetimes and 48 real samples per policy do not prove all hardware or stable tail distributions. Complete wall is GPU-completion/scheduling, not GPU nanoseconds/FPS.',
 'Complete uploader module is isolated on aec09d6, not integrated production. Warm changed regions split into <=64KiB public copies; first/recovery full uploads and GPU mip/compaction copies are outside that ceiling. Original has no measured partialUploadCopyCalls counter. New attempted-call count is reported, and source-identical adaptive cache timing/counters may change. No per-call timing/profiler: whole-frame ABBA cannot prove a smaller maximum single-copy duration or a specific GPU wait fix.',
 'Full/World3D/Canvas timings are nested/residual and cannot be added. Cold real samples remain in headline values. No allocation profiler or GC attribution.']};
await writeFile(resolve(here,'analysis-verified.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:resolve(here,'analysis-verified.json'),passed:result.validation.passed,violations,images:images.length,facts:facts.length,resourceChecks:resourceChecks.length,pooledCpu:[pooled.original.fullCpu,pooled.candidate.fullCpu],pooledWall:[pooled.original.realWall,pooled.candidate.realWall]}));
if(violations.length)process.exitCode=1;
