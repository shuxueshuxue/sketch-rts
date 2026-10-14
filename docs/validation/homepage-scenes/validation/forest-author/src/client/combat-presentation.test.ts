import { describe, expect, it } from 'vitest';
import { createGame, snapshotGame, strikeUnit, stepGame } from '../shared/sim';
import { checksumGame } from '../shared/sim/checksum';
import { localToWorld, shipProfile } from '../shared/ship-geometry';
import { UNIT_DEFS } from '../shared/catalog';
import { unitClassOf } from '../shared/unit-targeting';
import { CombatPresentationTracker, COMBAT_PRESENTATION_LIMITS, isBloodHit } from './combat-presentation';
import type { Unit, WorldEffect } from '../shared/types';

function scene(kind:Unit['kind']='footman') {
  const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.effects=[];game.items=[];
  const attacker=game.spawnUnit('player','footman',900,1000);
  const target=game.spawnUnit('enemy',kind,1000,1000);
  return {game,attacker,target};
}
const hit=(overrides:Partial<WorldEffect>={}):WorldEffect=>({id:'hit-1',type:'hit',x:100,y:100,duration:14,remaining:14,unitId:'target',damage:40,targetKind:'footman',targetHpAfter:60,targetMaxHp:180,targetRadius:18,targetUnitClass:'nonMechanical',fromX:50,fromY:100,...overrides});
const snapshot=(tick:number,effects:WorldEffect[],units:Unit[]=[])=>({tick,effects,units});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

