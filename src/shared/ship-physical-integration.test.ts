import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame,type Game } from './sim';
import { createBuilding,createUnit } from './map';
import { boardUnit,syncDecks } from './decks';
import { distanceToHull,hullContact,localToWorld,shipProfile } from './ship-geometry';
import { hullFits } from './ship-navigation';
import { footprintHalf } from './terrain';
import { checksumGame } from './sim/checksum';
import type { Unit } from './types';

function sea() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.obstacles=[];game.effects=[];game.projectiles=[];game.scriptedVictory=true;
  game.map.width=game.map.height=2048;
  game.map.terrain={cell:32,cols:64,rows:64,cells:'~'.repeat(4096)};
  return game;
}
function ship(game:Game,id:string,owner:Unit['owner']='player',x=900,y=1000) {
  const unit=createUnit(id,owner,'transport',x,y);
  unit.sailing={heading:0,speed:0,load:0,balance:0};unit.order={type:'hold',x,y};
  game.units.push(unit);return unit;
}
function momentum(unit:Unit,speed=64) {
  unit.sailing!.speed=speed;unit.sailing!.velocityX=speed;unit.sailing!.velocityY=0;
}
function pushed(unit:Unit,speed=64) { momentum(unit,speed);unit.pushX=speed;unit.pushY=0; }
function retainedCourse(unit:Unit,x=1600) {
  momentum(unit);
  // A saved exact helm leg encounters a hull that now occupies its corridor.
  // stepGame must sweep that real move before applying its collision damage.
  unit.order={type:'move',x,y:unit.y,heading:0};
  const end={x,y:unit.y,heading:0,exact:true};
  unit.sailing!.route={goalX:x,goalY:unit.y,points:[end],end,cruise:false};
}
function pair(owner:Unit['owner']='player',gap=.4) {
  const game=sea(),a=ship(game,'moving'),b=ship(game,'receiver',owner);
  b.x=a.x+shipProfile(a)!.length+gap;b.order={type:'hold',x:b.x,y:b.y};
  expect(hullContact(a,b)).toBeUndefined();expect(hullFits(game.map,a)).toBe(true);expect(hullFits(game.map,b)).toBe(true);
  return {game,a,b};
}
function hits(game:Game) {
  const observed:{source:string;target:string;damage:number}[]=[];
  game.observer={hit:(source,target,damage)=>observed.push({source:source.id,target:target.id,damage})};
  return observed;
}
describe('physical ship impacts through stepGame',()=>{
  it.each(['shove','saved sailing leg'] as const)('applies both sides of a friendly %s impact once before overlap',mode=>{
    const {game,a,b}=pair(),observed=hits(game);
    if(mode==='shove')pushed(a);else retainedCourse(a);
    stepGame(game);
    expect(a.hp).toBeLessThan(a.maxHp);expect(b.hp).toBeLessThan(b.maxHp);
    expect(observed.map(hit=>[hit.source,hit.target])).toEqual([[b.id,a.id],[a.id,b.id]]);
    expect(hullContact(a,b)).toBeUndefined();expect(a.sailing!.speed).toBe(0);
    const health=[a.hp,b.hp];a.order={type:'hold',x:a.x,y:a.y};
    for(let i=0;i<20;i++)stepGame(game);
    expect([a.hp,b.hp]).toEqual(health);expect(observed).toHaveLength(2);
    expect(a.kills+b.kills).toBe(0);expect(a.xp+b.xp).toBe(0);
  });
  it('destroys a dock through normal damage and respects a protected dock',()=>{
    for(const protectedDock of [false,true]) {
      const game=sea(),moving=ship(game,'moving'),dock=createBuilding('dock','enemy','shipyard',1200,1000,true);
      dock.hp=1;if(protectedDock)dock.invulnerable=true;
      moving.x=dock.x-footprintHalf(dock.radius,32)-shipProfile(moving)!.length/2-.4;
      game.buildings=[dock];pushed(moving);const observed=hits(game);
      expect(hullFits(game.map,moving)).toBe(true);stepGame(game);
      expect(moving.hp).toBeLessThan(moving.maxHp);
      if(protectedDock){expect(dock.hp).toBe(1);expect(game.buildings).toContain(dock);expect(observed.some(hit=>hit.target===dock.id)).toBe(false);}
      else{expect(game.buildings).not.toContain(dock);expect(game.match.stats.buildingsDestroyed.player).toBe(1);expect(observed.some(hit=>hit.source===moving.id&&hit.target===dock.id)).toBe(true);}
      expect(moving.kills).toBe(0);expect(moving.xp).toBe(0);
    }
  });
  it('breaks a physical obstacle without awarding kills or experience',()=>{
    const game=sea(),moving=ship(game,'moving'),rock={id:'rock',kind:'rocks' as const,owner:'neutral' as const,x:1200,y:1000,radius:32,hp:1,maxHp:100,along:{x:0,y:1}};
    moving.x=rock.x-footprintHalf(rock.radius,32)-shipProfile(moving)!.length/2-.4;
    game.obstacles=[rock];pushed(moving);const observed=hits(game);stepGame(game);
    expect(moving.hp).toBeLessThan(moving.maxHp);expect(game.obstacles).not.toContain(rock);
    expect(observed.some(hit=>hit.source===moving.id&&hit.target===rock.id)).toBe(true);
    expect(moving.kills).toBe(0);expect(moving.xp).toBe(0);expect(game.match.stats.neutralUnitsKilled.player??0).toBe(0);
  });
  it('damages a reachable ground body in shallow water through normal death handling',()=>{
    const game=sea();game.map.terrain!.cells=','.repeat(4096);
    const moving=ship(game,'moving'),worker=createUnit('worker','player','worker',moving.x+shipProfile(moving)!.length/2+15+.4,moving.y);
    worker.hp=1;worker.order={type:'hold',x:worker.x,y:worker.y};game.units.push(worker);
    const observed=hits(game);pushed(moving);stepGame(game);
    expect(moving.hp).toBeLessThan(moving.maxHp);expect(game.units).not.toContain(worker);
    expect(observed.some(hit=>hit.source===moving.id&&hit.target===worker.id)).toBe(true);
    expect(distanceToHull(moving,worker)).toBeGreaterThanOrEqual(worker.radius-1e-5);
    expect(game.match.stats.unitsLost.player).toBe(1);expect(moving.kills).toBe(0);expect(moving.xp).toBe(0);
  });
  it('counts friendly shipwreck passengers as losses without awarding a crash bounty',()=>{
    const {game,a,b}=pair(),crew=createUnit('crew','player','footman',b.x,b.y);
    game.units.push(crew);expect(boardUnit(b,crew,game.units)).toBe(true);crew.order={type:'hold',x:crew.x,y:crew.y};b.hp=1;
    pushed(a);stepGame(game);
    expect(game.units).toContain(a);expect(game.units).not.toContain(b);expect(game.units).not.toContain(crew);
    expect(game.match.stats.unitsLost.player).toBe(2);expect(game.match.stats.unitsKilled.player??0).toBe(0);
    expect(a.kills+b.kills+crew.kills).toBe(0);expect(a.xp+b.xp+crew.xp).toBe(0);
  });
  it('attributes an enemy collision wreck and its crew to the striking ship',()=>{
    const {game,a,b}=pair('enemy'),crew=createUnit('crew','enemy','worker',b.x,b.y);
    game.units.push(crew);expect(boardUnit(b,crew,game.units)).toBe(true);crew.order={type:'hold',x:crew.x,y:crew.y};b.hp=1;
    pushed(a);stepGame(game);
    expect(game.units).not.toContain(b);expect(game.units).not.toContain(crew);
    expect(game.match.stats.unitsLost.enemy).toBe(2);expect(game.match.stats.unitsKilled.player).toBe(2);
    expect(a.kills).toBe(2);expect(a.xp).toBeGreaterThan(0);expect(b.kills).toBe(0);
  });
  it('handles a fatal coast impact through shipwreck losses without self-awarded kills',()=>{
    const game=sea(),moving=ship(game,'moving'),coast=50*32;
    game.map.terrain!.cells=Array.from({length:64*64},(_,i)=>i%64>=50?'#':'~').join('');
    moving.x=coast-shipProfile(moving)!.length/2-.4;
    const crew=createUnit('crew','player','footman',moving.x,moving.y);game.units.push(crew);
    expect(boardUnit(moving,crew,game.units)).toBe(true);crew.order={type:'hold',x:crew.x,y:crew.y};moving.hp=1;pushed(moving);
    expect(hullFits(game.map,moving)).toBe(true);const observed=hits(game);stepGame(game);
    expect(game.units).not.toContain(moving);expect(game.units).not.toContain(crew);expect(hullFits(game.map,moving)).toBe(true);
    expect(observed.some(hit=>hit.source===moving.id&&hit.target===moving.id)).toBe(true);
    expect(game.match.stats.unitsLost.player).toBe(2);expect(game.match.stats.unitsKilled.player??0).toBe(0);expect(moving.kills).toBe(0);expect(moving.xp).toBe(0);
  });
  it('keeps repeated low-speed mooring quiet and excludes its passengers from collision bodies',()=>{
    const {game,a,b}=pair('player',.005),crew=createUnit('crew','player','worker',a.x,a.y);
    game.units.push(crew);expect(boardUnit(a,crew,game.units)).toBe(true);crew.order={type:'hold',x:crew.x,y:crew.y};const observed=hits(game);
    for(let i=0;i<30;i++){pushed(a,5);stepGame(game);expect(hullContact(a,b)).toBeUndefined();}
    expect(observed).toEqual([]);expect([a.hp,b.hp,crew.hp]).toEqual([a.maxHp,b.maxHp,crew.maxHp]);expect(crew.deck?.shipId).toBe(a.id);
  });
  it('blocks ground walking and shoves at a hull while its deck crew stays on the moving deck',()=>{
    const game=sea();game.map.terrain!.cells=','.repeat(4096);
    const hull=ship(game,'hull','player',1000),walker=createUnit('walker','player','worker',700,1000),crew=createUnit('crew','player','worker',hull.x,hull.y);
    game.units.push(walker,crew);expect(boardUnit(hull,crew,game.units)).toBe(true);crew.order={type:'hold',x:crew.x,y:crew.y};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[walker.id],x:1400,y:1000});const observed=hits(game);
    for(let i=0;i<240;i++)stepGame(game);
    expect(walker.x).toBeGreaterThan(700);expect(walker.x).toBeLessThan(hull.x);expect(distanceToHull(hull,walker)).toBeGreaterThanOrEqual(walker.radius-1e-5);expect(walker.deck).toBeUndefined();
    const stopped=walker.x;walker.pushX=500;walker.pushY=0;stepGame(game);
    expect(walker.x).toBeCloseTo(stopped,4);expect(walker.pushX).toBeUndefined();
    pushed(hull);stepGame(game);syncDecks(game.units);
    expect(crew.deck?.shipId).toBe(hull.id);expect({x:crew.x,y:crew.y}).toEqual(localToWorld(hull,crew.deck!));expect(observed).toEqual([]);
  });
  it('replays a saved sailing collision and passenger death with the same checksum',()=>{
    const {game,a,b}=pair('enemy'),crew=createUnit('crew','enemy','worker',b.x,b.y);
    game.units.push(crew);expect(boardUnit(b,crew,game.units)).toBe(true);crew.order={type:'hold',x:crew.x,y:crew.y};b.hp=1;retainedCourse(a);
    const restored=sea();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<20;i++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
    expect(game.units.some(unit=>unit.id===b.id||unit.id===crew.id)).toBe(false);expect(game.match.stats.unitsKilled.player).toBe(2);
  });
});
