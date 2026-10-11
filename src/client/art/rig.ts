import type { UnitAnimationFrame } from '../unit-animation';
import type { Brush, XY } from './kit';
import { sampleMotion, actionDirection, type MotionFamily } from './motion';
import { figures, creatures, type Figure } from './appearance';
import type { UnitKind } from '../../shared/types';
import type { EquipmentKind } from './equipment';
// Lift, wind up, strike, follow through, recover, ready. The tool remains in
// the worker's hand; only the upper body moves during a work stroke.
const WORK_POSES: {lean:number;wrist:XY;tool:number}[] = [
  {lean:.025,wrist:[10,-24],tool:-.35}, {lean:-.025,wrist:[10,-29],tool:-.7},
  {lean:.1,wrist:[16,-14],tool:.9}, {lean:.14,wrist:[16,-12],tool:1.2},
  {lean:.09,wrist:[14,-16],tool:.45}, {lean:.035,wrist:[11,-20],tool:-.1},
];

/** Presentation overrides are deliberately absent from simulation Unit state. */
export interface FigurePresentation {
  weapon?: EquipmentKind; motion?: MotionFamily; shield?: boolean; shieldStyle?:'round'|'kite';
  appearance?: Partial<Figure>; cloth?: string; headwear?: boolean;
  detail?: (b: Brush, rig: FigureRig, stage: 'body' | 'head' | 'equipment') => void;
}
export function defaultEquipment(f: Figure): EquipmentKind {
  if(f.weapon)return f.weapon;
  return f.role === 'sword' ? 'sword' : f.role === 'axe' ? 'axe' : f.role === 'pike' ? 'pike'
    : f.role === 'bow' ? 'bow' : f.role === 'worker' ? 'pick' : f.role === 'priest' ? 'crozier' : 'staff';
}
/** The source unit of an issued weapon may have a compatible nonhuman body. */
export function equipmentForKind(kind: UnitKind): EquipmentKind | undefined {
  const figure=figures[kind];return figure?defaultEquipment(figure):creatures[kind]?.weapon;
}
export function equipmentFamily(weapon: EquipmentKind): MotionFamily {
  return weapon === 'pike' || weapon === 'pitchfork' || weapon === 'javelin' || weapon === 'sling' ? 'thrust' : weapon === 'bow' ? 'bow' : weapon === 'staff' || weapon === 'crozier' ? 'staff' : weapon === 'pick' ? 'work' : 'slash';
}
/** Fixed length two-bone chain. A target outside the annulus is clamped;
 * callers attach tools to end, never to the unconstrained requested target. */
export function solveTwoBone(root: XY, target: XY, bend: 1 | -1 = 1, upper = 11, lower = 10.5) {
  const dx=target[0]-root[0], dy=target[1]-root[1], distance=Math.hypot(dx,dy);
  const length=Math.max(Math.abs(upper-lower)+.001,Math.min(upper+lower-.001,distance));
  const ux=distance>1e-8?dx/distance:0, uy=distance>1e-8?dy/distance:1;
  const along=(upper*upper-lower*lower+length*length)/(2*length);
  const cross=Math.sqrt(Math.max(0,upper*upper-along*along))*bend;
  return { joint:[root[0]+ux*along-uy*cross,root[1]+uy*along+ux*cross] as XY,
    end:[root[0]+ux*length,root[1]+uy*length] as XY };
}
export function socketPoint(grip: XY, angle: number, x: number, y: number): XY {
  return [grip[0]+Math.cos(angle)*x-Math.sin(angle)*y,grip[1]+Math.sin(angle)*x+Math.cos(angle)*y];
}
/** Closest reachable rigid grip in the intersection of both shoulder discs.
 * Solving this before either arm preserves both bone lengths and both sockets. */
