import { describe, expect, it } from 'vitest';
import { createGame, snapshotGame } from '../shared/sim';
import { boardUnit } from '../shared/decks';
import { createUnit } from '../shared/map';
import { cabinExitPoint } from '../shared/ship-cabin';
import { cabinAction, cabinCommand, cabinStatus } from './cabin-controls';

function scene() {
  const game=createGame('bareDuel',{aiPlayers:[]}); game.units=[]; delete game.map.terrain;
  const ship=game.spawnUnit('player','warship',800,800);
  const crew=game.spawnUnit('player','priest',800,800);
  expect(boardUnit(ship,crew,game.units)).toBe(true);
  return {game,ship,crew};
}

describe('manual cabin controls',()=>{
  it('orders a person already aboard to shelter, then returns sheltered people before sheltering a mixed selection',()=>{
    const {game,ship,crew}=scene(),other=game.spawnUnit('player','archer',800,800);
    expect(boardUnit(ship,other,game.units)).toBe(true);
    expect(cabinCommand(cabinAction(snapshotGame(game),'player',[crew]))).toEqual({type:'enterCabin',unitIds:[crew.id]});
    crew.cabin={shipId:ship.id};
    expect(cabinCommand(cabinAction(snapshotGame(game),'player',[crew,other]))).toEqual({type:'leaveCabin',unitIds:[crew.id]});
    expect(cabinStatus(crew,true)).toBe('舱内');
    crew.cabin.breached=true;
    expect(cabinStatus(crew,true)).toBe('舱室失守 · 等待出舱');
  });
  it('keeps a full or breached cabin action visible with a reason and sends no command',()=>{
    const {game,ship,crew}=scene();
    for(let i=0;i<2;i++){
      const inside=game.spawnUnit('player','archer',800,800);
      expect(boardUnit(ship,inside,game.units)).toBe(true);inside.cabin={shipId:ship.id};
    }
    const action=cabinAction(snapshotGame(game),'player',[crew]);
    expect(action).toMatchObject({type:'enterCabin',enabled:false,problem:'full'});
    expect(cabinCommand(action)).toBeUndefined();
    ship.shipParts!.cabin=0;
    expect(cabinAction(snapshotGame(game),'player',[crew])).toMatchObject({enabled:false,problem:'unavailable'});
  });
  it('does not shelter nearby shore units, an enemy selection or the ship itself',()=>{
    const {game,ship,crew}=scene(),shore=game.spawnUnit('player','priest',800,800);
    expect(cabinAction(snapshotGame(game),'player',[ship,shore])).toBeUndefined();
    crew.owner='enemy';
    expect(cabinAction(snapshotGame(game),'player',[crew])).toBeUndefined();
  });
  it('disables a manual return when the actual door is blocked, then enables it after space clears',()=>{
    const {game,ship,crew}=scene();crew.cabin={shipId:ship.id};
    const blockers:string[]=[];
    for(let i=0;i<60;i++){
      const blocker=createUnit(`block-${i}`,'player','priest',ship.x,ship.y),point=cabinExitPoint(game,ship,blocker);
      if(!point)break;
      blocker.deck={shipId:ship.id,...point};game.units.push(blocker);blockers.push(blocker.id);
    }
    expect(blockers.length).toBeGreaterThan(0);
    expect(cabinAction(snapshotGame(game),'player',[crew])).toMatchObject({type:'leaveCabin',enabled:false,problem:'blocked'});
    game.units=game.units.filter(unit=>!blockers.includes(unit.id));
    expect(cabinCommand(cabinAction(snapshotGame(game),'player',[crew]))).toEqual({type:'leaveCabin',unitIds:[crew.id]});
  });
});
