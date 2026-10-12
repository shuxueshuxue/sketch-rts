/** Compare evidence; fail if the fixed simulation or browser environment changed. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [beforeDir,afterDir,out]=process.argv.slice(2);
if(!beforeDir||!afterDir)throw new Error('Usage: node scripts/art-compare.mjs BEFORE AFTER [OUT.json]');
const read=async(dir,file)=>JSON.parse(await readFile(resolve(dir,file),'utf8'));
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const summarize=a=>{const sorted=[...a].sort((x,y)=>x-y);return{n:a.length,mean:mean(a),p50:sorted[Math.floor(a.length*.5)],p95:sorted[Math.floor(a.length*.95)],p99:sorted[Math.floor(a.length*.99)],max:sorted.at(-1),over16_67:a.filter(x=>x>1000/60).length,over33_33:a.filter(x=>x>1000/30).length};};
const pair=(before,after)=>({before,after,meanChangePercent:(after.mean/before.mean-1)*100});
const [cb,ca]=await Promise.all([read(beforeDir,'canvas.json'),read(afterDir,'canvas.json')]);
const assert=(value,message)=>{if(!value)throw new Error(message);};
assert(JSON.stringify(cb.viewport)===JSON.stringify(ca.viewport),'Canvas viewport differs');
assert(cb.node===ca.node&&JSON.stringify(cb.environment)===JSON.stringify(ca.environment),'Canvas runtime differs');
assert(cb.runs.every((r,i)=>JSON.stringify(r.stateHashes)===JSON.stringify(ca.runs[i]?.stateHashes)),'Simulation changed: Canvas state hashes differ');
const report={canvas:{simulationIdentical:true,metrics:{},runMeans:{before:cb.runs.map(r=>r.render.meanMs),after:ca.runs.map(r=>r.render.meanMs)},memory:{before:cb.runs.map(r=>r.memoryAfter),after:ca.runs.map(r=>r.memoryAfter)},scratchAllocations:{before:cb.runs.at(-1).scratchAllocations,after:ca.runs.at(-1).scratchAllocations},cache:{before:cb.runs.at(-1).cache,after:ca.runs.at(-1).cache}},webgl:{}};
for(const metric of ['render','simulation','snapshot','frame'])report.canvas.metrics[metric]=pair(summarize(cb.runs.slice(1).flatMap(r=>r[metric].valuesMs)),summarize(ca.runs.slice(1).flatMap(r=>r[metric].valuesMs)));
for(const file of ['webgl-full.json','webgl-all-units.json','webgl-dynamic.json']){
 const [b,a]=await Promise.all([read(beforeDir,file),read(afterDir,file)]);
 assert(b.validation.passed&&a.validation.passed,`${file}: resource validation failed`);
 assert(b.browser.product===a.browser.product&&b.browser.jsVersion===a.browser.jsVersion,`${file}: browser differs`);
 assert(JSON.stringify(b.viewport)===JSON.stringify(a.viewport)&&b.units===a.units&&b.ships===a.ships,`${file}: scene differs`);
 assert(b.artScene===a.artScene,`${file}: art scene differs`);
 if(file==='webgl-dynamic.json')assert(b.cycles[0].artTiming.replay.stateHash===a.cycles[0].artTiming.replay.stateHash,'Dynamic real-simulation replay differs');
 report.webgl[file]={...(file==='webgl-dynamic.json'?{frameIntervals:pair(summarize(b.cycles.flatMap(c=>c.artTiming.renderer.frameIntervalsMs)),summarize(a.cycles.flatMap(c=>c.artTiming.renderer.frameIntervalsMs))),visibleUnits:{before:b.cycles.map(c=>Math.min(...c.artTiming.renderer.visibleUnitCounts)),after:a.cycles.map(c=>Math.min(...c.artTiming.renderer.visibleUnitCounts))},animationModes:{before:b.cycles[0].artTiming.renderer.animationModes,after:a.cycles[0].artTiming.renderer.animationModes}}:{}),fullDrawFenced:pair(summarize(b.cycles.flatMap(c=>c.artTiming.fullDrawValuesMs)),summarize(a.cycles.flatMap(c=>c.artTiming.fullDrawValuesMs))),cpuSubmission:pair(summarize(b.cycles.flatMap(c=>c.artTiming.submissionValuesMs)),summarize(a.cycles.flatMap(c=>c.artTiming.submissionValuesMs))),staticCpuRunMeans:{before:b.cycles.map(c=>c.staticCpu.meanMs),after:a.cycles.map(c=>c.staticCpu.meanMs)},updatedCpuRunMeans:{before:b.cycles.map(c=>c.updatedCpu.meanMs),after:a.cycles.map(c=>c.updatedCpu.meanMs)},renderer:{before:b.cycles.map(c=>c.artTiming.renderer),after:a.cycles.map(c=>c.artTiming.renderer)},heapAfterGc:{before:b.cycles.map(c=>c.heapAfterGc.usedSize),after:a.cycles.map(c=>c.heapAfterGc.usedSize)}};
}
const text=JSON.stringify(report,null,2)+'\n';if(out)await writeFile(resolve(out),text);console.log(text);