function dualGrip(target:XY,primary:XY,secondary:XY,offset:XY):XY {
  const r=21.49,second:XY=[secondary[0]-offset[0],secondary[1]-offset[1]];
  const inside=(p:XY,c:XY)=>Math.hypot(p[0]-c[0],p[1]-c[1])<=r+1e-8;
  if(inside(target,primary)&&inside(target,second))return target;
  const on=(c:XY):XY=>{const dx=target[0]-c[0],dy=target[1]-c[1],d=Math.hypot(dx,dy)||1;return[c[0]+dx*r/d,c[1]+dy*r/d];};
  const a=on(primary),b=on(second),candidates:XY[]=[];
  if(inside(a,second))candidates.push(a);if(inside(b,primary))candidates.push(b);
  if(!candidates.length){
    const dx=second[0]-primary[0],dy=second[1]-primary[1],d=Math.hypot(dx,dy);
    const mx=(primary[0]+second[0])/2,my=(primary[1]+second[1])/2,h=Math.sqrt(Math.max(0,r*r-d*d/4));
    candidates.push([mx-dy/d*h,my+dx/d*h],[mx+dy/d*h,my-dx/d*h]);
  }
  return candidates.reduce((best,p)=>Math.hypot(p[0]-target[0],p[1]-target[1])<Math.hypot(best[0]-target[0],best[1]-target[1])?p:best);
}
const lerpPoint=(a:XY,b:XY,t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
// Up / level / down are deliberately authored hand placements, not a rotation
// of one body. Long shafts stay beside the body; bows leave room for the draw arm.
const CONTACT_HANDS:Record<'shaft'|'bow'|'staff'|'blade'|'unarmed',readonly XY[]>={
 shaft:[[9,-15],[12,-21],[8,-33]],
 bow:[[14,-34],[18,-23],[16,-12]],
 staff:[[11,-25],[17,-21],[14,-16]],
 blade:[[9,-27],[18,-21],[12,-23]],
 unarmed:[[9,-36],[22,-22],[13,-7]],
};
const FREE_HANDS:readonly XY[]=[[1,-41],[14,-22],[5,-7]];
/** One solved pose is shared by limbs, grip sockets and attached equipment. */
export function solveFigureRig(f: Figure, pose: UnitAnimationFrame, options: FigurePresentation = {}) {
  const weapon=options.weapon??defaultEquipment(f),family=equipmentFamily(weapon);
  const requested=options.motion;
  const compatible=requested===family||((family==='slash'||family==='thrust')&&(requested==='slash'||requested==='thrust'));
  const motion=sampleMotion(pose,compatible?requested:family),direction=actionDirection(pose);
  const working=weapon==='pick'&&pose.mode==='work',work=working?WORK_POSES[pose.frame]:undefined;
  const impact=pose.mode==='attack'?motion.reach:0,cast=pose.mode==='cast'?motion.castGlow:0;
  const weight=pose.mode==='attack'?([1,.76,.48,.24,.08,0][pose.frame]??0):cast;
  const shoulder:XY=[5,-23],supportShoulder:XY=[-5,-23];
  const shaft=weapon==='pike'||weapon==='pitchfork';
  const staff=weapon==='staff'||weapon==='crozier';
  const ready:XY=shaft?(f.mounted?[9,-16]:[8,-19]):weapon==='bow'?[18,-21]:weapon==='none'?[8,-3]:[12,-12+motion.breathe*.4];
  const readyAngle=shaft?(f.mounted?-.2:-.95):weapon==='javelin'?.45:weapon==='bow'||staff||weapon==='none'?0:weapon==='pick'?.24:weapon==='axe'?.15:.32;
  const category=shaft?'shaft':weapon==='bow'?'bow':staff?'staff':weapon==='none'||(weapon==='javelin'||weapon==='sling')&&pose.mode==='attack'?'unarmed':'blade';
  const source=CONTACT_HANDS[category][direction.source+1]!;
  // Residual aim moves the hand only a few pixels; the tool axis receives the
  // full bounded correction. Shoulders and grounded feet never orbit the target.
  const contact:XY=[source[0]-Math.sin(direction.correction)*2,source[1]+Math.sin(direction.correction)*3];
  const variant=Math.abs(Math.trunc(pose.variant??0))%3;
  const variation=pose.mode==='attack'?[0,-.13,.12][variant]!:0;
  const aimAngle=direction.sourceAngle+direction.correction;
  const contactAngle=(shaft||weapon==='bow'?aimAngle:aimAngle+Math.PI/2)+variation;
  const angle=work?.tool??readyAngle+(contactAngle-readyAngle)*weight+motion.weaponAngle*(working?1:.08);
  const requestedWrist=work?.wrist??lerpPoint(ready,contact,weight);
  // Keep the elbow's anatomical branch through recovery; flipping the IK
  // branch at the ready endpoint would teleport the elbow across the arm.
  const bend=-1 as const;
  const shield=weapon!=='greatSword'&&weapon!=='bow'&&weapon!=='pick'&&(options.shield??(weapon==='sword'||shaft&&(!!f.mounted||!!f.elite)));
  const twoHanded=weapon==='bow'||weapon==='greatSword'||weapon==='pick'||shaft&&!shield;
  const supportX=weapon==='bow'?-3-.35*(1-motion.recoil)*9:weapon==='greatSword'||weapon==='pick'?0:-9;
  const supportY=weapon==='greatSword'?5:weapon==='pick'?6:0;
  const offset=socketPoint([0,0],angle,supportX,supportY);
  const grip=twoHanded?dualGrip(requestedWrist,shoulder,supportShoulder,offset):requestedWrist;
  const primary=solveTwoBone(shoulder,grip,bend),wrist=primary.end;
  const free=shield?[-10,-10] as XY:lerpPoint([-8,-3],FREE_HANDS[direction.source+1]!,cast||weapon==='none'?weight:0);
  const support=twoHanded?socketPoint(wrist,angle,supportX,supportY):solveTwoBone(supportShoulder,free,1).end;
  const secondary=solveTwoBone(supportShoulder,support,1);
  const release=socketPoint(wrist,angle,shaft?48:weapon==='bow'?16:0,staff?-23:shaft||weapon==='bow'?0:-31);
  return {weapon,shieldStyle:options.shieldStyle??'kite',shield,motion,impact,cast,working,wrist,angle,
    lean:work?.lean??motion.lean+direction.source*weight*.025,shoulder,elbow:primary.joint,support,supportShoulder,supportElbow:secondary.joint,
    twoHanded,release,direction,primaryLayer:weight>.5&&direction.source<0?'back' as const:'front' as const};
}
export type FigureRig = ReturnType<typeof solveFigureRig>;
