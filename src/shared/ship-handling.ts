import { shipProfile } from './ship-geometry';
import type { Unit } from './types';

type Profile = NonNullable<ReturnType<typeof shipProfile>>;
type PartMaxima = Readonly<{ rigging: number; rudder: number; cabin: number }>;
const partMaxima = new WeakMap<Profile, { maxHp: number; parts: PartMaxima }>();
export function shipPartMax(ship: Unit) {
  const profile = shipProfile(ship)!;
  const cached = partMaxima.get(profile);
  if (cached?.maxHp === ship.maxHp) return cached.parts;
  const parts = Object.freeze({ rigging: Math.round(profile.length * .55), rudder: Math.round(profile.beam * .8),
    cabin: ship.kind === 'cutter' ? 0 : Math.round(ship.maxHp * .4) });
  partMaxima.set(profile, { maxHp: ship.maxHp, parts });
  return parts;
}

/** The share of its work a moving part still does: headway goes with the root of the rigging left, the helm with the
 * rudder left (the rates shipMotionLimits gives). */
export function shipPartWork(part: 'rigging' | 'rudder', left: number, max: number) {
  const share = Math.max(0, left / max);
  return part === 'rigging' ? Math.sqrt(share) : share;
}
// @@@crippled-parts - Below a quarter of its work a moving part has as good as failed: a ship of the line's rudder gives
// it 2 degrees a second, and a hull that cannot come about cannot reach a berth, a shore or the fight. Repair restores
// such a part to this floor before it mends the hull; the hull under fire is never mended full, and a rudder left at 1.3
// of 152 waited behind it for good.
export const SHIP_PART_CRIPPLED = .25;
/** The part hp at which it does SHIP_PART_CRIPPLED of its work. */
export function shipPartWorkingFloor(part: 'rigging' | 'rudder', max: number) {
  return part === 'rigging' ? max * SHIP_PART_CRIPPLED ** 2 : max * SHIP_PART_CRIPPLED;
}

type MotionLimits = Readonly<{ speed: number; reverseSpeed: number; acceleration: number; turnRate: number }>;
const motionLimits = new WeakMap<Unit, {
  profile: Profile; speed: number; load: number; balance: number; rigging: number; rudder: number; limits: MotionLimits;
}>();
/** Routing costs and engine limits use the same rates, in units/s and radians/s. */
export function shipMotionLimits(ship: Unit) {
  const profile = shipProfile(ship)!, motion = ship.sailing ?? {load:0,balance:0}, parts = shipPartMax(ship);
  const rigging = ship.shipParts?.rigging ?? parts.rigging, rudder = ship.shipParts?.rudder ?? parts.rudder;
  const cached = motionLimits.get(ship);
  if (cached?.profile === profile && cached.speed === ship.speed && cached.load === motion.load
    && cached.balance === motion.balance && cached.rigging === rigging && cached.rudder === rudder) return cached.limits;
  const load = motion.load / profile.loadCapacity;
  const steering = shipPartWork('rudder', rudder, parts.rudder);
  const speed = ship.speed * shipPartWork('rigging', rigging, parts.rigging) / (1 + .2 * load);
  const limits = Object.freeze({
    speed,
    reverseSpeed: speed * .4,
    acceleration: profile.acceleration / (1 + .4 * load),
    turnRate: profile.turnRate * steering / (1 + .35 * load + .25 * motion.balance),
  });
  motionLimits.set(ship, { profile, speed: ship.speed, load: motion.load, balance: motion.balance, rigging, rudder, limits });
  return limits;
}
