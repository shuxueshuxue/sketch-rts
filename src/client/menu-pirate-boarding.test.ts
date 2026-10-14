import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../shared/catalog';
import { deckPointFits } from '../shared/decks';
import { gangwaySurface } from '../shared/ship-gangway';
import { localToWorld, shipProfile } from '../shared/ship-geometry';
import { mountedWeaponPose } from '../shared/ship-equipment';
import { snapshotGame } from '../shared/sim';
import { createPirateBoarding } from './menu-pirate-boarding';

describe('the authored pirate boarding menu scene', () => {
  it('declares only its seven actual future deck casualties without spawning or advancing them',()=>{
    const run=createPirateBoarding(),before=snapshotGame(run.game);
    expect(before.corpses).toHaveLength(0);expect(before.tick).toBe(0);
    expect(run.warmCorpses).toHaveLength(7);
    for(const corpse of run.warmCorpses!){
      expect(corpse.deck).toBeDefined();expect(corpse.variant).toBe('menu/marine');
      expect(run.models!(corpse.variant!)).toBeDefined();
    }
    expect(snapshotGame(run.game)).toEqual(before);
    run.script(run.game,47);
    expect(run.game.corpses).toEqual(run.warmCorpses);
    run.script(run.game,0);expect(snapshotGame(run.game)).toEqual(before);
  });
  it('separates broadside casualties, carpentry, boarding and capture without match simulation', () => {
    const run = createPirateBoarding(), game=run.game;
    expect(run.presentation).toBe(true);
    run.script(game,2.6);
    expect(game.effects.some(e=>e.type==='siegeBolt')).toBe(true);
    expect(game.units.filter(u=>u.kind==='shipOfTheLine')).toHaveLength(2);
    run.script(game,13);
    expect(game.corpses).toHaveLength(4);
    expect(game.effects.filter(e=>e.type==='repair')).toHaveLength(3);
    expect(game.effects.some(e=>e.type==='siegeBolt')).toBe(false);
    expect(game.units[1]!.hp).toBeGreaterThan(game.units[1]!.maxHp*.63);
    run.script(game,25);
    expect(game.units[0]!.sailing!.gangway?.phase).toBe('deploying');
    expect(game.units.some(u=>u.gangway)).toBe(false);
    run.script(game,32);
    expect(game.units[0]!.sailing!.gangway?.phase).toBe('ready');
    expect(game.units.some(u=>u.gangway)).toBe(true);
    run.script(game,38);
    expect(run.actions!()!.length).toBeGreaterThan(0);
    expect(game.units[0]!.owner).not.toBe(game.units[1]!.owner);
    run.script(game,47);
    expect(game.units[0]!.owner).toBe(game.units[1]!.owner);
    expect(game.corpses).toHaveLength(7);
    expect(run.actions!()).toHaveLength(0);
    for(const variant of Object.values(game.variants!)) {
      const {base,...stats}=variant;
      expect(stats).toEqual(UNIT_DEFS[base]);
    }
  });

  it('keeps every crew disk on actual deck or bridge geometry, clear of masts, guns and friendly bodies', () => {
    const run=createPirateBoarding(), game=run.game;
    for(let tick=0;tick<1200;tick++) {
      run.script(game,tick/20);
      const ships=game.units.filter(u=>shipProfile(u)),crew=game.units.filter(u=>u.deck);
      expect(game.effects.length).toBeLessThanOrEqual(7);
      expect(game.units.length).toBeLessThanOrEqual(25);
      expect(game.corpses!.length).toBeLessThanOrEqual(7);
      for(const unit of crew) {
        if(unit.gangway) {
          const surface=gangwaySurface(ships[0]!,ships[1]!)!;
          expect(surface?.phase).toBe('ready');
          const crossing=unit.gangway;
          expect(unit.x).toBeCloseTo(surface.source.x+(surface.target.x-surface.source.x)*crossing.t,8);
          expect(unit.y).toBeCloseTo(surface.source.y+(surface.target.y-surface.source.y)*crossing.t,8);
        } else {
          const ship=ships.find(s=>s.id===unit.deck!.shipId)!;
          expect(deckPointFits(ship,unit,unit.deck!,game.units,false),`${tick}: ${unit.id}`).toBe(true);
          expect(unit.x).toBe(localToWorld(ship,unit.deck!).x);
          expect(unit.y).toBe(localToWorld(ship,unit.deck!).y);
        }
      }
      for(let i=0;i<crew.length;i++)for(let j=i+1;j<crew.length;j++){
        const a=crew[i]!,b=crew[j]!;
        if(a.owner===b.owner)expect(Math.hypot(a.x-b.x,a.y-b.y),`${tick}: ${a.id}/${b.id}`).toBeGreaterThanOrEqual(a.radius+b.radius-1);
      }
    }
  });

  it('fires from real broadside muzzles and holds both hulls steady once alongside', () => {
    const run=createPirateBoarding(),game=run.game;
    run.script(game,2.2);
    const flash=game.effects.find(e=>e.type==='muzzleFlash')!;
    const ship=game.units[0]!,gun=game.items.find(item=>item.id===flash.itemId)!;
    const pose=mountedWeaponPose(ship,gun)!;
    expect(flash.fromX).toBe(pose.muzzle.x);
    expect(flash.fromY).toBe(pose.muzzle.y);
    expect(flash.fromHeight).toBe(pose.height);
    expect(flash.toHeight).toBe(shipProfile(game.units[1]!)!.deckHeight);
    run.script(game,26);
    const stations=game.units.slice(0,2).map(s=>({x:s.x,y:s.y,heading:s.sailing!.heading}));
    for(const second of [27,32,38,47,58]){
      run.script(game,second);
      expect(game.units.slice(0,2).map(s=>({x:s.x,y:s.y,heading:s.sailing!.heading}))).toEqual(stations);
    }
  });
});
