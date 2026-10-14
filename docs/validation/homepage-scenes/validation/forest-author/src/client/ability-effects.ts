import { buildVeteranFrame, type VeteranUnitModifiers } from '../shared/veteran-runtime';
import { isVeteranActiveSkillId, isVeteranSkillId, VETERAN_ACTIVE_SKILL_IDS, VETERAN_SKILLS, type VeteranSkillEffect } from '../shared/veteran-skills';
import { isInCabin } from '../shared/ship-cabin';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { GameSnapshot, Unit, UnitStatusEffect, WorldEffect } from '../shared/types';
import { effectiveUnitStatusEffects } from './status-presentation';

type Point = { x:number;y:number };
type EffectFrame = {
  statuses:ReadonlyMap<string,readonly UnitStatusEffect[]>;
  veterans:ReadonlyMap<string,VeteranUnitModifiers>;
};
const frames=new WeakMap<GameSnapshot,{tick:number;units:Unit[];count:number;frame:EffectFrame}>();
const EMPTY:EffectFrame={statuses:new Map(),veterans:new Map()};

/** The renderer projects actual buffs once per network snapshot, not once per
 * drawn unit. Spatial buckets keep many overlapping veteran auras local; the
 * authoritative runtime still owns alliance, cabin and target eligibility. */
export function battlefieldEffectFrame(snapshot:GameSnapshot):EffectFrame {
  const known=frames.get(snapshot);
  if(known && known.tick===snapshot.tick && known.units===snapshot.units && known.count===snapshot.units.length)return known.frame;
  let hasVeterans=false,hasAuras=false;
  const statuses=new Map<string,readonly UnitStatusEffect[]>();
  for(const unit of snapshot.units) {
    if(unit.hp<=0 || isInCabin(unit))continue;
    if(unit.effects.length) {
      const active=effectiveUnitStatusEffects(unit);
      if(active.length)statuses.set(unit.id,active);
    }
    if(isVeteranSkillId(unit.veteranSkill)) {
      const effect=VETERAN_SKILLS[unit.veteranSkill].effect;
      hasVeterans ||= effect.type!=='active';hasAuras ||= effect.type==='aura';
    }
  }
  let veterans:ReadonlyMap<string,VeteranUnitModifiers>=EMPTY.veterans;
  if(hasVeterans && !hasAuras)veterans=buildVeteranFrame(snapshot);
  if(hasAuras) {
    const cell=192,buckets=new Map<string,Unit[]>();
    for(const unit of snapshot.units) {
      if(unit.hp<=0 || isInCabin(unit))continue;
      const key=`${Math.floor(unit.x/cell)}:${Math.floor(unit.y/cell)}`,bucket=buckets.get(key);
      if(bucket)bucket.push(unit);else buckets.set(key,[unit]);
    }
    const nearby=function*(x:number,y:number,radius:number) {
      for(let row=Math.floor((y-radius)/cell);row<=Math.floor((y+radius)/cell);row++)
        for(let col=Math.floor((x-radius)/cell);col<=Math.floor((x+radius)/cell);col++) {
          const bucket=buckets.get(`${col}:${row}`);if(bucket)yield* bucket;
        }
    };
    veterans=buildVeteranFrame(snapshot,nearby);
  }
  const frame=!statuses.size && !veterans.size ? EMPTY : {statuses,veterans};
  frames.set(snapshot,{tick:snapshot.tick,units:snapshot.units,count:snapshot.units.length,frame});
  return frame;
}

const INK={curse:'#bb78cd',guardian:'#ffe091',protection:'#9acfe8',slow:'#83bcd0',stun:'#ffe279',root:'#eae4cc',poison:'#83b847',bloodlust:'#d96e50',veteranBuff:'#efbc61'} as const;
function stroke(ctx:CanvasRenderingContext2D,color:string) {
  ctx.strokeStyle='#243238';ctx.lineWidth=3;ctx.stroke();
  ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();
}
function shield(ctx:CanvasRenderingContext2D,x:number,y:number,size:number) {
  ctx.moveTo(x,y-size);ctx.lineTo(x+size*.65,y-size*.55);ctx.lineTo(x+size*.5,y+size*.45);
  ctx.lineTo(x,y+size);ctx.lineTo(x-size*.5,y+size*.45);ctx.lineTo(x-size*.65,y-size*.55);ctx.closePath();
}
function star(ctx:CanvasRenderingContext2D,x:number,y:number,size:number) {
  for(let corner=0;corner<10;corner++) {
    const angle=-Math.PI/2+corner*Math.PI/5,r=corner%2?size*.42:size;
    const px=x+Math.cos(angle)*r,py=y+Math.sin(angle)*r;
    if(corner)ctx.lineTo(px,py);else ctx.moveTo(px,py);
  }
  ctx.closePath();
}
function chevrons(ctx:CanvasRenderingContext2D,x:number,y:number,r:number) {
  for(let i=0;i<2;i++){const at=y+i*7;ctx.moveTo(x-r*.35,at+4);ctx.lineTo(x,at);ctx.lineTo(x+r*.35,at+4);}
}