describe('combat hit facts',()=>{
  it.each(['footman','spirit','golem','ballista','transport'] as const)('records exact actual damage and post-hit facts for %s without extra effects or IDs',kind=>{
    const {game,attacker,target}=scene(kind);
    target.hp=20;
    const beforeId=game.nextId,beforeHp=target.hp;
    strikeUnit(game,attacker,target,9,'spell');
    const effect=game.effects.find(effect=>effect.type==='hit')!;
    expect(effect).toMatchObject({unitId:target.id,targetKind:kind,targetHpAfter:target.hp,targetMaxHp:target.maxHp,targetRadius:target.radius,targetUnitClass:unitClassOf(target,game),damage:beforeHp-target.hp});
    expect(game.nextId-beforeId).toBe(game.effects.length);
    expect(game.effects.filter(effect=>effect.type==='hit')).toHaveLength(1);
    expect(isBloodHit(effect)).toBe(kind==='footman');
    // Spell's existing source-less hit must not invent an attack direction.
    expect(effect.fromX).toBeUndefined();expect(effect.fromY).toBeUndefined();
  });

  it('uses the variant class instead of assuming that a humanoid base must bleed',()=>{
    const {game,attacker,target}=scene();
    game.variants={'test/machine':{...UNIT_DEFS.footman,base:'footman',unitClass:'mechanical'}};
    target.variant='test/machine';target.hp=20;
    strikeUnit(game,attacker,target,9,'spell');
    const effect=game.effects.find(effect=>effect.type==='hit')!;
    expect(effect.targetUnitClass).toBe('mechanical');expect(isBloodHit(effect)).toBe(false);
  });

  it('captures lethal facts before target cleanup, and real melee source positions',()=>{
    const {game,attacker,target}=scene();target.hp=2;
    strikeUnit(game,attacker,target,200,'melee');
    const effect=game.effects.find(effect=>effect.type==='hit')!;
    expect(effect).toMatchObject({targetHpAfter:target.hp,targetKind:target.kind,fromX:attacker.x,fromY:attacker.y});
    expect(effect.targetHpAfter).toBeLessThanOrEqual(0);
    game.units=game.units.filter(unit=>unit.id!==target.id);
    const tracker=new CombatPresentationTracker();tracker.update(game,0);
    expect(tracker.frame(0).droplets.length).toBeGreaterThan(0);
    expect(tracker.frame(0).body).toHaveLength(0);
  });

  it('keeps each same-tick hit HP instead of the final frame HP',()=>{
    const {game,attacker,target}=scene();target.hp=100;
    strikeUnit(game,attacker,target,20,'spell');
    strikeUnit(game,attacker,target,50,'spell');
    const hits=game.effects.filter(effect=>effect.type==='hit');
    expect(hits[0]!.targetHpAfter).toBeGreaterThan(hits[1]!.targetHpAfter!);
    expect(isBloodHit(hits[0]!)).toBe(false);expect(isBloodHit(hits[1]!)).toBe(true);
  });

  it('uses projectile launch origin even if the shooter has moved behind its target',()=>{
    const {game,attacker,target}=scene();game.scriptedVictory=true;target.hp=20;
    game.projectiles.push({id:'shot',owner:attacker.owner,attackerId:attacker.id,targetId:target.id,fromX:900,fromY:1000,toX:target.x,toY:target.y,damage:9,remaining:1,duration:10,sourceKind:'archer'});
    attacker.x=1200;
    stepGame(game);
    expect(game.effects.find(effect=>effect.type==='hit')).toMatchObject({fromX:900,fromY:1000});
  });

  it('leaves gameplay fields and RNG unchanged when presentation is observed',()=>{
    const {game,attacker,target}=scene();target.hp=20;strikeUnit(game,attacker,target,9,'spell');
    const before=snapshotGame(game),checksum=checksumGame(game),nextId=game.nextId;
    const tracker=new CombatPresentationTracker();tracker.update(game,0);
    for(let frame=0;frame<50;frame++)tracker.frame(frame*16);
    expect(snapshotGame(game)).toEqual(before);expect(checksumGame(game)).toBe(checksum);expect(game.nextId).toBe(nextId);
  });

  it.each(['near-lethal','lethal'] as const)('never creates spirit blood from an actual %s strike through the entire residue lifetime',injury=>{
    const {game,attacker,target}=scene('spirit');target.hp=injury==='near-lethal'?20:2;
    strikeUnit(game,attacker,target,injury==='near-lethal'?9:200,'melee');
    const effect=game.effects.find(effect=>effect.type==='hit')!;
    expect(effect.targetKind).toBe('spirit');expect(effect.targetUnitClass).toBe('nonMechanical');
    expect(effect.targetHpAfter).toBeLessThanOrEqual(effect.damage!*2);
    expect(effect.damage).toBeGreaterThan(0);expect(isBloodHit(effect)).toBe(false);
    if(injury==='near-lethal')expect(target.hp).toBeGreaterThan(0);else expect(target.hp).toBeLessThanOrEqual(0);
    const before=snapshotGame(game),checksum=checksumGame(game),nextId=game.nextId;
    const tracker=new CombatPresentationTracker();
    for(let tick=0;tick<=190;tick++){
      tracker.update(snapshot(game.tick+tick,tick===0?game.effects:[],game.units),tick*50);
      const frame=tracker.frame(tick*50);
      expect(frame.droplets,`airborne at ${tick}`).toHaveLength(0);
      expect(frame.ground,`landed at ${tick}`).toHaveLength(0);
      expect(frame.body,`stained at ${tick}`).toHaveLength(0);
      // Extra interpolation cannot resurrect a suppressed release.
      expect(tracker.frame(tick*50+20)).toMatchObject({droplets:[],ground:[],body:[]});
    }
    expect(snapshotGame(game)).toEqual(before);expect(checksumGame(game)).toBe(checksum);expect(game.nextId).toBe(nextId);
  });

  it.each(['footman','wildling'] as const)('preserves blood for actual close-to-lethal physical %s hits',kind=>{
    const {game,attacker,target}=scene(kind);target.hp=20;strikeUnit(game,attacker,target,9,'melee');
    const effect=game.effects.find(effect=>effect.type==='hit')!;
    expect(effect.targetKind).toBe(kind);expect(effect.targetUnitClass).toBe('nonMechanical');
    expect(isBloodHit(effect)).toBe(true);
    const tracker=new CombatPresentationTracker();tracker.update(game,0);
    expect(tracker.frame(0).droplets.length).toBeGreaterThan(0);
  });
});

