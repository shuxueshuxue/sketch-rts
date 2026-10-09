import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame } from '../shared/sim';
import { boardUnit, deckPointFits, syncDecks } from '../shared/decks';
import { createUnit } from '../shared/map';
import { cabinExitPoint, cabinSpaceRequired, shipCabinCapacity, shipCabinUsage } from '../shared/ship-cabin';
import { resolveVariant } from '../shared/catalog';
import { beginShipBoarding, GANGWAY_SETUP_TICKS, updateShipGangways } from '../shared/ship-gangway';
import { shipProfile } from '../shared/ship-geometry';
import { walkConnectedSurfaces } from '../shared/connected-decks';
import { cabinAction, cabinCommand, cabinProblemText, cabinQuotaText, cabinStatus } from './cabin-controls';

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
    const occupantSpace=cabinSpaceRequired(game,createUnit('sizing-crew','player','archer',800,800));
    while(shipCabinUsage(game,ship).free>=occupantSpace){
      const inside=game.spawnUnit('player','archer',800,800);
      expect(boardUnit(ship,inside,game.units)).toBe(true);inside.cabin={shipId:ship.id};
    }
    expect(shipCabinUsage(game,ship).overCapacity).toBe(0);
    expect(shipCabinUsage(game,ship).free).toBeLessThan(cabinSpaceRequired(game,crew));
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
  it('shows used body space and the selected cost, with a capacity reason even before the cabin is completely full',()=>{
    const {game,ship,crew}=scene();
    const capacity=shipCabinCapacity(ship),required=capacity-1;
    game.variants={heavyCrew:resolveVariant({base:'priest',supplyUsed:required})};
    crew.variant='heavyCrew';
    const sheltered=game.spawnUnit('player','priest',800,800);
    expect(boardUnit(ship,sheltered,game.units)).toBe(true);sheltered.cabin={shipId:ship.id};
    const action=cabinAction(snapshotGame(game),'player',[crew])!;
    const used=cabinSpaceRequired(game,sheltered);
    expect(cabinSpaceRequired(game,crew)).toBe(required);
    expect(action).toMatchObject({enabled:false,problem:'full',quota:{used,capacity,required}});
    expect(cabinQuotaText(action.quota!,true,true)).toBe(`舱容 ${used} / ${capacity} · 选中需 ${required}`);
    expect(cabinQuotaText(action.quota!,false,true)).toBe(`Cabin capacity ${used} / ${capacity} · Selected need ${required}`);
    expect(cabinProblemText(action,true)).toBe('舱容不足');expect(cabinCommand(action)).toBeUndefined();
  });
  it('reserves a mixed selection against each hull budget instead of enabling every individually fitting person',()=>{
    const {game,ship,crew}=scene();
    const second=game.spawnUnit('player','priest',800,800),third=game.spawnUnit('player','priest',800,800);
    const capacity=shipCabinCapacity(ship),companionSpace=cabinSpaceRequired(game,second);
    game.variants={heavyCrew:resolveVariant({base:'priest',supplyUsed:capacity-companionSpace})};crew.variant='heavyCrew';
    expect(boardUnit(ship,second,game.units)).toBe(true);expect(boardUnit(ship,third,game.units)).toBe(true);
    const action=cabinAction(snapshotGame(game),'player',[crew,second,third])!;
    expect(action.quota).toEqual({used:0,capacity,required:capacity+companionSpace});
    const command=cabinCommand(action)!;
    expect(command).toEqual({type:'enterCabin',unitIds:[crew.id,second.id]});
    issuePlayerCommand(game,'player',command);
    expect(crew.order.type).toBe('enterCabin');expect(second.order.type).toBe('enterCabin');
    expect(third.order.type).toBe('idle');
  });
  it('asks a bridge walker to return to the deck, then enables shelter after the actual walk back',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];
    game.map={...game.map,width:4096,height:4096,terrain:{cell:32,cols:128,rows:128,cells:'~'.repeat(128*128)}};
    const ship=game.spawnUnit('player','transport',1500,1500),target=game.spawnUnit('player','transport',1500,1900);
    target.y=ship.y+(shipProfile(ship)!.beam+shipProfile(target)!.beam)/2+12;
    const crew=game.spawnUnit('player','priest',ship.x,ship.y);
    expect(boardUnit(ship,crew,game.units)).toBe(true);syncDecks(game.units);
    const deckStart={x:crew.x,y:crew.y};
    expect(cabinAction(game,'player',[crew])?.enabled).toBe(true);
    ship.order={type:'boardShip',targetId:target.id};
    expect(beginShipBoarding(game.map,game.units,ship,target,game.tick,game)).toBe(true);
    updateShipGangways(game.map,game.units,game.tick,game);
    updateShipGangways(game.map,game.units,game.tick+GANGWAY_SETUP_TICKS,game);
    for(let i=0;i<300&&!crew.gangway;i++)walkConnectedSurfaces(crew,{x:target.x+60,y:target.y},game.units,game.map);
    expect(crew.gangway).toBeDefined();
    const action=cabinAction(game,'player',[crew])!;
    expect(action).toMatchObject({type:'enterCabin',enabled:false,problem:'crossing'});
    expect(cabinCommand(action)).toBeUndefined();
    expect(cabinProblemText(action,true)).toBe('先返回甲板');
    expect(cabinProblemText(action,false)).toBe('Return to the deck first');
    for(let i=0;i<300&&(crew.gangway||!deckPointFits(ship,crew,crew.deck!,game.units,false));i++)
      walkConnectedSurfaces(crew,deckStart,game.units,game.map);
    expect(crew.gangway).toBeUndefined();expect(crew.deck?.shipId).toBe(ship.id);
    expect(cabinCommand(cabinAction(game,'player',[crew]))).toEqual({type:'enterCabin',unitIds:[crew.id]});
  });
});
