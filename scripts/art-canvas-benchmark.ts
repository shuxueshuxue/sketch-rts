/** Fixed real-simulation Canvas benchmark. No AI, wall clock or random visual choices. */
import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { setScratchCanvasFactory } from '../src/client/art/scratch-canvas';
import { installHeadlessCanvas } from '../src/recorder/record';
import { cavalryCharge } from '../src/recorder/scenes/cavalry-charge';
import { snapshotGame, stepGame } from '../src/shared/sim';
import { drawWorld, trackUnitFacing, worldLabelsFor } from '../src/client/world-renderer';
import { UnitFacingTracker } from '../src/client/unit-facing';
import { UnitMotionSmoother } from '../src/client/unit-motion';
import { UnitAnimationTracker } from '../src/client/unit-animation';
import { ShipWakeTracker } from '../src/client/ship-wakes';
import { PAPER_BASE } from '../src/client/atlas-art';
import * as atlasArt from '../src/client/atlas-art';
import { SIM_TICKS_PER_SECOND } from '../src/shared/time';
import { createI18n } from '../src/client/i18n';
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const output = resolve(process.argv.includes('--out') ? arg('--out') : 'work/art-canvas');
mkdirSync(output, { recursive: true });
installHeadlessCanvas();
const scratch={allocations:0,pixels:0,requestedRgbaBytes:0};
setScratchCanvasFactory((width,height)=>{scratch.allocations++;scratch.pixels+=width*height;scratch.requestedRgbaBytes+=width*height*4;return createCanvas(width,height) as unknown as HTMLCanvasElement;});
const summarize = (values: number[]) => {
 const sorted = [...values].sort((a,b)=>a-b);
 return { samples: values.length, meanMs: values.reduce((a,b)=>a+b,0)/values.length, p50Ms: sorted[Math.floor(sorted.length*.5)], p95Ms: sorted[Math.floor(sorted.length*.95)], p99Ms: sorted[Math.floor(sorted.length*.99)], maxMs: sorted.at(-1), over16_67ms: values.filter(x=>x>1000/60).length, over33_33ms: values.filter(x=>x>1000/30).length, valuesMs: values };
};
const runs = [];
for(let run=0;run<4;run++) {
 const game = cavalryCharge.createGame();
 const canvas = createCanvas(1280,720), ctx=canvas.getContext('2d');
 const facing=new UnitFacingTracker(), motion=new UnitMotionSmoother(), animation=new UnitAnimationTracker(), wakes=new ShipWakeTracker();
 const render:number[]=[],sim:number[]=[],snapshot:number[]=[],frame:number[]=[];
 const hashes:string[]=[];
 const before=process.memoryUsage();
 for(let i=0;i<600;i++) {
  const start=performance.now(), target=Math.floor(i*SIM_TICKS_PER_SECOND/30);
  const simStart=performance.now();
  while(game.tick<target){stepGame(game);trackUnitFacing(facing,game);}
  const simEnd=performance.now();
  const state=snapshotGame(game),snapEnd=performance.now();
  const renderStart=performance.now();
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=PAPER_BASE;ctx.fillRect(0,0,1280,720);
  drawWorld({ctx:ctx as unknown as CanvasRenderingContext2D,snapshot:state,view:{x:1410,y:1688,width:1280,height:720,zoom:1},now:i*1000/30,facing,motion,animation,wakes,labels:worldLabelsFor(createI18n('en'))});
  const end=performance.now();
  render.push(end-renderStart);sim.push(simEnd-simStart);snapshot.push(snapEnd-simEnd);frame.push(end-start);
  if(i%60===0)hashes.push(createHash('sha256').update(JSON.stringify(state)).digest('hex'));
  if(run===1&&[0,150,300,450,599].includes(i))writeFileSync(resolve(output,`canvas-${i}.png`),canvas.toBuffer('image/png'));
 }
 runs.push({run,warmup:run===0,render:summarize(render),simulation:summarize(sim),snapshot:summarize(snapshot),frame:summarize(frame),memoryBefore:before,memoryAfter:process.memoryUsage(),scratchAllocations:{...scratch},cache:(atlasArt as unknown as {canvasArtCacheStats?:()=>unknown}).canvasArtCacheStats?.()??null,stateHashes:hashes,lastTick:game.tick,remainingUnits:game.units.length});
}
if(runs.some(run=>JSON.stringify(run.stateHashes)!==JSON.stringify(runs[0].stateHashes)))throw new Error('Fixed simulation differs across runs');
const sourceSha256=Object.fromEntries(['src/client/atlas-art.ts','src/client/world-renderer.ts','src/client/unit-animation.ts','src/client/art/painted-units.ts','src/client/art/painted-creatures.ts','src/shared/sim.ts'].map(file=>[file,createHash('sha256').update(readFileSync(resolve(file))).digest('hex')]));
const result={schema:1,sourceSha256,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,environment:{cpu:cpus()[0]?.model,threads:cpus().length,platform:platform(),release:release()},scene:'cavalry-charge',viewport:{width:1280,height:720,zoom:1,x:1410,y:1688},method:'Four sequential 600-frame real Canvas runs at deterministic 30 FPS timestamps, 20 sim ticks/sec. Run zero warms process caches. PNG encoding excluded. Frame is CPU sim+snapshot+Canvas drawing, not browser presentation/FPS. Memory is process memory without forced GC; scratchAllocations are cumulative requested RGBA pixel bytes (not resident/native overhead), not live retained bytes. State hashes prove same simulation across runs and before/after.',runs};
writeFileSync(resolve(output,'canvas.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(runs.map(r=>({run:r.run,render:r.render.meanMs,p95:r.render.p95Ms,simulation:r.simulation.meanMs,frame:r.frame.meanMs}))));
