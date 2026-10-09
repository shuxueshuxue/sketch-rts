import { shipProfile } from './ship-geometry';
import type { Unit } from './types';

export function shipPartMax(ship: Unit) {
  const profile = shipProfile(ship)!;
  return { rigging: Math.round(profile.length * .55), rudder: Math.round(profile.beam * .8),
    cabin: ship.kind === 'cutter' ? 0 : Math.round(ship.maxHp * .4) };
}

/** Routing costs and engine limits use the same rates, in units/s and radians/s. */
export function shipMotionLimits(ship: Unit) {
  const profile = shipProfile(ship)!, motion = ship.sailing ?? {load:0,balance:0}, parts = shipPartMax(ship);
  const load = motion.load / profile.loadCapacity;
  const propulsion = (ship.shipParts?.rigging ?? parts.rigging) / parts.rigging;
  const steering = (ship.shipParts?.rudder ?? parts.rudder) / parts.rudder;
  const speed = ship.speed * Math.sqrt(Math.max(0, propulsion)) / (1 + .2 * load);
  return {
    speed,
    reverseSpeed: speed * .4,
    acceleration: profile.acceleration / (1 + .4 * load),
    turnRate: profile.turnRate * steering / (1 + .35 * load + .25 * motion.balance),
  };
}
