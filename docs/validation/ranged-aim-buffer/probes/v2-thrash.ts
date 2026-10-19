import { createGame, stepGame } from '../../../../src/shared/sim.ts';
import { createAiRuntime, planPresetAiRuntimeCommands } from '../../../../src/ai/runtime.ts';
import { SdkCommandFrameRuntime } from '../../../../src/sdk/commands/frame.ts';
const game=createGame('ladder',{aiPlayers:['player','enemy']}),runtime=createAiRuntime(['player','enemy']);
const last=new Map<string,{tick:number;script:string;order:string}>(),counts:Record<string,number>={},examples:any[]=[];
for(let tick=0;tick<60000;tick++){
 const planned=planPresetAiRuntimeCommands(game,runtime);
 new SdkCommandFrameRuntime(game).issue(planned.commands,{afterIssue(entry){
  if(!('unitIds' in entry.command)||entry.command.queued)return;
  for(const id of entry.command.unitIds){
   const unit=game.units.find(u=>u.id===id);if(!unit)continue;
   const prev=last.get(id),order=JSON.stringify(unit.order);
   if(tick>=30000&&prev&&tick-prev.tick<=60&&order!==prev.order&&prev.script!==entry.scriptId
      &&[prev.script,entry.scriptId].every(s=>['attackWave','skirmishPreservation'].includes(s))
      &&![...game.units,...game.buildings].some(foe=>foe.hp>0&&foe.owner!==unit.owner&&(foe.owner==='neutral'||game.teams[foe.owner]!==game.teams[unit.owner])&&Math.hypot(foe.x-unit.x,foe.y-unit.y)<=600)) {
    const key=`${prev.script}->${entry.scriptId}`;counts[key]=(counts[key]??0)+1;
    if(examples.length<20)examples.push({tick,unit:id,owner:unit.owner,deltaTicks:tick-prev.tick,previous:prev,order:unit.order,x:unit.x,y:unit.y});
   }
   if(order!==prev?.order)last.set(id,{tick,script:entry.scriptId,order});
  }
 }},{checksum:false});stepGame(game);
}
console.log(JSON.stringify({rule:7,version:runtime.version,tick:game.tick,winner:game.match.winner,window:[30000,60000],enemyRadius:600,maxOverrideTicks:60,counts,examples},null,2));
