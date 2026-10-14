import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, UNIT_RULES } from '../shared/catalog';
import { snapshotGame } from '../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { createForestHorde } from './menu-forest-horde';
import { UnitAnimationTracker } from './unit-animation';
import { UnitFacingTracker } from './unit-facing';
import { isBloodHit } from './combat-presentation';

const view = (run: ReturnType<typeof createForestHorde>) => JSON.stringify({units:run.game.units,effects:run.game.effects,corpses:run.game.corpses,cues:run.actions!()!});

describe('army against a forest horde menu presentation',()=>{
  it('uses a bounded local cast with an army formation and genuine mixed creature silhouettes',()=>{
    const rules=JSON.stringify(UNIT_RULES),run=createForestHorde();
    expect(run.presentation).toBe(true); expect(run.game.activePlayers).toEqual(['court','wilds']);
    expect(run.game.units).toHaveLength(40); expect(run.game.buildings).toHaveLength(0);
    const army=run.game.units.filter(unit=>unit.owner==='court'),horde=run.game.units.filter(unit=>unit.owner==='wilds');
    expect(army).toHaveLength(18);expect(horde).toHaveLength(22);
    expect(army.filter(unit=>unit.kind==='archer')).toHaveLength(6);
    expect(army.filter(unit=>unit.kind==='knight')).toHaveLength(2);
    expect(horde.filter(unit=>['ogreLord','spiderQueen','graniteGolem','ancientStag'].includes(unit.kind))).toHaveLength(4);
    expect(new Set(horde.map(unit=>unit.kind)).size).toBeGreaterThanOrEqual(10);
    for(const time of [6,16.7,35.5,51])run.script(run.game,time);
    expect(run.game.variants).toBeUndefined();expect(JSON.stringify(UNIT_RULES)).toBe(rules);
  });

  it('stages opening arrows before contact, then releases melee toward the real opponent',()=>{
    const run=createForestHorde();
    run.script(run.game,6);
    expect(run.game.effects.some(effect=>effect.type==='projectile'&&effect.sourceKind==='archer')).toBe(true);
    expect(run.actions!()!.every(cue=>run.game.units.find(unit=>unit.id===cue.unitId)?.kind==='archer')).toBe(true);
    run.script(run.game,16.7);
    const snapshot=snapshotGame(run.game),units=new Map(snapshot.units.map(unit=>[unit.id,unit]));
    const facing=new UnitFacingTracker();facing.update(snapshot.units,id=>units.get(id));
    
    let contacts=0;
    for(const cue of run.actions!()!){
      const source=units.get(cue.unitId)!;
      if(source.order.type!=='attack')continue;
      const target=units.get(source.order.targetId)!;
      expect(target.owner).not.toBe(source.owner);
      expect(Math.sign(cue.toX!-cue.fromX!)).toBe(source.owner==='court'?1:-1);
      expect(facing.facing(source.id)).toBe(source.owner==='court'?1:-1);
      if(source.kind==='archer'||source.kind==='thornSlinger')continue;
      expect(cue.toX).toBe(target.x);expect(cue.toY).toBe(target.y);
      expect(Math.hypot(source.x-target.x,source.y-target.y)).toBeLessThanOrEqual(UNIT_DEFS[source.kind].attackRange+1);
      const releaseTick=cue.tick+1,releaseNow=releaseTick*1000/SIM_TICKS_PER_SECOND;
      const animation=new UnitAnimationTracker();animation.update({...snapshot,tick:releaseTick},releaseNow,[cue]);
      const pose=animation.frame(source,releaseNow);
      expect(pose.mode).toBe('attack');expect(pose.direction).toBeDefined();
      expect(Math.sign(pose.direction!.x)).toBe(source.owner==='court'?1:-1);
      contacts++;
    }
    expect(contacts).toBeGreaterThan(1);
  });

  it('has continuous movement, clear body footprints and clear scenery lanes over every authored frame',()=>{
    const run=createForestHorde(),terrain=run.game.map.terrain!;
    let previous=new Map(run.game.units.map(unit=>[unit.id,{x:unit.x,y:unit.y}])),maxStep=0,minGap=Infinity;
    const blocking=run.props.filter(prop=>['stone','deadTree'].includes(prop.kind));
    for(let frame=1;frame<=51*30;frame++){
      run.script(run.game,frame/30);
      const units=run.game.units;
      for(const unit of units){
        const before=previous.get(unit.id)!;
        maxStep=Math.max(maxStep,Math.hypot(unit.x-before.x,unit.y-before.y));
        expect(terrain.cells[Math.floor(unit.y/terrain.cell)*terrain.cols+Math.floor(unit.x/terrain.cell)]).toBe('.');
        for(const prop of blocking)expect(Math.hypot(prop.x-unit.x,prop.y-unit.y)-unit.radius).toBeGreaterThan(35);
      }
      for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
        const a=units[i]!,b=units[j]!;minGap=Math.min(minGap,Math.hypot(a.x-b.x,a.y-b.y)-a.radius-b.radius);
      }
      previous=new Map(units.map(unit=>[unit.id,{x:unit.x,y:unit.y}]));
    }
    expect(maxStep).toBeLessThan(3.05);expect(minGap).toBeGreaterThan(2);
  });

  it('can seek without accumulating state and only resets under the menu fade',()=>{
    const run=createForestHorde();run.script(run.game,35.5);const late=view(run);
    run.script(run.game,4);run.script(run.game,35.5);expect(view(run)).toBe(late);
    const fresh=createForestHorde();fresh.script(fresh.game,35.5);expect(view(fresh)).toBe(late);
    run.script(run.game,52);expect(run.game.units).toHaveLength(40);expect(run.game.corpses).toHaveLength(0);
    expect(run.game.effects).toHaveLength(0);expect(run.game.tick).toBe(0);
  });

  it('makes every casualty an authored lethal hit with class-correct blood and stable remains',()=>{
    const run=createForestHorde();let deaths=0;
    for(const time of [8.15,10.35,17.6,24.6,29.2,31.6,35.4]){
      run.script(run.game,time+.00001);
      const fatal=run.game.effects.find(effect=>effect.type==='hit'&&effect.targetHpAfter===0)!;
      expect(fatal).toBeDefined();expect(fatal.targetUnitClass).toBe(UNIT_DEFS[fatal.targetKind!].unitClass);
      expect(isBloodHit(fatal)).toBe(true);
      expect(run.game.units.some(unit=>unit.id===fatal.unitId)).toBe(false);
      const corpse=run.game.corpses!.find(corpse=>corpse.unitId===fatal.unitId)!;
      expect(corpse.x).toBe(fatal.x);expect(corpse.y).toBe(fatal.y);
      deaths++;expect(run.game.corpses).toHaveLength(deaths);
    }
    run.script(run.game,20);
    const stoneHit=run.game.effects.find(effect=>effect.targetKind==='rockGolem');
    // Sample the whole late window, independent of the exact staggered beat.
    let mechanical=stoneHit;
    for(let frame=0;!mechanical&&frame<120;frame++){run.script(run.game,20+frame/30);mechanical=run.game.effects.find(effect=>effect.targetKind==='rockGolem');}
    expect(mechanical).toBeDefined();expect(mechanical!.targetUnitClass).toBe('mechanical');expect(isBloodHit(mechanical!)).toBe(false);
  });

  it('keeps both armies and contact inside the uncovered portrait region and desktop right field',()=>{
    const run=createForestHorde();
    for(const [width,height] of [[1440,900],[1280,720],[390,844]] as const){
      for(const time of [0,6,16.7,31.8]){
        run.script(run.game,time);const view=run.frameAt!(time,width,height);
        expect(view.zoom).toBeGreaterThan(0);expect(Number.isFinite(view.zoom)).toBe(true);
        const screen=run.game.units.map(unit=>({x:(unit.x-view.focus.x)*view.zoom+width*view.anchorX,y:(unit.y-view.focus.y)*view.zoom+height*view.anchorY}));
        expect(Math.min(...screen.map(p=>p.x))).toBeGreaterThan(width<700?0:width*.4);
        expect(Math.max(...screen.map(p=>p.x))).toBeLessThan(width);
        expect(Math.min(...screen.map(p=>p.y))).toBeGreaterThan(65);
        expect(Math.max(...screen.map(p=>p.y))).toBeLessThan(width<700?height-280:height-80);
      }
    }
    expect(run.stillSecond).toBe(16.7);expect(run.game.tick).toBe(Math.floor(31.8*SIM_TICKS_PER_SECOND));
  });
});
