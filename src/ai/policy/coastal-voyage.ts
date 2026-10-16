import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { polygonRadius } from '../../shared/navigation-math';
import { routeClearsDisks } from '../../shared/route-selection';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { isInCabin } from '../../shared/ship-cabin';
import { shipProfile, type Point } from '../../shared/ship-geometry';
import { headingDifference, hullPassageClear, planVoyageRoute, shipPoseAt, type ShipPose } from '../../shared/ship-navigation';
import type { GameSnapshot, Unit } from '../../shared/types';
import { isEnemyOwner, type TeamPolicyOptions } from './ownership';

export type CoastalFireDisk = Point & { radius: number; id: string };
type Route = { points: readonly ShipPose[]; partial?: boolean };
export type CoastalVoyage = {
  proof: 'complete';
  waypoint: Point;
  /** Only the ordinary-move legs actually checked, possibly ending at an
   * intermediate mark. The remaining ordinary voyage must be queried again. */
  legs: { goal: Point; points: ShipPose[] }[];
  /** Complete hazard-aware reference to the strategic goal. This is a
   * tactical query proof, not a route installed in the engine. */
  reference: ShipPose[];
} | {
  proof: 'prefix';
  /** The public ordinary move requests this strategic coordinate. Only the
   * native planner's current incremental departure has a safety proof. */
  waypoint: Point;
  prefix: ShipPose[];
  legs: [];
};

/** Static observed fire coverage, expanded by the entire hull's radius.
 * The extra shore margin matches coastal-risk's advance warning. Mobile
 * enemies and physical traffic still require checks during the voyage. */
export function coastalFireDisks(snapshot: GameSnapshot, ship: Unit, options: TeamPolicyOptions, warningMargin = 160): CoastalFireDisk[] {
  const profile = shipProfile(ship);
  if (!profile) return [];
  const hull = polygonRadius(profile.hull);
  return [...snapshot.units.filter(unit => unit.hp > 0 && unitMover(unit.kind) === 'land' && !isInCabin(unit)
    && isEnemyOwner(snapshot, ship.owner, unit.owner, options)),
  ...snapshot.buildings.filter(building => building.hp > 0 && isEnemyOwner(snapshot, ship.owner, building.owner, options))]
    .flatMap(target => {
      const gun = combatCapability(snapshot, target);
      return gun.armed ? [{ x: target.x, y: target.y, radius: Math.max(150, gun.range) + warningMargin + hull, id: target.id }] : [];
    });
}

/** Bound the centre's circular departure from its endpoint chord. A hull
 * rotation is already covered by its enclosing radius; a curved/pivoting
 * centre needs R theta²/8 extra clearance around that chord as well. */
function curvedCentrePadding(from: ShipPose, to: ShipPose): number {
  const turn = Math.abs(headingDifference(from.heading, to.heading));
  if (!turn) return 0;
  const middle = shipPoseAt(from, to, .5);
  const sagitta = Math.hypot(middle.x - (from.x + to.x) / 2, middle.y - (from.y + to.y) / 2);
  if (!sagitta) return 0;
  const factor = 1 - Math.cos(turn / 2);
  return factor > 1e-12 ? sagitta / factor * turn * turn / 8 + 1e-5 : sagitta + 1e-5;
}

export function coastalFireSegmentClear(from: ShipPose, to: ShipPose, disks: readonly CoastalFireDisk[]): boolean {
  const padding = curvedCentrePadding(from, to);
  return routeClearsDisks([from, to], padding ? disks.map(disk => ({ ...disk, radius: disk.radius + padding })) : disks);
}

/** Fire safety of the native route's current finite prefix, not proof of
 * arrival. Partial routes are valid incremental departures; unknown or empty
 * routes have no such proof. Recheck before letting a later prefix execute. */
export function coastalVoyagePrefixSafe(snapshot: GameSnapshot, ship: Unit, route: Route | undefined, options: TeamPolicyOptions): boolean {
  if (!shipProfile(ship) || !route?.points.length || typeof route.partial !== 'boolean') return false;
  const disks = coastalFireDisks(snapshot, ship, options);
  let previous: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 };
  for (const point of route.points) {
    if (!coastalFireSegmentClear(previous, point, disks)) return false;
    previous = point;
  }
  return true;
}

/** Strict complete-route fire safety; a partial prefix is never arrival. */
export function coastalVoyageRouteSafe(snapshot: GameSnapshot, ship: Unit, route: Route | undefined, options: TeamPolicyOptions): boolean {
  return route?.partial === false && coastalVoyagePrefixSafe(snapshot, ship, route, options);
}

function ordinaryHull(ship: Unit, pose: ShipPose, goal: Point, speed: number): Unit {
  const copy: Unit = { ...ship, x: pose.x, y: pose.y, order: { type: 'move', x: goal.x, y: goal.y, avoidCombat: true },
    orderQueue: [], sailing: { ...ship.sailing!, heading: pose.heading, speed } };
  delete copy.sailing!.route;
  return copy;
}
function fullRoute(route: Route, goal: Point): boolean {
  const end = route.points.at(-1);
  return route.partial === false && !!end && Math.hypot(end.x - goal.x, end.y - goal.y) <= MOVE_ORDER_ARRIVAL_RANGE;
}

