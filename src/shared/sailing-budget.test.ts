import { describe, expect, it } from 'vitest';
import { hullFits } from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { turnShipToward } from './sailing';
import { shipMotionLimits } from './ship-motion';
import { SIM_TICKS_PER_SECOND } from './time';
import { headingDifference } from './ship-navigation';
import { hullContact } from './ship-geometry';

function fleet() {
  const game=createGame('bareDuel',{players:['player','enemy'],aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.mercenaryCamps=[];game.scriptedVictory=true;
  game.map={...game.map,width:8192,height:8192,wind:{direction:Math.PI/2,speed:80},
    terrain:{cols:128,rows:128,cell:64,cells:'~'.repeat(128*128)}};
  const ships=Array.from({length:4},(_,index)=>game.spawnUnit('player','warship',1800,3000+index*700));
  for(const ship of ships){
    ship.sailing!.heading=Math.PI/2;
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:6500,y:ship.y,avoidCombat:true});
  }
  return {game,ships};
}

describe('scheduled sailing through the simulation',()=>{
  it('starts all turning voyages in a bounded number of ticks without losing the actual destination',()=>{
    const {game,ships}=fleet();
    stepGame(game);
    expect(ships.filter(ship=>ship.sailing!.route)).toHaveLength(1);
    expect(ships.filter(ship=>ship.sailing!.planningRequestedAtTick!==undefined)).toHaveLength(3);
    for(let tick=1;tick<ships.length;tick++)stepGame(game);
    for(const ship of ships){
      expect(ship.sailing!.route).toMatchObject({goalX:6500,goalY:ship.order.type==='move'?ship.order.y:NaN});
      expect(ship.sailing!.planningRequestedAtTick).toBeUndefined();
      expect(hullFits(game.map,ship)).toBe(true);
    }
  });

  it('replays every pending request identically after a JSON snapshot restore',()=>{
    const {game}=fleet();stepGame(game);
    const restored=fleet().game;
    restoreSnapshotIntoGame(restored,JSON.parse(JSON.stringify(snapshotGame(game))),game.nextId);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for(let tick=0;tick<120;tick++){
      stepGame(game);stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
  });

  it('follows a close aligned leader without detouring and restores its real headway',()=>{
    const {game}=fleet();game.units=[];game.items=[];
    const ships=[game.spawnUnit('player','shipOfTheLine',2600,4000),
      game.spawnUnit('player','transport',2210,4000),game.spawnUnit('player','shipOfTheLine',1820,4000)];
    for(const ship of ships)issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:6500,y:4000,avoidCombat:true});
    const starts=ships.map(ship=>ship.x);
    stepGame(game);
    const restored=fleet().game;
    restoreSnapshotIntoGame(restored,JSON.parse(JSON.stringify(snapshotGame(game))),game.nextId);
    for(let tick=0;tick<240;tick++){
      stepGame(game);stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
      for(const ship of ships){
        expect(Math.abs(ship.y-4000),ship.id).toBeLessThan(1);
        expect(ship.hp,ship.id).toBe(ship.maxHp);
        expect(hullFits(game.map,ship),ship.id).toBe(true);
      }
      for(let a=0;a<ships.length;a++)for(let b=a+1;b<ships.length;b++)
        expect(hullContact(ships[a]!,ships[b]!)?.overlap??0).toBeLessThan(.1);
    }
    ships.forEach((ship,index)=>expect(ship.x-starts[index]!,ship.id).toBeGreaterThan(100));
  });

  it('safely pre-turns a deferred initial pursuit within one frame’s yaw allowance and restores its wait',()=>{
    const {game}=fleet();game.units=[];game.items=[];
    const target=game.spawnUnit('enemy','shipOfTheLine',6000,4000),ships=[
      game.spawnUnit('player','shipOfTheLine',1800,3000),game.spawnUnit('player','shipOfTheLine',1800,5000)];
    target.order={type:'hold',x:target.x,y:target.y};
    for(const ship of ships){
      ship.sailing!.heading=Math.PI/2;
      issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:target.id});
    }
    const waiting=ships[1]!,before={x:waiting.x,y:waiting.y,heading:waiting.sailing!.heading};
    stepGame(game);
    expect(ships[0]!.sailing!.route).toBeDefined();expect(waiting.sailing!.route).toBeUndefined();
    expect(waiting.sailing!.planningRequestedAtTick).toBe(game.tick);
    expect({x:waiting.x,y:waiting.y}).toEqual({x:before.x,y:before.y});
    const yaw=headingDifference(before.heading,waiting.sailing!.heading);
    expect(yaw).toBeLessThan(0);expect(Math.abs(yaw)).toBeLessThanOrEqual(shipMotionLimits(waiting).turnRate/SIM_TICKS_PER_SECOND+1e-7);
    const after=waiting.sailing!.heading;
    turnShipToward(waiting,0,game.map,game.units);
    expect(waiting.sailing!.heading).toBe(after);
    expect(hullFits(game.map,waiting)).toBe(true);
    const restored=fleet().game;
    restoreSnapshotIntoGame(restored,JSON.parse(JSON.stringify(snapshotGame(game))),game.nextId);
    for(let tick=0;tick<80;tick++){
      stepGame(game);stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(waiting.sailing!.route).toBeDefined();expect(waiting.sailing!.planningRequestedAtTick).toBeUndefined();
  });

  it('does not pre-turn a rooted ship while its first attack station waits',()=>{
    const {game,ships}=fleet();
    const waiting=ships[1]!,target=game.spawnUnit('enemy','shipOfTheLine',6000,4000);
    target.order={type:'hold',x:target.x,y:target.y};
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[waiting.id],targetId:target.id});
    waiting.effects.push({type:'root',remaining:100});
    const before={x:waiting.x,y:waiting.y,heading:waiting.sailing!.heading};
    stepGame(game);
    expect(waiting.sailing!.planningRequestedAtTick).toBe(game.tick);
    expect(waiting.sailing!.route).toBeUndefined();
    expect({x:waiting.x,y:waiting.y,heading:waiting.sailing!.heading}).toEqual(before);
    expect(waiting.sailing!.speed).toBe(0);
  });

  it('uses a replacement destination and releases a cancelled queued ship',()=>{
    const {game,ships}=fleet();stepGame(game);
    const cancelled=ships[1]!,redirected=ships[2]!;
    issuePlayerCommand(game,'player',{type:'stop',unitIds:[cancelled.id]});
    issuePlayerCommand(game,'player',{type:'move',unitIds:[redirected.id],x:5500,y:6000,avoidCombat:true});
    for(let tick=0;tick<ships.length;tick++)stepGame(game);
    expect(cancelled.sailing!.planningRequestedAtTick).toBeUndefined();
    expect(cancelled.sailing!.planningLastRequestedAtTick).toBeUndefined();
    expect(redirected.sailing!.route).toMatchObject({goalX:5500,goalY:6000});
    expect(ships[3]!.sailing!.route).toBeDefined();
  });

  it('sails towards a distant manual aim point which requires a real ahead turn',()=>{
    const {game}=fleet();game.units=[];
    const ship=game.spawnUnit('player','cutter',1800,4500);ship.sailing!.heading=Math.PI/2;
    issuePlayerCommand(game,'player',{type:'aim',unitIds:[ship.id],x:6500,y:ship.y});
    const origin={x:ship.x,y:ship.y};
    for(let tick=0;tick<40;tick++)stepGame(game);
    expect(ship.order.type).toBe('aim');
    expect(ship.sailing!.route).toMatchObject({goalX:6500,goalY:origin.y});
    expect(Math.hypot(ship.x-origin.x,ship.y-origin.y)).toBeGreaterThan(10);
    expect(hullFits(game.map,ship)).toBe(true);
  });

  it('sails a fire ship into range of a distant point skill instead of rejecting its plan',()=>{
    const {game}=fleet();game.units=[];
    const ship=game.spawnUnit('player','fireShip',1800,4500);ship.sailing!.heading=Math.PI/2;
    issuePlayerCommand(game,'player',{type:'cast',unitId:ship.id,ability:'incendiaryFlume',x:6500,y:4500});
    for(let tick=0;tick<40;tick++)stepGame(game);
    expect(ship.order.type).toBe('cast');
    expect(ship.sailing!.route).toMatchObject({goalX:6500,goalY:4500});
    expect(Math.hypot(ship.x-1800,ship.y-4500)).toBeGreaterThan(10);
    expect(hullFits(game.map,ship)).toBe(true);
  });

  it('keeps a queued corner while an adverse wind plan waits, then restores that wait identically',()=>{
    const {game}=fleet();game.units=[];game.map.wind={direction:Math.PI/4,speed:80};
    const boat=game.spawnUnit('player','transport',1600,1800);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[boat.id],x:4000,y:1800,avoidCombat:true});
    issuePlayerCommand(game,'player',{type:'move',unitIds:[boat.id],x:4000,y:5500,avoidCombat:true,queued:true});
    stepGame(game);
    const course=boat.sailing!.route!;
    expect(course.queuedX).toBe(4000);
    const blocker=game.spawnUnit('player','warship',1800,6500);blocker.sailing!.heading=Math.PI/2;
    issuePlayerCommand(game,'player',{type:'move',unitIds:[blocker.id],x:6500,y:6500,avoidCombat:true});
    blocker.sailing!.planningRequestedAtTick=game.tick;
    blocker.sailing!.planningLastRequestedAtTick=game.tick;
    game.units=[blocker,boat];game.map.wind={direction:Math.PI,speed:80};
    stepGame(game);
    expect(boat.sailing!.route).toBe(course);
    expect(boat.sailing!.planningRequestedAtTick).toBeDefined();
    expect(boat.orderQueue).toHaveLength(1);
    const restored=fleet().game;
    restoreSnapshotIntoGame(restored,JSON.parse(JSON.stringify(snapshotGame(game))),game.nextId);
    for(let tick=0;tick<30;tick++){
      stepGame(game);stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(boat.sailing!.planningRequestedAtTick).toBeUndefined();
    expect(boat.orderQueue).toHaveLength(1);
    expect(hullFits(game.map,boat)).toBe(true);
  });
});
