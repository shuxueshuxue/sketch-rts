import { detCos, detSin } from './det-math';
import { shipMotionLimits } from './ship-handling';
import { perTick } from './time';
import type { GameMap, Unit, UnitKind } from './types';
import { DEFAULT_WIND, windAt } from './wind-field';
export { DEFAULT_WIND, getWind, windAt } from './wind-field';

export type SailRig = 'lateen' | 'lug' | 'square';
export type SailMode = 'sail' | 'tacking' | 'maneuver' | 'calm-assist' | 'idle';
export type SailState = { angle: number; billow: number; set: number; mode: SailMode };

export const SAIL_RULES = {
  trimRate: Math.PI / 3,
  setRate: .8,
  billowRate: 2,
  auxiliaryShare: .2,
  lateen: { noGoAngle: Math.PI / 4, maxAngle: Math.PI * 65 / 180 },
  lug: { noGoAngle: Math.PI * 50 / 180, maxAngle: Math.PI * 65 / 180 },
  square: { noGoAngle: Math.PI / 3, maxAngle: Math.PI * 50 / 180 },
} as const;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const angleDifference = (from: number, to: number) => ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
// Match the navigation planner's quantized atan2 boundary across JS platforms.
const angleOf = (x: number, y: number) => Math.round(Math.atan2(y, x) * 1e9) / 1e9;

export function sailRig(kind: UnitKind): SailRig {
  return kind === 'transport' ? 'lug' : kind === 'warship' || kind === 'carrier' ? 'square' : 'lateen';
}

/** Game polar, not a second force calculation: all speeds are fractions of the
 * existing hull limit. The no-go boundary rises smoothly into useful beating. */
function polar(rig: SailRig, angle: number): number {
  const noGo = SAIL_RULES[rig].noGoAngle;
  if (angle <= noGo) return 0;
  const knots = [[noGo, 0], [noGo + Math.PI / 12, .75], [Math.PI / 2, .96],
    [Math.PI * 2 / 3, 1], [Math.PI, rig === 'lateen' ? .66 : rig === 'lug' ? .78 : .97]];
  for (let i = 1; i < knots.length; i++) {
    const [end, high] = knots[i]!, [start, low] = knots[i - 1]!;
    if (angle <= end!) {
      const t = clamp((angle - start!) / (end! - start!), 0, 1);
      return low! + (high! - low!) * t * t * (3 - 2 * t);
    }
  }
  return knots.at(-1)![1]!;
}

/** Pick positive upwind VMG, rather than the zero-speed no-go edge. */
function bestBeatAngle(rig: SailRig): number {
  let best = SAIL_RULES[rig].noGoAngle, bestVmg = 0;
  for (let degree = 1; degree < 90; degree++) {
    const angle = degree * Math.PI / 180, vmg = polar(rig, angle) * detCos(angle);
    if (vmg > bestVmg) { bestVmg = vmg; best = angle; }
  }
  return best;
}
const BEAT_ANGLES = { lateen: bestBeatAngle('lateen'), lug: bestBeatAngle('lug'), square: bestBeatAngle('square') };

function windAngles(ship: Unit, map: Pick<GameMap, 'wind'>, heading: number) {
  const wind = windAt(map, ship), motion = ship.sailing;
  const x = wind.x - (motion?.velocityX ?? 0), y = wind.y - (motion?.velocityY ?? 0);
  const apparentSpeed = Math.hypot(x, y);
  const apparentWindAngle = apparentSpeed > 1e-7 ? angleDifference(heading, angleOf(-x, -y)) : 0;
  return { wind, apparentWindAngle, apparentSpeed, trueWindAngle: Math.abs(angleDifference(heading, wind.from)) };
}

function trimAngle(rig: SailRig, apparentAngle: number, unloaded: boolean): number {
  if (unloaded) return 0;
  const side = apparentAngle < 0 ? -1 : 1, absolute = Math.abs(apparentAngle);
  // The fore-and-aft sail's foot is aft of its mast (-X), so positive
  // rig yaw moves that foot toward -Y. A square yard's reference normal is
  // +X, requiring the opposite yaw sign to brace toward the airflow.
  return rig === 'square'
    ? -side * clamp(Math.PI - absolute, 0, SAIL_RULES.square.maxAngle)
    : side * clamp(absolute - Math.PI / 9, 0, SAIL_RULES[rig].maxAngle);
}

