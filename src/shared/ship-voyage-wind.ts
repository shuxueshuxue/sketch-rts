import { shipPartMax } from './ship-equipment';
import { shipProfile, type Point } from './ship-geometry';
import { headingDifference, planBeatDeparture, planVoyageRoute, shipTackRoute, type ShipPose } from './ship-navigation';
import { shipRouteTraffic } from './ship-avoidance';
import type { GameMap, Unit } from './types';

/** The native voyage's companion filter, also used for predictive queries. */
export function voyageCompanion(ship: Unit, other: Unit, point: Point & { intent?: string; heading?: number }, bearing: number, windPlan = false): boolean {
  if (ship.order.type !== 'move' || ship.order.heading !== undefined || ship.order.rendezvousFor !== undefined
    || point.intent !== undefined || point.heading !== undefined || other === ship || other.owner !== ship.owner
    || other.order.type !== 'move' || other.order.heading !== undefined || other.order.rendezvousFor !== undefined || !other.sailing) return false;
  if ((other.shipParts?.rigging ?? shipPartMax(other).rigging) <= 0 || other.sailing.route?.cruise === false) return false;
  const length = shipProfile(ship)!.length, onward = Math.atan2(other.order.y - other.y, other.order.x - other.x);
  const otherLength = shipProfile(other)?.length ?? length;
  const remaining = Math.hypot(other.order.x - other.x, other.order.y - other.y);
  const clearFinish = Math.hypot(other.order.x - point.x, other.order.y - point.y) > (length + otherLength) * .5;
  return remaining > 1 && (remaining > otherLength || clearFinish)
    && Math.abs(headingDifference(bearing, onward)) <= Math.PI / 6
    && (windPlan || Math.abs(headingDifference(other.sailing.heading, onward)) <= Math.PI / 6);
}

/** Pure native wind substitution. Planning admission and route mutation stay
 * with the executor. The 1024-expansion suffix has its original partial flag. */
export function planVoyageWindLeg(map: GameMap, ship: Unit, next: ShipPose, traffic: (from: ShipPose, to: ShipPose) => boolean,
  units: readonly Unit[], movingPursuit: boolean, tackHeading?: number):
  | { kind: 'departure'; points: ShipPose[] }
  | { kind: 'tack'; points: ShipPose[]; reaches: boolean; partial: boolean }
  | undefined {
  const departure = movingPursuit ? planBeatDeparture(map, ship, next, traffic, tackHeading) : undefined;
  if (departure) return { kind: 'departure', points: departure };
  const tack = shipTackRoute(map, ship, next, traffic, tackHeading);
  if (!tack) return;
  const finish = tack.at(-1)!, reaches = Math.hypot(finish.x - next.x, finish.y - next.y) < 1;
  if (reaches) return { kind: 'tack', points: tack, reaches: true, partial: false };
  const onward = { ...ship, x: finish.x, y: finish.y, sailing: { ...ship.sailing!, heading: finish.heading } };
  const suffix = planVoyageRoute(map, onward, { x: next.x, y: next.y }, shipRouteTraffic(map, onward, units.filter(unit => unit !== ship), Infinity), 1024);
  return { kind: 'tack', points: [...tack, ...suffix.points], reaches: false, partial: suffix.partial };
}
