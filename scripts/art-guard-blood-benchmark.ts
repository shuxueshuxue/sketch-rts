/** CPU presentation-only stress. Synthetic event facts; not simulation or GPU FPS. */
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createGame} from '../src/shared/sim';
import {bloodSurfaceResolver} from '../src/client/combat-surfaces';
import type {WorldEffect} from '../src/shared/types';
const source=resolve(process.argv[2]??'.'),output=process.argv[3]??'/tmp/guard-blood-benchmark.json';
const load=(path:string)=>import(pathToFileURL(resolve(source,path)).href);
const {CombatPresentationTracker}=await load('src/client/combat-presentation.ts');
const {UnitAnimationTracker}=await load('src/client/unit-animation.ts');
const {UnitFacingTracker}=await load('src/client/unit-facing.ts');
const {projectActionFrame}=await load('src/client/art/action-direction.ts');
const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];
for(let i=0;i<1000;i++){const unit=game.spawnUnit(i%2?'enemy':'player',i%3?'footman':'lancer',500+i%40*34,500+Math.floor(i/40)*34);unit.order={type:'hold',x:unit.x,y:unit.y};}
const samples:number[]=[],cycles:object[]=[];let peakMarks=0,peakDrops=0,peakHeap=0;
for(let cycle=0;cycle<4;cycle++){
 const combat=new CombatPresentationTracker(),animation=new UnitAnimationTracker(),facing=new UnitFacingTracker(),values:number[]=[];
 global.gc?.();const heapBefore=process.memoryUsage().heapUsed;
 for(let tick=0;tick<120;tick++){
  const effects:WorldEffect[]=[];
  if(tick%12===1)for(let i=0;i<48;i++){
   const unit=game.units[400+i]!,attacker=game.units[399+i]!;
   effects.push({id:`release-${tick}-${i}`,type:'melee',x:unit.x,y:unit.y,duration:16,remaining:16,actionMode:'attack',actionTick:tick,sourceId:attacker.id,fromX:attacker.x,fromY:attacker.y,toX:unit.x,toY:unit.y});
   effects.push({id:`blood-${tick}-${i}`,type:'hit',x:unit.x,y:unit.y,duration:14,remaining:14,unitId:unit.id,damage:70,targetKind:unit.kind,targetHpAfter:30,targetMaxHp:145,targetRadius:unit.radius,targetUnitClass:'nonMechanical',fromX:attacker.x,fromY:attacker.y});
  }
  const snapshot={...game,tick,effects},now=tick*50,start=performance.now();
  animation.update(snapshot,now);facing.update(game.units,()=>undefined);
  combat.update(snapshot,now,bloodSurfaceResolver(snapshot,animation,facing,undefined));
  for(const unit of game.units){const raw=animation.frame(unit,now),side=facing.actionFacing(unit.id,raw.direction??raw.carryDirection);projectActionFrame(raw,side);}
  const marks=combat.frame(now);values.push(performance.now()-start);
  peakMarks=Math.max(peakMarks,marks.body.length);peakDrops=Math.max(peakDrops,marks.droplets.length);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
 }
 global.gc?.();cycles.push({cycle,heapBefore,heapAfter:process.memoryUsage().heapUsed,meanMs:values.reduce((a,b)=>a+b,0)/values.length});
 if(cycle)samples.push(...values);
}
samples.sort((a,b)=>a-b);const result={source,units:1000,frames:360,warmupFrames:120,burstEventsPer12Ticks:48,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),peakBodyMarks:peakMarks,peakDroplets:peakDrops,peakHeap,cycles,method:'Same static 1000 units, fixed synthetic hit/release facts, 120 frames per cycle. First cycle warms up. Animation/facing/pose projection/blood CPU only; no simulation, rasterization, GPU or capture. Heap is whole Node process including loader and module graphs, not retained art memory.'};
mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