/** Compact, text-free status language. Positions are the actor's drawn pose:
 * Canvas fallback, projected 3D body, deck and gangway all use this same path.
 * No particle objects, gradients, timers, textures or GPU resources survive it. */
export function drawUnitStatusEffects(ctx:CanvasRenderingContext2D,unit:Unit,frame:EffectFrame,
  body:Point,feet:Point,top:Point,now:number,reducedMotion=false,selected=false) {
  if(unit.hp<=0 || isInCabin(unit))return;
  const statuses=frame.statuses.get(unit.id),veteran=frame.veterans.get(unit.id);
  const skill=isVeteranSkillId(unit.veteranSkill)?VETERAN_SKILLS[unit.veteranSkill].effect:undefined;
  if(!statuses?.length && !veteran && skill?.type!=='aura')return;
  const r=Math.max(10,Math.min(42,unit.bodyRadius ?? unit.radius));
  const phase=reducedMotion?0:now/640+unit.id.charCodeAt(unit.id.length-1)*.13;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  if(statuses)for(const status of statuses) {
    if(status.type==='scorch' || status.remaining<=0)continue; // Existing body flames remain the burn language.
    ctx.globalAlpha=Math.min(1,status.remaining/SIM_TICKS_PER_SECOND)*.83;
    const color=INK[status.type];ctx.beginPath();
    if(status.type==='stun') {
      for(let i=0;i<3;i++){const a=phase+i*Math.PI*2/3;star(ctx,top.x+Math.cos(a)*r*.7,top.y-5+Math.sin(a)*3,3.5);}
    }else if(status.type==='root') {
      ctx.ellipse(feet.x,feet.y,r+5,(r+5)*.45,0,0,Math.PI*2);
      for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.moveTo(feet.x,feet.y);ctx.lineTo(feet.x+Math.cos(a)*(r+5),feet.y+Math.sin(a)*(r+5)*.45);}
      ctx.ellipse(feet.x,feet.y,r*.55,r*.25,0,0,Math.PI*2);
    }else if(status.type==='slow') {
      for(let side=-1;side<=1;side+=2){const x=feet.x+side*r*.6;ctx.moveTo(x,feet.y-6);ctx.lineTo(x,feet.y+4);ctx.moveTo(x-4,feet.y-2);ctx.lineTo(x+4,feet.y-2);ctx.moveTo(x-3,feet.y-5);ctx.lineTo(x+3,feet.y+1);}
    }else if(status.type==='poison') {
      for(let i=0;i<3;i++){const rise=reducedMotion ? .5 : (phase*.35+i/3)%1;const x=body.x+(i-1)*r*.65,y=feet.y-rise*24;ctx.moveTo(x,y-4);ctx.quadraticCurveTo(x+5,y+1,x,y+4);ctx.quadraticCurveTo(x-5,y+1,x,y-4);}
    }else if(status.type==='curse') {
      for(let i=0;i<3;i++){const a=phase*.5+i*Math.PI*2/3,x=body.x+Math.cos(a)*(r+4),y=body.y-16+Math.sin(a)*6;ctx.moveTo(x-3,y-5);ctx.lineTo(x+2,y);ctx.lineTo(x-3,y+5);}
    }else if(status.type==='guardian' || status.type==='protection') {
      for(let side=-1;side<=1;side+=2)shield(ctx,body.x+side*(r+3),body.y-16,7);
      if(status.type==='guardian')ctx.ellipse(feet.x,feet.y,r+8,(r+8)*.45,0,0,Math.PI*2);
    }else {
      const lift=reducedMotion?0:Math.sin(phase)*2;
      chevrons(ctx,body.x,body.y-28-lift,r);
      ctx.moveTo(feet.x-r*.8,feet.y-2);ctx.lineTo(feet.x-r*.5,feet.y-9);
      ctx.moveTo(feet.x+r*.8,feet.y-2);ctx.lineTo(feet.x+r*.5,feet.y-9);
    }
    stroke(ctx,color);
  }
  if(skill?.type==='aura') {
    const color=skill.modifiers.regenPerSecond?'#91be73':skill.modifiers.moveSpeedMultiplier?'#8fced0':skill.modifiers.damageReduction?'#9eb9d7':'#e3c778';
    ctx.globalAlpha=.42+(reducedMotion?0:Math.sin(phase)*.07);ctx.beginPath();
    for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.ellipse(feet.x,feet.y,r+9,(r+9)*.45,0,a,a+Math.PI*.28);}
    stroke(ctx,color);
    if(selected){ctx.globalAlpha=.2;ctx.beginPath();ctx.ellipse(feet.x,feet.y,skill.radius,skill.radius*.45,0,0,Math.PI*2);stroke(ctx,color);}
  }
  if(veteran) {
    ctx.globalAlpha=.55;ctx.beginPath();
    if(veteran.reductions.length)shield(ctx,body.x-r-4,body.y-4,4);
    if(veteran.attackSpeedMultiplier>1)chevrons(ctx,body.x+r+4,body.y-5,8);
    if(veteran.moveSpeedMultiplier>1 && (unit.order.type==='move'||unit.order.type==='charge')) {
      for(let side=-1;side<=1;side+=2){ctx.moveTo(feet.x+side*r,feet.y+2);ctx.lineTo(feet.x+side*(r+8),feet.y+5);}
    }
    if(veteran.regenPerSecond>0 && unit.hp<unit.maxHp) {
      const lift=reducedMotion?10:(phase*.4%1)*19;
      ctx.moveTo(body.x+r*.6-3,body.y-9-lift);ctx.lineTo(body.x+r*.6+3,body.y-9-lift);
      ctx.moveTo(body.x+r*.6,body.y-12-lift);ctx.lineTo(body.x+r*.6,body.y-6-lift);
    }
    if(selected && (veteran.aimSpeedMultiplier>1 || veteran.attackRangeMultiplier>1)) {
      for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.ellipse(feet.x,feet.y,r+14,(r+14)*.45,0,a,a+Math.PI*.18);}
    }
    stroke(ctx,'#d7c991');
  }
  ctx.restore();
}

