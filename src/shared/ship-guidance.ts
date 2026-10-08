import { detCos, detSin } from './det-math';
import { shipTraffic } from './ship-avoidance';
import { shipProfile } from './ship-geometry';
import { shipMotionLimits } from './ship-handling';
import { advanceShip } from './ship-motion';
import { headingDifference, hullPassageClear, type ShipPose } from './ship-navigation';
import { perTick, SIM_TICKS_PER_SECOND } from './time';
import type { GameMap, Unit } from './types';

/** Regulated pure pursuit for ordinary forward voyages. The heading lattice
 * remains the reference path; berths, reversals and pivot maneuvers retain the
 * exact executor. A maneuver keeps the existing validated route; false asks
 * for a new exact route from a cruise pose whose predicted sweep is blocked. */
export function followShipRoute(ship: Unit, map: GameMap, units: readonly Unit[], pace: number): boolean | 'maneuver' {
  const motion = ship.sailing!, route = motion.route!, points = route.points;
  const limits = shipMotionLimits(ship), profile = shipProfile(ship)!;
  let previous = { x: route.legX ?? route.startX ?? ship.x, y: route.legY ?? route.startY ?? ship.y };
  // Do not smooth through a reverse or a contact-point turn. These encode a
  // deliberate maneuver, rather than a corner in a forward reference path.
  for (const point of points) {
    if (point.pivot || (point.x - previous.x) * detCos(point.heading) + (point.y - previous.y) * detSin(point.heading) < -1e-5) return 'maneuver';
    previous = point;
  }
  const lookahead = Math.max(profile.length * .45, Math.min(profile.length, motion.speed * 2));
  let origin = { x: route.legX ?? route.startX ?? ship.x, y: route.legY ?? route.startY ?? ship.y };
  // Consume passed reference vertices, including the lattice's zero-distance
  // turn states. The carrot can already lie beyond the next corner.
  while (points.length > 1) {
    const next = points[0]!, dx = next.x - origin.x, dy = next.y - origin.y, length = Math.hypot(dx, dy);
    const along = length ? ((ship.x - origin.x) * dx + (ship.y - origin.y) * dy) / length : 0;
    const cross = length ? Math.abs((ship.x - origin.x) * dy - (ship.y - origin.y) * dx) / length : 0;
    const following = points.find(point => Math.hypot(point.x - next.x, point.y - next.y) > 1e-7);
    let beyondCorner = false;
    if (following && Math.hypot(ship.x - next.x, ship.y - next.y) < lookahead * 1.5) {
      const fx = following.x - next.x, fy = following.y - next.y, squared = fx * fx + fy * fy;
      const t = Math.max(0, Math.min(1, ((ship.x - next.x) * fx + (ship.y - next.y) * fy) / squared));
      beyondCorner = t > 0 && Math.hypot(ship.x - next.x - fx * t, ship.y - next.y - fy * t) < cross;
    }
    if (length > 1e-7 && Math.hypot(ship.x - next.x, ship.y - next.y) > Math.min(8, lookahead * .15)
      && !(along >= length && cross < lookahead) && !beyondCorner) break;
    origin = points.shift()!;
    route.legX = origin.x; route.legY = origin.y;
  }
  const last = points.at(-1);
  if (!last) return true;
  const endGap = Math.hypot(last.x - ship.x, last.y - ship.y);
  if (points.length === 1 && endGap < .25) {
    points.length = 0; motion.speed = 0; return true;
  }
  const first = points[0]!, dx = first.x - origin.x, dy = first.y - origin.y, length = Math.hypot(dx, dy);
  const projection = length ? Math.max(0, Math.min(1, ((ship.x - origin.x) * dx + (ship.y - origin.y) * dy) / (length * length))) : 1;
  let carrot = { x: origin.x + dx * projection, y: origin.y + dy * projection }, remaining = lookahead;
  for (const next of points) {
    const gap = Math.hypot(next.x - carrot.x, next.y - carrot.y);
    if (gap >= remaining && gap > 1e-7) {
      carrot = { x: carrot.x + (next.x - carrot.x) * remaining / gap, y: carrot.y + (next.y - carrot.y) * remaining / gap };
      break;
    }
    remaining -= gap; carrot = next;
  }
  const cx = carrot.x - ship.x, cy = carrot.y - ship.y, distance = Math.hypot(cx, cy);
  if (distance < 1e-7) return false;
  const error = headingDifference(motion.heading, Math.atan2(cy, cx));
  const turn = perTick(limits.turnRate), acceleration = perTick(limits.acceleration);
  // Pure pursuit has zero curvature for a target exactly astern. Recover the
  // shortest heading first, then resume a forward curve before fully aligned.
  if (Math.abs(error) > Math.PI * .48) {
    motion.speed = 0;
    return advanceShip(ship, map, units, { yaw: Math.max(-turn, Math.min(turn, error)) });
  }
  const lateral = -cx * detSin(motion.heading) + cy * detCos(motion.heading);
  const curvature = Math.abs(lateral) < 1e-7 ? 0 : 2 * lateral / (distance * distance);
  const targetSpeed = Math.min(limits.speed * pace,
    curvature ? limits.turnRate / Math.abs(curvature) : Infinity,
    Math.sqrt(2 * limits.acceleration * endGap));
  // Curvature is a hard steering limit; acceleration controls the usual ramp.
  const speed = Math.min(targetSpeed, motion.speed + acceleration);
  let surge = perTick(speed), yaw = surge * curvature;
  // Finish on the goal when it is within one forward step and the yaw budget.
  if (points.length === 1 && endGap <= surge && Math.abs(error) <= turn) {
    surge = endGap; yaw = error;
  }
  const start = { x: ship.x, y: ship.y, heading: motion.heading };
  const traffic = shipTraffic(ship, units);
  // Project the commanded curve only as far as the carrot (at most 1 second).
  // Each projected step checks both rotation and forward sweep, as the engine
  // does. Dynamic traffic is checked again by advanceShip on the actual step.
  const horizon = Math.min(SIM_TICKS_PER_SECOND, Math.max(1, Math.ceil(distance / Math.max(surge, 1e-7))));
  let from: ShipPose = start;
  for (let i = 0; i < horizon; i++) {
    const heading = from.heading + yaw, turned = { ...from, heading };
    const to = { x: from.x + surge * detCos(heading), y: from.y + surge * detSin(heading), heading };
    if (!hullPassageClear(map, ship, from, turned) || !traffic(from, turned)
      || !hullPassageClear(map, ship, turned, to) || !traffic(turned, to)) return false;
    from = to;
  }
  if (!advanceShip(ship, map, units, { surge, yaw })) return false;
  motion.speed = speed;
  return true;
}