export function coursePerformance(ship: Unit, map: Pick<GameMap, 'wind'>,
  heading = ship.sailing?.heading ?? 0, options: { assumeTrimmed?: boolean } = {}) {
  const rig = sailRig(ship.kind), limits = shipMotionLimits(ship);
  const { wind, trueWindAngle, apparentWindAngle, apparentSpeed } = windAngles(ship, map, heading);
  const calm = wind.speed <= 1e-7, noGoAngle = SAIL_RULES[rig].noGoAngle;
  const noGo = !calm && trueWindAngle <= noGoAngle + 1e-9;
  const targetSailAngle = trimAngle(rig, apparentWindAngle, calm || noGo);
  const sail = ship.sailing?.sail;
  const alignment = options.assumeTrimmed ? 1 : Math.max(0, detCos((sail?.angle ?? 0) - targetSailAngle)) ** 2;
  const deployed = options.assumeTrimmed ? 1 : clamp(sail?.set ?? 0, 0, 1);
  const trimmedMode = options.assumeTrimmed || !sail || sail.mode === 'sail' || sail.mode === 'tacking';
  const trimEfficiency = alignment * deployed;
  const maxForwardSpeed = limits.speed;
  // True wind supplies the energy. Boat-generated apparent wind only trims
  // the sail and cannot propel it in a calm, even while moving astern.
  const targetSpeed = calm || noGo || !trimmedMode ? 0
    : maxForwardSpeed * Math.min(1, wind.speed / DEFAULT_WIND.speed) * polar(rig, trueWindAngle) * trimEfficiency;
  return { targetSpeed, noGo, noGoAngle, beatAngle: BEAT_ANGLES[rig], maxForwardSpeed,
    auxiliarySpeed: maxForwardSpeed * SAIL_RULES.auxiliaryShare,
    trueWindAngle, apparentWindAngle, apparentSpeed, targetSailAngle, trimEfficiency,
    windKey: wind.key, calm, rig };
}

const toward = (current: number, target: number, limit: number) => current + clamp(target - current, -limit, limit);

/** Advance only the serialized sail state, once per simulation tick. */
export function updateAutoTrim(ship: Unit, map: Pick<GameMap, 'wind'>, mode?: SailMode): SailState {
  const motion = ship.sailing ??= { heading: 0, speed: 0, load: 0, balance: 0 };
  const sail = motion.sail ??= { angle: 0, billow: 0, set: 0, mode: mode ?? 'sail' };
  sail.mode = mode ?? sail.mode;
  const performance = coursePerformance(ship, map), wind = windAt(map, ship);
  const auxiliary = sail.mode === 'maneuver' || sail.mode === 'calm-assist';
  const furled = sail.mode === 'idle' || performance.maxForwardSpeed <= 0;
  const targetSet = furled ? 0 : auxiliary ? .15 : performance.noGo ? .35 : 1;
  const targetAngle = furled || auxiliary ? 0 : performance.targetSailAngle;
  sail.angle = clamp(toward(sail.angle, targetAngle, perTick(SAIL_RULES.trimRate)),
    -SAIL_RULES[performance.rig].maxAngle, SAIL_RULES[performance.rig].maxAngle);
  sail.set = clamp(toward(sail.set, targetSet, perTick(SAIL_RULES.setRate)), 0, 1);
  const relativeFlow = performance.apparentWindAngle + Math.PI;
  const loading = performance.rig === 'square' ? detCos(relativeFlow - sail.angle) : detSin(relativeFlow - sail.angle);
  const billow = furled || auxiliary || performance.calm || performance.noGo ? 0
    : clamp(loading * Math.min(1, wind.speed / DEFAULT_WIND.speed) * sail.set, -1, 1);
  sail.billow = clamp(toward(sail.billow, billow, perTick(SAIL_RULES.billowRate)), -1, 1);
  return sail;
}