/** Veteran active abilities reuse simulation effect types. Resolve the real
 * learned skill and radius rather than mistaking every red flare for an ogre
 * spell; recipients retain their own visible status after this cast pulse. */
export function drawVeteranCastEffect(ctx:CanvasRenderingContext2D,effect:WorldEffect,caster:Unit|undefined,
  point:Point,reducedMotion=false):boolean {
  if(effect.radius===undefined)return false;
  // A death or fog change can remove the caster while its emitted effect is
  // still visible. These three radius/type signatures are unique in the actual
  // effect catalog; ordinary spells and item fields do not carry them.
  let skill:VeteranSkillEffect|undefined;
  if(caster) {
    if(!isVeteranActiveSkillId(caster.veteranSkill))return false;
    skill=VETERAN_SKILLS[caster.veteranSkill].effect;
  }else {
    if(!effect.unitId || !effect.sourceKind)return false;
    for(const id of VETERAN_ACTIVE_SKILL_IDS) {
      const candidate=VETERAN_SKILLS[id].effect;
      if(matchesVeteranCast(effect,candidate)){skill=candidate;break;}
    }
  }
  if(!skill || !matchesVeteranCast(effect,skill))return false;
  const age=(effect.duration-effect.remaining)/SIM_TICKS_PER_SECOND,span=.9;
  if(age>=span)return true;
  const p=Math.max(0,age/span),color=skill.action==='heal'?'#acd18a':skill.modifiers.damageReduction?'#b4daed':'#e7c27b';
  const radius=reducedMotion?Math.min(42,skill.radius):14+p*skill.radius;
  ctx.save();ctx.globalAlpha=(1-p)*.75;ctx.beginPath();
  ctx.ellipse(point.x,point.y+10,radius,radius*.45,0,0,Math.PI*2);stroke(ctx,color);
  for(let i=0;i<6;i++){const a=i*Math.PI/3,x=point.x+Math.cos(a)*radius*.7,y=point.y+10+Math.sin(a)*radius*.32;ctx.beginPath();
    if(skill.action==='heal'){ctx.moveTo(x-5,y);ctx.lineTo(x+5,y);ctx.moveTo(x,y-5);ctx.lineTo(x,y+5);}
    else if(skill.modifiers.damageReduction)shield(ctx,x,y,6);
    else chevrons(ctx,x,y-5,12);
    stroke(ctx,color);
  }
  ctx.restore();return true;
}

function matchesVeteranCast(effect:WorldEffect,skill:VeteranSkillEffect):skill is Extract<VeteranSkillEffect,{type:'active'}> {
  return skill.type==='active' && effect.radius===skill.radius
    && effect.type===(skill.action==='heal'?'heal':skill.modifiers.damageReduction?'guardianField':'bloodlust');
}
