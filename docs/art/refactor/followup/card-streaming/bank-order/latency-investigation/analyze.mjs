/** Read existing completed artifacts only. No browser, Canvas, simulation or benchmark. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const inputRoot=resolve(arg('--input')??resolve(here,'../final'));
const outputRoot=resolve(arg('--out')??here);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs={};
async function load(name){const path=resolve(inputRoot,name),bytes=await readFile(path);inputs[name]={path,sha256:hash(bytes),bytes:bytes.length};return JSON.parse(bytes);}
const reference=await load('mixed-reference/raw.json'),candidate=await load('mixed-candidate/raw.json');
const summary=await load('performance-summary.json'),comparison=await load('mixed-comparison.json');
if(!comparison.validation.passed||!reference.completed||!candidate.completed||!reference.validation.passed||!candidate.validation.passed)throw new Error('Completed strict source/facts/RGBA proof required');
for(const field of ['sourceCommit','sourceGitDiffSha256','harnessSha256','entryFixtureSha256','factFixtureSha256','variantHelperSha256','viewportMetadataSha256'])if(reference[field]!==candidate[field])throw new Error(`Different ${field}`);
if(JSON.stringify(reference.allClientSourceSha256)!==JSON.stringify(candidate.allClientSourceSha256))throw new Error('Client source differs');
for(const [side,run] of [['reference',reference],['candidate',candidate]])if(run.scene!=='mixed'||run.cycles.length!==2||run.cpuFrames!==60||run.realFrames!==12||run.repeats!==2||run.variant.maxBanks!==1||run.variant.mips!==(side==='reference'?'full':'native')||!run.paced||run.simulation.length)throw new Error('Expected original final mixed 1/full vs 1/native schedule');
const sum=values=>values.reduce((a,b)=>a+b,0);
function dist(values){
 if(!values.length||values.some(v=>!Number.isFinite(v)))throw new Error('Empty/nonfinite samples');
 const sorted=[...values].sort((a,b)=>a-b),p=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))];
 return{samples:values.length,totalMs:sum(values),meanMs:sum(values)/values.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:sorted.at(-1),over16_67:values.filter(v=>v>1000/60).length,over50:values.filter(v=>v>50).length,over100:values.filter(v=>v>100).length};
}
function paired(rows,field='fullMs'){
 const a=rows.map(r=>r.reference[field]),b=rows.map(r=>r.candidate[field]),delta=b.map((v,i)=>v-a[i]);
 return{reference:dist(a),candidate:dist(b),totalDeltaMs:sum(delta),meanDeltaMs:sum(delta)/rows.length,positivePairs:delta.filter(v=>v>0).length,negativePairs:delta.filter(v=>v<0).length,zeroPairs:delta.filter(v=>v===0).length,positiveDeltaTotalMs:sum(delta.filter(v=>v>0)),negativeDeltaTotalMs:sum(delta.filter(v=>v<0))};
}
const rows=[],reals=[],lifetimes=[];
for(const a of reference.cycles){
 const b=candidate.cycles.find(c=>c.cycle===a.cycle&&c.hiddenCount===a.hiddenCount);
 if(!b||a.hiddenCount!==0||a.cpu.valuesMs.length!==60||b.cpu.valuesMs.length!==60||JSON.stringify(a.cpu.sampleTicks)!==JSON.stringify(b.cpu.sampleTicks))throw new Error('Mixed lifetime/tick/sample grid mismatch');
 const lifeRows=[];
 for(let i=0;i<60;i++){
  const tick=a.cpu.sampleTicks[i],fresh=i===0||tick!==a.cpu.sampleTicks[i-1];
  const entry=c=>({fullMs:c.cpu.valuesMs[i],world3DMs:c.cpu.layerValuesMs[i],residualMs:c.cpu.canvasValuesMs[i]});
  const row={cycle:a.cycle,index:i,n:114+i,tick,phase:i%3,freshTick:fresh,reference:entry(a),candidate:entry(b)};
  if(tick!==Math.floor(row.n/3)||fresh!==(row.phase===0))throw new Error('Fixture clock differs from original three-frame tick schedule');
  row.deltaMs=row.candidate.fullMs-row.reference.fullMs;
  row.world3DDeltaMs=row.candidate.world3DMs-row.reference.world3DMs;
  row.residualDeltaMs=row.candidate.residualMs-row.reference.residualMs;
  rows.push(row);lifeRows.push(row);
 }
 const lifeReals=[];
 for(let i=0;i<12;i++){
  const entry=c=>{const completion=c.real.completion[i];return{wallMs:c.real.completeWallValuesMs[i],submitMs:c.real.submitValuesMs[i],fenceWaitMs:completion.waitMs,pollCalls:completion.polls,pollCallMs:completion.pollCallMs,yieldedWallMs:completion.yieldedWallMs,maxYieldMs:Math.max(...completion.yieldIntervalsMs)};};
  const row={cycle:a.cycle,index:i,n:480+i,tick:Math.floor((480+i)/3),phase:i%3,reference:entry(a),candidate:entry(b)};
  row.deltaWallMs=row.candidate.wallMs-row.reference.wallMs;row.deltaSubmitMs=row.candidate.submitMs-row.reference.submitMs;
  row.deltaFenceWaitMs=row.candidate.fenceWaitMs-row.reference.fenceWaitMs;
  row.unaccountedDeltaMs=row.deltaWallMs-row.deltaSubmitMs-row.deltaFenceWaitMs;
  reals.push(row);lifeReals.push(row);
 }
 lifetimes.push({cycle:a.cycle,full:paired(lifeRows),world3D:paired(lifeRows,'world3DMs'),residual:paired(lifeRows,'residualMs'),realWall:paired(lifeReals,'wallMs')});
}
const total=paired(rows);
const fields=['fullMs','world3DMs','residualMs'];
function cpuSlice(selected){return{...Object.fromEntries(fields.map(field=>[field,paired(selected,field)])),shareOfOverallDelta:sum(selected.map(r=>r.deltaMs))/total.totalDeltaMs};}
const partitions={all:cpuSlice(rows),freshTick:cpuSlice(rows.filter(r=>r.freshTick)),repeatedTick:cpuSlice(rows.filter(r=>!r.freshTick))};
for(const phase of [0,1,2])partitions[`phase${phase}`]=cpuSlice(rows.filter(r=>r.phase===phase));
for(const [name,select] of [['bothAtMost16_67',r=>Math.max(r.reference.fullMs,r.candidate.fullMs)<=1000/60],['eitherOver50',r=>Math.max(r.reference.fullMs,r.candidate.fullMs)>50],['eitherOver100',r=>Math.max(r.reference.fullMs,r.candidate.fullMs)>100]])partitions[name]=cpuSlice(rows.filter(select));
const byTick=[...new Set(rows.map(r=>r.tick))].map(tick=>({tick,...cpuSlice(rows.filter(r=>r.tick===tick))}));
const biggestPositive=[...rows].sort((a,b)=>b.deltaMs-a.deltaMs).slice(0,15),biggestNegative=[...rows].sort((a,b)=>a.deltaMs-b.deltaMs).slice(0,10);
const cpuTails=Object.fromEntries(['reference','candidate'].map(side=>[side,[...rows].sort((a,b)=>b[side].fullMs-a[side].fullMs).slice(0,12)]));
const stageFields=['paintMs','readbackMs','cacheMs','pickMaskMs','rowFlipMs','slotMs'];
const uploaderFields=['rasterizations','copiedLayers','mipInitializedPages','mipLayerUpdates','mipCopyCalls','mipCopyBytes','gpuCompactionLayers','gpuCompactionCopyCalls','scratchInitialUploadBytes','scratchFullUploadBytes','scratchPartialUploadBytes','scratchPartialUploads','scratchUnchangedUploads','scratchFullUploadFallbacks','scratchUploadBytes','gpuTransferSubmissionWallMs'];
const cumulative=Object.fromEntries([['reference',reference],['candidate',candidate]].map(([side,run])=>[side,{
 scope:'Counters taken after all real samples; cumulative preparation + CPU warmup + measured CPU + real frames. No CPU-measured-only boundary snapshots exist.',
 stageTotals:Object.fromEntries(stageFields.map(k=>[k,sum(run.cycles.map(c=>c.before.cards.rasterStages[k]))])),
 rasterWorkWallMs:sum(run.cycles.map(c=>c.before.cards.rasterWorkWallMs)),
 uploaderTotals:Object.fromEntries(uploaderFields.map(k=>[k,sum(run.cycles.map(c=>c.before.cards[k]))])),
 cacheTotals:Object.fromEntries(['backoffs','bypassRequests','hits','misses','evictions'].map(k=>[k,sum(run.cycles.map(c=>c.before.cards.rasterCache[k]))])),
 perLifetime:run.cycles.map(c=>({cycle:c.cycle,rasterStages:c.before.cards.rasterStages,rasterWorkWallMs:c.before.cards.rasterWorkWallMs,gpuTransferSubmissionWallMs:c.before.cards.gpuTransferSubmissionWallMs,rasterCache:c.before.cards.rasterCache,
  pages:c.before.cards.residencySnapshot.pages,chunks:c.before.cards.drawChunks,pooledChunks:c.before.cards.pooledDrawChunks,drawBufferBytes:c.before.cards.drawBufferBytes,rendererInfo:c.before.render,viewIndex:c.before.viewIndex}))
}]));
const cumulativeDifferences={stages:Object.fromEntries(stageFields.map(k=>[k,cumulative.candidate.stageTotals[k]-cumulative.reference.stageTotals[k]])),rasterWorkWallMs:cumulative.candidate.rasterWorkWallMs-cumulative.reference.rasterWorkWallMs,uploader:Object.fromEntries(uploaderFields.map(k=>[k,cumulative.candidate.uploaderTotals[k]-cumulative.reference.uploaderTotals[k]]))};
const realPartitions={};
for(const [name,selected] of [['all',reals],['firstColdStream',reals.filter(r=>r.index===0)],['subsequent',reals.filter(r=>r.index>0)],...[0,1,2].map(phase=>[`phase${phase}`,reals.filter(r=>r.phase===phase)])])realPartitions[name]={
 wall:paired(selected,'wallMs'),submission:paired(selected,'submitMs'),fenceWait:paired(selected,'fenceWaitMs'),pollCall:paired(selected,'pollCallMs'),yieldedWall:paired(selected,'yieldedWallMs'),
 totalDeltaWallMs:sum(selected.map(r=>r.deltaWallMs)),totalDeltaSubmitMs:sum(selected.map(r=>r.deltaSubmitMs)),totalDeltaFenceWaitMs:sum(selected.map(r=>r.deltaFenceWaitMs)),unaccountedDeltaMs:sum(selected.map(r=>r.unaccountedDeltaMs))};
const fromSummary=summary.rows.find(r=>r.scene==='mixed'&&r.hiddenCount===0);
for(const side of ['reference','candidate'])if(Math.abs(fromSummary.timings.fullCpu[side].meanMs-partitions.all.fullMs[side].meanMs)>1e-9)throw new Error('Raw aggregation disagrees with prior formal summary');
const sourceVerification=[];
for(const file of ['src/client/world3d/world-layer.ts','src/client/world3d/painted-card-batches.ts','src/client/world3d/card-mip-uploader.ts','src/client/world3d/card-mip-residency.ts']){
 try{const bytes=await readFile(resolve(reference.sourceRoot,file));sourceVerification.push({file,expectedSha256:reference.allClientSourceSha256[file],actualSha256:hash(bytes),matchesMeasuredSource:hash(bytes)===reference.allClientSourceSha256[file]});}catch{sourceVerification.push({file,matchesMeasuredSource:false,unavailable:true});}
}
const result={sourceCommit:reference.sourceCommit,inputs,analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),sourceVerification,
 method:'Read-only analysis of existing completed matched fact/tick sample arrays and cumulative stage/resource counters. Original artifacts are never rewritten. Percentiles pooled from raw samples using floor(n*p). Pairing localizes differences under matching facts; sequential benchmark lifetimes are not randomized causal interventions.',
 limitations:['CPU renderer.render is replaced by a no-op; source raster/readback/uploader and host scene/chunk assembly still run. Actual GPU drawing call count cannot directly explain measured CPU render work.',
  'Repeated snapshot ticks continue frame.now and animation poses, hence may rasterize/upload or block; they are not no-work controls. residentMip is evaluated on every visible unit every draw, not only fresh snapshots.',
  'No per-measured-frame rasterStages/upload/page/chunk snapshots, residentMip timer, GPU timer or CPU profiler exist. Lifetime cumulative stages cannot be allocated to a particular CPU outlier or compared as a measured-only budget.',
  'getImageData readbackMs includes the canvas flush/pixel copy visible to CPU; it does not isolate PCIe readback or prove physical GPU placement.',
  'Fence wait includes unfinished GPU work and event-loop scheduling. Tiny clientWaitSync polling time alone does not measure the GPU work.'],
 lifetimes,partitions,byTick,biggestPositive,biggestNegative,cpuTails,cumulative,cumulativeDifferences,realPartitions,realRows:reals,cpuRows:rows};
for(const [name,descriptor] of Object.entries(inputs))if(hash(await readFile(descriptor.path))!==descriptor.sha256)throw new Error(`Input changed during analysis: ${name}`);
await mkdir(outputRoot,{recursive:true});
await writeFile(resolve(outputRoot,'analysis.json'),JSON.stringify(result,null,2)+'\n');
const csvFields=['cycle','index','n','tick','phase','freshTick','refFullMs','candidateFullMs','deltaMs','refWorld3DMs','candidateWorld3DMs','world3DDeltaMs','refResidualMs','candidateResidualMs','residualDeltaMs'];
await writeFile(resolve(outputRoot,'matched-cpu-samples.csv'),csvFields.join(',')+'\n'+rows.map(r=>[r.cycle,r.index,r.n,r.tick,r.phase,r.freshTick,r.reference.fullMs,r.candidate.fullMs,r.deltaMs,r.reference.world3DMs,r.candidate.world3DMs,r.world3DDeltaMs,r.reference.residualMs,r.candidate.residualMs,r.residualDeltaMs].join(',')).join('\n')+'\n');
console.log(JSON.stringify({outputRoot,sourceCommit:reference.sourceCommit,cpuSamples:rows.length,realSamples:reals.length,totalCpuDeltaMs:total.totalDeltaMs,
 phaseContributions:[0,1,2].map(p=>({phase:p,deltaMs:partitions[`phase${p}`].fullMs.totalDeltaMs,meanDeltaMs:partitions[`phase${p}`].fullMs.meanDeltaMs})),
 cumulativeStageDeltas:cumulativeDifferences.stages,realWaitDeltaMs:realPartitions.all.totalDeltaFenceWaitMs,inputsUnchanged:true}));
