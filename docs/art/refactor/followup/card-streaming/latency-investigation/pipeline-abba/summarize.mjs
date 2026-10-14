/** Compact offline view of the completed strict analysis; no measurement. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const a=JSON.parse(await readFile(resolve(here,'analysis.json'),'utf8'));
const timing=d=>({n:d.samples,mean:d.meanMs,p95:d.p95Ms,p99:d.p99Ms,max:d.maxMs,over50:d.over50,over100:d.over100});
const resource=phase=>{
 const c=phase.cards,s=c.residencySnapshot;
 return {cards:Object.fromEntries(Object.entries(c).filter(([,v])=>typeof v==='number')),cache:c.rasterCache,stages:c.rasterStages,
  actualBaseMips:s.actualCardBaseMips,sourceSizes:s.originalSourceSizes,totalCapacity:s.totalPageCapacity,liveLayers:s.liveLayers,activeLayers:s.activeLayers,
  pages:s.pages.map(p=>({width:p.width,height:p.height,capacity:p.capacity,live:p.liveLayers,active:p.activeLayers,bases:p.actualBaseMips})),
  positions:phase.positions,render:phase.render,memory:phase.memory,viewIndex:phase.viewIndex};
};
const out={sourceCommit:a.sourceCommit,validation:a.validation,images:a.images.length,facts:a.facts.length,clocks:a.matchedCpuSamples,rgbaEqual:a.allScreenshotsZeroRGBA,pngShaEqual:a.allRecordedPixelHashesEqual,
 timing:Object.fromEntries(Object.entries(a.pooled).map(([p,d])=>[p,Object.fromEntries(Object.entries(d).map(([k,v])=>[k,timing(v)]))])),
 lifetimes:a.perRun.flatMap(r=>r.lifetimes.map(l=>({run:r.name,cycle:l.cycle,hiddenCount:l.hiddenCount,timing:Object.fromEntries(Object.entries(l.timings).map(([k,v])=>[k,timing(v)])),before:resource(l.before),empty:resource(l.empty),returned:resource(l.returned)}))),
 resourceDifferenceFields:[...new Set(a.resourceChecks.flatMap(r=>r.differences.map(d=>d.field)))],phaseDifferenceFields:[...new Set(a.resourceChecks.flatMap(r=>r.phaseDifferences.map(d=>d.field)))],
 scriptSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')};
await writeFile(resolve(here,'report-summary.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:out.sourceCommit,quality:out.validation,timing:out.timing,
 life:out.lifetimes.map(l=>({run:l.run,cycle:l.cycle,cpu:l.timing.fullCpu,wall:l.timing.realWall,cold:l.timing.firstColdReal,subsequent:l.timing.subsequentReal,
  ownedCpu:l.before.cards.ownedCpuBytes,peakCpu:l.before.cards.peakOwnedCpuBytes,gpu:l.before.cards.ownedGpuBytes,peakGpu:l.before.cards.peakOwnedGpuBytes,
  pages:l.before.cards.pages,chunks:l.before.cards.drawChunks,capacity:l.before.totalCapacity,live:l.before.liveLayers,bases:l.before.actualBaseMips,
  misses:l.before.cache.misses,hits:l.before.cache.hits,cacheWork:l.before.cache.workMs,stage:l.before.stages,upload:l.before.cards.gpuTransferSubmissionWallMs,
  mipCopyCalls:l.before.cards.mipCopyCalls,mipCopyBytes:l.before.cards.mipCopyBytes,arrayUpload:l.before.cards.arrayBaseUploadBytes,scratchUpload:l.before.cards.scratchUploadBytes,
  returnedOwnedGpu:l.returned.cards.ownedGpuBytes,returnedCpu:l.returned.cards.ownedCpuBytes})),diffs:out.resourceDifferenceFields,phaseDiffs:out.phaseDifferenceFields},null,2));
