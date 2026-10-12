import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { ART_TILE_SIZE, ART_ACTION_SIZE } from './raster-cache';
import type { UnitAnimationFrame } from '../unit-animation';
import type { UnitKind } from '../../shared/types';
import type { Facing } from '../unit-facing';

export type DirectionVector = { x: number; y: number; height?:number };
export type ProjectDirection = (direction: DirectionVector) => DirectionVector;
export const projectPaperDirection:ProjectDirection=direction=>direction.height?{x:direction.x,y:direction.y-direction.height*Math.tan(SHIP_CAMERA.tilt)}:direction;
/** Screen-local, authored facing right: negative is up, positive is down. */
export function finiteAim(pose: UnitAnimationFrame): number {
  if ((pose.mode !== 'attack' && pose.mode !== 'cast') || pose.frame >= 5) return 0;
  return Number.isFinite(pose.aim) ? Math.max(-6, Math.min(6, Math.round(pose.aim!))) : 0;
}
/** All renderers share one bounded identity; the ready endpoint is literally idle. */
export function animationKey(pose: UnitAnimationFrame): string {
  const carry=carryKey(pose);
  if ((pose.mode==='attack'||pose.mode==='cast') && pose.frame>=5) return 'idle:0:0:0'+carry;
  const variant=pose.mode==='attack'?Math.abs(Math.trunc(pose.variant??0))%3:0;
  return `${pose.mode}:${pose.frame}:${variant}:${finiteAim(pose)}${carry}`;
}
export function carryStrength(pose:UnitAnimationFrame){return Number.isFinite(pose.carry)?Math.max(0,Math.min(6,Math.round(pose.carry!))):0;}
function carryKey(pose:UnitAnimationFrame){const carry=carryStrength(pose);return carry?`:carry:${carry}:${Number.isFinite(pose.carryAim)?Math.max(-6,Math.min(6,Math.round(pose.carryAim!))):0}`:'';}
const projectedFrames = new Map<string, Readonly<UnitAnimationFrame>>();
export function projectActionFrame(pose: UnitAnimationFrame, facing: Facing, projectVector: ProjectDirection=projectPaperDirection): UnitAnimationFrame {
  let aim=finiteAim(pose);
  if(pose.direction && (pose.mode==='attack'||pose.mode==='cast') && pose.frame<5){
    const vector=projectVector(pose.direction);
    const localX=vector.x*facing;
    if(Math.hypot(localX,vector.y)>1e-6)aim=Math.max(-6,Math.min(6,Math.round(Math.atan2(vector.y,Math.abs(localX))*12/Math.PI)));
  }
  const carry=carryStrength(pose);
  let carryAim=Number.isFinite(pose.carryAim)?Math.max(-6,Math.min(6,Math.round(pose.carryAim!))):0;
  if(carry&&pose.carryDirection){
    const vector=projectVector(pose.carryDirection);
    if(Math.hypot(vector.x,vector.y)>1e-6)carryAim=Math.max(-6,Math.min(6,Math.round(Math.atan2(vector.y,Math.abs(vector.x))*12/Math.PI)));
  }
  const suffix=carry?`:carry:${carry}:${carryAim}`:'';
  // Facing affects the mirror, not whether the target is above/below the body.
  const variant=pose.mode==='attack'?Math.abs(Math.trunc(pose.variant??0))%3:0;
  const ready=(pose.mode==='attack'||pose.mode==='cast')&&pose.frame>=5;
  const key=(ready?'idle:0:0:0':`${pose.mode}:${pose.frame}:${variant}:${aim}`)+suffix;
  let result=projectedFrames.get(key);
  if(!result){
    result=Object.freeze({...(ready?{mode:'idle' as const,frame:0}:{mode:pose.mode,frame:pose.frame,...(pose.mode==='attack'?{variant:Math.abs(Math.trunc(pose.variant??0))%3}:{}),...(aim?{aim}:{})}),...(carry?{carry,carryAim}:{})});
    projectedFrames.set(key,result);
  }
  return result;
}

/** The canvas follows the drawn envelope. Tall antlers and a long dragon tail
 * also need padding at rest; pixels outside a foot line are not invalid. */
export function actionPaintSize(pose:UnitAnimationFrame,kind?:UnitKind):number {
  if(carryStrength(pose)||kind==='ancientStag'||kind==='redDragon'||kind==='spiderQueen'||(pose.mode==='attack'||pose.mode==='cast')&&pose.frame<5)return ART_ACTION_SIZE;
  return ART_TILE_SIZE;
}
