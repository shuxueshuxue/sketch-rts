/** Aggregate raw samples after all formal browser runs and strict comparisons. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const root=resolve(arg('--root')??'docs/art/refactor/followup/card-streaming/bank-order');
const output=resolve(arg('--out')??`${root}/performance-summary.json`);
const includeDiagnostics=process.argv.includes('--diagnostics');
const profile=arg('--profile')??'e02';
if(!['e02','final'].includes(profile)||profile==='final'&&includeDiagnostics)throw new Error('Use --profile e02 [--diagnostics] or --profile final');
const load=async file=>JSON.parse(await readFile(resolve(root,file),'utf8'));
function distribution(values){
 if(!values.length||values.some(v=>!Number.isFinite(v)))throw new Error('Missing/nonfinite raw timing samples');
 const sorted=[...values].sort((a,b)=>a-b),p=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))];
 return{samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:sorted.at(-1),
  over16_67:values.filter(v=>v>1000/60).length,over50:values.filter(v=>v>50).length,over100:values.filter(v=>v>100).length};
}
const fresh=(cycle,values)=>values.filter((_,i)=>i===0||cycle.cpu.sampleTicks[i]!==cycle.cpu.sampleTicks[i-1]);
const same=(cycle,values)=>values.filter((_,i)=>i>0&&cycle.cpu.sampleTicks[i]===cycle.cpu.sampleTicks[i-1]);
const timingFields={
 fullCpu:c=>c.cpu.valuesMs,freshTickCpu:c=>fresh(c,c.cpu.valuesMs),sameTickCpu:c=>same(c,c.cpu.valuesMs),
 world3DCpu:c=>c.cpu.layerValuesMs,freshTickWorld3D:c=>fresh(c,c.cpu.layerValuesMs),canvasAndCoordinator:c=>c.cpu.canvasValuesMs,
 realCompleteWall:c=>c.real.completeWallValuesMs,realSubmission:c=>c.real.submitValuesMs,realIntervals:c=>c.real.intervalsMs,
 firstRealCompleteWall:c=>c.real.completeWallValuesMs.slice(0,1),subsequentRealCompleteWall:c=>c.real.completeWallValuesMs.slice(1)
};
function resources(cycle){
 const c=cycle.before.cards,r=c.residencySnapshot;if(!r?.outsideMeasuredTimers)throw new Error('Actual untimed residency metadata missing');
 return{cycle:cycle.cycle,pages:c.pages,cards:c.cards,allocatedPixels:c.pixels,pageCapacity:r.totalPageCapacity,liveLayers:r.liveLayers,activeLayers:r.activeLayers,
  unusedAllocatedLayers:r.totalPageCapacity-r.liveLayers,actualCardBaseMips:r.actualCardBaseMips,activeCardBaseMips:r.activeCardBaseMips,pageLayout:r.pages,
  drawChunks:c.drawChunks,pooledDrawChunks:c.pooledDrawChunks,drawCapacity:c.drawCapacity,drawBufferBytes:c.drawBufferBytes,drawLayout:r.chunks,
  ownedGpuBytes:c.ownedGpuBytes,peakOwnedGpuBytes:c.peakOwnedGpuBytes,allocatedMipBytes:c.allocatedMipBytes,ownedCpuBytes:c.ownedCpuBytes,
  peakOwnedCpuBytes:c.peakOwnedCpuBytes,canvasBackingBytes:c.canvasBackingBytes,maskBytes:c.maskBytes,scratchCpuBytes:c.scratchCpuBytes,scratchGpuBytes:c.scratchGpuBytes,
  rasterizations:c.rasterizations,rasterCache:c.rasterCache,mipLayerUpdates:c.mipLayerUpdates,mipCopyCalls:c.mipCopyCalls,mipCopyBytes:c.mipCopyBytes,
  scratchUploadBytes:c.scratchUploadBytes,scratchInitialUploadBytes:c.scratchInitialUploadBytes,scratchFullUploadBytes:c.scratchFullUploadBytes,
  scratchPartialUploadBytes:c.scratchPartialUploadBytes,scratchPartialUploads:c.scratchPartialUploads,scratchUnchangedUploads:c.scratchUnchangedUploads,
  scratchFullUploadFallbacks:c.scratchFullUploadFallbacks,compactionLayers:c.gpuCompactionLayers,compactionMipCalls:c.gpuCompactionCopyCalls,
  requestedMipBases:cycle.before.viewIndex?.cardMipBases,render:cyleRender(cycle),heapAfterDisposeGc:cycle.heapAfterGc,
  blankCamera:{submissionMs:cycle.empty.submissionMs,completeWallMs:cycle.empty.completeWallMs,cards:cycle.empty.cards,render:cycle.empty.render},
  returnedCamera:{submissionMs:cycle.returned.submissionMs,completeWallMs:cycle.returned.completeWallMs,cards:cycle.returned.cards,render:cycle.returned.render}};
}
function cyleRender(cycle){return{...cycle.before.render,memory:cycle.before.memory};}
const rows=[],regressions=[],validations=[],sources=[];
const plans=['canonical','mixed'].map(scene=>({scene,label:profile==='final'?'final-one-native':'initial-eight-native',reference:`${scene}-reference`,candidate:`${scene}-candidate`,comparison:`${scene}-comparison.json`}));
if(includeDiagnostics)for(const name of ['one','two','four'])plans.push({scene:'canonical',label:`diagnostic-${name}-native`,reference:'canonical-reference',candidate:`canonical-${name}-native`,comparison:`canonical-${name}-native-comparison.json`});
for(const plan of plans){
 const {scene,label}=plan;
 const reference=await load(`${plan.reference}/raw.json`),candidate=await load(`${plan.candidate}/raw.json`),comparison=await load(plan.comparison);
 if(profile==='final')for(const [role,run] of [['reference',reference],['candidate',candidate]]){
  const expectedCounts=scene==='canonical'?[0,9900]:[0],expectedCpu=scene==='canonical'?360:60,expectedReal=scene==='canonical'?18:12;
  if(run.variant.maxBanks!==1||run.variant.mips!==(role==='reference'?'full':'native')||run.repeats!==2||run.cpuFrames!==expectedCpu||run.realFrames!==expectedReal||JSON.stringify(run.counts)!==JSON.stringify(expectedCounts)||run.simulation.length!==0)throw new Error(`${scene}/${role} does not match the final authorized configuration and schedule`);
 }
 if(!comparison.validation?.passed)throw new Error(`${scene} strict source/fact/RGBA comparison did not pass`);
 if(!reference.completed||!candidate.completed||!reference.paced||!candidate.paced)throw new Error(`${scene} runs must be complete and paced`);
 validations.push({scene,label,comparison:plan.comparison,passed:true,images:comparison.images.length,facts:comparison.facts.length});
 sources.push({scene,label,sourceCommit:reference.sourceCommit,referenceVariant:reference.variant,candidateVariant:candidate.variant,
  clientSha256:reference.allClientSourceSha256,harnessSha256:reference.harnessSha256,entryFixtureSha256:reference.entryFixtureSha256,
  factFixtureSha256:reference.factFixtureSha256,variantHelperSha256:reference.variantHelperSha256,viewportMetadataSha256:reference.viewportMetadataSha256,
  browserVersion:reference.browserVersion});
 for(const hiddenCount of comparison.selectedHiddenCounts??reference.counts){
  const before=reference.cycles.filter(c=>c.hiddenCount===hiddenCount),after=candidate.cycles.filter(c=>c.hiddenCount===hiddenCount);
  const timings={};
  for(const [name,field] of Object.entries(timingFields)){
   const a=distribution(before.flatMap(field)),b=distribution(after.flatMap(field));
   const deltas=Object.fromEntries(['meanMs','p50Ms','p95Ms','p99Ms','maxMs'].map(key=>[key,{deltaMs:b[key]-a[key],changePct:a[key]===0?null:(b[key]/a[key]-1)*100}]));
   timings[name]={reference:a,candidate:b,deltas,
    byLifetime:{reference:before.map(c=>({cycle:c.cycle,...distribution(field(c))})),candidate:after.map(c=>({cycle:c.cycle,...distribution(field(c))}))}};
   if(!['firstRealCompleteWall','subsequentRealCompleteWall','realIntervals'].includes(name))for(const metric of ['meanMs','p95Ms','p99Ms'])if(b[metric]>a[metric])regressions.push({scene,label,hiddenCount,field:name,metric,reference:a[metric],candidate:b[metric],deltaMs:b[metric]-a[metric],changePct:a[metric]===0?null:(b[metric]/a[metric]-1)*100});
  }
  rows.push({scene,label,hiddenCount,visibleCount:100,repeat:before.length,cpuFramesPerLifetime:reference.cpuFrames,realFramesPerLifetime:reference.realFrames,timings,
   resources:{reference:before.map(resources),candidate:after.map(resources)},
   lifetimeSummary:{reference:reference.heapAfterTeardown,candidate:candidate.heapAfterTeardown}});
 }
}
const result={method:'Pool original raw samples across independent lifetimes, then calculate empirical percentiles using index floor(n*p); never average reported percentiles. Same-source joint bank/mip configuration ablation, not a historical-renderer comparison. Full CPU includes resource preparation and possible upload/driver backpressure with renderer.render disabled. World3D is nested in full presentation; Canvas/coordinator is the residual submission cost. No simulation work is measured. Complete wall includes GPU fence/event-loop scheduling and Canvas deferred work on SwiftShader, not GPU timer nanoseconds or hardware FPS.',
 limitations:['Real complete-wall sample counts are only 36 per canonical population and 24 for mixed: reported p95/p99 are small-sample empirical values, not stable tail estimates.',
  'The original mixed schedule jumps from n173 to n480 before real samples. All first cold-stream samples remain in primary results; first/subsequent breakdown is diagnostic only.',
  'Resource counters are cumulative for a whole lifetime including real preparation and CPU warmup, not allocations exclusively inside measured frames.',
  'Owned GPU bytes are renderer-program allocation estimates for card pages/scratch; they exclude other scene textures, shadow maps and actual driver VRAM/RSS. Draw typed-buffer bytes and Canvas backing estimates are reported separately.',
  'Actual retained Card.baseMip is separate from the current requested safety classification. Base0 may legitimately remain for large/near/high-DPR or shadow-constrained cards; no quality reduction is assumed.',
  'The full-mip reference skips residentMip SVD computation, making reference CPU work cheaper. Both configurations preserve the shared production stable ordering.'],
 profile,decisions:profile==='e02'?{initialEightNative:'Rejected: measured GPU-completion wall regressions are preserved. Diagnostic lower-bank policies are same-source configurations, not a changed shipping default.',finalShippingPolicy:'Requires a new source freeze, same-source formal comparison and applicable production QA before claiming a shipping improvement.'}:
 {measuredConfiguration:'Same-source final 1/full reference versus 1/native candidate. All measured regressions remain reported; acceptance requires reviewing raw distributions, residency and source/fact/RGBA proof alongside applicable production QA.'},
 sources,validations,rows,measuredRegressions:regressions};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,rows:rows.map(r=>({scene:r.scene,label:r.label,hiddenCount:r.hiddenCount,cpuSamples:r.timings.fullCpu.candidate.samples,
 cpuMeanMs:[r.timings.fullCpu.reference.meanMs,r.timings.fullCpu.candidate.meanMs],realSamples:r.timings.realCompleteWall.candidate.samples,
 wallMeanMs:[r.timings.realCompleteWall.reference.meanMs,r.timings.realCompleteWall.candidate.meanMs]})),measuredRegressions:regressions.length}));
