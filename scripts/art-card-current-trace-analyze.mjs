/** Offline Chromium trace correlation; never mutate trace/raw or launch a browser. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const root=resolve(arg('--input')??'docs/art/refactor/followup/card-streaming/stall-followup/current-trace');
const here=resolve(arg('--out')??resolve(root,'attribution'));
await mkdir(dirname(here),{recursive:true});await mkdir(here); // Refuse to overwrite an earlier analysis.

const hash=b=>createHash('sha256').update(b).digest('hex');
const rawBytes=await readFile(resolve(root,'raw.json')),raw=JSON.parse(rawBytes);
const traceBytes=await readFile(resolve(root,'trace.json')),trace=JSON.parse(traceBytes);
if(hash(traceBytes)!==raw.trace.raw.sha256||!raw.trace.complete||raw.trace.tracingComplete.dataLossOccurred||!raw.completed||!raw.validation.passed||!raw.diagnostic.tracing)throw new Error('Invalid/incomplete trace evidence');
if(hash(await readFile(resolve(root,'profiler.js')))!==raw.diagnostic.profilerSha256)throw new Error('Profiler archive differs');
const integrity=[];
for(const[file,expected]of [['harness.mjs',raw.harnessSha256],['profiler.js',raw.diagnostic.profilerSha256],['fact-fixture.js',raw.factFixtureSha256],['bank-variant.js',raw.variantHelperSha256],['viewport-metadata.js',raw.viewportMetadataSha256],['entry.html',raw.diagnostic.entryHtmlSha256]]){
 if(!expected)throw new Error('Missing archived hash '+file);
 const actual=hash(await readFile(resolve(root,file)));if(actual!==expected)throw new Error('Archived hash mismatch '+file);integrity.push({file,sha256:actual});
}
if(!raw.diagnostic.productionOnly||!raw.diagnostic.sourceStayedFrozen||raw.sourceCommit!==raw.diagnostic.expectedSourceCommit||!raw.sourceCommit.startsWith('8345a0d'))throw new Error('Not frozen current-production 8345 evidence');
for(const[file,expected]of Object.entries(raw.diagnostic.fullSourceSha256)){
 const actual=hash(await readFile(resolve(root,'source-snapshot',file)));if(actual!==expected||raw.diagnostic.finalSourceSha256[file]!==expected)throw new Error('Source snapshot/start/end mismatch '+file);integrity.push({file:'source-snapshot/'+file,sha256:actual});
}
const events=trace.traceEvents,threads=new Map(),processes=new Map(),categoryCounts=new Map(),phaseCounts=new Map(),nameCounts=new Map(),asyncBegins=new Map(),spans=[];
const uid=e=>`${e.pid}/${e.cat}/${e.name}/${e.id2?.local??e.id2?.global??e.id}`;
for(const e of events){
 categoryCounts.set(e.cat,(categoryCounts.get(e.cat)??0)+1);phaseCounts.set(e.ph,(phaseCounts.get(e.ph)??0)+1);nameCounts.set(e.name,(nameCounts.get(e.name)??0)+1);
 if(e.ph==='M'&&e.name==='thread_name')threads.set(`${e.pid}/${e.tid}`,e.args.name);
 if(e.ph==='M'&&e.name==='process_name')processes.set(e.pid,e.args.name);
 if(e.name?.startsWith('CardLatency.')){
  if(e.ph==='b')asyncBegins.set(uid(e),e);
  if(e.ph==='e'){const b=asyncBegins.get(uid(e));if(!b)throw new Error('User Timing end without begin');asyncBegins.delete(uid(e));const m=b.name.match(/^CardLatency\.([^/]+)\/cycle=(\d+)\/hidden=(\d+)\/row=(\d+)\/n=([^/]+)\/tick=(\d+)(?:\/(.*))?$/);if(!m)throw new Error('Unexpected timing name');spans.push({name:b.name,kind:m[1],cycle:+m[2],hidden:+m[3],row:+m[4],n:+m[5],tick:+m[6],key:m[7],start:b.ts,end:e.ts,pid:b.pid,tid:b.tid,ms:(e.ts-b.ts)/1000});}
 }
}
if(asyncBegins.size)throw new Error('Incomplete CardLatency spans');
const worlds=spans.filter(s=>s.kind==='World3DLayer.draw'),pids=[...new Set(worlds.map(s=>s.pid))],tids=[...new Set(worlds.map(s=>s.tid))];
if(pids.length!==1||tids.length!==1||threads.get(`${pids[0]}/${tids[0]}`)!=='CrRendererMain')throw new Error('Ambiguous target main Renderer');
const pid=pids[0],tid=tids[0],gpuPids=[...processes].filter(([,n])=>n==='GPU Process').map(([p])=>p);
const complete=[],stacks=new Map();
for(const e of events){
 if(e.ph==='X'&&Number.isFinite(e.ts)&&Number.isFinite(e.dur)&&e.dur>0)complete.push({start:e.ts,end:e.ts+e.dur,name:e.name,cat:e.cat,pid:e.pid,tid:e.tid,args:e.args});
 if(e.ph==='B'){const key=`${e.pid}/${e.tid}`,s=stacks.get(key)??[];s.push(e);stacks.set(key,s);}
 if(e.ph==='E'){const b=stacks.get(`${e.pid}/${e.tid}`)?.pop();if(b)complete.push({start:b.ts,end:e.ts,name:b.name,cat:b.cat,pid:b.pid,tid:b.tid,args:b.args});}
}
function indexed(entries){const sorted=entries.sort((a,b)=>a.start-b.start),prefix=[];let end=-Infinity;for(const e of sorted){end=Math.max(end,e.end);prefix.push(end);}return{sorted,prefix};}
const isMain=e=>e.pid===pid&&e.tid===tid;
const isGC=e=>/^(?:MajorGC|MinorGC|Scavenge|Mark-Compact)$|^V8\.GC|^V8GC/.test(e.name??'');
const groups={
 mainGC:indexed(complete.filter(e=>isMain(e)&&isGC(e))),
 mainTopGCPause:indexed(complete.filter(e=>isMain(e)&&/^(MajorGC|MinorGC|Scavenge|Mark-Compact)$/.test(e.name??''))),
 mainSkia:indexed(complete.filter(e=>isMain(e)&&(e.cat??'').includes('skia'))),
 mainWait:indexed(complete.filter(e=>isMain(e)&&/WaitForCmd|WaitForGetOffset|WaitForToken|GpuChannelHost::VerifyFlush|EstablishGpuChannelSync/.test(e.name??''))),
 mainCanvas:indexed(complete.filter(e=>isMain(e)&&/Canvas|ReadPixels|readPixels|ImageData|Raster/i.test(e.name??''))),
 sameRendererWorkerGC:indexed(complete.filter(e=>e.pid===pid&&e.tid!==tid&&isGC(e))),
 sameRendererWorkerSkia:indexed(complete.filter(e=>e.pid===pid&&e.tid!==tid&&(e.cat??'').includes('skia'))),
 gpuProcess:indexed(complete.filter(e=>gpuPids.includes(e.pid)&&(e.cat??'').includes('gpu'))),
 gpuProcessSkia:indexed(complete.filter(e=>gpuPids.includes(e.pid)&&(e.cat??'').includes('skia'))),
};
function overlap(span,index){
 const {sorted,prefix}=index;let lo=0,hi=prefix.length;while(lo<hi){const mid=(lo+hi)>>1;if(prefix[mid]<=span.start)lo=mid+1;else hi=mid;}
 const intervals=[],names=new Map();
 for(let i=lo;i<sorted.length&&sorted[i].start<span.end;i++){const e=sorted[i],a=Math.max(e.start,span.start),b=Math.min(e.end,span.end);if(b>a){intervals.push([a,b]);const x=names.get(e.name)??{count:0,intervals:[]};x.count++;x.intervals.push([a,b]);names.set(e.name,x);}}
 const union=list=>{list.sort((a,b)=>a[0]-b[0]);let total=0,start,end;for(const[a,b]of list){if(start===undefined){start=a;end=b;}else if(a<=end)end=Math.max(end,b);else{total+=end-start;start=a;end=b;}}if(start!==undefined)total+=end-start;return total/1000;};
 const unionMs=union(intervals);return{unionMs,fraction:span.ms?unionMs/span.ms:0,eventCount:intervals.length,names:[...names].map(([name,x])=>({name,count:x.count,unionMs:union(x.intervals)})).sort((a,b)=>b.unionMs-a.unionMs).slice(0,12)};
}
const violations=[],offsets=[],rows=[];
for(const cycle of raw.cycles){
 for(const r of cycle.latencyProfile.rows){
  const w=worlds.find(w=>w.cycle===cycle.cycle&&w.hidden===cycle.hiddenCount&&w.row===r.index);if(!w){violations.push(`Missing World span ${r.index}`);continue;}
  if(w.tick!==r.tick||r.expectedN!==null&&w.n!==r.expectedN||Math.abs(w.ms-(r.traceTiming.endTime-r.traceTiming.startTime))>.002)violations.push(`Clock/span mismatch ${r.index}`);
  offsets.push(w.start-r.traceTiming.startTime*1000);
  const get=spans.filter(s=>s.cycle===cycle.cycle&&s.hidden===cycle.hiddenCount&&s.row===r.index&&s.kind==='getImageData'),copy=spans.filter(s=>s.cycle===cycle.cycle&&s.hidden===cycle.hiddenCount&&s.row===r.index&&s.kind==='copyTextureToTexture');
  rows.push({cycle:cycle.cycle,hidden:cycle.hiddenCount,index:r.index,before:r.before,after:r.after,glApiCalls:r.glApiCalls??null,glLongCalls:r.glLongCalls??null,phase:r.phase,n:r.expectedN,tick:r.tick,worldMs:w.ms,worldSpan:w,
   rawCpuMs:r.phase==='cpu-sample'?cycle.cpu.valuesMs[r.sample]:undefined,
   calls:r.calls,getImageDataBuckets:r.getImageDataBuckets,textureCopyBuckets:r.textureCopyBuckets,rasterStages:r.rasterStagesDelta.cards,
   deltas:Object.fromEntries(['rasterizations','mipLayerUpdates','scratchUploadBytes','mipInitializedPages','compactionLayers','rasterCacheHits','rasterCacheMisses','rasterCacheEvictions','rasterCacheBackoffs','rasterCacheWorkMs','transferWallMs','mipCopyCalls'].map(k=>[k,r.after.cards[k]-r.before.cards[k]])),
   worldOverlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(w,v)])),
   getSpans:get.map(s=>({...s,overlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(s,v)]))})),
   copySpans:copy.map(s=>({...s,overlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(s,v)]))}))});
 }
}
if(worlds.length!==rows.length||Math.max(...offsets)-Math.min(...offsets)>3)violations.push('World span count/timebase offset inconsistent');
const cpu=rows.filter(r=>r.phase==='cpu-sample');
for(const cycle of raw.cycles){
 const selected=rows.filter(r=>r.cycle===cycle.cycle&&r.hidden===cycle.hiddenCount);
 const measured=selected.filter(r=>r.phase==='cpu-sample');
 if(measured.length!==raw.cpuFrames||measured.some((r,i)=>r.n!==114+i||r.tick!==Math.floor(r.n/3)))violations.push('CPU original clock grid differs cycle '+cycle.cycle);
 if(!cycle.latencyProfile.scheduleValidation.allExpectedRows||cycle.latencyProfile.scheduleValidation.mismatches.length)violations.push('Original schedule validation failed');
 for(const row of selected){
  const noop=row.phase==='cpu-warmup'||row.phase==='cpu-sample';
  if(noop&&(row.before.rendererRenderHookActive||row.after.rendererRenderHookActive||row.calls['renderer.render']?.calls))violations.push('Expected render no-op n='+row.n);
 }
}

const getCpu=cpu.flatMap(r=>r.getSpans),copyCpu=cpu.flatMap(r=>r.copySpans);
const warm=cpu.filter(r=>!r.calls['renderer.copyTextureToTexture']?.calls&&Object.values(r.getImageDataBuckets).every(b=>b.calls===0)).sort((a,b)=>a.worldMs-b.worldMs);
const med=warm[Math.floor(warm.length/2)];
const slim=r=>({cycle:r.cycle,hidden:r.hidden,index:r.index,n:r.n,tick:r.tick,phase:r.phase,worldMs:r.worldMs,rawCpuMs:r.rawCpuMs,deltas:r.deltas,rasterStages:r.rasterStages,worldOverlap:r.worldOverlap,
 longestGets:[...r.getSpans].sort((a,b)=>b.ms-a.ms).slice(0,4),longestCopies:[...r.copySpans].sort((a,b)=>b.ms-a.ms).slice(0,4)});
const allNames=[...nameCounts].map(([name,count])=>({name,count}));
const result={integrity,allRows:rows,fullSourceSha256:raw.diagnostic.fullSourceSha256,profilerSha256:raw.diagnostic.profilerSha256,harnessSha256:raw.harnessSha256,sourceCommit:raw.sourceCommit,input:{rawSha256:hash(rawBytes),traceSha256:hash(traceBytes),traceBytes:traceBytes.length,gzip:raw.trace.gzip},analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),
 validation:{passed:!violations.length,violations,dataLossOccurred:raw.trace.tracingComplete.dataLossOccurred},renderer:{pid,tid,threadName:threads.get(`${pid}/${tid}`),gpuPids,timebaseOffsetUs:{min:Math.min(...offsets),max:Math.max(...offsets)}},
 method:'Match paired CardLatency async UserTiming spans to raw row/n/tick. Durations are synchronous wall, never GPU timers. Clip complete trace intervals to each span, merge overlapping/nested intervals per category before measuring union. Cross-thread/process overlaps indicate correlation, not causal or additive CPU duration.',
 coverage:{events:events.length,completeIntervals:complete.length,cardSpans:spans.length,worldSpans:worlds.length,cpuGetLongSpans:getCpu.length,cpuCopyLongSpans:copyCpu.length,
 phases:[...phaseCounts],categories:[...categoryCounts].sort((a,b)=>b[1]-a[1]),processes:[...processes],threads:[...threads],
 gcNames:allNames.filter(e=>isGC(e)).sort((a,b)=>b.count-a.count),waitNames:allNames.filter(e=>/WaitFor|GpuChannel|CommandBuffer|IPC/i.test(e.name??'')).sort((a,b)=>b.count-a.count),canvasNames:allNames.filter(e=>/Canvas|ReadPixels|ImageData|Raster/i.test(e.name??'')&&!e.name?.startsWith('CardLatency.')).sort((a,b)=>b.count-a.count),
 groupCounts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.sorted.length]))},
 targets:[...cpu].sort((a,b)=>b.rawCpuMs-a.rawCpuMs).slice(0,12).map(r=>({n:r.n,cycle:r.cycle,row:slim(r)})),
 firstSamples:cpu.filter(r=>r.n===114).map(slim),
 glSpans:spans.filter(s=>s.kind.startsWith('GL.')).map(s=>({...s,overlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(s,v)]))})),
 longestGetCpu:[...getCpu].sort((a,b)=>b.ms-a.ms).slice(0,15),longestCopyCpu:[...copyCpu].sort((a,b)=>b.ms-a.ms).slice(0,15),
 warmNoGetNoCopy:{samples:warm.length,medianWorldMs:med?.worldMs,median:med?slim(med):null},cpuRows:cpu,
 limits:['Two full current-production lifetimes with observer overhead; all phases retained. This does not retrospectively attribute the earlier unobserved 696.9 ms stall. No formal performance ratios. Warm n54..113 and sampled n114..173 all use renderer.render no-op; only prep n0..51 and real n480..491 render normally.',
 'Only getImageData/copy calls >1ms have UserTiming spans; raw buckets count every call. The absence of a long span does not mean no short calls.',
 'Main-thread GC union is synchronous traced GC work; background GC is reported separately and cannot be added as a pause. GC overlap does not prove the allocation that caused it.',
 'Skia/GPU/channel overlap can be nested or concurrent; category union values cannot be summed. No GPU hardware timer queries or request/channel-level causal link are present.',
 'No OS scheduler off-CPU/sched_switch stack samples or complete internal Canvas readPixels implementation attribution. Missing named events cannot prove missing work.']};
if(hash(await readFile(resolve(root,'raw.json')))!==result.input.rawSha256||hash(await readFile(resolve(root,'trace.json')))!==result.input.traceSha256)throw new Error('Original input mutated during analysis');
await mkdir(here,{recursive:true});await writeFile(resolve(here,'analysis.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:resolve(here,'analysis.json'),passed:result.validation.passed,renderer:result.renderer,events:events.length,cpuRows:cpu.length,
 targets:result.targets.map(({n,row})=>({n,worldMs:row?.worldMs,gcMs:row?.worldOverlap.mainGC.unionMs,skiaMs:row?.worldOverlap.mainSkia.unionMs,waitMs:row?.worldOverlap.mainWait.unionMs,getMax:row?.longestGets[0]?.ms,copyMax:row?.longestCopies[0]?.ms,copyKey:row?.longestCopies[0]?.key})),warm:result.warmNoGetNoCopy.medianWorldMs,inputsUnchanged:true}));
if(violations.length)process.exitCode=1;
