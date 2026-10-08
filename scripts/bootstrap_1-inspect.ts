import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { bootstrapGame, bootstrapMatches } from '../src/ai/bootstrap_1/benchmark';
import { runAiGameLoop } from '../src/ai/game-runner';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import type { BootstrapAiVersion, MapId } from '../src/shared/types';
const {values}=parseArgs({options:{map:{type:'string',default:'pineshade'},subject:{type:'string',default:'v9_summoner'},opponents:{type:'string',default:'v5+v7'},race:{type:'string',default:'grove'},side:{type:'string',default:'0'},out:{type:'string',default:'/tmp/bootstrap_1-trace.json'}}});
const match=bootstrapMatches('bootstrap_1-development',[values.map as MapId]).find(match=>match.subject===values.subject&&match.agents.p0!.race===values.race&&match.side===Number(values.side)&&Object.values(match.agents).slice(1).map(agent=>agent.version).join('+')===values.opponents)!;
const rows:unknown[]=[];
const memories=createAiMemoryProvider();
const commandPlanner:Parameters<typeof runAiGameLoop>[0]['commandPlanner']=({snapshot,owner,agent,source,teams})=>planAiOwnerCommandEntries(snapshot,{playerId:owner,version:agent.version,source},{teams,memoryProvider:memories});
const result=runAiGameLoop({...match,game:bootstrapGame(match),commandPlanner},{onStep:({game})=>{
  if(game.tick%1200!==0)return;
  const row={tick:game.tick,players:Object.fromEntries(Object.keys(match.agents).map(owner=>[owner,{policy:structuredClone(memories.get(owner)),gold:game.players[owner]!.gold,supply:game.players[owner]!.supplyUsed,cap:game.players[owner]!.supplyCap,upgrades:game.players[owner]!.upgrades,bases:game.buildings.filter(building=>building.owner===owner&&building.kind==='townHall').map(({id,x,y,hp,complete})=>({id,x,y,hp,complete})),units:game.units.filter(unit=>unit.owner===owner).map(({id,kind,x,y,hp,maxHp,order,cooldown})=>({id,kind,x,y,hp,maxHp,order,cooldown})),buildings:game.buildings.filter(building=>building.owner===owner).map(({id,kind,hp,complete,queue})=>({id,kind,hp,complete,queue}))}]))};
  rows.push(row); console.log(JSON.stringify({tick:game.tick,players:Object.fromEntries(Object.entries(row.players).map(([owner,player])=>[owner,{gold:player.gold,supply:player.supply,cap:player.cap,bases:player.bases.length,army:player.units.filter(unit=>unit.kind!=='worker').length}]))}));
}});
writeFileSync(values.out,JSON.stringify({subject:values.subject as BootstrapAiVersion,result:{tick:result.game.tick,winner:result.game.match.winner},rows})+'\n');
