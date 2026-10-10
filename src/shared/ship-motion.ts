import { detCos, detSin } from './det-math';
import { shipMotionLimits } from './ship-handling';
export { shipMotionLimits } from './ship-handling';
import { isShipKind, localToWorld, shipPassengers, shipProfile } from './ship-geometry';
import { shipPoseAt } from './ship-navigation';
import { beginShipCollisionFrame, recordShipCollision, sweepShipCollision, updateShipCollisionPosition } from './ship-collisions';
import { perTick } from './time';
import type { Building, GameMap, Obstacle, Unit } from './types';
type MotionBudget = { yaw: number; distance: number; astern: number };
type ShipControls = { surge?: number; yaw?: number; pivotLever?: number; spentYaw?: number };
const budgets = new WeakMap<Unit, MotionBudget>();

/** One budget for propulsion, aiming turns and impulses in the whole step.
 * Simulation may supply its complete current hull view, including dead hulls;
 * direct callers retain a full scan, even after replacing array members. */
export function beginShipMotionFrame(units: readonly Unit[], map?: GameMap, solids: readonly (Building | Obstacle)[] = [], vessels: readonly Unit[] = units) {
  for (const ship of vessels) if (isShipKind(ship.kind)) {
    const budget = budgets.get(ship);
    if (budget) { budget.yaw = 0; budget.distance = 0; budget.astern = 0; }
    else budgets.set(ship, { yaw: 0, distance: 0, astern: 0 });
  }
  beginShipCollisionFrame(units, map, solids, vessels);
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
  const turnContact = sweepShipCollision(map, ship, units, from, turned);
  const contact = turnContact ?? sweepShipCollision(map, ship, units, turned, to);
  const segmentStart = turnContact ? from : turned, segmentEnd = turnContact ? turned : to;
  // Reach the first surface continuously instead of rejecting the whole tick;
  // a thin body crossed between otherwise clear poses still stops the hull.
  const fraction = contact ? Math.max(0, contact.fraction - 1e-5 / Math.max(1, Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y))) : 1;
  const end = contact ? shipPoseAt(segmentStart, segmentEnd, fraction) : to;
  if (contact) recordShipCollision(map, ship, units, segmentStart, segmentEnd, contact);
  ship.x = end.x;
  ship.y = end.y;
  motion.heading = end.heading;
  if (budget) {
    const usedYaw = turnContact ? Math.abs(yaw) * fraction : Math.abs(yaw);
    const usedSurge = turnContact ? 0 : surge * fraction;
    budget.yaw += usedYaw;
    budget.distance += Math.abs(usedSurge) + Math.abs(lever * usedYaw);
    if(usedSurge<0)budget.astern-=usedSurge;
  }
  updateShipCollisionPosition(units, ship);
  for (const passenger of shipPassengers(units, ship)) Object.assign(passenger, localToWorld(ship, passenger.deck!));
  return !contact;
}
