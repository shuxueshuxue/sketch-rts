/** Renderer inputs for blood contact: shared poses, equipment and facing. */
import {SHIP_CAMERA,shipProfile} from '../shared/ship-geometry';
import {activeItem} from '../shared/equipment';
import type {GameSnapshot,Unit} from '../shared/types';
import type {UnitModel} from '../story/cast';
import {unitGlyphScale} from './glyphs';
import {IDLE_FRAME,type UnitAnimationTracker} from './unit-animation';
import type {UnitFacingTracker} from './unit-facing';
import {projectActionFrame} from './art/action-direction';
import {appearanceFor} from './art/unit-appearance';
import {figureWeaponSurface,creatureWeaponSurface,type WeaponSurface} from './art/weapon-surface';
export type BloodSurface={facing:1|-1;floor:number;bodyScale?:number;weapon?:WeaponSurface};
export type BloodSurfaceResolver=(unit:Unit,now:number)=>BloodSurface;
export function bloodSurfaceResolver(snapshot:GameSnapshot,animation:UnitAnimationTracker|undefined,facing:UnitFacingTracker,models:((key:string)=>UnitModel|undefined)|undefined,reducedMotion=false):BloodSurfaceResolver{
 return (unit,now)=>{
  const raw=reducedMotion?IDLE_FRAME:animation?.frame(unit,now)??IDLE_FRAME;
  const side=facing.actionFacing(unit.id,raw.direction??raw.carryDirection),pose=projectActionFrame(raw,side);
  const model=unit.variant?models?.(unit.variant):undefined,presentation=appearanceFor(snapshot,unit);
  const local=model?model.paint.weaponSurface?.(pose,presentation):figureWeaponSurface(unit.kind,pose,presentation)??creatureWeaponSurface(unit.kind,pose);
  const scale=model?Math.max(.72,unit.radius/18):unitGlyphScale(unit.radius);
  const ship=unit.deck?snapshot.units.find(u=>u.id===unit.deck!.shipId):undefined;
  const weapon=local?{key:local.key+':'+(activeItem(snapshot,unit,'right')?.id??'native'),segments:local.segments.map(s=>({a:[s.a[0]*scale,s.a[1]*scale] as [number,number],b:[s.b[0]*scale,s.b[1]*scale] as [number,number],width:s.width*scale}))}:undefined;
  return {facing:side,bodyScale:scale,floor:ship?shipProfile(ship)?.deckHeight??0:0,...(weapon?{weapon}:{})};
 };
}
export const BLOOD_HEIGHT_PROJECTION=Math.tan(SHIP_CAMERA.tilt);
