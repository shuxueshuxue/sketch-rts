/** Deterministic, bounded client-only hit debris. Simulation emits facts, never
 * particles; all positions are world units and height points up from the floor. */
import { circleInPolygon, shipProfile, SHIP_CAMERA } from '../shared/ship-geometry';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { GameSnapshot, Unit, WorldEffect } from '../shared/types';

export type BloodDroplet = { x:number; y:number; height:number; vx:number; vy:number; vz:number; radius:number; alpha:number };
export type GroundBlood = { x:number; y:number; height:number; radius:number; angle:number; alpha:number };
/** localX/localY are drawing offsets (screen-world units) from the unit's feet.
 * Mirror localX with current facing; localY projects physical height by camera tilt. */
export type BodyBlood = GroundBlood & { unitId:string; height:number; localX:number; localY:number };
export type CombatSpeedLine = { unitId:string; x:number; y:number; dx:number; dy:number; length:number; width:number; height:number; alpha:number };
export type CombatPresentationFrame = { droplets:BloodDroplet[]; ground:GroundBlood[]; body:BodyBlood[]; speedLines:CombatSpeedLine[] };
type Snapshot = Pick<GameSnapshot,'tick'|'units'|'effects'>;
type Drop = { vx:number; vy:number; vz:number; height:number; landTime:number; radius:number; angle:number; air:BloodDroplet; ground:GroundBlood };
type Burst = { id:string; tick:number; unitId:string; x:number; y:number; deck?:NonNullable<WorldEffect['targetDeck']>; floor:number; drops:Drop[]; mark:BodyBlood };
type Position = { x:number; y:number; deck?:{x:number;y:number;shipId:string} };
const TICK_MS=1000/SIM_TICKS_PER_SECOND;
const GRAVITY=180;
const LIFE=9;
const BODY_LIFE=6;
export const COMBAT_PRESENTATION_LIMITS=Object.freeze({ bursts:48, residueBursts:96, dropletsPerBurst:10, speedLines:128, seenEvents:2048 });

/** Non-mechanical targets bleed only on a lethal or genuinely close-to-lethal
 * hit. Missing old-save metadata is not guessed from a later live unit. */
export function isBloodHit(effect:WorldEffect):boolean {
  return effect.type==='hit' && effect.targetUnitClass==='nonMechanical' && !!effect.targetKind
    && Number.isFinite(effect.damage) && effect.damage!>0
    && Number.isFinite(effect.targetHpAfter) && effect.targetHpAfter!<=effect.damage!*2
    && Number.isFinite(effect.targetMaxHp) && effect.targetMaxHp!>0;
}

export class CombatPresentationTracker {
  private tick:number|undefined;
  private receivedAt=0;
  private effects: readonly WorldEffect[] | undefined;
  private effectCount=-1;
  private frameNow:number|undefined;
  private overflowThrough=-1;
  private scratch={x:0,y:0};
  private bursts:Burst[]=[];
  private residue:Burst[]=[];
  private seen=new Map<string,number>();
  private positions=new Map<string,Position>();
  private units=new Map<string,Unit>();
  private lines:CombatSpeedLine[]=[];
  private output:CombatPresentationFrame={droplets:[],ground:[],body:[],speedLines:[]};

  reset() {
    this.tick=undefined;this.effects=undefined;this.effectCount=-1;this.receivedAt=0;this.frameNow=undefined;this.overflowThrough=-1;this.bursts.length=0;this.residue.length=0;this.seen.clear();this.positions.clear();this.units.clear();this.lines.length=0;
    this.output.droplets.length=0;this.output.ground.length=0;this.output.body.length=0;this.output.speedLines.length=0;
  }

