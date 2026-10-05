import { describe, expect, it } from 'vitest';
import { createGame, issueCommand, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from './sim';
import { BUILDING_DEFS, UNIT_DEFS } from './catalog';
import { createBuilding } from './map';

function setup() {
  const game=createGame('bareDuel'); game.scriptedVictory=true;
  const worker=game.units.find(u=>u.owner==='player' && u.kind==='worker')!;
  game.units=[worker]; game.players.player.gold=1000;
  const order={type:'build',unitId:worker.id,buildingKind:'farm',x:worker.x+350,y:worker.y} as const;
  return {game,worker,order};
}
const advance=(game:ReturnType<typeof createGame>,n=400)=>{for(let i=0;i<n;i++)stepGame(game);};
describe('construction intents',()=>{
  it('has no entity, payment, collision body or remote HP until the worker arrives',()=>{
    const {game,worker,order}=setup();const count=game.buildings.length;
    issueCommand(game,order);expect(worker.order.type).toBe('build');
    expect(game.buildings).toHaveLength(count);expect(game.players.player.gold).toBe(1000);
    advance(game);expect(game.buildings).toHaveLength(count+1);
    expect(game.players.player.gold).toBe(1000-BUILDING_DEFS.farm.cost);
  });
  it('leaves nothing behind when stopped or killed on the way',()=>{
    for(const die of [false,true]){
      const {game,worker,order}=setup();const count=game.buildings.length;issueCommand(game,order);
      if(die) game.units=[];else issueCommand(game,{type:'stop',unitIds:[worker.id]});
      advance(game);expect(game.buildings).toHaveLength(count);expect(game.players.player.gold).toBe(1000);
    }
  });
  it('rechecks occupancy and waits for funds without making a vulnerable placeholder',()=>{
    const {game,worker,order}=setup();issueCommand(game,order);
    const plan=worker.order; if(plan.type!=='build') throw Error('missing plan');
    game.players.player.gold=0;advance(game);expect(worker.order.type).toBe('build');
    expect(game.buildings.some(b=>b.kind==='farm')).toBe(false);
    game.buildings.push(createBuilding('occupied','enemy','farm',plan.x,plan.y,true));
    game.players.player.gold=1000;advance(game,2);
    expect(worker.order.type).toBe('idle');expect(game.buildings.filter(b=>b.kind==='farm')).toHaveLength(1);
    expect(game.players.player.gold).toBe(1000);
  });
  it('restores a travelling plan deterministically',()=>{
    const {game,order}=setup();issueCommand(game,order);advance(game,10);
    const restored=createGame('bareDuel');restored.scriptedVictory=true;
    restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    advance(game);advance(restored);expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  });
});
describe('training cancellation',()=>{
  it('refunds the clicked job, frees supply, rejects foreign ownership and tolerates repeated clicks',()=>{
    const game=createGame('bareDuel');game.players.player.gold=1000;
    const hall=game.buildings.find(b=>b.owner==='player' && b.kind==='townHall')!;
    const initialSupply=game.players.player.supplyUsed;
    for(let i=0;i<2;i++) issueCommand(game,{type:'train',buildingId:hall.id,unitKind:'worker'});
    const first=hall.queue[0]!.id!,second=hall.queue[1]!.id!;
    expect(first).not.toBe(second);
    const cancel={type:'cancelTraining',buildingId:hall.id,jobId:second} as const;
    expect(()=>issuePlayerCommand(game,'enemy',cancel)).toThrow();
    issueCommand(game,cancel);issueCommand(game,cancel);
    expect(hall.queue.map(j=>j.id)).toEqual([first]);
    expect(game.players.player.gold).toBe(1000-UNIT_DEFS.worker.cost);
    expect(game.players.player.supplyUsed).toBe(initialSupply+UNIT_DEFS.worker.supplyUsed);
    advance(game,1);issueCommand(game,{...cancel,jobId:first});
    expect(game.players.player.gold).toBe(1000);expect(hall.queue).toHaveLength(0);
  });
});
