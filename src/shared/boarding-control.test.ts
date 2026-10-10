import { describe,expect,it } from 'vitest';
import { boardingHoldShips,prepareCrewRendezvous } from './crew-rendezvous';
import { decksAllowCrossing,decksSupportCrossing,decksTouch,walkConnectedSurfaces } from './connected-decks';
import { boardUnit,deckPlacement,deckPointFits,moveOnDeck,syncDecks } from './decks';
import { createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame } from './sim';
import { hullGap,localToWorld,shipProfile } from './ship-geometry';
import { shipContactGoal } from './ship-avoidance';
import { checksumGame } from './sim/checksum';
import { seconds } from './time';
import { rebuildShipFittings } from './ship-equipment';
import { createUnit } from './map';

function scene() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=3200;game.map.height=2400;
  game.map.terrain={cell:40,cols:80,rows:60,cells:'~'.repeat(4800)};
  return game;
}
function alongside() {
  const game=scene(),source=game.spawnUnit('player','shipOfTheLine',1000,1000),target=game.spawnUnit('enemy','transport',1000,1400);
  target.y=source.y+(shipProfile(source)!.beam+shipProfile(target)!.beam)/2+.05;
  const crew=game.spawnUnit('player','footman',1000,1000);
  expect(boardUnit(source,crew,game.units)).toBe(true);syncDecks(game.units);
  return {game,source,target,crew};
}
describe('boarding control at hull contact',()=>{
  it('cleans an abandoned implicit approach even when the surviving list has no hulls',()=>{
    const game=scene(),orphan=createUnit('orphan','player','worker',1000,1000);
    orphan.deck={shipId:'missing-source',x:0,y:0};orphan.cabin={shipId:'missing-source'};
    orphan.sailing={heading:0,speed:0,load:0,balance:0,route:{goalX:1200,goalY:1000,points:[],end:{x:1200,y:1000},trafficKey:''}};
    orphan.order={type:'move',x:1200,y:1000,rendezvousFor:'missing-crew'};
    game.units=[orphan];
    prepareCrewRendezvous(game.map,game.units);
    expect(orphan.order).toEqual({type:'idle'});expect(orphan.sailing.route).toBeUndefined();
    expect(orphan.deck.shipId).toBe('missing-source');expect(orphan.cabin.shipId).toBe('missing-source');
    expect(boardingHoldShips(game.units)).toEqual(new Set());
  });
  it('requires a body-wide supported seam rather than bow point contact',()=>{
    const {game,source,target,crew}=alongside();
    expect(decksAllowCrossing(source,target,crew)).toBe(true);
    source.sailing!.heading=Math.PI/2;source.x=target.x+600;source.y=target.y;
    const pose=shipContactGoal(source,target,[target])!;
    Object.assign(source,{x:pose.x,y:pose.y});source.sailing!.heading=pose.heading;
    expect(decksTouch(source,target,crew)).toBe(true);
    expect(decksAllowCrossing(source,target,crew)).toBe(false);
    expect(hullGap(source,target)).toBeLessThan(.1);
    expect(game.units).toContain(crew);
  });
  it('rejects passing contact without freezing either hull or bypassing through deck walking',()=>{
    const {game,source,target,crew}=alongside();
    Object.assign(source.sailing!,{speed:40,velocityX:40,velocityY:0});
    Object.assign(target.sailing!,{speed:0,velocityX:0,velocityY:0});
    crew.order={type:'board',transportId:target.id};
    expect(decksSupportCrossing(source,target,crew)).toBe(true);
    expect(decksAllowCrossing(source,target,crew)).toBe(false);
    expect(boardingHoldShips(game.units).size).toBe(0);
    const initial={x:crew.x,y:crew.y,deck:{...crew.deck!}};
    for(let i=0;i<20;i++)expect(walkConnectedSurfaces(crew,{x:target.x,y:target.y},game.units,game.map)).toBe(false);
    expect({x:crew.x,y:crew.y,deck:crew.deck}).toEqual(initial);
    source.order={type:'move',x:source.x+400,y:source.y};
    const x=source.x;stepGame(game);
    expect(source.x).toBeGreaterThan(x);
    expect(crew.deck?.shipId).toBe(source.id);
  });
  it('allows matched travel but only active crew orders can hold a helm willing to stop',()=>{
    const {game,source,target,crew}=alongside();
    for(const ship of [source,target])Object.assign(ship.sailing!,{speed:30,velocityX:30,velocityY:0});
    expect(decksAllowCrossing(source,target,crew)).toBe(true);
    expect(boardingHoldShips(game.units).size).toBe(0);
    crew.order={type:'board',transportId:target.id};
    source.order={type:'move',x:source.x+400,y:source.y};target.order={type:'follow',targetId:source.id};
    expect(boardingHoldShips(game.units).size).toBe(0);
    for(const ship of [source,target]){ship.order={type:'idle'};Object.assign(ship.sailing!,{speed:0,velocityX:0,velocityY:0});}
    expect(decksAllowCrossing(source,target,crew)).toBe(true);
    expect([...boardingHoldShips(game.units)].sort()).toEqual([source.id,target.id].sort());
  });
  it('includes seam rotation and actual previous travel in crossing qualification',()=>{
    const {source,target,crew}=alongside();
    Object.assign(source.sailing!,{speed:0,velocityX:40,velocityY:0});
    expect(decksAllowCrossing(source,target,crew)).toBe(false);
    Object.assign(source.sailing!,{velocityX:0,velocityY:0,yawRate:.3});
    expect(decksSupportCrossing(source,target,crew)).toBe(true);
    expect(decksAllowCrossing(source,target,crew)).toBe(false);
    source.sailing!.yawRate=0;
    expect(decksAllowCrossing(source,target,crew)).toBe(true);
    // Actual velocity already accounts for the shove recorded by simulation.
    for(const ship of [source,target])Object.assign(ship.sailing!,{speed:30,velocityX:30,velocityY:0});
    source.pushX=20;
    expect(decksAllowCrossing(source,target,crew)).toBe(true);
  });
  it('plans a fast approach against a hypothetical stopped berth and replays the saved velocity',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,900),target=game.spawnUnit('enemy','transport',1300,1000),crew=game.spawnUnit('player','worker',700,900);
    expect(boardUnit(source,crew,game.units)).toBe(true);syncDecks(game.units);
    Object.assign(source.sailing!,{speed:40,velocityX:40,velocityY:0});
    crew.order={type:'board',transportId:target.id};
    prepareCrewRendezvous(game.map,game.units);
    expect(crew.order.type==='board'&&crew.order.rendezvous).toBeTruthy();
    expect(source.order.type).toBe('move');
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<seconds(3);i++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
  });
  it('recomputes a saved approach when a stationary enemy rotates',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,900),target=game.spawnUnit('enemy','transport',1300,1000),crew=game.spawnUnit('player','worker',700,900);
    boardUnit(source,crew,game.units);crew.order={type:'board',transportId:target.id};
    prepareCrewRendezvous(game.map,game.units);
    expect(crew.order.type).toBe('board');if(crew.order.type!=='board')return;
    const before=crew.order.rendezvous!;
    target.sailing!.heading=.4;
    prepareCrewRendezvous(game.map,game.units);
    expect(crew.order.rendezvous!.heading).toBeCloseTo(.4);
    expect(crew.order.rendezvous).not.toEqual(before);
  });
  it('ends the implicit approach at usable contact and preserves a departure order',()=>{
    const {game,source,target,crew}=alongside();
    crew.order={type:'board',transportId:target.id};
    source.order={type:'move',x:source.x,y:source.y,heading:0,rendezvousFor:crew.id};source.sailing!.speed=4;
    prepareCrewRendezvous(game.map,game.units);
    expect(source.order.type).toBe('idle');expect(source.sailing!.speed).toBe(0);
    expect([...boardingHoldShips(game.units)].sort()).toEqual([source.id,target.id].sort());
    source.order={type:'move',x:1600,y:900};
    expect(boardingHoldShips(game.units).has(source.id)).toBe(false);
    expect(source.order).toEqual({type:'move',x:1600,y:900});
  });
  it('preserves queued helm orders when crew requests an idle hull approach',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,900),target=game.spawnUnit('player','transport',1300,1000),crew=game.spawnUnit('player','worker',700,900);
    boardUnit(source,crew,game.units);
    issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});
    issuePlayerCommand(game,'player',{type:'move',unitIds:[source.id],x:700,y:1500,queued:true});
    const queued=structuredClone(source.orderQueue);
    prepareCrewRendezvous(game.map,game.units);
    expect(source.order.type).toBe('idle');expect(source.orderQueue).toEqual(queued);expect(target.order.type).toBe('idle');
  });
  it('holds both fighting decks for melee orders addressed to an enemy hull',()=>{
    const {game,source,target,crew}=alongside(),defender=game.spawnUnit('enemy','footman',target.x,target.y);
    expect(boardUnit(target,defender,game.units)).toBe(true);syncDecks(game.units);
    crew.order={type:'attack',targetId:target.id};defender.order={type:'attack',targetId:crew.id};
    source.order={type:'attack',targetId:target.id};target.order={type:'attack',targetId:source.id};
    expect([...boardingHoldShips(game.units)].sort()).toEqual([source.id,target.id].sort());
    target.order={type:'follow',targetId:source.id};
    expect(boardingHoldShips(game.units).has(target.id)).toBe(false);
  });
  it('routes around stationary crew on a large usable deck',()=>{
    const game=scene(),ship=game.spawnUnit('player','shipOfTheLine',1200,1200),walker=game.spawnUnit('player','worker',1200,1200),blocker=game.spawnUnit('player','worker',1200,1200);
    const start={x:-70,y:-50},goal={x:60,y:-50};
    expect(boardUnit(ship,walker,game.units)).toBe(true);expect(boardUnit(ship,blocker,game.units)).toBe(true);
    walker.deck={shipId:ship.id,...deckPlacement(ship,walker,game.units,start,false)!};
    blocker.deck={shipId:ship.id,...deckPlacement(ship,blocker,game.units,{x:-5,y:-50},false)!};syncDecks(game.units);
    const destination=deckPlacement(ship,walker,game.units,goal,false)!;
    for(let i=0;i<seconds(10);i++)moveOnDeck(walker,ship,localToWorld(ship,destination),game.units);
    expect(Math.hypot(walker.deck!.x-destination.x,walker.deck!.y-destination.y)).toBeLessThan(1e-6);
    expect(deckPointFits(ship,walker,walker.deck!,game.units)).toBe(true);
  });
  it('finishes a large-to-small crew transfer and its saved continuation identically',()=>{
    const {game,source,target}=alongside();
    const crew=game.units.filter(unit=>unit.deck?.shipId===source.id);
    crew.push(game.spawnUnit('player','archer',source.x,source.y));expect(boardUnit(source,crew[1]!,game.units)).toBe(true);
    issuePlayerCommand(game,'player',{type:'board',unitIds:crew.map(unit=>unit.id),transportId:target.id});
    for(let i=0;i<seconds(2);i++)stepGame(game);
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<seconds(25);i++){stepGame(game);stepGame(restored);}
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for(const unit of crew){expect(unit.deck?.shipId).toBe(target.id);expect(unit.order.type).toBe('idle');expect(deckPointFits(target,unit,unit.deck!,game.units)).toBe(true);}
    const returning={type:'board' as const,unitIds:crew.map(unit=>unit.id),transportId:source.id};
    issuePlayerCommand(game,'player',returning);issuePlayerCommand(restored,'player',returning);
    for(let i=0;i<seconds(25);i++){stepGame(game);stepGame(restored);}
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for(const unit of crew){expect(unit.deck?.shipId).toBe(source.id);expect(unit.order.type).toBe('idle');expect(deckPointFits(source,unit,unit.deck!,game.units)).toBe(true);}
  });
  it('keeps a large-to-small melee battle alongside, then honors a helm departure',()=>{
    const {game,source,target,crew}=alongside(),defender=game.spawnUnit('enemy','footman',target.x,target.y);
    expect(boardUnit(target,defender,game.units)).toBe(true);
    // Isolate the boarding battle from the batteries' damage and knockback.
    game.items=[];rebuildShipFittings(game,source);rebuildShipFittings(game,target);
    crew.deck={shipId:source.id,...deckPlacement(source,crew,game.units,{x:-20,y:60},false)!};
    defender.deck={shipId:target.id,...deckPlacement(target,defender,game.units,{x:-20,y:-30},false)!};
    crew.hp=crew.maxHp=5000;defender.hp=defender.maxHp=5000;syncDecks(game.units);
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[crew.id,source.id],targetId:target.id});
    issuePlayerCommand(game,'enemy',{type:'attack',unitIds:[defender.id,target.id],targetId:crew.id});
    const poses=[source,target].map(ship=>({x:ship.x,y:ship.y,heading:ship.sailing!.heading}));
    for(let i=0;i<seconds(15);i++){
      stepGame(game);
      for(const [index,ship] of [source,target].entries())expect({x:ship.x,y:ship.y,heading:ship.sailing!.heading}).toEqual(poses[index]);
    }
    expect(crew.hp).toBeLessThan(crew.maxHp);expect(defender.hp).toBeLessThan(defender.maxHp);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[source.id],x:source.x+400,y:source.y-200});
    for(let i=0;i<seconds(5);i++)stepGame(game);
    expect(Math.hypot(source.x-poses[0]!.x,source.y-poses[0]!.y)).toBeGreaterThan(30);
    expect(crew.hp).toBeGreaterThan(0);expect(defender.hp).toBeGreaterThan(0);
  });
});
