/** Aggregate sequential samples and check whole composited images. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createHash} from 'node:crypto';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const beforePath=resolve(arg('--before')),afterPath=resolve(arg('--after')),out=resolve(arg('--out'));
const before=JSON.parse(await readFile(beforePath)),after=JSON.parse(await readFile(afterPath));
function stats(values){const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];return{samples:values.length,meanMs:values.reduce((s,v)=>s+v,0)/values.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99),maxMs:sorted.at(-1),over50Ms:values.filter(v=>v>50).length};}
const digest=data=>createHash('sha256').update(data).digest('hex');
async function rgba(path){const img=await loadImage(path),canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return{width:img.width,height:img.height,data:ctx.getImageData(0,0,img.width,img.height).data};}
const images=[],rows=[];let passed=before.validation.passed&&after.validation.passed;
if(before.fixtureSha256!==after.fixtureSha256||before.entryFixtureSha256!==after.entryFixtureSha256||before.harnessSha256!==after.harnessSha256)throw new Error('Harness or fixture changed between measurements');
for(const b of before.cycles){
 const a=after.cycles.find(c=>c.hiddenCount===b.hiddenCount&&c.cycle===b.cycle);if(!a)throw new Error('Missing paired lifetime');
 if(a.pixelProofSha256!==b.pixelProofSha256)passed=false;
 for(const name of Object.keys(b.screenshots)){
  const left=await rgba(resolve(dirname(beforePath),b.screenshots[name].path)),right=await rgba(resolve(dirname(afterPath),a.screenshots[name].path));
  if(left.width!==right.width||left.height!==right.height)throw new Error('Different screenshot dimensions');
  let changedChannels=0,changedPixels=0,maxDifference=0;
  for(let p=0;p<left.data.length;p+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(left.data[p+c]-right.data[p+c]);if(delta){changedChannels++;changed=true;maxDifference=Math.max(maxDifference,delta);}}if(changed)changedPixels++;}
  if(changedChannels)passed=false;
  images.push({hiddenCount:b.hiddenCount,cycle:b.cycle,name,changedPixels,changedChannels,maxDifference,rgbaSha256Before:digest(left.data),rgbaSha256After:digest(right.data)});
 }
}
for(const count of before.counts){
 const group=data=>data.cycles.filter(c=>c.hiddenCount===count),b=group(before),a=group(after);
 const summarize=cycles=>{
  const fresh=cycles.flatMap(c=>c.cpu.valuesMs.filter((v,i)=>i===0||c.cpu.sampleTicks[i]!==c.cpu.sampleTicks[i-1])),same=cycles.flatMap(c=>c.cpu.valuesMs.filter((v,i)=>i>0&&c.cpu.sampleTicks[i]===c.cpu.sampleTicks[i-1]));
  return{cpu:stats(cycles.flatMap(c=>c.cpu.valuesMs)),fresh:stats(fresh),same:stats(same),layer:stats(cycles.flatMap(c=>c.cpu.layerValuesMs)),canvas:stats(cycles.flatMap(c=>c.cpu.canvasValuesMs)),realCompleteWall:stats(cycles.flatMap(c=>c.real.completeWallValuesMs)),realSubmission:stats(cycles.flatMap(c=>c.real.submitValuesMs)),lifetimes:cycles.map(c=>({cycle:c.cycle,cards:c.before.cards,renderer:c.before.render,heapAfterDisposeAndGc:c.heapAfterGc,empty:c.empty,returned:c.returned,assetCoverage:c.assetCoverage}))};
 };
 rows.push({hiddenCount:count,visibleCount:b[0].visibleCount,before:summarize(b),after:summarize(a)});
}
const result={passed,beforeCommit:before.sourceCommit,afterCommit:after.sourceCommit,entryFixtureName:before.entryFixtureName,harnessSha256:before.harnessSha256,entryFixtureSha256:before.entryFixtureSha256,images,rows,scope:'Identical fixture and harness; sample distributions aggregate raw samples, never averages of percentiles. CPU wall includes rasterization/upload/driver backpressure; real complete wall includes software GPU completion and polling, not hardware FPS. Owned GPU bytes describe program allocations, not measured VRAM residency; heap is after disposal and requested GC. No simulation executes inside measured presentation loops.'};
await writeFile(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({out,passed,images:images.length,changedChannels:images.reduce((n,x)=>n+x.changedChannels,0),rows:rows.map(r=>({hidden:r.hiddenCount,before:r.before.cpu,after:r.after.cpu}))}));
if(!passed)process.exitCode=1;