describe('deterministic blood physics',()=>{
  it('rejects light injuries, non-unit/missing facts and mechanical units; threshold uses actual damage',()=>{
    expect(isBloodHit(hit({targetHpAfter:81}))).toBe(false);
    expect(isBloodHit(hit({targetHpAfter:80}))).toBe(true);
    expect(isBloodHit(hit({targetHpAfter:0}))).toBe(true);
    expect(isBloodHit(hit({targetUnitClass:'mechanical',targetHpAfter:0}))).toBe(false);
    const noKind=hit();delete noKind.targetKind;expect(isBloodHit(noKind)).toBe(false);
    expect(isBloodHit(hit({damage:0,targetHpAfter:0}))).toBe(false);
    const noHp=hit();delete noHp.targetMaxHp;expect(isBloodHit(noHp)).toBe(false);
  });

  it('scales droplet count and radius with the actual share of health damaged',()=>{
    const small=new CombatPresentationTracker(),large=new CombatPresentationTracker();
    small.update(snapshot(0,[hit({damage:5,targetHpAfter:0})]),0);
    large.update(snapshot(0,[hit({damage:150,targetHpAfter:0})]),0);
    expect(large.frame(0).droplets.length).toBeGreaterThan(small.frame(0).droplets.length);
    expect(large.frame(0).droplets[0]!.radius).toBeGreaterThan(small.frame(0).droplets[0]!.radius);
  });

  it('reconstructs exactly from event ID and event tick, without duplicate views replaying',()=>{
    const tracker=new CombatPresentationTracker(),late=new CombatPresentationTracker();
    tracker.update(snapshot(10,[hit()]),0);
    tracker.update(snapshot(13,[hit({remaining:11})]),150);
    late.update(snapshot(13,[hit({remaining:11})]),9000);
    expect(copy(tracker.frame(150))).toEqual(copy(late.frame(9000)));
    const count=tracker.frame(150).droplets.length;
    tracker.update(snapshot(13,[hit({remaining:11})]),10000);
    expect(tracker.frame(10000).droplets).toHaveLength(count);
    expect(copy(tracker.frame(10000))).toEqual(copy(tracker.frame(100000)));
  });

  it('launches away from the actual source, falls under gravity and stays at the calculated landing point',()=>{
    const tracker=new CombatPresentationTracker();tracker.update(snapshot(0,[hit()]),0);
    const first=copy(tracker.frame(0).droplets[0]!);
    expect(first.vx).toBeGreaterThan(0);
    tracker.update(snapshot(4,[]),200);
    const airborne=copy(tracker.frame(200).droplets[0]!);
    expect(airborne.x).toBeCloseTo(first.x+first.vx*.2);
    expect(airborne.height).toBeCloseTo(first.height+first.vz*.2-.5*180*.2*.2);
    tracker.update(snapshot(40,[]),2000);
    const landed=copy(tracker.frame(2000).ground);
    expect(landed.length).toBeGreaterThan(0);expect(tracker.frame(2000).droplets).toHaveLength(0);
    tracker.update(snapshot(80,[]),4000);
    expect(copy(tracker.frame(4000).ground)).toEqual(landed);
    tracker.update(snapshot(160,[]),8000);
    expect(tracker.frame(8000).ground[0]!.alpha).toBeLessThan(landed[0]!.alpha);
    tracker.update(snapshot(181,[]),9050);expect(tracker.frame(9050).ground).toHaveLength(0);
  });

  it('keeps marks in body-local coordinates while a living unit moves, removing them on death',()=>{
    const {target}=scene();target.id='target';
    const tracker=new CombatPresentationTracker();tracker.update(snapshot(0,[hit()],[target]),0);
    const mark=copy(tracker.frame(0).body[0]!);
    target.x+=70;target.y+=15;tracker.update(snapshot(1,[],[target]),50);
    expect(tracker.frame(50).body[0]).toMatchObject({x:target.x,y:target.y,localX:mark.localX,localY:mark.localY});
    target.hp=0;tracker.update(snapshot(2,[],[target]),100);expect(tracker.frame(100).body).toHaveLength(0);
  });

  it('bounds crowds and clears old stains on reset or backward seek',()=>{
    const tracker=new CombatPresentationTracker();
    tracker.update(snapshot(20,Array.from({length:1000},(_,i)=>hit({id:'hit-'+i}))),0);
    expect(tracker.frame(0).droplets.length).toBeLessThanOrEqual(COMBAT_PRESENTATION_LIMITS.bursts*COMBAT_PRESENTATION_LIMITS.dropletsPerBurst);
    tracker.update(snapshot(1,[]),50);expect(tracker.frame(50).droplets).toHaveLength(0);
    tracker.update(snapshot(2,[hit()]),100);tracker.reset();expect(tracker.frame(100).droplets).toHaveLength(0);
  });
});

