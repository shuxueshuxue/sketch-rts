import { describe,expect,it } from 'vitest';
import { beginShipBoarding,bindGangwayCrewRules,cancelShipBoarding,damageShipGangway,gangwaySurface,GANGWAY_COOLDOWN_TICKS,GANGWAY_SETUP_TICKS,shipBoardingRefusal,updateShipGangways } from './ship-gangway';
import { decksAllowCrossing,decksCanTransfer,walkConnectedSurfaces } from './connected-decks';
import { boardUnit,canBoard,deckPointFits,settleGangwayCrossings,syncDecks } from './decks';
import { createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame } from './sim';
import { shipProfile } from './ship-geometry';
import { seconds } from './time';
import { checksumGame } from './sim/checksum';
import { boardingHoldShips,prepareCrewRendezvous } from './crew-rendezvous';
import { resolveVariant } from './catalog';
import { canReach } from './naval';
import { createSnapshotQuery } from '../sdk/snapshot/query';

function scene() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=3200;game.map.height=2400;game.map.terrain={cell:40,cols:80,rows:60,cells:'~'.repeat(4800)};
  return game;
}
function pair(owner:'player'|'enemy'='enemy') {
  const game=scene(),source=game.spawnUnit('player','transport',1000,1000),target=game.spawnUnit(owner,'transport',1000,1300),crew=game.spawnUnit('player','footman',1000,1000);
  target.y=source.y+(shipProfile(source)!.beam+shipProfile(target)!.beam)/2+12;
  expect(boardUnit(source,crew,game.units)).toBe(true);syncDecks(game.units);
  source.order={type:'boardShip',targetId:target.id};
  return {game,source,target,crew};
}
function deploy(fixture:ReturnType<typeof pair>) {
  const {game,source,target}=fixture;
  expect(beginShipBoarding(game.map,game.units,source,target,game.tick,game)).toBe(true);
  updateShipGangways(game.map,game.units,game.tick,game);
  expect(source.sailing!.gangway?.phase).toBe('deploying');
  updateShipGangways(game.map,game.units,GANGWAY_SETUP_TICKS,game);
  expect(source.sailing!.gangway?.phase).toBe('ready');
}
describe('short physical gangways',()=>{
  it('takes three seconds to create an infantry floor across a real water gap',()=>{
    const fixture=pair(),{game,source,target,crew}=fixture;
    expect(decksAllowCrossing(source,target,crew)).toBe(false);
    expect(beginShipBoarding(game.map,game.units,source,target,0,game)).toBe(true);
    updateShipGangways(game.map,game.units,0,game);
    expect(gangwaySurface(source,target)?.phase).toBe('deploying');
    expect(decksCanTransfer(source,target,crew)).toBe(false);
    updateShipGangways(game.map,game.units,GANGWAY_SETUP_TICKS-1,game);
    expect(decksCanTransfer(source,target,crew)).toBe(false);
    updateShipGangways(game.map,game.units,GANGWAY_SETUP_TICKS,game);
    expect(decksCanTransfer(source,target,crew)).toBe(true);
    let crossedGap=false;
    for(let i=0;i<seconds(12);i++) {
      walkConnectedSurfaces(crew,{x:target.x+60,y:target.y},game.units,game.map);
      crossedGap ||= !!crew.gangway;
      syncDecks(game.units);
    }
    expect(crossedGap).toBe(true);expect(crew.gangway).toBeUndefined();
    expect(crew.deck?.shipId).toBe(target.id);expect(deckPointFits(target,crew,crew.deck!,game.units)).toBe(true);
  });
  it('interrupts setup when an enemy leaves and retains the deployment cooldown',()=>{
    const {game,source,target}=pair();
    expect(beginShipBoarding(game.map,game.units,source,target,0,game)).toBe(true);
    updateShipGangways(game.map,game.units,0,game);
    target.order={type:'move',x:target.x+400,y:target.y};
    const order=structuredClone(target.order);
    Object.assign(target.sailing!,{speed:40,velocityX:40,velocityY:0});
    updateShipGangways(game.map,game.units,1,game);
    expect(source.sailing!.gangway).toBeUndefined();expect(target.order).toEqual(order);
    expect(source.sailing!.gangwayCooldownUntilTick).toBe(GANGWAY_COOLDOWN_TICKS);
    expect(shipBoardingRefusal(source,game.units,1,game)).toBe('cooldown');
    expect(shipBoardingRefusal(source,game.units,GANGWAY_COOLDOWN_TICKS,game)).toBeUndefined();
  });
  it('holds only the bridge source and keeps crew transfer from replanning physical contact',()=>{
    const fixture=pair(),{game,source,target,crew}=fixture;deploy(fixture);
    source.order={type:'idle'};target.order={type:'attack',targetId:source.id};
    crew.order={type:'board',transportId:target.id};
    expect([...boardingHoldShips(game.units)]).toEqual([source.id]);
    prepareCrewRendezvous(game.map,game.units);
    expect(source.order.type).toBe('idle');expect(target.order).toEqual({type:'attack',targetId:source.id});
    expect(source.sailing!.gangway?.phase).toBe('ready');
  });
  it('approaches a defender blocking the bridge exit without walking through its body',()=>{
    const fixture=pair(),{game,source,target,crew}=fixture,defender=game.spawnUnit('enemy','footman',target.x,target.y);
    expect(boardUnit(target,defender,game.units)).toBe(true);syncDecks(game.units);deploy(fixture);
    const before={x:crew.x,y:crew.y};
    for(let i=0;i<seconds(10);i++)walkConnectedSurfaces(crew,{x:target.x+60,y:target.y},game.units,game.map);
    expect(Math.hypot(crew.x-before.x,crew.y-before.y)).toBeGreaterThan(20);
    expect(Math.hypot(crew.x-defender.x,crew.y-defender.y)).toBeLessThan(crew.attackRange);
    expect(Math.hypot(crew.x-defender.x,crew.y-defender.y)).toBeGreaterThanOrEqual(crew.radius+defender.radius+1-1e-6);
    expect(crew.deck?.shipId).toBe(source.id);expect(crew.hp).toBe(crew.maxHp);
  });
  it('checks relative travel and yaw without refusing a fast but valid approach plan',()=>{
    const {game,source,target}=pair();
    Object.assign(source.sailing!,{speed:40,velocityX:40,velocityY:0});
    expect(beginShipBoarding(game.map,game.units,source,target,0,game)).toBe(true);
    updateShipGangways(game.map,game.units,0,game);expect(source.sailing!.gangway?.phase).toBe('approach');
    for(const ship of [source,target])Object.assign(ship.sailing!,{speed:30,velocityX:30,velocityY:0});
    updateShipGangways(game.map,game.units,1,game);expect(source.sailing!.gangway?.phase).toBe('deploying');
    Object.assign(source.sailing!,{speed:0,velocityX:0,velocityY:0,yawRate:.5});
    Object.assign(target.sailing!,{speed:0,velocityX:0,velocityY:0});
    expect(gangwaySurface(source,target)).toBeUndefined();
    updateShipGangways(game.map,game.units,2,game);expect(source.sailing!.gangway).toBeUndefined();
  });
  it('admits infantry-sized walking bodies and rejects oversized or sheltered crew',()=>{
    const fixture=pair(),{game,source,target,crew}=fixture;deploy(fixture);
    const large=game.spawnUnit('player','ogreWarrior',source.x,source.y);expect(boardUnit(source,large,game.units)).toBe(true);
    expect(large.radius).toBeGreaterThan(20);expect(decksCanTransfer(source,target,large)).toBe(false);
    crew.cabin={shipId:source.id};expect(decksCanTransfer(source,target,crew)).toBe(false);
  });
  it('uses the sloped bridge instead of a body-height step limit for a smaller walker',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',1000,1000),target=game.spawnUnit('player','carrier',1000,1300),crew=game.spawnUnit('player','worker',1000,1000);
    source.deckScale=2.2;source.radius*=2;
    crew.radius=10;crew.bodyRadius=10;
    target.y=source.y+(shipProfile(source)!.beam+shipProfile(target)!.beam)/2+12;
    expect(boardUnit(source,crew,game.units)).toBe(true);syncDecks(game.units);source.order={type:'boardShip',targetId:target.id};
    expect(canBoard(target,crew,game.units)).toBe(false);
    deploy({game,source,target,crew});
    expect(canBoard(target,crew,game.units)).toBe(true);
  });
  it('carries a gap walker between both moving endpoints and safely settles only that walker on break',()=>{
    const fixture=pair(),{game,source,target,crew}=fixture;deploy(fixture);
    for(let i=0;i<seconds(10)&&!crew.gangway;i++)walkConnectedSurfaces(crew,{x:target.x+60,y:target.y},game.units,game.map);
    expect(crew.gangway).toBeDefined();
    const before={x:crew.x,y:crew.y};source.x+=3;target.x+=3;syncDecks(game.units);
    expect(crew.x).toBeCloseTo(before.x+3);expect(crew.y).toBeCloseTo(before.y);
    cancelShipBoarding(source);settleGangwayCrossings(game.units);syncDecks(game.units);
    expect(crew.gangway).toBeUndefined();
    const parent=game.units.find(ship=>ship.id===crew.deck?.shipId)!;
    expect(deckPointFits(parent,crew,crew.deck!,game.units)).toBe(true);
    expect(crew.hp).toBe(crew.maxHp);
  });
  it('breaks under transferred hull damage without losing cooldown or rescuing wreck passengers',()=>{
    const fixture=pair(),{game,source,target,crew}=fixture;deploy(fixture);
    for(let i=0;i<seconds(10)&&!crew.gangway;i++)walkConnectedSurfaces(crew,{x:target.x+60,y:target.y},game.units,game.map);
    expect(crew.gangway).toBeDefined();
    damageShipGangway(source,120);expect(source.sailing!.gangway).toBeUndefined();
    expect(source.sailing!.gangwayCooldownUntilTick).toBe(GANGWAY_COOLDOWN_TICKS);
    source.hp=0;const parent=crew.deck!.shipId;
    settleGangwayCrossings(game.units);expect(crew.deck!.shipId).toBe(parent);expect(crew.gangway).toBeDefined();
  });
  it('replays a live bridge and a walker saved in its water gap',()=>{
    const fixture=pair('player'),{game,source,target,crew}=fixture;deploy(fixture);
    for(let i=0;i<seconds(10)&&!crew.gangway;i++)walkConnectedSurfaces(crew,{x:target.x+60,y:target.y},game.units,game.map);
    expect(crew.gangway).toBeDefined();
    issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<seconds(8);i++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
    expect(crew.deck?.shipId).toBe(target.id);expect(crew.gangway).toBeUndefined();
  });
  it.each(['mechanical','nonMechanical'] as const)('keeps %s variant admission consistent across snapshots, JSON queries and restore before stepping',unitClass=>{
    const fixture=pair(),{game,source,target,crew}=fixture;deploy(fixture);
    const defender=game.spawnUnit('enemy','footman',target.x,target.y);
    expect(boardUnit(target,defender,game.units)).toBe(true);syncDecks(game.units);
    game.variants={bridgeCrew:resolveVariant({base:'footman',unitClass})};crew.variant='bridgeCrew';
    const allowed=unitClass==='nonMechanical',checksum=checksumGame(game),bridge=JSON.stringify(source.sailing!.gangway),cooldown=source.sailing!.gangwayCooldownUntilTick;
    bindGangwayCrewRules(game.units,game);
    expect(canReach(game.map,crew,defender,game.units)).toBe(allowed);
    expect(checksumGame(game)).toBe(checksum);
    const saved=snapshotGame(game),savedCrew=saved.units.find(unit=>unit.id===crew.id)!,savedDefender=saved.units.find(unit=>unit.id===defender.id)!;
    expect(canReach(saved.map,savedCrew,savedDefender,saved.units)).toBe(allowed);
    const raw=JSON.parse(JSON.stringify(saved)) as typeof saved,rawSource=raw.units.find(unit=>unit.id===source.id)!,rawTarget=raw.units.find(unit=>unit.id===target.id)!,rawCrew=raw.units.find(unit=>unit.id===crew.id)!;
    expect(decksCanTransfer(rawSource,rawTarget,rawCrew)).toBe(false);
    const rawBefore=JSON.stringify(raw);
    bindGangwayCrewRules(raw.units,raw);
    expect(decksCanTransfer(rawSource,rawTarget,rawCrew)).toBe(allowed);expect(JSON.stringify(raw)).toBe(rawBefore);
    const transported=JSON.parse(JSON.stringify(saved)) as typeof saved,transportedBefore=JSON.stringify(transported),query=createSnapshotQuery(transported);
    expect(canReach(query.snapshot.map,query.unitById(crew.id)!,query.unitById(defender.id)!,query.snapshot.units)).toBe(allowed);
    expect(JSON.stringify(transported)).toBe(transportedBefore);
    const restored=scene();restoreSnapshotIntoGame(restored,saved,game.nextId);
    expect(canReach(restored.map,restored.units.find(unit=>unit.id===crew.id)!,restored.units.find(unit=>unit.id===defender.id)!,restored.units)).toBe(allowed);
    expect(checksumGame(restored)).toBe(checksum);
    expect(JSON.stringify(restored.units.find(unit=>unit.id===source.id)!.sailing!.gangway)).toBe(bridge);
    expect(restored.units.find(unit=>unit.id===source.id)!.sailing!.gangwayCooldownUntilTick).toBe(cooldown);
  });
});
