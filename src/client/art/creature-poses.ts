/** Body-specific projected gestures. These are authored drawings, not IK rigs. */
import type { UnitAnimationFrame } from '../unit-animation';
import type { Shape } from './appearance';
import type { EquipmentKind } from './equipment';
import type { XY } from './kit';
import { sampleMotion, actionDirection } from './motion';
import {carryStrength} from './action-direction';
import { socketPoint } from './rig';
const curves:Record<Shape,readonly number[]>={
 stone:[1,.9,.55,.2,.04,0],wood:[1,.8,.4,.1,-.04,0],ogre:[1,.62,.12,-.16,-.07,0],
 hound:[1,.55,.18,-.1,-.04,0],stag:[1,.7,.3,-.12,-.05,0],dragon:[1,.82,.45,.12,.02,0],
 fish:[1,.65,.32,.1,.03,0],spider:[1,.68,.2,-.06,-.02,0],turtle:[1,.72,.28,.05,-.03,0],spirit:[1,.8,.48,.2,.06,0],
};
const mix=(a:XY,z:XY,t:number):XY=>[a[0]+(z[0]-a[0])*t,a[1]+(z[1]-a[1])*t];
export function creatureDrawing(shape:Shape,weapon:EquipmentKind|undefined,frame:UnitAnimationFrame){
 const motion=sampleMotion(frame,'creature'),aim=actionDirection(frame);
 const variant=Math.abs(Math.trunc(frame.variant??0))%3;
 const strike=frame.mode==='attack'?(curves[shape][frame.frame]??0)*[1,.88,.96][variant]!:0;
 const casting=frame.mode==='cast'?motion.castGlow:0,action=Math.max(0,strike,casting);
 const dx=Math.cos(aim.angle)*action,dy=Math.sin(aim.angle)*action;
 const staff=weapon==='staff';
 const ready:XY=shape==='fish'?[22,-5]:[24,-2];
 const contact:XY=(shape==='fish'?[[18,-28],[31,-15],[29,3]]:shape==='stone'||shape==='wood'?[[25,-34],[36,-16],[29,9]]:[[24,-30],[34,-16],[30,2]])[aim.source+1] as XY;
 let hand=staff?mix(ready,[26,-12],casting||Math.max(0,strike)*.5):mix(ready,contact,strike);
 const readyElbow:XY=shape==='fish'?[14,-8]:[23,-14];
 let elbow=mix(readyElbow,(shape==='fish'?[[12,-18],[18,-12],[17,-6]]:[[20,-26],[24,-19],[24,-8]])[aim.source+1] as XY,staff?casting*.4:strike);
 const free=mix(shape==='fish'?[-12,0]:[-25,-1],[[0,-33],[15,-18],[7,2]][aim.source+1] as XY,casting);
 let angle=staff?.04+casting*.06:weapon==='javelin'?.45+(aim.angle+1.2-.45)*strike:.18+(aim.angle+1.4-.18)*strike;
 const carry=carryStrength(frame)/6;
 if(weapon&&carry&&(frame.mode==='idle'||frame.mode==='walk'||frame.mode==='attack')){
  const direction=actionDirection({mode:'attack',frame:0,aim:frame.carryAim??0});
  const amount=carry*(frame.mode==='attack'?(frame.frame===0?0:1-strike):1);
  const guard:XY=(staff?[[23,-6],[24,-4],[24,-2]]:shape==='fish'?[[14,-8],[19,-10],[19,-13]]:[[22,-10],[23,-6],[22,-14]])[direction.source+1] as XY;
  const guardElbow:XY=shape==='fish'?[13,-10]:[20,-15];
  hand=[hand[0]+(guard[0]-ready[0])*amount,hand[1]+(guard[1]-ready[1])*amount];
  elbow=[elbow[0]+(guardElbow[0]-readyElbow[0])*amount,elbow[1]+(guardElbow[1]-readyElbow[1])*amount];
  const guardAngle=staff?.04:weapon==='pike'?direction.angle+Math.PI/2:[-.2,.35,.85][direction.source+1]!+direction.correction*.5;
  angle+=(guardAngle-(staff?.04:weapon==='javelin'?.45:.18))*amount;
 }
 const headX=(shape==='stag'?25:shape==='turtle'?27:shape==='dragon'?35:27)+dx*(shape==='turtle'?12:6)+strike*2;
 const headY=(shape==='stag'?-39:shape==='turtle'?-8:shape==='dragon'?-24:-18)+dy*11+strike*(shape==='stag'?9:2);
 const mouth:XY=[headX+(shape==='stag'?12:14),headY+4];
 const bob=motion.breathe*(shape==='spirit'?1.8:shape==='stone'?.35:.6);
 let release:XY=mouth;
 if(shape==='ogre'||shape==='fish')release=weapon==='javelin'?hand:socketPoint(hand,angle,0,staff?-25:weapon==='pike'?-32:-34);
 else if(shape==='stone'||shape==='wood')release=casting?free:hand;
 else if(shape==='spider')release=[23+dx*7,3+dy*9];
 else if(shape==='spirit')release=[12+dx*12,-26+dy*16];
 return{motion,strike,casting,action,dx,dy,hand,elbow,free,angle,headX,headY,mouth,bob,release,walk:motion.stride,stepLift:frame.mode==='walk'?Math.cos(frame.frame*Math.PI/4):0,variant,aim};
}
export type CreatureDrawing=ReturnType<typeof creatureDrawing>;