describe('special-motion speed lines',()=>{
  it('uses real charge displacement, excludes ordinary walking and freezes during pauses',()=>{
    const {target}=scene();const tracker=new CombatPresentationTracker();
    tracker.update(snapshot(0,[],[target]),0);
    target.x+=4;tracker.update(snapshot(1,[],[target]),50);expect(tracker.frame(50).speedLines).toHaveLength(0);
    target.order={type:'charge',targetId:'foe',resume:{type:'idle'}};
    target.x+=10;tracker.update(snapshot(2,[],[target]),100);
    expect(tracker.frame(100).speedLines).toHaveLength(3);
    expect(tracker.frame(100).speedLines[0]).toMatchObject({dx:1,dy:0});
    expect(copy(tracker.frame(100))).toEqual(copy(tracker.frame(100000)));
    tracker.update(snapshot(3,[],[target]),150);expect(tracker.frame(150).speedLines).toHaveLength(0);
  });

  it('rotates relative crew charge velocity into world direction on a ninety-degree hull',()=>{
    const {game,target}=scene();const ship=game.spawnUnit('enemy','transport',1000,1000);
    Object.assign(ship,{sailing:{...ship.sailing,heading:Math.PI/2}});
    target.deck={shipId:ship.id,x:0,y:0};Object.assign(target,localToWorld(ship,target.deck));
    target.order={type:'charge',targetId:'foe',resume:{type:'idle'}};
    const tracker=new CombatPresentationTracker();tracker.update(snapshot(0,[],[ship,target]),0);
    target.deck.x+=10;Object.assign(target,localToWorld(ship,target.deck));
    tracker.update(snapshot(1,[],[ship,target]),50);
    const line=tracker.frame(50).speedLines[0]!;
    expect(line).toBeDefined();expect(line.dx).toBeCloseTo(0);expect(line.dy).toBeCloseTo(1);
  });

  it('does not emit lines for teleporting or a passenger carried by a fast ship',()=>{
    const {target}=scene();target.order={type:'charge',targetId:'foe',resume:{type:'idle'}};
    const tracker=new CombatPresentationTracker();tracker.update(snapshot(0,[],[target]),0);
    target.x+=1000;tracker.update(snapshot(1,[],[target]),50);expect(tracker.frame(50).speedLines).toHaveLength(0);
    target.deck={shipId:'ship',x:0,y:0};tracker.update(snapshot(2,[],[target]),100);
    target.x+=20;tracker.update(snapshot(3,[],[target]),150);expect(tracker.frame(150).speedLines).toHaveLength(0);
  });
});


