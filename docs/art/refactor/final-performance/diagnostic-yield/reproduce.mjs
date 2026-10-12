// Run from repository root. This lifecycle diagnostic never changes production.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let source=readFileSync('scripts/art-canvas-benchmark.ts','utf8');
const anchor="  if(run===1&&[0,150,300,450,599].includes(i))writeFileSync(resolve(output,`canvas-${i}.png`),canvas.toBuffer('image/png'));";
if(!source.includes(anchor))throw new Error('Benchmark screenshot anchor changed');
source=source.replace(anchor,anchor+'\n  if((i+1)%20===0)await new Promise<void>(done=>setImmediate(done));');
source=source.replace('const result={schema:1,',"const result={schema:1,lifecycleDiagnostic:{yieldEveryFrames:20,forcedGc:false,yieldOutsideTiming:true,method:'setImmediate after every twentieth frame, after timing/telemetry/screenshots. CPU timings exclude yield; not wall-frame time, not browser behavior, not a production speedup.'},");
const temporary=`scripts/.art-yield-diagnostic-${process.pid}.ts`;
try{
 writeFileSync(temporary,source);
 const result=spawnSync(process.execPath,['--import','tsx',temporary,'--final-art','--out',process.argv[2]??'work/art-yield-diagnostic'],{stdio:'inherit'});
 process.exitCode=result.status??1;
}finally{unlinkSync(temporary);}