/** Find a safe ordinary-move mark without changing terrain or installing a
 * private engine route. A complete tactical reference supplies intermediate
 * candidates; only independently completed ordinary legs can become orders.
 * A native incremental departure can return an explicit prefix proof. Only
 * its current finite corridor is safe; subsequent native replans must be
 * checked before they execute. It never becomes a complete ordinary leg.
 * Call on a new/invalidated voyage, then persist its mark in policy memory. */
export function planCoastalVoyage(snapshot: GameSnapshot, ship: Unit, goal: Point, options: TeamPolicyOptions, budget = 100_000): CoastalVoyage | undefined {
  const profile = shipProfile(ship);
  if (!profile || !ship.sailing) return;
  // A firing station's final gun heading is the combat controller's work.
  // Public moves request coordinates; no private heading or route is set.
  goal = { x: goal.x, y: goal.y };
  const start = { x: ship.x, y: ship.y, heading: ship.sailing.heading }, disks = coastalFireDisks(snapshot, ship, options);
  if (!coastalFireSegmentClear(start, start, disks) || !coastalFireSegmentClear({ ...goal, heading: 0 }, { ...goal, heading: 0 }, disks)) return;
  const nativeQuery = (from: ShipPose, destination: Point, speed: number) => {
    const hull = ordinaryHull(ship, from, destination, speed);
    const units = snapshot.units.map(unit => unit.id === ship.id ? hull : unit);
    // This query owns a new units array: retain the executor's real static solids.
    beginShipCollisionFrame(units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
    const traffic = shipRouteTraffic(snapshot.map, hull, units);
    const route = planVoyageRoute(snapshot.map, hull, destination, traffic, budget);
    return { hull, route };
  };
  const nativeSafe = (from: ShipPose, hull: Unit, route: Route) => {
    let previous = from;
    for (const point of route.points) {
      if (!coastalFireSegmentClear(previous, point, disks) || !hullPassageClear(snapshot.map, hull, previous, point)) return false;
      previous = point;
    }
    return !!route.points.length;
  };
  const nativeLeg = (from: ShipPose, destination: Point, speed: number) => {
    const { hull, route } = nativeQuery(from, destination, speed);
    return fullRoute(route, destination) && nativeSafe(from, hull, route) ? route : undefined;
  };
  const direct = nativeQuery(start, goal, ship.sailing.speed);
  if (fullRoute(direct.route, goal) && nativeSafe(start, direct.hull, direct.route))
    return { proof: 'complete', waypoint: goal, legs: [{ goal, points: direct.route.points }], reference: direct.route.points };
  const prefix = (): CoastalVoyage | undefined => {
    const end = direct.route.points.at(-1);
    return direct.route.partial === true && end && Math.hypot(end.x - start.x, end.y - start.y) > MOVE_ORDER_ARRIVAL_RANGE
      && nativeSafe(start, direct.hull, direct.route)
      ? { proof: 'prefix', waypoint: goal, prefix: direct.route.points, legs: [] } : undefined;
  };
  const hull = ordinaryHull(ship, start, goal, ship.sailing.speed);
  const units = snapshot.units.map(unit => unit.id === ship.id ? hull : unit);
  beginShipCollisionFrame(units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const traffic = shipRouteTraffic(snapshot.map, hull, units);
  const detour = planVoyageRoute(snapshot.map, hull, goal,
    (from, to) => coastalFireSegmentClear(from, to, disks) && traffic(from, to), budget);
  if (!fullRoute(detour, goal)) return prefix();
  // Try the farthest useful ordinary mark along the complete reference first.
  // Include the entrance to a long straight, even when its short preceding
  // arc has no individual segment longer than a hull. Dense arc samples are
  // not themselves a sequence of replacement helms.
  const seen = new Set<string>();
  for (let i = detour.points.length - 2; i >= 0; i--) {
    const candidate = detour.points[i]!;
    if (candidate.curvature || Math.hypot(candidate.x - start.x, candidate.y - start.y) < profile.length * .5) continue;
    const key = `${candidate.x}:${candidate.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mark = { x: candidate.x, y: candidate.y };
    const first = nativeLeg(start, mark, ship.sailing.speed);
    if (!first) continue;
    const legs: Extract<CoastalVoyage, { proof: 'complete' }>['legs'] = [{ goal: mark, points: first.points }];
    const arrival = first.points.at(-1)!;
    const second = nativeLeg(arrival, goal, ship.sailing.speed);
    if (second && nativeLeg(arrival, goal, 0)) legs.push({ goal, points: second.points });
    return { proof: 'complete', waypoint: mark, legs, reference: detour.points };
  }
  return prefix();
}
