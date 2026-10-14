/** Read completed ABBA evidence only; no browser/Canvas/profiler/test/benchmark. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const names=['original-A','production-B','production-B2','original-A2'],inputs={},runs={};
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
const sourceFields=['sourceRoot','entryFixtureName','factFixtureName','sourceCommit','sourceGitDiffSha256','allClientSourceSha256','sourceSha256','harnessSha256','entryFixtureSha256','factFixtureSha256','fixtureSha256','variantHelperSha256','viewportMetadataSha256','viewport','browserVersion','scene','counts','repeats','paced','cpuFrames','realFrames'];
const archived={'harness.mjs':'harnessSha256','fixture.js':'entryFixtureSha256','fact-fixture.js':'factFixtureSha256','bank-variant.js':'variantHelperSha256','viewport-metadata.js':'viewportMetadataSha256'};
for(const name of names){
 const run=runs[name],policy=name.startsWith('original')?'original':'production';
 for(const k of sourceFields)equal(run[k],oracle[k],`${name}: different ${k}`);
 if(!run.completed||!run.validation.passed||run.errors.length||run.failed.length||run.scene!=='mixed'||run.cpuFrames!==60||run.realFrames!==12||run.repeats!==2||canonical(run.counts)!=='[0]'||!run.paced||run.simulation.length||run.variant.maxBanks!==1||run.variant.mips!=='native'||run.cycles.length!==2)violations.push(`${name}: invalid original mixed schedule/source proof`);
 for(const[file,key]of Object.entries(archived))if(hash(await readFile(resolve(here,name,file)))!==run[key])violations.push(`${name}: archived ${file} differs`);
 const isolation=run.maskIsolation;
 const maskFile='src/client/world3d/card-pick-mask.ts',batchesFile='src/client/world3d/painted-card-batches.ts';
 const clean=id=>id.split('?')[0].replace(/^\/@fs(?=\/)/,'');
 const selected=policy==='original'?`${isolation.extraBaselineRoot}/${maskFile}`:`${run.sourceRoot}/${maskFile}`;
 const selectedSha=policy==='original'?isolation.baselineMaskSha256:isolation.currentMaskSha256;
 if(run.sourceCommit!=='aec09d620801dd07852042732831e5b2de1c4193'||run.sourceGitDiffSha256!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'||isolation.policy!==policy||isolation.peakPolicy!=='current production, untouched'||isolation.extraBaselineDirty||isolation.extraBaselineCommit!=='5b356c7795068bb2a532ad1d486b3c22936cf735'||!isolation.currentSourceStayedFrozen||!isolation.baselineSourceStayedFrozen)violations.push(`${name}: source/baseline/policy invalid`);
 for(const key of ['extraBaselineRoot','extraBaselineCommit','baselineMaskSha256','corpusMaskSha256','currentMaskSha256','currentBatchesSha256','loaderSha256','parentHarnessSha256'])equal(isolation[key],oracle.maskIsolation[key],`${name}: different baseline ${key}`);
 equal(isolation.finalClientSourceSha256,run.allClientSourceSha256,`${name}: final client source differs`);
 if(isolation.actualProviderPath!==selected||isolation.actualProviderSha256!==selectedSha||isolation.baselineMaskSha256!==isolation.corpusMaskSha256||isolation.currentMaskSha256!==run.allClientSourceSha256[maskFile]||isolation.currentBatchesSha256!==run.allClientSourceSha256[batchesFile])violations.push(`${name}: invalid selected/current provider SHA`);
 for(const[file,sha]of [['mask-loader.js',isolation.loaderSha256],['parent-harness.mjs',isolation.parentHarnessSha256],['source-snapshot/baseline-card-pick-mask.ts',isolation.baselineMaskSha256],['source-snapshot/current-card-pick-mask.ts',isolation.currentMaskSha256],['source-snapshot/current-painted-card-batches.ts',isolation.currentBatchesSha256]])if(hash(await readFile(resolve(here,name,file)))!==sha)violations.push(`${name}: archived ${file} differs`);
 if(!isolation.resolveRecords.length||isolation.resolveRecords.some(r=>r.request!=='./card-pick-mask'||clean(r.importer)!==`${run.sourceRoot}/${batchesFile}`||r.policy!==policy||r.redirected!==(policy==='original')||clean(r.resolvedId)!==selected||r.providerSha256!==selectedSha))violations.push(`${name}: resolver not isolated`);
 const m=isolation.moduleSetup;
 if(!m.ready||m.policy!==policy||m.providerRoot!==(policy==='original'?isolation.extraBaselineRoot:run.sourceRoot)||m.providerFile!==maskFile||m.peakPolicy!=='current production, untouched'||!m.baselineModuleImportedWithoutCalling||!m.currentModuleImportedWithoutCalling||!m.publicCardMaskHitFunctionSourceIdentical)violations.push(`${name}: unbalanced/invalid untimed mask module setup`);
 const loaded=new Set(isolation.loadedMaskModules.map(r=>clean(r.path)));
 if(!loaded.has(`${isolation.extraBaselineRoot}/${maskFile}`)||!loaded.has(`${run.sourceRoot}/${maskFile}`)||loaded.size!==2)violations.push(`${name}: unexpected loaded mask modules`);
 providers.push({name,policy,actualProviderPath:selected,actualProviderSha256:selectedSha,compileTimeResolution:isolation.resolveRecords,moduleSetup:m});
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
   const x=stableCards(c[phase].cards),y=stableCards(a[phase].cards);equal(x,y,`${name}/${c.cycle}/${phase}: actual allocation/peak/counter differs`);
   equal(stablePhase(c[phase]),stablePhase(a[phase]),`${name}/${c.cycle}/${phase}: non-timing phase resource/call/order differs`);
   resourceChecks.push({name,cycle:c.cycle,phase,identical:canonical(stablePhase(c[phase]))===canonical(stablePhase(a[phase])),comparedAllNonTimingCardAndPhaseFields:true,excludedTimingFields:['submissionMs','completeWallMs','cards.rasterStages','cards.rasterWorkWallMs','cards.gpuTransferSubmissionWallMs','cards.rasterCache.workMs','cards.rasterCache.avoidedPaintMs']});
  }
  for(const [view,desc]of Object.entries(c.screenshots)){
   const bytes=await readFile(resolve(here,name,desc.path));if(hash(bytes)!==desc.sha256)violations.push(`${name}/${c.cycle}/${view}: PNG hash differs`);
   const decoded=png(bytes),key=`${c.cycle}/${view}`;if(!imageOracle.has(key))imageOracle.set(key,decoded);const original=imageOracle.get(key);
   const identical=decoded.width===original.width&&decoded.height===original.height&&decoded.rgba.equals(original.rgba);if(!identical)violations.push(`${name}/${key}: RGBA differs`);
   images.push({name,cycle:c.cycle,view,width:decoded.width,height:decoded.height,sha256:hash(bytes),rgbaSha256:hash(decoded.rgba),identical});
  }
 }
}
const sum=a=>a.reduce((x,y)=>x+y,0);
function dist(v){if(!v.length||v.some(x=>!Number.isFinite(x)))throw new Error('Nonfinite/missing raw samples');const s=[...v].sort((a,b)=>a-b),p=q=>s[Math.min(s.length-1,Math.floor(s.length*q))];return{samples:v.length,meanMs:sum(v)/v.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:s.at(-1),over16_67:v.filter(x=>x>1000/60).length,over50:v.filter(x=>x>50).length,over100:v.filter(x=>x>100).length};}
const select=(c,values,predicate)=>values.filter((_,i)=>predicate(c,i));
const fields={fullCpu:c=>c.cpu.valuesMs,world3DCpu:c=>c.cpu.layerValuesMs,canvasResidual:c=>c.cpu.canvasValuesMs,
 freshTick:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===0),repeatedTick:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3!==0),phase1:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===1),phase2:c=>select(c,c.cpu.valuesMs,(_,i)=>i%3===2),
 realWall:c=>c.real.completeWallValuesMs,realSubmit:c=>c.real.submitValuesMs,realIntervals:c=>c.real.intervalsMs,firstColdReal:c=>c.real.completeWallValuesMs.slice(0,1),subsequentReal:c=>c.real.completeWallValuesMs.slice(1),
 fenceWait:c=>c.real.completion.map(r=>r.waitMs),pollCall:c=>c.real.completion.map(r=>r.pollCallMs),yieldedWall:c=>c.real.completion.map(r=>r.yieldedWallMs),fencePolls:c=>c.real.completion.map(r=>r.polls),emptyWall:c=>[c.empty.completeWallMs],emptySubmit:c=>[c.empty.submissionMs],returnedWall:c=>[c.returned.completeWallMs],returnedSubmit:c=>[c.returned.submissionMs]};
function aggregate(cycles){return Object.fromEntries(Object.entries(fields).map(([k,field])=>[k,dist(cycles.flatMap(field))]));}
const originalCycles=['original-A','original-A2'].flatMap(k=>runs[k].cycles),productionCycles=['production-B','production-B2'].flatMap(k=>runs[k].cycles);
const pooled={original:aggregate(originalCycles),production:aggregate(productionCycles)},regressions=[];
for(const k of Object.keys(fields))for(const metric of ['meanMs','p50Ms','p95Ms','p99Ms','maxMs'])if(pooled.production[k][metric]>pooled.original[k][metric])regressions.push({field:k,metric,original:pooled.original[k][metric],production:pooled.production[k][metric],changePct:pooled.original[k][metric]===0?null:(pooled.production[k][metric]/pooled.original[k][metric]-1)*100});
const perRun=names.map(name=>({name,policy:runs[name].maskIsolation.policy,timings:aggregate(runs[name].cycles),lifetimes:runs[name].cycles.map(c=>({cycle:c.cycle,timings:aggregate([c]),before:c.before,empty:c.empty,returned:c.returned,heapAfterGc:c.heapAfterGc})),heapAfterTeardown:runs[name].heapAfterTeardown}));
for(const d of Object.values(inputs))if(hash(await readFile(d.path))!==d.sha256)violations.push('Historical raw changed during analysis');
const result={sourceCommit:oracle.sourceCommit,inputArtifacts:inputs,analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),method:'Same aec09d6 source ABBA original-A/production-B/production-B2/original-A2. Both one/native bank and current peak accounting, same allocation/raster/draw/upload/artist code; only the exact PaintedCardBatches mask-module import provider differs at compile time. All raw samples pooled across four lifetimes per policy, not averaged quantiles. All 24 PNGs are decoded and compared at zero RGBA tolerance; original-A supplies six phase/lifetime image oracles.',
 validation:{passed:!violations.length,violations,inputHashesUnchanged:true},sourceAndSettings:Object.fromEntries(sourceFields.map(k=>[k,oracle[k]])),baselineProvider:oracle.maskIsolation,providers,images,facts,resourceChecks,pooled,perRun,matchedCpuSamples:facts.reduce((s,r)=>s+r.matchedCpuTicks,0),allScreenshotsZeroRGBA:images.length===24&&images.every(r=>r.identical),allRecordedPixelHashesEqual:images.every(r=>r.sha256===images.find(x=>x.name==='original-A'&&x.cycle===r.cycle&&x.view===r.view).sha256),measuredRegressions:regressions,
 limits:['ABBA reduces simple order drift but only four lifetimes and 48 real samples per policy do not prove all hardware or stable tail distributions. Complete wall is GPU-completion/scheduling, not GPU nanoseconds/FPS.',
 'Mask packing is isolated with current peak/page/draw/upload metadata on both sides. This is not the entire historical 5b renderer versus aec09d6.',
 'Full/World3D/Canvas timings are nested/residual and cannot be added. Cold real samples remain in headline values. No allocation profiler or GC attribution.']};
await writeFile(resolve(here,'analysis.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:resolve(here,'analysis.json'),passed:result.validation.passed,violations,images:images.length,facts:facts.length,resourceChecks:resourceChecks.length,pooledCpu:[pooled.original.fullCpu,pooled.production.fullCpu],pooledWall:[pooled.original.realWall,pooled.production.realWall]}));
if(violations.length)process.exitCode=1;
