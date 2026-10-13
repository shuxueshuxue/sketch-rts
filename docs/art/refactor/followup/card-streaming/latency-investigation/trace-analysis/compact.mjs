/** Compact derived trace evidence. Run only outside all benchmark windows. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),a=JSON.parse(await readFile(resolve(here,'analysis.json'),'utf8'));
if(!a.validation.passed)throw new Error('Verified trace analysis required');
const rows=a.cpuRows,gets=rows.flatMap(r=>r.getSpans),copies=rows.flatMap(r=>r.copySpans);
const sum=v=>v.reduce((a,b)=>a+b,0);
function coverage(spans){
 const sorted=[...spans].sort((a,b)=>a.start-b.start);
 for(let i=1;i<sorted.length;i++)if(sorted[i].start<sorted[i-1].end)throw new Error('Calls overlap: per-call union totals cannot be added');
 const unionMs=sum(sorted.map(s=>s.ms)),groups={};
 for(const key of ['mainGC','mainTopGCPause','mainSkia','mainWait','mainCanvas','sameRendererWorkerGC','gpuProcess','gpuProcessSkia']){
  const overlapMs=sum(sorted.map(s=>s.overlap[key].unionMs));groups[key]={unionMs:overlapMs,fraction:unionMs?overlapMs/unionMs:0,callsWithOverlap:sorted.filter(s=>s.overlap[key].unionMs>0).length};
 }
 return{calls:sorted.length,unionMs,callSpansDisjointVerified:true,groups};
}
const rowCompact=r=>({n:r.n,tick:r.tick,row:r.index,worldMs:r.worldMs,rasterizations:r.deltas.rasterizations,uploadBytes:r.deltas.scratchUploadBytes,
 measuredStages:r.rasterStages,methods:Object.fromEntries(['World3DLayer.residentMip','PaintedCardBatches.cards.draw','PaintedCardBatches.cards.recordPeaks','CardMipUploader.cards.uploadLayer','renderer.copyTextureToTexture'].map(k=>[k,r.calls[k]??{calls:0,inclusiveMs:0}])),
 mainGC:r.worldOverlap.mainGC.unionMs,mainSkia:r.worldOverlap.mainSkia.unionMs,mainWait:r.worldOverlap.mainWait.unionMs,
 getCoverage:coverage(r.getSpans),copyCoverage:coverage(r.copySpans)});
const callCompact=s=>({n:s.n,tick:s.tick,row:s.row,key:s.key,ms:s.ms,
 mainGC:{unionMs:s.overlap.mainGC.unionMs,fraction:s.overlap.mainGC.fraction},mainSkia:{unionMs:s.overlap.mainSkia.unionMs,fraction:s.overlap.mainSkia.fraction},
 mainWait:{unionMs:s.overlap.mainWait.unionMs,fraction:s.overlap.mainWait.fraction,names:s.overlap.mainWait.names},gpuProcessCorrelation:s.overlap.gpuProcess});
const result={sourceCommit:a.sourceCommit,input:a.input,renderer:a.renderer,coverage:{traceEvents:a.coverage.events,worldSpans:a.coverage.worldSpans,cpuRows:rows.length,
 allLongCpuGet:coverage(gets),allLongCpuCopy:coverage(copies),rawGetCalls:sum(rows.flatMap(r=>Object.values(r.getImageDataBuckets).map(b=>b.calls))),
 rawGetBucketWallMs:sum(rows.flatMap(r=>Object.values(r.getImageDataBuckets).map(b=>b.inclusiveMs))),rawReadbackStageMs:sum(rows.map(r=>r.rasterStages.readbackMs))},
 largestGet:callCompact(a.longestGetCpu[0]),largestCopy:callCompact(a.longestCopyCpu[0]),topGets:a.longestGetCpu.slice(0,5).map(callCompact),topCopies:a.longestCopyCpu.slice(0,5).map(callCompact),
 targets:[116,135,158].map(n=>rowCompact(rows.find(r=>r.n===n))),worstCpuRows:[...rows].sort((a,b)=>b.worldMs-a.worldMs).slice(0,6).map(rowCompact),
 warmNoGetNoCopy:{count:a.warmNoGetNoCopy.samples,medianWorldMs:a.warmNoGetNoCopy.medianWorldMs,medianN:a.warmNoGetNoCopy.median.n,median:rowCompact(rows.find(r=>r.n===a.warmNoGetNoCopy.median.n))},
 limitations:a.limits};
await writeFile(resolve(here,'compact.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:resolve(here,'compact.json'),longGets:result.coverage.allLongCpuGet,largestGet:{n:result.largestGet.n,ms:result.largestGet.ms,gc:result.largestGet.mainGC,skia:result.largestGet.mainSkia,wait:result.largestGet.mainWait},copy:{n:result.largestCopy.n,key:result.largestCopy.key,ms:result.largestCopy.ms,wait:result.largestCopy.mainWait},warm:result.warmNoGetNoCopy.medianWorldMs}));