  update(snapshot:Snapshot,now:number) {
    if(this.tick!==undefined && snapshot.tick<this.tick)this.reset();
    const sameTick=snapshot.tick===this.tick;
    if(sameTick&&snapshot.effects===this.effects&&snapshot.effects.length===this.effectCount)return;
    this.effects=snapshot.effects;this.effectCount=snapshot.effects.length;
    this.frameNow=undefined;
    const gap=this.tick===undefined?0:snapshot.tick-this.tick;
    this.tick=snapshot.tick;if(!sameTick)this.receivedAt=now;
    this.units.clear();for(const unit of snapshot.units)this.units.set(unit.id,unit);
    this.bursts=this.bursts.filter(burst=>(snapshot.tick-burst.tick)/SIM_TICKS_PER_SECOND<LIFE);
    this.residue=this.residue.filter(burst=>(snapshot.tick-burst.tick)/SIM_TICKS_PER_SECOND<LIFE);
    for(const [id,tick] of this.seen)if(snapshot.tick-tick>LIFE*SIM_TICKS_PER_SECOND)this.seen.delete(id);
    const previouslyOverflowed=this.overflowThrough;
    for(const effect of snapshot.effects) {
      if(!isBloodHit(effect)||this.seen.has(effect.id))continue;
      const tick=snapshot.tick-Math.max(0,effect.duration-effect.remaining);
      if(snapshot.tick-tick>=LIFE*SIM_TICKS_PER_SECOND||tick<=previouslyOverflowed)continue;
      this.seen.set(effect.id,tick);
      this.bursts.push(makeBurst(effect,tick));
      if(this.bursts.length>COMBAT_PRESENTATION_LIMITS.bursts) {
        this.residue.push(this.bursts.shift()!);
        if(this.residue.length>COMBAT_PRESENTATION_LIMITS.residueBursts)this.residue.shift();
      }
      if(this.seen.size>COMBAT_PRESENTATION_LIMITS.seenEvents) { this.seen.delete(this.seen.keys().next().value!);this.overflowThrough=snapshot.tick; }
    }
    // A hit can arrive between draws of the same tick. Consume it without
    // treating an unchanged position as a new motion observation.
    if(sameTick)return;
    this.lines.length=0;
    const next=new Map<string,Position>();
    for(const unit of snapshot.units) {
      const previous=this.positions.get(unit.id);
      next.set(unit.id,{x:unit.x,y:unit.y,...(unit.deck?{deck:{...unit.deck}}:{})});
      if(!previous||gap<=0||gap>4||unit.hp<=0||unit.effects.some(e=>e.type==='stun'))continue;
      // Crew motion is relative to the deck, never the ship carrying it.
      const aboard=unit.deck||previous.deck;
      if(aboard&&unit.deck?.shipId!==previous.deck?.shipId)continue;
      let dx=aboard?unit.deck!.x-previous.deck!.x:unit.x-previous.x;
      let dy=aboard?unit.deck!.y-previous.deck!.y:unit.y-previous.y;
      if(unit.deck) {
        const heading=this.units.get(unit.deck.shipId)?.sailing?.heading??0,c=Math.cos(heading),s=Math.sin(heading);
        const localDx=dx;dx=dx*c-dy*s;dy=localDx*s+dy*c;
      }
      const distance=Math.hypot(dx,dy), speed=distance*SIM_TICKS_PER_SECOND/gap;
      const forced=(unit.pushX!==undefined||unit.pushY!==undefined)&&speed>Math.max(35,unit.speed*1.15);
      const charging=unit.order.type==='charge'&&speed>Math.max(20,unit.speed*.7);
      if((!charging&&!forced)||distance<.1||speed>1200)continue; // ignore teleports
      const normX=dx/distance,normY=dy/distance;
      const strength=Math.min(1,speed/300);
      for(let i=0;i<3&&this.lines.length<COMBAT_PRESENTATION_LIMITS.speedLines;i++) {
        const side=(i-1)*unit.radius*.65;
        this.lines.push({unitId:unit.id,x:unit.x-normY*side,y:unit.y+normX*side,dx:normX,dy:normY,length:Math.min(75,12+speed*.13)*(i===1?1:.73),width:.65+strength*.6,height:unit.radius*(.35+i*.38),alpha:.18+strength*.35});
      }
    }
    this.positions=next;
  }

