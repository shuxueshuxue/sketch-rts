/** Offline Chromium trace correlation; never mutate trace/raw or launch a browser. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../trace-current');
const hash=b=>createHash('sha256').update(b).digest('hex');
const rawBytes=await readFile(resolve(root,'raw.json')),raw=JSON.parse(rawBytes);
const traceBytes=await readFile(resolve(root,'trace.json')),trace=JSON.parse(traceBytes);
if(hash(traceBytes)!==raw.trace.raw.sha256||!raw.trace.complete||raw.trace.tracingComplete.dataLossOccurred||!raw.completed||!raw.validation.passed||!raw.diagnostic.tracing)throw new Error('Invalid/incomplete trace evidence');
if(hash(await readFile(resolve(root,'profiler.js')))!==raw.diagnostic.profilerSha256)throw new Error('Profiler archive differs');
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
  const w=worlds.find(w=>w.cycle===cycle.cycle&&w.row===r.index);if(!w){violations.push(`Missing World span ${r.index}`);continue;}
  if(w.tick!==r.tick||r.expectedN!==null&&w.n!==r.expectedN||Math.abs(w.ms-(r.traceTiming.endTime-r.traceTiming.startTime))>.002)violations.push(`Clock/span mismatch ${r.index}`);
  offsets.push(w.start-r.traceTiming.startTime*1000);
  const get=spans.filter(s=>s.cycle===cycle.cycle&&s.row===r.index&&s.kind==='getImageData'),copy=spans.filter(s=>s.cycle===cycle.cycle&&s.row===r.index&&s.kind==='copyTextureToTexture');
  rows.push({cycle:cycle.cycle,index:r.index,phase:r.phase,n:r.expectedN,tick:r.tick,worldMs:w.ms,worldSpan:w,
   rawCpuMs:r.phase==='cpu-sample'?cycle.cpu.valuesMs[r.sample]:undefined,
   calls:r.calls,getImageDataBuckets:r.getImageDataBuckets,textureCopyBuckets:r.textureCopyBuckets,rasterStages:r.rasterStagesDelta.cards,
   deltas:Object.fromEntries(['rasterizations','mipLayerUpdates','scratchUploadBytes','mipInitializedPages','compactionLayers'].map(k=>[k,r.after.cards[k]-r.before.cards[k]])),
   worldOverlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(w,v)])),
   getSpans:get.map(s=>({...s,overlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(s,v)]))})),
   copySpans:copy.map(s=>({...s,overlap:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,overlap(s,v)]))}))});
 }
}
if(worlds.length!==rows.length||Math.max(...offsets)-Math.min(...offsets)>3)violations.push('World span count/timebase offset inconsistent');
const cpu=rows.filter(r=>r.phase==='cpu-sample');if(cpu.length!==60||cpu.some((r,i)=>r.n!==114+i||r.tick!==Math.floor(r.n/3)))violations.push('CPU original clock grid differs');
const getCpu=cpu.flatMap(r=>r.getSpans),copyCpu=cpu.flatMap(r=>r.copySpans);
const warm=cpu.filter(r=>!r.calls['renderer.copyTextureToTexture']?.calls&&Object.values(r.getImageDataBuckets).every(b=>b.calls===0)).sort((a,b)=>a.worldMs-b.worldMs);
const med=warm[Math.floor(warm.length/2)];
const slim=r=>({index:r.index,n:r.n,tick:r.tick,phase:r.phase,worldMs:r.worldMs,rawCpuMs:r.rawCpuMs,deltas:r.deltas,rasterStages:r.rasterStages,worldOverlap:r.worldOverlap,
 longestGets:[...r.getSpans].sort((a,b)=>b.ms-a.ms).slice(0,4),longestCopies:[...r.copySpans].sort((a,b)=>b.ms-a.ms).slice(0,4)});
const allNames=[...nameCounts].map(([name,count])=>({name,count}));
const result={sourceCommit:raw.sourceCommit,input:{rawSha256:hash(rawBytes),traceSha256:hash(traceBytes),traceBytes:traceBytes.length,gzip:raw.trace.gzip},analysisScriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),
 validation:{passed:!violations.length,violations,dataLossOccurred:raw.trace.tracingComplete.dataLossOccurred},renderer:{pid,tid,threadName:threads.get(`${pid}/${tid}`),gpuPids,timebaseOffsetUs:{min:Math.min(...offsets),max:Math.max(...offsets)}},
 method:'Match paired CardLatency async UserTiming spans to raw row/n/tick. Durations are synchronous wall, never GPU timers. Clip complete trace intervals to each span, merge overlapping/nested intervals per category before measuring union. Cross-thread/process overlaps indicate correlation, not causal or additive CPU duration.',
 coverage:{events:events.length,completeIntervals:complete.length,cardSpans:spans.length,worldSpans:worlds.length,cpuGetLongSpans:getCpu.length,cpuCopyLongSpans:copyCpu.length,
 phases:[...phaseCounts],categories:[...categoryCounts].sort((a,b)=>b[1]-a[1]),processes:[...processes],threads:[...threads],
 gcNames:allNames.filter(e=>isGC(e)).sort((a,b)=>b.count-a.count),waitNames:allNames.filter(e=>/WaitFor|GpuChannel|CommandBuffer|IPC/i.test(e.name??'')).sort((a,b)=>b.count-a.count),canvasNames:allNames.filter(e=>/Canvas|ReadPixels|ImageData|Raster/i.test(e.name??'')&&!e.name?.startsWith('CardLatency.')).sort((a,b)=>b.count-a.count),
 groupCounts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.sorted.length]))},
 targets:[116,135,158].map(n=>({n,row:cpu.find(r=>r.n===n)?slim(cpu.find(r=>r.n===n)):null})),
 longestGetCpu:[...getCpu].sort((a,b)=>b.ms-a.ms).slice(0,15),longestCopyCpu:[...copyCpu].sort((a,b)=>b.ms-a.ms).slice(0,15),
 warmNoGetNoCopy:{samples:warm.length,medianWorldMs:med?.worldMs,median:med?slim(med):null},cpuRows:cpu,
 limits:['One traced lifetime with UserTiming/Chrome tracing observer cost; no formal performance ratios.',
 'Only getImageData/copy calls >1ms have UserTiming spans; raw buckets count every call. The absence of a long span does not mean no short calls.',
 'Main-thread GC union is synchronous traced GC work; background GC is reported separately and cannot be added as a pause. GC overlap does not prove the allocation that caused it.',
 'Skia/GPU/channel overlap can be nested or concurrent; category union values cannot be summed. No GPU hardware timer queries or request/channel-level causal link are present.',
 'No OS scheduler off-CPU/sched_switch stack samples or complete internal Canvas readPixels implementation attribution. Missing named events cannot prove missing work.']};
if(hash(await readFile(resolve(root,'raw.json')))!==result.input.rawSha256||hash(await readFile(resolve(root,'trace.json')))!==result.input.traceSha256)throw new Error('Original input mutated during analysis');
await mkdir(here,{recursive:true});await writeFile(resolve(here,'analysis.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:resolve(here,'analysis.json'),passed:result.validation.passed,renderer:result.renderer,events:events.length,cpuRows:cpu.length,
 targets:result.targets.map(({n,row})=>({n,worldMs:row?.worldMs,gcMs:row?.worldOverlap.mainGC.unionMs,skiaMs:row?.worldOverlap.mainSkia.unionMs,waitMs:row?.worldOverlap.mainWait.unionMs,getMax:row?.longestGets[0]?.ms,copyMax:row?.longestCopies[0]?.ms,copyKey:row?.longestCopies[0]?.key})),warm:result.warmNoGetNoCopy.medianWorldMs,inputsUnchanged:true}));
if(violations.length)process.exitCode=1;
