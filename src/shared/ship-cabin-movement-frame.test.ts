import { describe, expect, it } from 'vitest';
import { boardUnit, deckPointFits } from './decks';
import { installedWeapons, rebuildShipFittings, shipMounts, SHIP_WEAPONS } from './ship-equipment';
import { cabinCrewMovedThisTick, enterCabinStep, isInCabin } from './ship-cabin';
import { createGame, issuePlayerCommand } from './sim';
import { perTick } from './time';

describe('read-only cabin movement allowance',()=>{
  it('preserves real courtesy walking while other tick and unit-array queries leave its spent allowance intact',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});
    game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
    game.map.width=game.map.height=4000;
    game.map.terrain={cell:40,cols:100,rows:100,cells:'~'.repeat(10000)};
    const ship=game.spawnUnit('player','shipOfTheLine',1600,1600);
    for(const mount of shipMounts(ship))if(!installedWeapons(game,ship).some(item=>item.mountId===mount.id))game.items.push({
      id:`courtesy-${mount.id}`,kind:'shipCannon',x:ship.x,y:ship.y,shipId:ship.id,mountId:mount.id,
      durability:SHIP_WEAPONS.shipCannon.hp,cooldownRemaining:0,
    });
    rebuildShipFittings(game,ship);
    expect(installedWeapons(game,ship)).toHaveLength(8);
    const priest=game.spawnUnit('player','priest',ship.x,ship.y),companion=game.spawnUnit('player','footman',ship.x,ship.y);
    expect(boardUnit(ship,priest,game.units)).toBe(true);expect(boardUnit(ship,companion,game.units)).toBe(true);
    expect(cabinCrewMovedThisTick(game,companion)).toBe(false);
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[priest.id]});

    let yielded=false;
    for(let tick=1;tick<=200&&!yielded;tick++) {
      game.tick=tick;
      const before={...companion.deck!};
      enterCabinStep(game,priest);
      const distance=Math.hypot(companion.deck!.x-before.x,companion.deck!.y-before.y);
      if(distance<=1e-7)continue;
      yielded=true;
      expect(distance).toBeLessThanOrEqual(perTick(companion.speed)+1e-6);
      expect(companion.order).toEqual({type:'idle'});expect(isInCabin(companion)).toBe(false);
      expect(deckPointFits(ship,companion,companion.deck!,game.units)).toBe(true);
      expect(cabinCrewMovedThisTick(game,companion)).toBe(true);
      for(const tick of [game.tick+1,game.tick-1,undefined]) {
        expect(cabinCrewMovedThisTick({units:game.units,teams:game.teams,...(tick===undefined?{}:{tick})},companion)).toBe(false);
        expect(cabinCrewMovedThisTick(game,companion),'a read for another tick must not replace the actual walking frame').toBe(true);
      }
      expect(cabinCrewMovedThisTick({...game,units:[...game.units]},companion)).toBe(false);
      expect(cabinCrewMovedThisTick(game,companion)).toBe(true);
      const after={...companion.deck!};
      enterCabinStep(game,priest);
      expect(companion.deck,'courtesy cannot walk the same idle crew twice in one tick').toEqual(after);
      game.tick++;
      expect(cabinCrewMovedThisTick(game,companion),'last tick movement does not spend this tick allowance').toBe(false);
    }
    expect(yielded,'the actual idle body must walk aside at the eight-gun hatch approach').toBe(true);
  });
});
