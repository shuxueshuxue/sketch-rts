import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../shared/catalog';
import { createGame, issuePlayerCommand, refreshUnitStats, snapshotGame, stepGame } from '../shared/sim';
import { seconds } from '../shared/time';
import { xpStarThresholds } from '../shared/unit-value';
import type { GameSnapshot, Unit } from '../shared/types';
import type { VeteranSkillId } from '../shared/veteran-skills';
import { battlefieldEffectFrame, drawUnitStatusEffects, drawVeteranCastEffect } from './ability-effects';

function emptyGame() {
  const game=createGame('bareDuel',{players:['player','ally','enemy'],teams:{player:'blue',ally:'blue',enemy:'red'},aiPlayers:[]});
  game.units=[];game.buildings=[];game.items=[];game.resources=[];game.obstacles=[];game.mercenaryCamps=[];
  game.scriptedVictory=true;delete game.map.terrain;
  return game;
}
function advance(game:ReturnType<typeof emptyGame>,ticks:number) {for(let i=0;i<ticks;i++)stepGame(game);}
function learn(game:ReturnType<typeof emptyGame>,unit:Unit,skill:VeteranSkillId) {
  unit.xp=xpStarThresholds(UNIT_DEFS[unit.kind])[2]!;unit.level=3;
  unit.veteranSkillChoices=['veteranResilience','veteranMobility',skill];refreshUnitStats(game,unit);
  issuePlayerCommand(game,unit.owner,{type:'learnVeteranSkill',unitId:unit.id,skill});
}
function statusImage(snapshot:GameSnapshot,unit:Unit,now=1000) {
  const canvas=createCanvas(240,200),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillText=()=>{throw new Error('Persistent status presentation must remain text-free');};
  drawUnitStatusEffects(ctx,unit,battlefieldEffectFrame(snapshot),{x:120,y:110},{x:120,y:130},{x:120,y:55},now);
  return canvas.getContext('2d').getImageData(0,0,240,200).data.some((value,index)=>index%4===3 && value>0);
}

