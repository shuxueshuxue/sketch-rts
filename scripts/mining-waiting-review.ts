/** Real complete mining loops: starting workers, buildings, map terrain, and every-tick gold conservation. */
import { writeFileSync } from 'node:fs';
import { createGame, issuePlayerCommand, stepGame } from '../src/shared/sim.ts';
import { createUnit } from '../src/shared/map.ts';
import { MAP_POOL } from '../src/shared/map-pool.ts';
import { GOLD_MINE_RULES } from '../src/shared/mining.ts';
import { seconds } from '../src/shared/time.ts';
import type { MapId } from '../src/shared/types.ts';

const scenarios = ['verdantCrossroads', 'bareDuel', ...MAP_POOL.map(map => map.id), 'minimum-axis', 'minimum-diagonal', 'long-haul'];
const rows = [];
for (const scenario of scenarios) for (let count=1;count<=6;count++) {
  const map = (scenario.startsWith('minimum') || scenario==='long-haul' ? 'bareDuel' : scenario) as MapId;
  const seats=MAP_POOL.find(spec=>spec.id===map)?.players ?? 2;
  const game=createGame(map,{players:['player', ...Array.from({length:seats-1},(_,i)=>`enemy${i}`)],aiPlayers:[]});
  const hall=game.buildings.find(building=>building.owner==='player'&&building.kind==='townHall')!;
  const mine=game.resources.find(mine=>mine.id==='gold-player-main')!;
  if(scenario==='minimum-axis'||scenario==='minimum-diagonal'||scenario==='long-haul') {
    const angle=scenario==='minimum-diagonal'?Math.PI/4:0,range=scenario==='long-haul'?600:210;
    Object.assign(mine,{x:hall.x+Math.cos(angle)*range,y:hall.y+Math.sin(angle)*range});
  }
  const initial=game.units.filter(unit=>unit.owner==='player'&&unit.kind==='worker');
  game.units=Array.from({length:count},(_,i)=>initial[i]??createUnit(`extra-${i}`,'player','worker',hall.x+80,hall.y+50+(i-3)*20));
  const workers=game.units;
  game.players.player!.gold=0;mine.amount=100000;game.scriptedVictory=true;
  issuePlayerCommand(game,'player',{type:'mine',resourceId:mine.id,unitIds:workers.map(worker=>worker.id)});
  const stats=workers.map(worker=>({id:worker.id,delivered:0,waitTicks:0,maxWaitTicks:0,initialMaxWaitTicks:0,waiting:0,stuck:0,maxStuckTicks:0}));
  let startGold=0,conserved=true;
  for(let tick=0;tick<seconds(90);tick++) {
    const before=workers.map(worker=>({x:worker.x,y:worker.y,load:worker.carryingGold}));
    stepGame(game);
    const measured=tick>=seconds(30);
    if(tick===seconds(30)-1)startGold=game.players.player!.gold;
    for(let i=0;i<workers.length;i++) {
      const worker=workers[i]!,old=before[i]!,stat=stats[i]!;
      const stationary=Math.hypot(worker.x-old.x,worker.y-old.y)<.01;
      const queued=stationary&&worker.order.type==='mine'&&worker.order.phase==='toMine'&&Math.hypot(worker.x-mine.x,worker.y-mine.y)<=GOLD_MINE_RULES.entryRange;
      stat.waiting=queued?stat.waiting+1:0;
      if(measured){stat.waitTicks+=+queued;stat.maxWaitTicks=Math.max(stat.maxWaitTicks,stat.waiting);if(old.load>0&&worker.carryingGold===0)stat.delivered+=old.load;}
      else stat.initialMaxWaitTicks=Math.max(stat.initialMaxWaitTicks,stat.waiting);
      const stuck=stationary&&worker.order.type==='mine'&&worker.order.phase!=='gather'&&!queued;
      stat.stuck=stuck?stat.stuck+1:0;
      if(measured)stat.maxStuckTicks=Math.max(stat.maxStuckTicks,stat.stuck);
    }
    conserved&&=mine.amount+workers.reduce((sum,worker)=>sum+worker.carryingGold,0)+game.players.player!.gold===100000;
  }
  rows.push({scenario,count,distance:Math.hypot(hall.x-mine.x,hall.y-mine.y),goldPerMinute:game.players.player!.gold-startGold,conserved,
    maxSteadyWaitSeconds:Math.max(...stats.map(stat=>stat.maxWaitTicks))/20,meanWaitingWorkers:stats.reduce((sum,stat)=>sum+stat.waitTicks,0)/seconds(60),stats});
}
for(const repeat of [false,true]) {
  const game=createGame('bareDuel',{aiPlayers:[]});
  const workers=game.units.filter(unit=>unit.owner==='player'&&unit.kind==='worker');game.units=workers;
  const mine=game.resources.find(mine=>mine.id==='gold-player-main')!;mine.amount=100000;game.players.player!.gold=0;game.scriptedVictory=true;
  const command={type:'mine' as const,resourceId:mine.id,unitIds:workers.map(worker=>worker.id)};
  issuePlayerCommand(game,'player',command);
  for(let tick=0;tick<seconds(60);tick++){if(repeat&&tick%seconds(1)===0)issuePlayerCommand(game,'player',command);stepGame(game);}
  rows.push({scenario:repeat?'repeat-command':'no-repeat',count:3,goldPerMinute:game.players.player!.gold,conserved:mine.amount+workers.reduce((sum,worker)=>sum+worker.carryingGold,0)+game.players.player!.gold===100000});
}
if (rows.some(row => !row.conserved)) throw new Error('Mining gold was not conserved');
writeFileSync(process.argv[2] ?? 'work/mining-waiting-review.json',JSON.stringify({rules:GOLD_MINE_RULES,warmupSeconds:30,measuredSeconds:60,rows},null,2));
console.table(rows.map(row=>({scenario:row.scenario,count:row.count,gold:row.goldPerMinute,maxWait:'maxSteadyWaitSeconds' in row?row.maxSteadyWaitSeconds:undefined,waiting:'meanWaitingWorkers' in row?row.meanWaitingWorkers:undefined,conserved:row.conserved})));
