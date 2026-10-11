import { finiteAim } from './action-direction';
import type { UnitAnimationFrame } from '../unit-animation';

/** A motion describes intention, not a species or equipment mesh. Rigs scale
 * reach to their limb lengths and constrain hand targets to a reachable chain. */
export type MotionFamily = 'slash' | 'thrust' | 'bow' | 'staff' | 'work' | 'creature' | 'siege';
export type MotionPose = Readonly<{
  stride: number; lift: number; lean: number; reach: number;
  weaponAngle: number; offhand: number; castGlow: number;
  breathe: number; recoil: number; bowDraw: number;
}>;
const REST: MotionPose = Object.freeze({ stride: 0, lift: 0, lean: 0, reach: 0, weaponAngle: 0, offhand: 0, castGlow: 0, breathe: 0, recoil: 0, bowDraw: .35 });
const CONTACT = [1, .76, .48, .24, .08, 0] as const;
const WORK_REACH = [.05, -.12, .8, 1, .45, .08] as const;
const WORK_ANGLE = [-.35, -.7, .9, 1.2, .45, -.1] as const;
const FAMILIES: readonly MotionFamily[] = ['slash', 'thrust', 'bow', 'staff', 'work', 'creature', 'siege'];
const MODES = ['idle', 'walk', 'attack', 'cast', 'work'] as const;

function keyPose(mode: UnitAnimationFrame['mode'], frame: number, variant: number, family: MotionFamily): MotionPose {
  if ((mode === 'idle' && frame === 0) || ((mode === 'attack' || mode === 'cast') && frame === 5)) return REST;
  if (mode === 'idle') {
    const breath = Math.sin(frame * Math.PI / 4);
    return Object.freeze({ ...REST, breathe: breath * .65, lean: breath * .008 });
  }
  if (mode === 'walk') {
    const stride = Math.sin(frame * Math.PI / 4);
    return Object.freeze({ ...REST, stride, lift: -Math.abs(stride) * 1.3, weaponAngle: stride * .09, offhand: -stride * .06 });
  }
  if (mode === 'work') return Object.freeze({ ...REST, reach: WORK_REACH[frame]!, weaponAngle: WORK_ANGLE[frame]!, lean: [.025, -.025, .1, .14, .09, .035][frame]! });
  const recovery = mode==='attack'&&(family==='slash'||family==='work')
    ? [1,.65,.15,-.28,-.15,0][frame]!
    :mode==='attack'&&family==='thrust'?[1,.55,.12,-.12,-.05,0][frame]!:CONTACT[frame]!;
  if (mode === 'cast') return Object.freeze({ ...REST, reach: recovery * .45, lean: -.035 * recovery, weaponAngle: -.48 * recovery, offhand: -.3 * recovery, castGlow: recovery });
  // The simulation reports a completed hit/release. These are contact-to-ready
  // clips, never a new windup after damage has already happened. Variants alter
  // the contact plane, not release time or attack cadence.
  switch (family) {
    case 'thrust': return Object.freeze({ ...REST, reach: recovery * [1, .85, .92][variant]!, lean: recovery * .07, weaponAngle: recovery * [.06, -.12, .18][variant]!, offhand: recovery * -.08 });
    case 'bow': return Object.freeze({ ...REST, reach: recovery * [.7, .6, .65][variant]!, lean: recovery * -.025, weaponAngle: recovery * [0, -.07, .07][variant]!, offhand: recovery * .18, recoil: recovery, bowDraw: [0,.25,.5,.9,.6,.35][frame]! });
    case 'staff': return Object.freeze({ ...REST, reach: recovery * .75, lean: recovery * .045, weaponAngle: recovery * [.32, -.18, .12][variant]!, offhand: recovery * -.1 });
    case 'siege': return Object.freeze({ ...REST, recoil: recovery, reach: recovery });
    case 'creature': return Object.freeze({ ...REST, reach: recovery * [1, .85, .95][variant]!, lean: recovery * [.06, -.025, .035][variant]!, weaponAngle: recovery * [.18, -.16, .08][variant]! });
    default: return Object.freeze({ ...REST, reach: recovery * [1, .88, .93][variant]!, lean: recovery * [.075, .055, .065][variant]!, weaponAngle: recovery * [1.45, .95, 1.2][variant]!, offhand: recovery * -.12 });
  }
}

// A finite, immutable pose bank. Atlas generation and live draw calls share the
// same samples without trig, temporary arrays or pose allocations on hot paths.
const BANK = new Map<MotionFamily, ReadonlyArray<ReadonlyArray<ReadonlyArray<MotionPose>>>>(FAMILIES.map(family => [family,
  MODES.map(mode => Array.from({ length: 3 }, (_, variant) => Array.from({ length: mode === 'walk' || mode === 'idle' ? 8 : 6 }, (_, frame) => keyPose(mode, frame, variant, family))))
]));
const MODE_INDEX = { idle: 0, walk: 1, attack: 2, cast: 3, work: 4 } as const;

/** A compatible unit can select another family without altering its identity,
 * equipment, simulation state or hit timing. All callers receive shared poses. */
export function sampleMotion(pose: UnitAnimationFrame, family: MotionFamily = 'slash'): MotionPose {
  const frames = BANK.get(family)![MODE_INDEX[pose.mode]]![Math.abs(Math.trunc(pose.variant ?? 0)) % 3]!;
  return frames[Math.max(0, Math.min(frames.length - 1, Math.trunc(pose.frame)))] ?? REST;
}

/** Three authored source planes plus at most 30 degrees of terminal correction.
 * Sources own shoulder/hand arrangement; correction never rotates the body. */
const DIRECTION_BANK=Array.from({length:13},(_,index)=>{
 const bin=index-6,source=bin<=-2?-1:bin>=2?1:0;
 const angle=bin*Math.PI/12,sourceAngle=source*Math.PI/3;
 return Object.freeze({bin,source:source as -1|0|1,angle,sourceAngle,correction:angle-sourceAngle});
});
export function actionDirection(pose:UnitAnimationFrame){return DIRECTION_BANK[finiteAim(pose)+6]!;}
