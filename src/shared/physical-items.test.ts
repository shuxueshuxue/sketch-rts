import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame } from './sim';
import { exchangeRecipient,itemsFor } from './equipment';
import { deckPointFits,projectDeckPoint } from './decks';
import { localToWorld } from './ship-geometry';
import { installedWeapons } from './ship-equipment';
import { settleGroundItems } from './item-surfaces';
import { isGameCommand } from './command-schema';
import { dropItemCommand } from '../client/item-controls';
import type { WorldItem } from './types';
function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;game.map.width=1600;game.map.height=1600;game.map.terrain={cell:40,cols:40,rows:40,cells:Array.from({length:1600},(_,i)=>i%40<8?'.':i%40===8?',':'~').join('')};return game;}
describe('supported items and physical deck interaction',()=>{
  it('handles newly dropped land and water items after an empty actual simulation frame',()=>{
    const game=scene(),items=game.items;
    stepGame(game);
    expect(game.items).toBe(items);
    expect(game.items).toEqual([]);
    items.push({id:'new-land',kind:'shipCannon',x:100,y:100,cooldownRemaining:0},
      {id:'new-water',kind:'shipCannon',x:1000,y:1000,cooldownRemaining:0});
    stepGame(game);
    expect(game.items).toBe(items);
    expect(game.items.map(item=>item.id)).toEqual(['new-land']);
    stepGame(game);
    expect(game.items.map(item=>item.id)).toEqual(['new-land']);
  });
  it('destroys loose equipment in shallow and deep water, keeps land loot and moving deck objects',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',700,700);
    const item=(id:string,x:number,y:number):WorldItem=>({id,kind:'shipCannon',x,y,cooldownRemaining:0});
    game.items.push(item('land',100,100),item('shallow',340,100),item('deep',1000,100),item('deck',ship.x,ship.y));
    settleGroundItems(game.items,game.units,game.map);expect(game.items.map(i=>i.id)).toEqual(['land','deck']);
    const floor=game.items[1]!;expect(floor.deck?.shipId).toBe(ship.id);ship.x+=30;ship.sailing!.heading=.1;
    settleGroundItems(game.items,game.units,game.map);expect({x:floor.x,y:floor.y}).toEqual(localToWorld(ship,floor.deck!));
    ship.hp=0;settleGroundItems(game.items,game.units,game.map);expect(game.items.map(i=>i.id)).toEqual(['land']);
  });
  it('lets an empty ship mount, stow and discard its own gun overboard',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',700,700),gun=installedWeapons(game,ship)[0]!;
    issuePlayerCommand(game,'player',{type:'transferItem',itemId:gun.id,destination:{shipId:ship.id,slot:0}});
    const mount={type:'transferItem',itemId:gun.id,destination:{shipId:ship.id,mountId:'bow'}} as const;
    expect(isGameCommand(mount)).toBe(true);issuePlayerCommand(game,'player',mount);
    issuePlayerCommand(game,'player',dropItemCommand(gun,ship,game.units));expect(game.items.some(item=>item.id===gun.id)).toBe(false);
    expect(installedWeapons(game,ship)).toEqual([]);stepGame(game);expect(game.items.some(item=>item.id===gun.id)).toBe(false);
  });
  it('allows hauling a cannon but rejects wielding it, including old save hand state',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',700,700),worker=game.spawnUnit('player','worker',280,700),gun=installedWeapons(game,ship)[0]!;worker.x=660;worker.y=700;
    issuePlayerCommand(game,'player',{type:'transferItem',itemId:gun.id,destination:{unitId:worker.id,slot:'carry0'}});
    expect(itemsFor(game,worker)).toHaveLength(1);
    for(const hand of ['right','left'] as const)expect(()=>issuePlayerCommand(game,'player',{type:'wieldItem',unitId:worker.id,itemId:gun.id,hand})).toThrow(/ship fitting/);
    worker.hands={right:gun.id};restoreSnapshotIntoGame(game,snapshotGame(game),game.nextId);
    expect(game.units.find(unit=>unit.id===worker.id)!.hands?.right).toBeUndefined();expect(game.items.find(item=>item.id===gun.id)?.carrierId).toBe(worker.id);
  });
  it('selects an available nearby recipient when the preferred unit is too far away',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',700,700),far=game.spawnUnit('player','worker',1300,700),near=game.spawnUnit('player','worker',280,700);
    near.x=680;near.y=700;expect(exchangeRecipient(game,'player',ship,'shipCannon',far.id)?.id).toBe(near.id);
    near.hp=0;expect(exchangeRecipient(game,'player',ship,'shipCannon',far.id)).toBeUndefined();
  });
  it('projects crew drag outside every deck edge into legal floor space',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',700,700),worker=game.spawnUnit('player','worker',700,700);
    for(const point of [{x:1000,y:0},{x:-1000,y:0},{x:0,y:1000},{x:0,y:-1000}]){
      const projected=projectDeckPoint(ship,worker,point,game.units);expect(projected).toBeDefined();expect(deckPointFits(ship,worker,projected!,game.units)).toBe(true);
      expect(Math.hypot(projected!.x,projected!.y)).toBeGreaterThan(15);
    }
  });
});