describe('persistent battlefield ability effects',()=>{
  it.each([
    ['murlocHunter','slow',120],['venomSpider','poison',40],
    ['graniteGolem','stun',80],['spiderQueen','root',200],
  ] as const)('shows a real %s status after the caster leaves, then removes it on expiry',(kind,status,gap)=>{
    const game=emptyGame(),caster=game.spawnUnit('neutral',kind,1000,1000),target=game.spawnUnit('player','footman',1000+gap,1000);
    target.hp=target.maxHp=5000;
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[target.id],targetId:caster.id});
    for(let tick=0;tick<120 && !target.effects.some(effect=>effect.type===status);tick++)stepGame(game);
    const active=target.effects.find(effect=>effect.type===status);
    expect(active).toBeDefined();
    game.units=game.units.filter(unit=>unit.id!==caster.id);game.effects=[];target.order={type:'idle'};
    const snapshot=snapshotGame(game),recipient=snapshot.units.find(unit=>unit.id===target.id)!;
    expect(battlefieldEffectFrame(snapshot).statuses.get(target.id)?.map(effect=>effect.type)).toContain(status);
    expect(statusImage(snapshot,recipient)).toBe(true);
    advance(game,active!.remaining+1);
    const expired=snapshotGame(game);
    expect(battlefieldEffectFrame(expired).statuses.has(target.id)).toBe(false);
    expect(statusImage(expired,expired.units.find(unit=>unit.id===target.id)!)).toBe(false);
  });

  it('keeps actual ogre Bloodlust visible after its casting flash expires',()=>{
    const game=emptyGame(),mage=game.spawnUnit('neutral','ogreMage',1000,1000),warrior=game.spawnUnit('neutral','ogreWarrior',1060,1000),enemy=game.spawnUnit('player','footman',1110,1000);
    enemy.hp=enemy.maxHp=5000;
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[enemy.id],targetId:warrior.id});
    for(let tick=0;tick<100 && !game.units.some(unit=>unit.effects.some(effect=>effect.type==='bloodlust'));tick++)stepGame(game);
    const recipient=game.units.find(unit=>unit.effects.some(effect=>effect.type==='bloodlust'))!;
    expect(recipient).toBeDefined();
    game.units=game.units.filter(unit=>unit.owner==='neutral');mage.autocast={bloodlust:false};
    for(const unit of game.units)unit.order={type:'idle'};
    advance(game,seconds(2));
    expect(game.effects.some(effect=>effect.type==='bloodlust')).toBe(false);
    const snapshot=snapshotGame(game);
    expect(statusImage(snapshot,snapshot.units.find(unit=>unit.id===recipient.id)!)).toBe(true);
  });

  it.each(['veteranRally','veteranInnerFire'] as const)('keeps real %s recipients marked after its cast pulse, then expires cleanly',skill=>{
    const game=emptyGame(),caster=game.spawnUnit('player',skill==='veteranRally'?'footman':'priest',800,800),recipient=game.spawnUnit('ally','footman',870,800);
    learn(game,caster,skill);caster.autocast={[skill]:false};
    issuePlayerCommand(game,'player',{type:'cast',unitId:caster.id,ability:skill});
    const effect=game.effects.find(effect=>effect.unitId===caster.id && effect.radius)!;
    expect(effect).toBeDefined();
    const canvas=createCanvas(400,240),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(drawVeteranCastEffect(ctx,effect,caster,{x:200,y:110})).toBe(true);
    expect(canvas.getContext('2d').getImageData(0,0,400,240).data.some((value,index)=>index%4===3 && value>0)).toBe(true);
    advance(game,seconds(2));ctx.clearRect(0,0,400,240);
    expect(drawVeteranCastEffect(ctx,game.effects.find(candidate=>candidate.id===effect.id)!,caster,{x:200,y:110})).toBe(true);
    expect(canvas.getContext('2d').getImageData(0,0,400,240).data.some((value,index)=>index%4===3 && value>0)).toBe(false);
    expect(drawVeteranCastEffect(ctx,game.effects.find(candidate=>candidate.id===effect.id)!,undefined,{x:200,y:110})).toBe(true);
    expect(canvas.getContext('2d').getImageData(0,0,400,240).data.some((value,index)=>index%4===3 && value>0)).toBe(false);
    const snapshot=snapshotGame(game),marked=snapshot.units.find(unit=>unit.id===recipient.id)!;
    expect(statusImage(snapshot,marked)).toBe(true);
    expect(game.units.find(unit=>unit.id===recipient.id)!.effects[0]!.remaining).toBeGreaterThan(0);
    advance(game,seconds(4)+1);
    const expired=snapshotGame(game);
    expect(statusImage(expired,expired.units.find(unit=>unit.id===recipient.id)!)).toBe(false);
  });

  it('distinguishes the real veteran healing wave from ordinary priest and ogre casts',()=>{
    const game=emptyGame(),caster=game.spawnUnit('player','priest',800,800),recipient=game.spawnUnit('ally','footman',870,800);
    recipient.hp-=60;caster.autocast={heal:false,veteranHealingWave:false};learn(game,caster,'veteranHealingWave');
    issuePlayerCommand(game,'player',{type:'cast',unitId:caster.id,ability:'veteranHealingWave'});
    expect(recipient.hp).toBe(recipient.maxHp-30);
    const effect=game.effects.find(effect=>effect.type==='heal')!,canvas=createCanvas(400,240),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(drawVeteranCastEffect(ctx,effect,caster,{x:200,y:100})).toBe(true);
    const {radius:_radius,...ordinary}=effect;
    expect(drawVeteranCastEffect(ctx,ordinary,caster,{x:200,y:100})).toBe(false);
    const ogre=game.spawnUnit('neutral','ogreMage',1200,1000);
    expect(drawVeteranCastEffect(ctx,{...effect,type:'bloodlust'},ogre,{x:200,y:100})).toBe(false);
    expect(battlefieldEffectFrame(snapshotGame(game)).statuses.has(recipient.id)).toBe(false);
  });

  it('projects real aura eligibility once, without granting enemy, remote or sheltered bonuses',()=>{
    const game=emptyGame(),leader=game.spawnUnit('player','footman',800,800),ally=game.spawnUnit('ally','footman',880,800),enemy=game.spawnUnit('enemy','footman',900,800),remote=game.spawnUnit('ally','footman',1200,800),sheltered=game.spawnUnit('ally','footman',850,820);
    learn(game,leader,'veteranCommand');
    const snapshot=snapshotGame(game),hidden=snapshot.units.find(unit=>unit.id===sheltered.id)!;
    hidden.deck={shipId:'shelter',x:0,y:0};hidden.cabin={shipId:'shelter'};
    const original=JSON.stringify(snapshot),frame=battlefieldEffectFrame(snapshot);
    expect(frame.veterans.get(ally.id)?.attackSpeedMultiplier).toBe(1.35);
    expect([enemy.id,remote.id,sheltered.id].every(id=>!frame.veterans.has(id))).toBe(true);
    expect(battlefieldEffectFrame(snapshot)).toBe(frame);
    expect(JSON.stringify(snapshot)).toBe(original);
    const next={...snapshot,tick:snapshot.tick+1,units:snapshot.units.map(unit=>unit.id===leader.id?{...unit,hp:0}:unit)};
    expect(battlefieldEffectFrame(next).veterans.has(ally.id)).toBe(false);
    expect(statusImage(snapshot,hidden)).toBe(false);
  });

  it('shows renewal only on eligible living bodies and keeps temporary attack-speed signs unstacked',()=>{
    const game=emptyGame(),leader=game.spawnUnit('player','priest',800,800),ally=game.spawnUnit('ally','footman',880,800),machine=game.spawnUnit('ally','catapult',910,800);
    learn(game,leader,'veteranRenewal');
    ally.effects=[{type:'bloodlust',remaining:20},{type:'veteranBuff',remaining:80,attackSpeedMultiplier:1.2}];
    const snapshot=snapshotGame(game),frame=battlefieldEffectFrame(snapshot);
    expect(frame.veterans.get(ally.id)?.regenPerSecond).toBe(3);
    expect(frame.veterans.get(machine.id)?.regenPerSecond ?? 0).toBe(0);
    expect(frame.statuses.get(ally.id)).toHaveLength(1);
    expect(frame.statuses.get(ally.id)?.[0]?.type).toBe('bloodlust');
    advance(game,21);
    expect(battlefieldEffectFrame(snapshotGame(game)).statuses.get(ally.id)?.[0]?.type).toBe('veteranBuff');
  });
});
