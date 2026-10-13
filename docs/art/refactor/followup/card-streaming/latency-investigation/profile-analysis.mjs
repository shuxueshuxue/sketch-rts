/** Offline analysis only: no browser, Canvas, simulation, tests or benchmark. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const arg=k=>{const i=process.argv.indexOf(k);return i<0?undefined:process.argv[i+1];};
const input=resolve(arg('--input')??here),output=resolve(arg('--out')??here);
const hash=b=>createHash('sha256').update(b).digest('hex'),sum=a=>a.reduce((x,y)=>x+y,0);
const descriptors={};
async function load(side){const path=resolve(input,`profile-baseline-${side}/raw.json`),bytes=await readFile(path);descriptors[side]={path,sha256:hash(bytes)};return JSON.parse(bytes);}
const full=await load('full'),native=await load('native');
for(const key of ['sourceCommit','sourceGitDiffSha256','harnessSha256','entryFixtureSha256','factFixtureSha256','variantHelperSha256','viewportMetadataSha256'])if(full[key]!==native[key])throw new Error(`Different ${key}`);
if(JSON.stringify(full.allClientSourceSha256)!==JSON.stringify(native.allClientSourceSha256)||full.diagnostic.profilerSha256!==native.diagnostic.profilerSha256)throw new Error('Different frozen source/profiler');
for(const [side,run]of[['full',full],['native',native]])if(!run.completed||!run.validation.passed||run.diagnostic.formalTiming!==false||run.scene!=='mixed'||run.cycles.length!==2||run.cpuFrames!==60||run.realFrames!==12||run.variant.maxBanks!==1||run.variant.mips!==side)throw new Error('Expected complete original mixed profiled 1/full versus 1/native');
const names={world:'World3DLayer.draw',gate:'World3DLayer.residentMip',finish:'PaintedCardBatches.cards.finish',raster:'PaintedCardBatches.cards.raster',peaks:'PaintedCardBatches.cards.recordPeaks',slot:'PaintedCardBatches.cards.slot',compact:'PaintedCardBatches.cards.compact',hostDraw:'PaintedCardBatches.cards.draw',remove:'PaintedCardBatches.cards.remove',createPage:'PaintedCardBatches.cards.createPage',createChunk:'PaintedCardBatches.cards.createChunk',resizeChunk:'PaintedCardBatches.cards.resizeChunk',upload:'CardMipUploader.cards.uploadLayer',copyLayers:'CardMipUploader.cards.copyLayers',init:'renderer.initTexture',copy:'renderer.copyTextureToTexture',render:'renderer.render',remainsFinish:'PaintedCardBatches.remains.finish'};
const ms=(r,key)=>r.calls[key]?.inclusiveMs??0;
const short=(r,key)=>ms(r,names[key]);
const stage=(r,key)=>r.rasterStagesDelta.cards[key]+r.rasterStagesDelta.remains[key];
function partition(r){
 // These are disjoint leaves derived from the frozen call tree, not the sum of
 // inclusive timers. slotMs is deliberately excluded: it includes recordPeaks.
 const p={gate:short(r,'gate'),rendererRender:short(r,'render'),remains:short(r,'remainsFinish'),
  paint:stage(r,'paintMs'),readback:stage(r,'readbackMs'),cache:stage(r,'cacheMs'),mask:stage(r,'pickMaskMs'),flip:stage(r,'rowFlipMs'),
  recordPeaks:short(r,'peaks'),slotSelf:short(r,'slot')-short(r,'createPage'),createPage:short(r,'createPage'),
  glInit:short(r,'init'),glCopy:short(r,'copy'),uploaderSelf:short(r,'upload')+short(r,'copyLayers')-short(r,'init')-short(r,'copy'),
  hostDrawSelf:short(r,'hostDraw')-short(r,'createChunk')-short(r,'resizeChunk'),createChunk:short(r,'createChunk'),resizeChunk:short(r,'resizeChunk'),remove:short(r,'remove')};
 const finishLeaves=['paint','readback','cache','mask','flip','recordPeaks','slotSelf','createPage','glInit','glCopy','uploaderSelf','hostDrawSelf','createChunk','resizeChunk','remove'];
 p.finishResidual=short(r,'finish')-sum(finishLeaves.map(k=>p[k]));
 p.worldOther=short(r,'world')-short(r,'finish')-p.remains-p.gate-p.rendererRender;
 return p;
}
const paired=[];
for(const a of full.cycles){
 const b=native.cycles.find(c=>c.cycle===a.cycle&&c.hiddenCount===a.hiddenCount);
 if(!b||a.hiddenCount!==0||a.cpu.valuesMs.length!==60||b.cpu.valuesMs.length!==60)throw new Error('Lifetime mismatch');
 for(const c of[a,b])if(!c.latencyProfile.scheduleValidation.allExpectedRows||c.latencyProfile.scheduleValidation.mismatches.length)throw new Error('Diagnostic clock mismatch');
 const ar=a.latencyProfile.rows.filter(r=>r.phase==='cpu-sample'),br=b.latencyProfile.rows.filter(r=>r.phase==='cpu-sample');
 if(ar.length!==60||br.length!==60)throw new Error('Missing CPU rows');
 for(let i=0;i<60;i++){
  const x=ar[i],y=br[i];
  if(x.expectedN!==114+i||y.expectedN!==x.expectedN||x.sample!==i||y.sample!==i||x.tick!==y.tick||x.tick!==a.cpu.sampleTicks[i]||y.tick!==b.cpu.sampleTicks[i]||x.before.rendererRenderHookActive||y.before.rendererRenderHookActive||x.calls['renderer.render']||y.calls['renderer.render'])throw new Error('Sample/n/tick/render no-op mismatch');
  const xs=a.latencyProfile.snapshots[x.snapshotIndex],ys=b.latencyProfile.snapshots[y.snapshotIndex];
  if(xs.sha256!==ys.sha256)throw new Error('Source snapshot facts differ');
  const metrics=(r,c)=>({fullCpuMs:c.cpu.valuesMs[i],layerOuterMs:c.cpu.layerValuesMs[i],worldProfileMs:short(r,'world'),bookkeepingMs:r.observationBookkeepingMs,inclusive:r.calls,disjoint:partition(r),stageSlotReportedMs:stage(r,'slotMs'),delta:Object.fromEntries(['rasterizations','copiedLayers','mipInitializedPages','mipCopyCalls','mipCopyBytes','compactionLayers','compactionCopyCalls','scratchUploadBytes','rasterCacheHits','rasterCacheMisses','rasterCacheBackoffs','rasterCacheBypass'].map(k=>[k,r.after.cards[k]-r.before.cards[k]])),before:r.before.cards,after:r.after.cards});
  const row={cycle:a.cycle,index:i,n:x.expectedN,tick:x.tick,phase:x.expectedN%3,snapshotSha256:xs.sha256,full:metrics(x,a),native:metrics(y,b)};
  row.deltaCpuMs=row.native.fullCpuMs-row.full.fullCpuMs;row.deltaWorldMs=row.native.worldProfileMs-row.full.worldProfileMs;
  row.disjointDelta=Object.fromEntries(Object.keys(row.full.disjoint).map(k=>[k,row.native.disjoint[k]-row.full.disjoint[k]]));
  for(const side of['full','native'])if(Math.abs(sum(Object.values(row[side].disjoint))-row[side].worldProfileMs)>1e-7)throw new Error('Derived call-tree partition does not conserve World3D total');
  paired.push(row);
 }
}
function dist(a){const s=[...a].sort((x,y)=>x-y),p=q=>s[Math.min(s.length-1,Math.floor(s.length*q))];return{samples:a.length,totalMs:sum(a),meanMs:sum(a)/a.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:s.at(-1),minMs:s[0]};}
function aggregate(rows){
 const keys=Object.keys(rows[0].full.disjoint),methods=[...new Set(rows.flatMap(r=>Object.keys(r.full.inclusive).concat(Object.keys(r.native.inclusive))))];
 const sides=Object.fromEntries(['full','native'].map(side=>[side,{fullCpu:dist(rows.map(r=>r[side].fullCpuMs)),world:dist(rows.map(r=>r[side].worldProfileMs)),bookkeeping:dist(rows.map(r=>r[side].bookkeepingMs)),
  disjoint:Object.fromEntries(keys.map(k=>[k,dist(rows.map(r=>r[side].disjoint[k]))])),
  inclusive:Object.fromEntries(methods.map(k=>[k,{calls:sum(rows.map(r=>r[side].inclusive[k]?.calls??0)),...dist(rows.map(r=>r[side].inclusive[k]?.inclusiveMs??0)),maxSingleCallMs:Math.max(...rows.map(r=>r[side].inclusive[k]?.maxInclusiveMs??0))}])),
  counters:Object.fromEntries(Object.keys(rows[0][side].delta).map(k=>[k,sum(rows.map(r=>r[side].delta[k]))]))}]));
 return{samples:rows.length,...sides,cpuDeltaMs:sides.native.fullCpu.totalMs-sides.full.fullCpu.totalMs,worldDeltaMs:sides.native.world.totalMs-sides.full.world.totalMs,
  disjointDeltaMs:Object.fromEntries(keys.map(k=>[k,sides.native.disjoint[k].totalMs-sides.full.disjoint[k].totalMs]))};
}
const all=aggregate(paired),phases=Object.fromEntries([0,1,2].map(p=>[p,aggregate(paired.filter(r=>r.phase===p))]));
const byN=[...new Set(paired.map(r=>r.n))].map(n=>({n,tick:Math.floor(n/3),phase:n%3,...aggregate(paired.filter(r=>r.n===n))}));
const biggestIncrease=[...paired].sort((a,b)=>b.deltaCpuMs-a.deltaCpuMs).slice(0,12);
const tails=Object.fromEntries(['full','native'].map(side=>[side,[...paired].sort((a,b)=>b[side].fullCpuMs-a[side].fullCpuMs).slice(0,12)]));
const sourceVerification=[];
for(const file of['src/client/world3d/painted-card-batches.ts','src/client/world3d/card-mip-uploader.ts','src/client/world3d/world-layer.ts']){const sha256=hash(await readFile(resolve(full.sourceRoot,file)));if(sha256!==full.allClientSourceSha256[file])throw new Error('Frozen call-tree source changed');sourceVerification.push({file,sha256});}
const result={sourceCommit:full.sourceCommit,inputArtifacts:descriptors,profilerSha256:full.diagnostic.profilerSha256,analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),sourceVerification,
 method:'Offline matching of all 120 CPU-sample profile rows by lifetime, original n/tick and snapshot SHA. Renderer.render must be the fixture no-op. Inclusive methods are not summed. Disjoint synchronous leaves are derived from the verified frozen call tree and conserve World3D total.',
 caveats:['Profile wrappers add observation overhead and perturb scheduling; these ratios are diagnostics, not formal results. Method timers exclude their own bookkeeping, which remains in enclosing residuals.',
  'No allocation profiler/GC attribution exists: recordPeaks includes production stats() scans/object creation, but does not prove an individual allocation or GC pause. Saving its measured time is a bounded opportunity, not a solution to all long tails.',
  'rasterStages.slotMs includes the following recordPeaks; it cannot be added to slot/recordPeaks. createPage is inside slot, createChunk/resizeChunk inside host draw, and GL init/copy inside uploader. Quantized timers may produce tiny negative derived residuals; they are preserved.',
  'Large copyTextureToTexture synchronous duration locates a blocking public API call, not pure GPU duration or exact scratch versus array copy: source/destination/level are not logged. getImageData includes deferred Canvas flush/pixel copy, not proof of physical PCIe readback.'],
 all,phases,byLifetime:[0,1].map(cycle=>({cycle,...aggregate(paired.filter(r=>r.cycle===cycle))})),byN,biggestIncrease,tails,matchedCpuRows:paired};
for(const d of Object.values(descriptors))if(hash(await readFile(d.path))!==d.sha256)throw new Error('Historical raw changed during analysis');
await mkdir(output,{recursive:true});await writeFile(resolve(output,'profile-analysis.json'),JSON.stringify(result,null,2)+'\n');
const keys=Object.keys(paired[0].full.disjoint),header=['cycle','index','n','tick','phase','fullCpuMs','nativeCpuMs','deltaCpuMs',...keys.flatMap(k=>[`full_${k}`,`native_${k}`,`delta_${k}`])];
await writeFile(resolve(output,'matched-profile-cpu.csv'),header.join(',')+'\n'+paired.map(r=>[r.cycle,r.index,r.n,r.tick,r.phase,r.full.fullCpuMs,r.native.fullCpuMs,r.deltaCpuMs,...keys.flatMap(k=>[r.full.disjoint[k],r.native.disjoint[k],r.disjointDelta[k]])].join(',')).join('\n')+'\n');
console.log(JSON.stringify({output,matchedSamples:paired.length,cpuMeanMs:[all.full.fullCpu.meanMs,all.native.fullCpu.meanMs],disjointDeltaMs:all.disjointDeltaMs,inputsUnchanged:true}));
