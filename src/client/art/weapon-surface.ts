/** Solid equipment surfaces in the same authored coordinates as the painters.
 * Coordinates are relative to feet; stains use segment position, not screen XY. */
import type {UnitKind} from '../../shared/types';
import type {UnitAnimationFrame} from '../unit-animation';
import type {XY} from './kit';
import type {EquipmentKind} from './equipment';
import {figures,creatures} from './appearance';
import {sampleFigurePose,socketPoint,type FigurePresentation} from './rig';
import {creatureDrawing} from './creature-poses';
import {creatureGround,type CreaturePresentation} from './painted-creatures';
export type WeaponSegment={a:XY;b:XY;width:number};
export type WeaponSurface={key:string;segments:WeaponSegment[]};
const segment=(a:XY,b:XY,width:number):WeaponSegment=>({a,b,width});
function geometry(weapon:EquipmentKind,rigid=false):WeaponSegment[]{
 if(weapon==='none'||weapon==='sling')return [];
 if(weapon==='bow')return [segment([0,-17],[6,-9],1.5),segment([6,-9],[8,0],1.5),segment([8,0],[6,10],1.5),segment([6,10],[0,17],1.5)];
 if(weapon==='pike'||weapon==='pitchfork')return rigid?[segment([0,25],[0,-22],1),segment([0,-22],[0,-31],1.6)]:[segment([-23,0],[39,0],1),segment([39,0],[47,0],1.4)];
 if(weapon==='javelin')return [segment([0,14],[0,-16],1),segment([0,-16],[0,-25],1.4)];
 if(weapon==='staff'||weapon==='crozier')return [segment([0,24],[0,-23],1)];
 if(weapon==='club')return [segment([0,5],[0,-24],1.5),segment([1,-24],[0,-36],4)];
 if(weapon==='axe')return [segment([0,3],[0,-25],1.2),segment([9,-25],[8,-18],3)];
 if(weapon==='pick')return [segment([0,12],[0,-20],1.2),segment([-7,-19],[8,-19],1.2)];
 const scale=weapon==='greatSword'?1.15:1;
 return [segment([0,-6*scale],[0,-27*scale],1.6*scale)];
}
export function figureWeaponSurface(kind:UnitKind,pose:UnitAnimationFrame,presentation:FigurePresentation={},size=1):WeaponSurface|undefined{
 const base=figures[kind];if(!base)return;
 const f={...base,...presentation.appearance},rig=sampleFigurePose(f,pose,presentation);
 if(rig.weapon==='javelin'&&rig.impact>=.7)return;
 const local=geometry(rig.weapon);if(!local.length)return;
 const transform=(p:XY):XY=>{
  const [x,y]=socketPoint(rig.wrist,rig.angle,...p),c=Math.cos(rig.lean),s=Math.sin(rig.lean);
  let px=x*c-(y+4)*s+rig.impact*(f.mounted?.65:2),py=x*s+(y+4)*c-4+rig.motion.lift+rig.motion.breathe+rig.bodyDrop;
  if(f.mounted){px=-3+px*.84;py=-17+py*.84;}
  return [px*size,(py-17)*size];
 };
 return {key:rig.weapon,segments:local.map(s=>({a:transform(s.a),b:transform(s.b),width:s.width*size*(f.mounted?.84:1)}))};
}
export function creatureWeaponSurface(kind:UnitKind,pose:UnitAnimationFrame,presentation:CreaturePresentation={}):WeaponSurface|undefined{
 const def=creatures[kind];if(!def?.weapon)return;
 const p=creatureDrawing(def.shape,def.weapon,pose),size=presentation.size??def.size??1;
 if(def.weapon==='javelin'&&p.strike>=.7)return;
 const ground=creatureGround(kind,presentation),offset=def.shape==='ogre'?18-23*size:0;
 const transform=(point:XY):XY=>{const [x,y]=socketPoint(p.hand,p.angle,...point);return[x*size,(y+p.bob)*size+offset-ground];};
 return {key:def.weapon,segments:geometry(def.weapon,true).map(s=>({a:transform(s.a),b:transform(s.b),width:s.width*size}))};
}