  /** Returned records are reused until the next call; render immediately or
   * copy for retained captures. Never drives the simulation or an RNG. */
  frame(now:number):CombatPresentationFrame {
    const out=this.output;
    if(this.frameNow===now)return out;
    this.frameNow=now;
    out.droplets.length=0;out.ground.length=0;out.body.length=0;out.speedLines.length=0;
    if(this.tick===undefined)return out;
    const fraction=Math.max(0,Math.min(1,(now-this.receivedAt)/TICK_MS));
    const clock=this.tick+fraction;
    for(let index=0;index<this.residue.length+this.bursts.length;index++) {
      const active=index>=this.residue.length;
      const burst=active?this.bursts[index-this.residue.length]!:this.residue[index]!;
      const age=Math.max(0,(clock-burst.tick)/SIM_TICKS_PER_SECOND);
      if(age>=LIFE)continue;
      // The wound belongs to the surviving actor, independently of the
      // surface on which the hit happened (they may since have disembarked).
      const unit=this.units.get(burst.unitId);
      if(active&&unit&&unit.hp>0&&age<BODY_LIFE) {
        const p=burst.mark;p.x=unit.x;p.y=unit.y;p.alpha=.65*fade(age,3,BODY_LIFE);out.body.push(p);
      }
      const hull=burst.deck?this.units.get(burst.deck.shipId):undefined;
      const profile=hull&&hull.hp>0?shipProfile(hull):undefined;
      if(burst.deck&&!profile)continue;
      const heading=hull?.sailing?.heading??0,c=Math.cos(heading),s=Math.sin(heading);
      for(const drop of burst.drops) {
        const t=Math.min(age,drop.landTime);
        const localX=burst.x+drop.vx*t,localY=burst.y+drop.vy*t;
        this.scratch.x=localX;this.scratch.y=localY;
        if(profile&&!circleInPolygon(this.scratch,drop.radius,profile.deck))continue;
        const x=hull?hull.x+localX*c-localY*s:localX;
        const y=hull?hull.y+localX*s+localY*c:localY;
        if(age<drop.landTime) {
          if(!active)continue;
          const p=drop.air;
          p.x=x;p.y=y;
          p.height=(profile?.deckHeight??burst.floor)+Math.max(0,drop.height+drop.vz*age-.5*GRAVITY*age*age);
          p.vx=drop.vx*c-drop.vy*s;p.vy=drop.vx*s+drop.vy*c;
          p.vz=drop.vz-GRAVITY*age;
          out.droplets.push(p);
        }else{
          const p=drop.ground;p.x=x;p.y=y;p.height=profile?.deckHeight??burst.floor;p.angle=drop.angle+(hull?.sailing?.heading??0);
          p.alpha=.58*fade(age,5,LIFE);
          out.ground.push(p);
        }
      }
    }
    for(const line of this.lines)out.speedLines.push(line);
    return out;
  }
}

const fade=(age:number,start:number,end:number)=>Math.max(0,Math.min(1,(end-age)/(end-start)));
function makeBurst(effect:WorldEffect,tick:number):Burst {
  const random=seeded(effect.id+':'+tick);
  const radius=Math.max(6,Math.min(60,effect.targetRadius??17));
  const severity=Math.min(1,effect.damage!/effect.targetMaxHp!);
  const count=Math.min(COMBAT_PRESENTATION_LIMITS.dropletsPerBurst,3+Math.floor(Math.sqrt(severity)*7));
  const from=Number.isFinite(effect.fromX)&&Number.isFinite(effect.fromY);
  const direction=(from?Math.atan2(effect.y-effect.fromY!,effect.x-effect.fromX!):0)-(effect.targetDeck?.heading??0);
  const floor=effect.targetDeck?Math.max(0,(effect.toHeight??18)-18):0;
  const originX=effect.targetDeck?.x??effect.x,originY=effect.targetDeck?.y??effect.y;
  const drops:Drop[]=[];
  const height=radius*(1.2+random()*.45);
  for(let i=0;i<count;i++) {
    const angle=from?direction+(random()-.5)*1.5:random()*Math.PI*2;
    const speed=(12+Math.sqrt(severity)*55)*(.5+random()*.65);
    const vx=Math.cos(angle)*speed,vy=Math.sin(angle)*speed;
    const vz=10+random()*32;
    const landTime=(vz+Math.sqrt(vz*vz+2*GRAVITY*height))/GRAVITY;
    const size=.65+Math.sqrt(severity)*(1+random()*1.7);
    drops.push({vx,vy,vz,height,landTime,radius:size,angle,
      air:{x:effect.x,y:effect.y,height:floor+height,vx,vy,vz,radius:size,alpha:.86},
      ground:{x:originX+vx*landTime,y:originY+vy*landTime,height:floor,radius:size*1.5,angle,alpha:.58},
    });
  }
  return {id:effect.id,tick,unitId:effect.unitId??'',x:originX,y:originY,...(effect.targetDeck?{deck:effect.targetDeck}:{}),floor,drops,
    mark:{unitId:effect.unitId??'',x:effect.x,y:effect.y,height,localX:(random()-.5)*radius*.5,localY:-height*Math.tan(SHIP_CAMERA.tilt),radius:1.4+severity*2.6,angle:random()*Math.PI,alpha:.65}};
}
function seeded(text:string):()=>number {
  let state=2166136261;
  for(let i=0;i<text.length;i++)state=Math.imul(state^text.charCodeAt(i),16777619);
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
}
