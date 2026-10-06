import { detCos, detSin } from './det-math';
import { shipMotionLimits } from './ship-handling';
export { shipMotionLimits } from './ship-handling';
import { localToWorld, shipPassengers, shipProfile } from './ship-geometry';
import { hullPassageClear } from './ship-navigation';
import { shipTraffic } from './ship-avoidance';
import { perTick } from './time';
import type { GameMap, Unit } from './types';
type MotionBudget = { yaw: number; distance: number; astern: number };
type ShipControls = { surge?: number; yaw?: number; pivotLever?: number; spentYaw?: number };
const budgets = new WeakMap<Unit, MotionBudget>();

/** One budget for propulsion, aiming turns and impulses in the whole step. */
export function beginShipMotionFrame(units: readonly Unit[]) {
  for (const unit of units) if (shipProfile(unit)) budgets.set(unit, { yaw: 0, distance: 0, astern: 0 });
}

/** Navigation supplies controls, never a world-space displacement. The keel
 * admits surge and yaw only. A bow/stern pivot couples translation to yaw;
 * it cannot produce lateral travel without turning. Rates are per second. */
export function advanceShip(ship: Unit, map: GameMap, units: readonly Unit[], controls: ShipControls) {
  const profile = shipProfile(ship)!;
  const motion = ship.sailing ??= { heading: 0, speed: 0, load: 0, balance: 0 };
  const limits = shipMotionLimits(ship), budget = budgets.get(ship);
  const bound = Math.max(0, perTick(limits.turnRate) - Math.max(budget?.yaw ?? 0, controls.spentYaw ?? 0));
  const requestedYaw = controls.yaw ?? 0, requestedSurge = controls.surge ?? 0;
  if (!Number.isFinite(requestedYaw) || !Number.isFinite(requestedSurge) || !Number.isFinite(controls.pivotLever ?? 0)) return false;

  const lever = Math.max(-profile.length / 2, Math.min(profile.length / 2, controls.pivotLever ?? 0));
  const travel = Math.max(0, perTick(limits.speed) - (budget?.distance ?? 0));
  const yawBound = lever ? Math.min(bound, travel / Math.abs(lever)) : bound;
  const yaw = Math.max(-yawBound, Math.min(yawBound, requestedYaw));
  const surgeBound = Math.max(0, travel - Math.abs(lever * yaw));
  const surge = Math.max(-Math.min(surgeBound, Math.max(0,perTick(limits.reverseSpeed)-(budget?.astern ?? 0))), Math.min(surgeBound, requestedSurge));

  const from = { x: ship.x, y: ship.y, heading: motion.heading };
  const heading = from.heading + yaw, c = detCos(heading), s = detSin(heading);
  const pivot = lever ? {
    x: from.x - lever * detCos(from.heading),
    y: from.y - lever * detSin(from.heading),
  } : undefined;
  const turned = {
    x: pivot ? pivot.x + lever * c : from.x,
    y: pivot ? pivot.y + lever * s : from.y,
    heading,
    ...(pivot ? { pivot } : {}),
  };
  const to = { x: turned.x + surge * c, y: turned.y + surge * s, heading };
  const traffic = shipTraffic(ship, units);
  if (!hullPassageClear(map, ship, from, turned) || !traffic(from, turned)
    || !hullPassageClear(map, ship, turned, to) || !traffic(turned, to)) return false;

  ship.x = to.x;
  ship.y = to.y;
  motion.heading = heading;
  if (budget) {
    budget.yaw += Math.abs(yaw);
    budget.distance += Math.abs(surge) + Math.abs(lever * yaw);
    if(surge<0)budget.astern-=surge;
  }
  for (const passenger of shipPassengers(units, ship)) Object.assign(passenger, localToWorld(ship, passenger.deck!));
  return true;
}
