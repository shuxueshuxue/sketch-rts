import type { UnitAnimationFrame } from '../unit-animation';
import type { Brush, XY } from './kit';
import { sampleMotion, type MotionFamily } from './motion';
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
  weapon?: EquipmentKind; motion?: MotionFamily; shield?: boolean;
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
/** One solved pose is shared by limbs, grip sockets and attached equipment. */
export function solveFigureRig(f: Figure, pose: UnitAnimationFrame, options: FigurePresentation = {}) {
  const weapon = options.weapon ?? defaultEquipment(f);
  const family = equipmentFamily(weapon);
  // A bow cannot use a sword's slash or a pike a bow release. Alternate clips
  // within an equipment family are selected using pose.variant.
  const requested = options.motion;
  const compatible = requested === family || ((family === 'slash' || family === 'thrust') && (requested === 'slash' || requested === 'thrust'));
  const motion = sampleMotion(pose, compatible ? requested : family);
  const working = weapon === 'pick' && pose.mode === 'work';
  const work = working ? WORK_POSES[pose.frame] : undefined;
  const impact = pose.mode === 'attack' ? motion.reach : 0;
  const cast = pose.mode === 'cast' ? motion.castGlow : 0;
  const requestedWrist: XY = weapon === 'pike' || weapon === 'pitchfork' ? (f.mounted ? [9 + impact * 3, -16] : [8 + impact * 5, -19])
    : weapon === 'bow' ? [18, -21]
    : weapon === 'none' ? [8+impact*11,-3-impact*14-cast*18]
    : work?.wrist ?? [12 + impact * 7, -12 - impact * 5 - cast * 8 + motion.breathe * .4];
  const shoulder:XY=[5,-23];
  let primary=solveTwoBone(shoulder,requestedWrist,working?1:-1);
  let wrist=primary.end;
  const angle = weapon === 'pike' || weapon === 'pitchfork' ? (f.mounted ? -.2 + impact * .16 : -.95 + impact * .55) + motion.weaponAngle * .12
    : weapon === 'sling' ? -impact*1.65+motion.weaponAngle*.4
    : weapon === 'javelin' ? .45+impact*.95+motion.weaponAngle
    : weapon === 'bow' || weapon === 'staff' || weapon === 'crozier' ? motion.weaponAngle
    : work?.tool ?? (weapon === 'pick' ? .24 + motion.weaponAngle : (weapon === 'axe' ? .15 : .32) + motion.weaponAngle);
  const supportX=weapon==='bow'?-3-.35*(1-motion.recoil)*9:weapon==='greatSword'||weapon==='pick'?0:-9;
  const supportY=weapon==='greatSword'?5:weapon==='pick'?6:0;
  let support=socketPoint(wrist,angle,supportX,supportY);
  if(['bow','greatSword','pick','pike','pitchfork'].includes(weapon)){
    // Solve the shared rigid handle against both arms. Moving the grip by the
    // support constraint preserves the local socket and avoids detached hands.
    const reachable=solveTwoBone([-5,-23],support).end;
    wrist=[wrist[0]+reachable[0]-support[0],wrist[1]+reachable[1]-support[1]];
    primary=solveTwoBone(shoulder,wrist,working?1:-1);wrist=primary.end;
    support=socketPoint(wrist,angle,supportX,supportY);
  }
  return { weapon, shieldStyle: options.shield===true?'round':'kite', shield: weapon !== 'greatSword' && weapon !== 'bow' && weapon !== 'pick' && (options.shield ?? (weapon === 'sword' || weapon === 'pike' && (!!f.mounted || !!f.elite))), motion, impact, cast, working, wrist, angle, lean: work?.lean ?? motion.lean,
    shoulder, elbow: primary.joint,
    support };
}
export type FigureRig = ReturnType<typeof solveFigureRig>;