describe('deck blood surface and crowded persistence',()=>{
  it('captures the deck surface at impact and keeps drops/stains attached to its moving hull',()=>{
    const {game,attacker,target}=scene();
    const ship=game.spawnUnit('enemy','transport',1000,1000);
    target.x=ship.x;target.y=ship.y;target.deck={shipId:ship.id,x:0,y:0};target.hp=20;
    strikeUnit(game,attacker,target,9,'spell');
    const effect=game.effects.find(effect=>effect.type==='hit')!;
    expect(effect.targetDeck).toEqual({...target.deck,heading:ship.sailing?.heading??0});
    expect(effect.toHeight).toBeCloseTo(shipProfile(ship)!.deckHeight+18);
    const tracker=new CombatPresentationTracker();tracker.update(game,0);
    expect(tracker.frame(0).droplets.every(drop=>drop.height>shipProfile(ship)!.deckHeight)).toBe(true);
    game.tick=40;game.effects=[];tracker.update(game,2000);
    const before=copy(tracker.frame(2000).ground);expect(before.length).toBeGreaterThan(0);
    ship.x+=80;ship.y+=30;Object.assign(target,localToWorld(ship,target.deck));game.tick=41;
    tracker.update(game,2050);
    expect(tracker.frame(2050).ground[0]!.x-before[0]!.x).toBeCloseTo(80);
    expect(tracker.frame(2050).ground[0]!.y-before[0]!.y).toBeCloseTo(30);
    expect(tracker.frame(2050).ground[0]!.height).toBeCloseTo(shipProfile(ship)!.deckHeight);
    ship.hp=0;game.tick=42;tracker.update(game,2100);expect(tracker.frame(2100).ground).toHaveLength(0);
  });

  it('keeps a disembarked survivor body mark after the original hull disappears, then expires it normally',()=>{
    const {game,attacker,target}=scene();
    const ship=game.spawnUnit('enemy','transport',1000,1000);
    target.x=ship.x;target.y=ship.y;target.deck={shipId:ship.id,x:0,y:0};target.hp=20;
    strikeUnit(game,attacker,target,9,'spell');
    const tracker=new CombatPresentationTracker();tracker.update(game,0);
    expect(tracker.frame(0).body).toHaveLength(1);
    game.tick=40;game.effects=[];tracker.update(game,2000);
    expect(tracker.frame(2000).ground.length).toBeGreaterThan(0);
    // Snapshot facts after leaving the deck and the original ship's removal.
    delete target.deck;target.x=1200;target.y=1100;
    game.units=game.units.filter(unit=>unit.id!==ship.id);game.tick=41;tracker.update(game,2050);
    const after=tracker.frame(2050);
    expect(after.ground).toHaveLength(0);expect(after.droplets).toHaveLength(0);
    expect(after.body).toHaveLength(1);expect(after.body[0]).toMatchObject({unitId:target.id,x:1200,y:1100});
    const alpha=after.body[0]!.alpha;
    game.tick=80;target.x+=25;tracker.update(game,4000);
    expect(tracker.frame(4000).body[0]!.x).toBe(target.x);
    expect(tracker.frame(4000).body[0]!.alpha).toBeLessThan(alpha);
    game.tick=120;tracker.update(game,6000);expect(tracker.frame(6000).body).toHaveLength(0);
  });

  it('retains landed stains when a new burst exceeds the active particle budget',()=>{
    const tracker=new CombatPresentationTracker();
    tracker.update(snapshot(0,[hit({id:'first',x:-10000})]),0);
    tracker.update(snapshot(40,Array.from({length:48},(_,i)=>hit({id:'new-'+i}))),2000);
    expect(tracker.frame(2000).ground.some(mark=>mark.x< -9000)).toBe(true);
    expect(tracker.frame(2000).droplets.length).toBeLessThanOrEqual(480);
  });
});


it('shares one sampled combat frame across render passes but invalidates it on a new tick at the same wall clock',()=>{
  const tracker=new CombatPresentationTracker();tracker.update(snapshot(0,[hit()]),0);
  const frame=tracker.frame(0),drop=frame.droplets[0]!,height=drop.height;
  expect(tracker.frame(0)).toBe(frame);expect(tracker.frame(0).droplets[0]).toBe(drop);
  tracker.update(snapshot(2,[]),0);
  expect(tracker.frame(0)).toBe(frame);expect(tracker.frame(0).droplets[0]!.height).not.toBe(height);
  tracker.reset();expect(tracker.frame(0).droplets).toHaveLength(0);
});


it('shows actual hits appended in the same tick once without advancing existing particle time',()=>{
 const {game,target,attacker}=scene();target.hp=20;
 const tracker=new CombatPresentationTracker();tracker.update(game,0);
 strikeUnit(game,attacker,target,5,'melee');
 const first=game.effects.find(effect=>effect.type==='hit')!;
 // The first wound is too light; the next hit crosses the exact post-hit threshold.
 expect(isBloodHit(first)).toBe(false);tracker.update(game,0);expect(tracker.frame(0).droplets).toHaveLength(0);
 strikeUnit(game,attacker,target,8,'melee');tracker.update(game,0);
 const drops=tracker.frame(0).droplets.map(drop=>({...drop}));expect(drops.length).toBeGreaterThan(0);
 tracker.update(game,0);expect(tracker.frame(0).droplets).toEqual(drops);
 game.tick++;for(const effect of game.effects)effect.remaining--;
 tracker.update(game,50);expect(tracker.frame(50).droplets).toHaveLength(drops.length);
 expect(tracker.frame(50).droplets[0]!.height).not.toBe(drops[0]!.height);
});
