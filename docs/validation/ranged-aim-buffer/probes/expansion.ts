import { createSubjectGauntletInput } from '../../../../src/ai/benchmark/subject-gauntlet.ts';
import { roomGauntlet } from '../../../../src/ai/benchmark/room-gauntlet.ts';
import { navalObservedPlanner } from '../../../../src/ai/benchmark/naval-room-worker.ts';
import { runGameLoop } from '../../../../src/sdk/game-runner.ts';
import { UNIT_DEFS } from '../../../../src/shared/catalog.ts';
import { SHIP_WEAPONS } from '../../../../src/shared/ship-equipment.ts';
for(const buffer of [0,.25]){
 for(const def of [...Object.values(UNIT_DEFS),...Object.values(SHIP_WEAPONS)])def.aimRangeBuffer=buffer;
 const {input}=createSubjectGauntletInput(roomGauntlet('v9_archer',['v9']),{seed:'v5-final-1',mapCount:20});
 const match=input.evaluations[0]!.matches[28]!,memories:any={},halls=new Map(),events:any[]=[],samples:any[]=[];
 let lastStage='',firstConcurrent3:number|undefined;
 const result=runGameLoop({...match,maxTicks:12000,commandPlanner:navalObservedPlanner(memories)},{onStep({game}){
  const live=game.buildings.filter(b=>b.owner==='v9_archer'&&b.kind==='townHall');
  for(const b of live){if(!halls.has(b.id))halls.set(b.id,{id:b.id,x:b.x,y:b.y,created:game.tick,complete:b.complete?game.tick:undefined});else if(b.complete&&!halls.get(b.id).complete)halls.get(b.id).complete=game.tick;}
  for(const [id,b]of halls)if(!b.destroyed&&!live.some(h=>h.id===id))b.destroyed=game.tick;
  if(live.length>=3)firstConcurrent3??=game.tick;
  const task=memories.v9_archer?.landExpansion;
  const stage=JSON.stringify(task&&{mine:task.mineId,stage:task.stage,paused:task.paused,reason:task.interruptions?.at(-1)});
  if(stage!==lastStage){events.push({tick:game.tick,task:structuredClone(task),gold:game.players.v9_archer.gold,clears:game.match.stats.neutralUnitsKilled.v9_archer,lost:game.match.stats.unitsLost.v9_archer});lastStage=stage;}
  if(game.tick%200===0)samples.push({tick:game.tick,halls:live.map(b=>({id:b.id,hp:b.hp,complete:b.complete})),gold:game.players.v9_archer.gold,army:game.units.filter(u=>u.owner==='v9_archer'&&u.kind!=='worker').length,task:structuredClone(task),stats:structuredClone(game.match.stats)});
 }});
 console.log(JSON.stringify({buffer,map:match.name,tick:result.game.tick,winner:result.game.match.winner,firstConcurrent3,halls:[...halls.values()],events,samples}));
}
