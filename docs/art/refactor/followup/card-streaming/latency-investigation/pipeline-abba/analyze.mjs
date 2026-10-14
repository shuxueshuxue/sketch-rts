/** Read completed ABBA evidence only; no browser/Canvas/profiler/test/benchmark. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const names=['reference-A','candidate-B','candidate-B2','reference-A2'],inputs={},runs={};
for(const name of names){const path=resolve(here,name,'raw.json'),bytes=await readFile(path);inputs[name]={path,sha256:hash(bytes)};runs[name]=JSON.parse(bytes);}
const violations=[],images=[],resourceChecks=[],providers=[],facts=[];
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b,label)=>{if(canonical(a)!==canonical(b))violations.push(label);};
const oracle=runs['reference-A'];
const expectedScene=oracle.scene,expectedCpuFrames=expectedScene==='mixed'?60:360,expectedRealFrames=expectedScene==='mixed'?12:18,expectedCounts=expectedScene==='mixed'?[0]:[0,9900];
const expectedCycles=2*expectedCounts.length;
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
 const run=runs[name],policy=name.startsWith('reference')?'original':'candidate';
 equal(run.errors,[],`${name}: errors must be an empty array`);equal(run.failed,[],`${name}: failed must be an empty array`);equal(run.validation?.violations,[],`${name}: validation violations must be empty`);
 for(const k of sourceFields)equal(run[k],oracle[k],`${name}: different ${k}`);
 if(!run.completed||!run.validation.passed||run.errors.length||run.failed.length||!['mixed','canonical'].includes(run.scene)||run.cpuFrames!==expectedCpuFrames||run.realFrames!==expectedRealFrames||run.repeats!==2||canonical(run.counts)!==canonical(expectedCounts)||!run.paced||run.simulation.length||run.variant.maxBanks!==1||run.variant.mips!==(policy==='original'?'full':'native')||run.cycles.length!==expectedCycles)violations.push(`${name}: invalid combined pipeline schedule/source proof`);
 equal(run.cycles.map(c=>`${c.cycle}/${c.hiddenCount}`).sort(),[0,1].flatMap(c=>expectedCounts.map(hidden=>`${c}/${hidden}`)).sort(),`${name}: duplicate/missing lifetime/population`);
 for(const[file,key]of Object.entries(archived))if(hash(await readFile(resolve(here,name,file)))!==run[key])violations.push(`${name}: archived ${file} differs`);
 const isolation=run.cacheIsolation;
 const cacheFile='src/client/world3d/card-raster-cache.ts',batchesFile='src/client/world3d/painted-card-batches.ts',maskFile='src/client/world3d/card-pick-mask.ts';
 const clean=id=>id.split('?')[0].replace(/^\/@fs(?=\/)/,'');
 const selected=policy==='original'?`${isolation.extraBaselineRoot}/${cacheFile}`:isolation.candidateSource;
 const selectedSha=policy==='original'?isolation.baselineCacheSha256:isolation.candidateCacheSha256;
 if(run.sourceCommit!=='aec09d620801dd07852042732831e5b2de1c4193'||run.sourceGitDiffSha256!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'||isolation.policy!==policy||isolation.mode!==(policy==='original'?'reference':'candidate')||isolation.peakPolicy!==(policy==='original'?'5b exact prototype references':'current production')||isolation.maskPolicy!==(policy==='original'?'5b module':'current production')||isolation.extraBaselineDirty||isolation.extraBaselineCommit!=='5b356c7795068bb2a532ad1d486b3c22936cf735'||!isolation.currentSourceStayedFrozen||!isolation.baselineSourceStayedFrozen||!isolation.candidateSourceStayedFrozen||isolation.comparisonKind!=='Combined pipeline comparison: full/original peaks/original mask/48 MiB versus native/current peaks/current mask/16 MiB; not single-variable isolation'||isolation.candidateExactSingleConstructorDifference!==true||isolation.expectedMaximumEncodedEntries!==1024||isolation.expectedMaximumProbationEntries!==null)violations.push(`${name}: source/baseline/policy invalid`);
 for(const key of ['extraBaselineRoot','extraBaselineCommit','candidateSource','baselineCacheSha256','corpusCacheSha256','currentCacheSha256','candidateCacheSha256','currentBatchesSha256','currentMaskSha256','loaderSha256','parentHarnessSha256','pipelineLoaderSha256','peakHelperSha256','baselineMaskSha256','baselineBatchesSha256','methodFingerprints'])equal(isolation[key],oracle.cacheIsolation[key],`${name}: different provider ${key}`);
 equal(isolation.finalClientSourceSha256,run.allClientSourceSha256,`${name}: final client source differs`);
 equal(isolation.expectedBudgets,{original:50331648,candidate:16777216,selected:policy==='original'?50331648:16777216},`${name}: combined-policy budget expectations differ`);
 if(isolation.candidateBudgetArgumentPurpose!=='Validation expectation only; the complete provider class supplies its own default constructor budget without any override.')violations.push(`${name}: budget must not be constructor override`);
 if(isolation.candidateCacheSha256!=='f9c83fe94bcb5fd4136b5ae820911d6af880a50c1e240c8037853a29f3e3e78b'||isolation.actualProviderPath!==selected||isolation.actualProviderSha256!==selectedSha||isolation.baselineCacheSha256!==isolation.corpusCacheSha256||isolation.currentCacheSha256!==isolation.baselineCacheSha256||isolation.currentCacheSha256!==run.allClientSourceSha256[cacheFile]||isolation.currentMaskSha256!==run.allClientSourceSha256[maskFile]||isolation.currentBatchesSha256!==run.allClientSourceSha256[batchesFile]||isolation.candidateCacheSha256===isolation.baselineCacheSha256)violations.push(`${name}: invalid selected/current provider SHA`);
 for(const[file,sha]of [['pipeline-loader.js',isolation.pipelineLoaderSha256],['peak-helper.js',isolation.peakHelperSha256],['cache-loader.js',isolation.loaderSha256],['parent-harness.mjs',isolation.parentHarnessSha256],['source-snapshot/baseline-card-raster-cache.ts',isolation.baselineCacheSha256],['source-snapshot/current-card-raster-cache.ts',isolation.currentCacheSha256],['source-snapshot/candidate-card-raster-cache.ts',isolation.candidateCacheSha256],['source-snapshot/current-card-pick-mask.ts',isolation.currentMaskSha256],['source-snapshot/current-painted-card-batches.ts',isolation.currentBatchesSha256]])if(hash(await readFile(resolve(here,name,file)))!==sha)violations.push(`${name}: archived ${file} differs`);
 const oldSource=await readFile(resolve(here,name,'source-snapshot/baseline-card-raster-cache.ts'));
 const newSource=await readFile(resolve(here,name,'source-snapshot/candidate-card-raster-cache.ts'));
 const oldCtor='constructor(private budget=48*1024*1024){}',newCtor='constructor(private budget=16*1024*1024){}';
 if(oldSource.toString('utf8').split(oldCtor).length!==2||!newSource.equals(Buffer.from(oldSource.toString('utf8').replace(oldCtor,newCtor))))violations.push(`${name}: archived candidate is not exactly the single constructor-default budget difference`);
 if(!isolation.resolveRecords.length||isolation.resolveRecords.some(r=>r.request!=='./card-raster-cache'||clean(r.importer)!==`${run.sourceRoot}/${batchesFile}`||r.policy!==policy||r.redirected!==true||clean(r.resolvedId)!==selected||r.providerSha256!==selectedSha))violations.push(`${name}: resolver not isolated`);
 const m=isolation.moduleSetup;
 if(!m.ready||m.policy!==policy||m.providerPath!==selected||m.peakPolicy!==isolation.peakPolicy||m.maskPolicy!==isolation.maskPolicy||!m.baselineModuleImportedWithoutInstantiation||!m.candidateModuleImportedWithoutInstantiation)violations.push(`${name}: unbalanced/invalid untimed cache class setup`);
 const loaded=new Set(isolation.loadedCacheModules.map(r=>clean(r.path)));
 if(!loaded.has(`${isolation.extraBaselineRoot}/${cacheFile}`)||!loaded.has(isolation.candidateSource)||loaded.size!==2||isolation.loadedCacheModules.some(r=>!r.servedFromRunStartSnapshot||r.sha256!==(clean(r.path)===isolation.candidateSource?isolation.candidateCacheSha256:isolation.baselineCacheSha256)))violations.push(`${name}: unexpected loaded cache modules/snapshot`);
 const pipelineSnapshots=isolation.pipelineSourceSnapshots;
 if(!Array.isArray(pipelineSnapshots)||!pipelineSnapshots.length)violations.push(`${name}: missing pipeline source snapshots`);
 const snapshotMap=new Map();
 for(const r of pipelineSnapshots??[]){
  if(snapshotMap.has(r.path)||r.snapshot!==`pipeline-module-snapshots/${r.sha256}.ts`)violations.push(`${name}: duplicate/incorrect pipeline snapshot filename`);
  snapshotMap.set(r.path,r);
  if(hash(await readFile(resolve(here,name,r.snapshot)))!==r.sha256)violations.push(`${name}: pipeline source snapshot bytes differ ${r.path}`);
 }
 if(!Array.isArray(isolation.pipelineLoadedModules)||!isolation.pipelineLoadedModules.length)violations.push(`${name}: missing actual pipeline module load records`);
 for(const r of isolation.pipelineLoadedModules??[])if(r.servedFromSnapshot!==true||snapshotMap.get(r.path)?.sha256!==r.sha256)violations.push(`${name}: loaded pipeline module lacks exact source snapshot`);
 for(const [path,sha]of [[`${isolation.extraBaselineRoot}/${maskFile}`,isolation.baselineMaskSha256],[`${isolation.extraBaselineRoot}/${batchesFile}`,isolation.baselineBatchesSha256],[`${run.sourceRoot}/${maskFile}`,isolation.currentMaskSha256]]){
  if(snapshotMap.get(path)?.sha256!==sha)violations.push(`${name}: required mask/peak source snapshot missing`);
  if(!(isolation.pipelineLoadedModules??[]).some(r=>r.path===path&&r.sha256===sha&&r.servedFromSnapshot===true))violations.push(`${name}: required mask/peak actual module load missing`);
 }
 const normalizedSnapshots=[...snapshotMap.values()].map(r=>({path:r.path,sha256:r.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 equal(normalizedSnapshots,oracle.cacheIsolation.pipelineSourceSnapshots.map(r=>({path:r.path,sha256:r.sha256})).sort((a,b)=>a.path.localeCompare(b.path)),`${name}: pipeline provider/dependency bytes differ between arms`);
 const expectedMask=policy==='original'?`${isolation.extraBaselineRoot}/${maskFile}`:`${run.sourceRoot}/${maskFile}`;
 if(isolation.selectedMaskPath!==expectedMask)violations.push(`${name}: incorrect selected mask path`);
 const maskRecords=isolation.pipelineResolveRecords.filter(r=>r.request==='./card-pick-mask');
 if(!maskRecords.length||maskRecords.some(r=>clean(r.importer)!==`${run.sourceRoot}/${batchesFile}`||r.resolvedId!==expectedMask||r.redirected!==(policy==='original')))violations.push(`${name}: selected mask resolver contract differs`);
 const threeRecords=isolation.pipelineResolveRecords.filter(r=>r.request==='three');
 if(!threeRecords.length||threeRecords.some(r=>!clean(r.importer).startsWith(isolation.extraBaselineRoot+'/')||r.sameThreeIdentity!==true||!r.resolvedId||r.resolvedId!==r.currentResolvedId))violations.push(`${name}: baseline/current package resolver identity differs`);
 if(isolation.pipelineResolveRecords.some(r=>!['three','./card-pick-mask'].includes(r.request)))violations.push(`${name}: unexpected pipeline resolver record`);
 for(const provider of ['baseline','current'])for(const key of ['stats','recordPeaks']){
  const f=isolation.methodFingerprints?.[provider]?.[key];
  if(!f||f.name!==key||typeof f.source!=='string'||hash(Buffer.from(f.source,'utf8'))!==f.sha256)violations.push(`${name}: runtime method fingerprint invalid ${provider}/${key}`);
 }
 const peak=isolation.peakSetup,providerRoot=policy==='original'?isolation.extraBaselineRoot:run.sourceRoot;
 if(peak.policy!==(policy==='original'?'original':'production')||peak.methodProviderRoot!==providerRoot||peak.methodProviderFile!==batchesFile||peak.baselineClassInstantiated!==false||peak.productionMethodsUnmodified!==(policy==='candidate'))violations.push(`${name}: invalid peak setup provider`);
 equal(peak.methods,['stats','recordPeaks'],`${name}: incorrect peak method selection`);
 if(run.variant.name!==`pipeline-${isolation.mode}`||run.variant.ordering!=='current corrected stable snapshot ordering')violations.push(`${name}: invalid host pipeline variant`);
 equal(run.variant.referenceOverrides,policy==='original'?['residentMip returns 0','5b stats/recordPeaks','5b mask','48 MiB original cache']:[],`${name}: invalid host reference overrides`);
 providers.push({name,policy,actualProviderPath:selected,actualProviderSha256:selectedSha,compileTimeResolution:isolation.resolveRecords,moduleSetup:m,loadedCacheModules:isolation.loadedCacheModules});
 for(const c of run.cycles){
  const a=oracle.cycles.find(x=>x.cycle===c.cycle&&x.hiddenCount===c.hiddenCount);
  if(!a){violations.push(`${name}: extra lifetime`);continue;}
  equal(c.device,a.device,`${name}/${c.cycle}: device differs`);equal(c.cpu.sampleTicks,a.cpu.sampleTicks,`${name}/${c.cycle}: CPU ticks differ`);
  if(c.cpu.sampleTicks.length!==expectedCpuFrames||c.cpu.sampleTicks.some((t,i)=>t!==Math.floor((114+i)/3))||c.cpu.valuesMs.length!==expectedCpuFrames||c.cpu.layerValuesMs.length!==expectedCpuFrames||c.cpu.canvasValuesMs.length!==expectedCpuFrames||c.real.completeWallValuesMs.length!==expectedRealFrames||c.real.submitValuesMs.length!==expectedRealFrames||c.real.intervalsMs.length!==expectedRealFrames-1||c.glError||!c.disposed)violations.push(`${name}/${c.cycle}: clock/samples/GL/disposal invalid`);
  for(const key of ['pixelProof','pixelProofSha256','capturedVisibleSnapshotSha256'])equal(c[key],a[key],`${name}/${c.cycle}: different ${key}`);
  const contentCoverage=coverage=>coverage===undefined?undefined:Object.fromEntries(Object.entries(coverage).filter(([k])=>!['residentKeys','residentKeyCount'].includes(k)));
  equal(contentCoverage(c.assetCoverage),contentCoverage(a.assetCoverage),`${name}/${c.cycle}: visible art content coverage differs`);
  facts.push({name,cycle:c.cycle,hiddenCount:c.hiddenCount,sameFacts:c.pixelProofSha256===a.pixelProofSha256,sameCapturedSnapshot:c.capturedVisibleSnapshotSha256===a.capturedVisibleSnapshotSha256,matchedCpuTicks:c.cpu.sampleTicks.length,assetCoverage:{reference:a.assetCoverage,actual:c.assetCoverage,differences:deepDifferences(a.assetCoverage,c.assetCoverage,'assetCoverage')}});
  if(!c.variantSetups.length||c.variantSetups.some(s=>!s.outsideMeasuredDraws||s.maxBanks!==1||s.mips!==(policy==='original'?'full':'native')||s.cardMaxBanks!==1||s.remainsMaxBanks!==1||s.cardPages||s.cardChunks||s.remainsPages||s.remainsChunks))violations.push(`${name}/${c.cycle}: unbalanced variant resource preparation`);
  if(c.variant.name!==run.variant.name||c.variant.maxBanks!==1||c.variant.mips!==(policy==='original'?'full':'native')||c.variant.ordering!=='production stable snapshot ordering')violations.push(`${name}/${c.cycle}: invalid fixture variant`);
  equal(c.variant.referenceOverrides,policy==='original'?['residentMip returns 0']:[],`${name}/${c.cycle}: invalid fixture reference override`);
  if(!Array.isArray(c.pipelineSetups)||c.pipelineSetups.length!==1)violations.push(`${name}/${c.cycle}: missing/extra lifetime peak binding setup`);
  for(const s of c.pipelineSetups??[]){
   if(s.policy!==(policy==='original'?'original':'production')||s.outsideDraw!==true||typeof s.residentMipSource!=='string')violations.push(`${name}/${c.cycle}: invalid pipeline setup`);
   if(policy==='original'&&!s.residentMipSource.replace(/\s/g,'').includes('this.cardMipBases[0]++;return0;'))violations.push(`${name}/${c.cycle}: reference does not select full-chain residency`);
   const matched=runs[names.find(n=>runs[n].cacheIsolation.policy===policy)].cycles.find(x=>x.cycle===c.cycle&&x.hiddenCount===c.hiddenCount);
   if(matched?.pipelineSetups?.[0])equal(s.residentMipSource,matched.pipelineSetups[0].residentMipSource,`${name}/${c.cycle}: residency selector source differs within policy`);
   equal(s.instances.map(i=>i.name),['cards','remainsCards'],`${name}/${c.cycle}: peak binding instances differ`);
   for(const i of s.instances)if(i.maxBanks!==1||i.pages!==0||i.chunks!==0||i.statsProvider!==providerRoot||i.recordPeaksProvider!==providerRoot||i.statsName!=='stats'||i.recordPeaksName!=='recordPeaks'||i.exactBaselineMethodReferences!==(policy==='original')||i.noOverride!==(policy==='candidate'))violations.push(`${name}/${c.cycle}: peak method binding/empty resource preparation differs`);
  }
  for(const k of ['hiddenCount','visibleCount','totalUnits'])equal(c[k],a[k],`${name}/${c.cycle}: scene ${k} differs`);
  if(hash(Buffer.from(JSON.stringify(c.pixelProof)))!==c.pixelProofSha256||hash(Buffer.from(JSON.stringify({units:c.pixelProof.visibleUnitFacts,effects:c.pixelProof.visibleEffectFacts,tick:c.pixelProof.tick})))!==c.capturedVisibleSnapshotSha256)violations.push(`${name}/${c.cycle}: raw fact hash differs`);
  for(const phase of ['before','empty','returned']){
   const current=c[phase],reference=a[phase],x=stableCards(current.cards),y=stableCards(reference.cards);
   equal(c.cachePolicyResources[phase],current.cards,`${name}/${c.cycle}/${phase}: cache resource alias differs`);
   const rc=current.cards.rasterCache;
   if(rc.budget!==isolation.expectedBudgets.selected||!Number.isInteger(rc.entries)||rc.entries>1024||rc.entries<0||!Number.isFinite(rc.bytes)||rc.bytes<0||rc.bytes>rc.budget||rc.ownedBytes<rc.bytes||rc.ownedBytes!==rc.bytes+rc.scratchBytes)violations.push(`${name}/${c.cycle}/${phase}: cache budget/entry/ownership invalid`);
   const unexpectedPolicyFields=Object.keys(rc).filter(k=>/probation|admission|ghost/i.test(k));
   equal(Object.keys(rc).sort(),['backoffs','bypassRequests','workMs','avoidedPaintMs','bytes','scratchBytes','ownedBytes','entries','hits','misses','evictions','budget'].sort(),`${name}/${c.cycle}/${phase}: unchanged cache stats keyset differs`);
   if(unexpectedPolicyFields.length)violations.push(`${name}/${c.cycle}/${phase}: unexpected admission/ghost stats`);
   const bv=c.cacheBudgetValidation[phase];
   if(bv.expectedBudgetBytes!==isolation.expectedBudgets.selected||bv.actualBudgetBytes!==rc.budget||bv.budgetMatches!==true||bv.encodedBytes!==rc.bytes||bv.encodedBytesWithinBudget!==true||bv.encodedEntries!==rc.entries||bv.encodedEntryLimit!==1024||bv.encodedEntriesValid!==true||bv.probationApplies!==false||bv.probationEntryLimit!==null||bv.probationEntries!==null||bv.probationEntriesValid!==null||bv.noAdmissionMetadata!==true||canonical(bv.unexpectedPolicyFields)!=='[]')violations.push(`${name}/${c.cycle}/${phase}: actual budget/no-admission proof differs`);
   const invariantFields=['maxTextureBanks'];
   if(x.maxTextureBanks!==1)violations.push(`${name}/${c.cycle}/${phase}: not the selected single-bank policy`);
   // Full/native residency changes physical pages and draw segmentation. Those
   // resources and every renderer-info field are reported, not equated.
   const phaseDifferences=deepDifferences(stablePhase(reference),stablePhase(current),'phase');
   for(const k of ['positions','combat'])equal(current[k],reference[k],`${name}/${c.cycle}/${phase}: unchanged content/view ${k} differs`);
   const contentView=index=>index===null?null:Object.fromEntries(Object.entries(index).filter(([k])=>k!=='cardMipBases'));
   equal(contentView(current.viewIndex),contentView(reference.viewIndex),`${name}/${c.cycle}/${phase}: unchanged view-index content differs`);
   const snapshot=current.cards.residencySnapshot;
   if(!snapshot?.outsideMeasuredTimers||snapshot.pages.some(p=>p.capacity<1||p.liveLayers>p.capacity||p.activeLayers>p.liveLayers)||snapshot.chunks.some(ch=>ch.banks<0||ch.banks>1||ch.visible&&ch.count>0&&ch.banks!==1||ch.count<0||ch.count>ch.capacity))violations.push(`${name}/${c.cycle}/${phase}: invalid actual residency snapshot`);
   if(policy==='original'&&Object.keys(snapshot.actualCardBaseMips).some(k=>k!=='0'))violations.push(`${name}/${c.cycle}/${phase}: full-chain reference retained a nonzero mip base`);
   // Cache decisions depend on measured work. Report every change, including
   // unknown/new fields, instead of pretending all ownership and counters match.
   const differences=deepDifferences(y,x);
   resourceChecks.push({name,cycle:c.cycle,hiddenCount:c.hiddenCount,phase,layoutComparedFields:invariantFields,phaseDifferences,allNonTimingCardsIdentical:!differences.length,differences,original:y,actual:x,cacheCost:{original:reference.cards.rasterCache,actual:current.cards.rasterCache},rasterStages:{original:reference.cards.rasterStages,actual:current.cards.rasterStages},rasterWorkWallMs:{original:reference.cards.rasterWorkWallMs,actual:current.cards.rasterWorkWallMs},gpuTransferSubmissionWallMs:{original:reference.cards.gpuTransferSubmissionWallMs,actual:current.cards.gpuTransferSubmissionWallMs}});
  }
  for(const [view,desc]of Object.entries(c.screenshots)){
   const bytes=await readFile(resolve(here,name,desc.path));if(hash(bytes)!==desc.sha256)violations.push(`${name}/${c.cycle}/${view}: PNG hash differs`);
   const decoded=png(bytes),key=`${c.hiddenCount}/${c.cycle}/${view}`;if(!imageOracle.has(key))imageOracle.set(key,decoded);const original=imageOracle.get(key);
   const identical=decoded.width===original.width&&decoded.height===original.height&&decoded.rgba.equals(original.rgba);if(!identical)violations.push(`${name}/${key}: RGBA differs`);
   images.push({name,cycle:c.cycle,hiddenCount:c.hiddenCount,view,width:decoded.width,height:decoded.height,sha256:hash(bytes),rgbaSha256:hash(decoded.rgba),identical});
  }
 }
}
if(images.length!==names.length*expectedCycles*3||facts.length!==names.length*expectedCycles||resourceChecks.length!==names.length*expectedCycles*3||facts.reduce((s,r)=>s+r.matchedCpuTicks,0)!==names.length*expectedCycles*expectedCpuFrames)violations.push('Missing PNG/fact/resource/clock evidence');
const sum=a=>a.reduce((x,y)=>x+y,0);
function dist(v){if(!v.length||v.some(x=>!Number.isFinite(x)))throw new Error('Nonfinite/missing raw samples');const s=[...v].sort((a,b)=>a-b),p=q=>s[Math.min(s.length-1,Math.floor(s.length*q))];return{samples:v.length,meanMs:sum(v)/v.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:s.at(-1),over16_67:v.filter(x=>x>1000/60).length,over50:v.filter(x=>x>50).length,over100:v.filter(x=>x>100).length};}
const select=(c,values,predicate)=>values.filter((_,i)=>predicate(c,i));
const fields={fullCpu:c=>c.cpu.valuesMs,world3DCpu:c=>c.cpu.layerValuesMs,canvasResidual:c=>c.cpu.canvasValuesMs,
 freshTick:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===0),repeatedTick:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3!==0),phase1:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===1),phase2:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===2),
 realWall:c=>c.real.completeWallValuesMs,realSubmit:c=>c.real.submitValuesMs,realIntervals:c=>c.real.intervalsMs,firstColdReal:c=>c.real.completeWallValuesMs.slice(0,1),subsequentReal:c=>c.real.completeWallValuesMs.slice(1),
 fenceWait:c=>c.real.completion.map(r=>r.waitMs),pollCall:c=>c.real.completion.map(r=>r.pollCallMs),yieldedWall:c=>c.real.completion.map(r=>r.yieldedWallMs),fencePolls:c=>c.real.completion.map(r=>r.polls),emptyWall:c=>[c.empty.completeWallMs],emptySubmit:c=>[c.empty.submissionMs],returnedWall:c=>[c.returned.completeWallMs],returnedSubmit:c=>[c.returned.submissionMs]};
function aggregate(cycles){return Object.fromEntries(Object.entries(fields).map(([k,field])=>[k,dist(cycles.flatMap(field))]));}
const originalCycles=['reference-A','reference-A2'].flatMap(k=>runs[k].cycles),candidateCycles=['candidate-B','candidate-B2'].flatMap(k=>runs[k].cycles);
const pooled={original:aggregate(originalCycles),candidate:aggregate(candidateCycles)},regressions=[];
const pooledByHidden=Object.fromEntries(expectedCounts.map(hidden=>[hidden,{original:aggregate(originalCycles.filter(c=>c.hiddenCount===hidden)),candidate:aggregate(candidateCycles.filter(c=>c.hiddenCount===hidden))}]));
for(const k of Object.keys(fields))for(const metric of ['meanMs','p50Ms','p95Ms','p99Ms','maxMs'])if(pooled.candidate[k][metric]>pooled.original[k][metric])regressions.push({field:k,metric,original:pooled.original[k][metric],candidate:pooled.candidate[k][metric],changePct:pooled.original[k][metric]===0?null:(pooled.candidate[k][metric]/pooled.original[k][metric]-1)*100});
const perRun=names.map(name=>({name,policy:runs[name].cacheIsolation.policy,timings:aggregate(runs[name].cycles),lifetimes:runs[name].cycles.map(c=>({cycle:c.cycle,hiddenCount:c.hiddenCount,timings:aggregate([c]),before:c.before,empty:c.empty,returned:c.returned,heapAfterGc:c.heapAfterGc})),heapAfterTeardown:runs[name].heapAfterTeardown}));
let inputHashesUnchanged=true;
for(const d of Object.values(inputs))if(hash(await readFile(d.path))!==d.sha256){inputHashesUnchanged=false;violations.push('Historical raw changed during analysis');}
const result={sourceCommit:oracle.sourceCommit,inputArtifacts:inputs,analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),method:'Combined same-aec09d6 current-core pipeline ABBA, reference-A/candidate-B/candidate-B2/reference-A2, two lifetimes per population. Reference: one full-chain bank, frozen 5b exact stats/recordPeaks references, frozen 5b mask and original48MiB cache. Candidate: one native-mip bank, current peaks/mask and original cache with constructor-default16MiB only. Both retain current painter/shader/upload/allocation/corrected ordering/rules. This is a combined-policy comparison, not single-variable attribution or historical renderer restoration. All samples pooled without selection; populations reported separately. PNG/facts/clocks/source/providers are strict; changed physical residency/render/cache resources are retained field by field. No added per-frame observer. Current aggregate snapshots do not record or independently prove per-instance submitted geometry/order. Picking requires separate correctness evidence.',
 validation:{passed:!violations.length,violations,inputHashesUnchanged},sourceAndSettings:Object.fromEntries(sourceFields.map(k=>[k,oracle[k]])),baselineProvider:oracle.cacheIsolation,providers,images,facts,resourceChecks,cacheMetadataAccounting:{encodedEntriesCap:1024,encodedBudgetsByPolicy:{original:50331648,candidate:16777216},probationApplies:false,probationKeysCap:null,probationEntryMetadataBytes:null,reason:'Neither selected cache class implements probation or admission metadata; absent raw fields remain absent, and validation fields are null/not applicable. Existing encoded-entry Map/key/object metadata and process memory are not measured by declared buffer ownership.'},pooled,pooledByHidden,perRun,matchedCpuSamples:facts.reduce((s,r)=>s+r.matchedCpuTicks,0),allScreenshotsZeroRGBA:images.length===names.length*expectedCycles*3&&images.every(r=>r.identical),allRecordedPixelHashesEqual:images.every(r=>r.sha256===images.find(x=>x.name==='reference-A'&&x.cycle===r.cycle&&x.hiddenCount===r.hiddenCount&&x.view===r.view).sha256),measuredRegressions:regressions,
 limits:['ABBA pools every lifetime and includes first cold real frames. Completed wall includes scheduling/completion polling, not pure GPU timing or FPS. It reduces simple order drift but does not establish stable tails or cross-device gains.',
 'Combined policy changes residency, peak methods, mask packing and cache default together. Component percentages cannot be split or summed from prior experiments. Current corrected ordering, painters, rules and upload implementation remain current, not an entire historical version.',
 'Actual cards/page/chunk snapshots are untimed aggregate observations. They do not record individual instance matrices/ids/feet/submission sequence, so this audit cannot independently prove that sequence equal. PNG/facts provide visible coverage, and separate camera/picking correctness is required. Resources/layout/copy calls can legitimately differ and are reported rather than asserted equal.',
 'Baseline three imports are resolved through the current package context and each recorded raw resolvedId must equal its currentResolvedId including query. Opaque optimized temporary paths need not equal across lifetimes/runs. No optimized bundle-byte SHA or complete browser module-graph singleton measurement exists.',
 'Cache encoded budget excludes reconstruction scratch and JS metadata. Buffer ownership is not process memory. No probation/ghost/admission fields exist. Cumulative stages/cache work are not restricted to timed CPU rows and can nest; avoidedPaintMs is estimated, not a frame counterfactual. Full/World3D/Canvas values are nested/residual, not additive. No per-call profiler, GC attribution or GPU timer queries.']};
await writeFile(resolve(here,'analysis.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:resolve(here,'analysis.json'),passed:result.validation.passed,violations,images:images.length,facts:facts.length,resourceChecks:resourceChecks.length,pooledCpu:[pooled.original.fullCpu,pooled.candidate.fullCpu],pooledWall:[pooled.original.realWall,pooled.candidate.realWall]}));
if(violations.length)process.exitCode=1;
