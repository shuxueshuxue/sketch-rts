import { advanceShipRouteSearch, SHIP_STATIC_ROUTE_SLICE_MAX_WORK, type ShipPose, type ShipRouteSearchState } from '../../shared/ship-navigation';
import { shareShipProfile, shipProfile } from '../../shared/ship-geometry';
import { shipMotionLimits } from '../../shared/ship-handling';
import { coursePerformance, windAt } from '../../shared/ship-wind';
import { shipTraffic } from '../../shared/ship-avoidance';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, Unit } from '../../shared/types';
import { fnv1a } from '../../shared/sim/checksum';
import { observationJsonBytes } from './observation-json-bytes';
import { currentFactWork } from './fact-work';
import type { StrategyObservationMemory } from './observation-memory';
import type { Point } from './types';

type Route = { points: ShipPose[]; partial: boolean };
type Entry = { id: string; key: string; firstRequestedTick: number; lastRequestedTick: number;
  geometryVersion: string; readyTick: number | null; publishedTick?: number;
  work: number; state: ShipRouteSearchState; failure?: 'memory-budget' };
export type PointRouteMemory = { entries: Entry[] };
export const POINT_ROUTE_MEMORY_BYTES = 32 * 1024;
export const POINT_ROUTE_LIMIT = 16;
export type PointRouteFact = Readonly<
  { status: 'complete'; route: Route; ticks: number; computedTick: number; work: number;
    basis: 'continued-native-search' | 'observed-native-route' | 'observed-at-berth' }
  | { status: 'pending' | 'static-infeasible' | 'transient-blocked'; reasonCode: string; work: number }>;
const clearStatic = Object.assign(() => true, { hasTraffic: false });

/** A static geometry cache and a fresh motion/wind price. Native search uses
 * handling and wind in its cost order, so they also invalidate its route key;
 * a cached road never supplies a stale ETA. Future boats do not freeze today's
 * mobile traffic at their eventual launch time. Real traffic remains an
 * explicitly temporary execution constraint, rather than static infeasibility. */
export function pointRoute(snapshot: GameSnapshot, observation: StrategyObservationMemory, ship: Unit,
  from: Point, goal: Point, future = false): PointRouteFact {
  const queue = currentFactWork();
  if (!queue) throw new Error('Point routes require the shared think work ledger');
  const liveOrigin = from.x === ship.x && from.y === ship.y;
  const at = Math.hypot(from.x - goal.x, from.y - goal.y);
  if (at < 1e-7 || !future && liveOrigin && at <= ship.radius)
    return { status: 'complete', route: { points: [], partial: false }, ticks: 0, computedTick: snapshot.tick,
      work: 0, basis: 'observed-at-berth' };
  const helm = ship.sailing?.route;
  if (!future && liveOrigin && helm && !helm.partial && helm.goalX === goal.x && helm.goalY === goal.y
    && Math.hypot((helm.points.at(-1)?.x ?? ship.x) - goal.x, (helm.points.at(-1)?.y ?? ship.y) - goal.y) <= ship.radius) {
    // The simulation has already published this hull's remaining native
    // course. Reuse that observed course instead of restarting a new search
    // every time the moving origin changes. Never accept a partial suffix.
    const route = { points: helm.points, partial: false };
    return { status: 'complete', route, ticks: pointRouteTicks(snapshot, ship, route.points),
      computedTick: snapshot.tick, work: 0, basis: 'observed-native-route' };
  }
  const memory = observation.pointRoutes ??= { entries: [] };
  const pose = { ...ship, x: from.x, y: from.y, sailing: { ...ship.sailing! } };
  delete pose.sailing.route; delete pose.sailing.planningJob;
  shareShipProfile(ship, pose);
  const profile = shipProfile(pose), limits = shipMotionLimits(pose);
  const id = `${ship.id}:${goal.x}:${goal.y}`;
  const geometryVersion = `${observation.terrain}:${observation.landBodies}`;
  const key = JSON.stringify([observation.terrain, observation.landBodies, [from.x, from.y], [goal.x, goal.y], profile?.hull,
    pose.sailing.heading ?? 0, limits, windAt(snapshot.map, from).key]);
  let entry = memory.entries.find(entry => entry.key === key);
  if (!entry) {
    const previous = memory.entries.find(entry => entry.id === id);
    if (memory.entries.length >= POINT_ROUTE_LIMIT) {
      memory.entries.sort((a, b) => a.lastRequestedTick - b.lastRequestedTick || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      if (memory.entries[0]!.lastRequestedTick === snapshot.tick)
        return { status: 'pending', reasonCode: 'native-point-route-entry-budget', work: 0 };
      memory.entries.shift();
    }
    entry = { id, key, geometryVersion,
      firstRequestedTick: previous?.geometryVersion === geometryVersion ? previous.firstRequestedTick : snapshot.tick,
      lastRequestedTick: snapshot.tick, readyTick: null, work: 0, state: { phase: 'prepare' } };
    memory.entries.push(entry);
  }
  entry.lastRequestedTick = snapshot.tick;
  const progress = entry;
  const taskKey = `point:${key}`;
  if (progress.readyTick === null) queue.register({ key: taskKey, goal, reportKey: `point:${id}:${fnv1a(key)}`,
    tier: queue.isCritical(goal) ? 'critical-route' : 'background-field',
    minimum: SHIP_STATIC_ROUTE_SLICE_MAX_WORK,
    run() {
      const meter = { logicalWork: 0, expandedStates: 0 };
      // A finite expansion cap avoids the native Infinity-only whole-map
      // potential prepass; the existing continued native search still owns
      // trial order, collision tests and its normal logical slice boundary.
      const route = advanceShipRouteSearch(snapshot.map, pose, goal, clearStatic,
        Number.MAX_SAFE_INTEGER, true, progress.state, meter);
      if (meter.logicalWork > SHIP_STATIC_ROUTE_SLICE_MAX_WORK) throw new Error('Native static slice reservation was exceeded');
      progress.work += meter.logicalWork;
      if (route) {
        progress.readyTick = snapshot.tick;
        progress.state = { phase: 'done', result: route };
      }
      if (observationJsonBytes(memory) > POINT_ROUTE_MEMORY_BYTES) {
        // Never let search graphs evict the complete policy memory. Report a
        // bounded failure, rather than treating a truncated graph as a road.
        progress.state = { phase: 'done', result: { points: [], partial: true } };
        progress.failure = 'memory-budget';
        progress.readyTick = snapshot.tick;
      }
      return { work: meter.logicalWork, done: progress.readyTick !== null };
    } });
  const route = progress.state.result;
  if (progress.failure) return { status: 'pending', reasonCode: 'native-point-route-memory-budget', work: progress.work };
  if (progress.readyTick === null || progress.readyTick >= snapshot.tick || !route)
    return { status: 'pending', reasonCode: 'native-point-route-pending', work: progress.work };
  const end = route.points.at(-1) ?? pose;
  if (route.partial || Math.hypot(end.x - goal.x, end.y - goal.y) > 1e-5)
    return { status: 'static-infeasible', reasonCode: 'native-point-route-static-infeasible', work: progress.work };
  if (!future) {
    const traffic = shipTraffic(pose, snapshot.units.filter(unit => unit.id !== ship.id));
    let previous: ShipPose = { x: from.x, y: from.y, heading: pose.sailing.heading ?? 0 };
    for (const point of route.points) {
      if (!traffic(previous, point)) return { status: 'transient-blocked', reasonCode: 'native-point-route-traffic-blocked', work: progress.work };
      previous = point;
    }
  }
  progress.publishedTick ??= snapshot.tick;
  return { status: 'complete', route, ticks: pointRouteTicks(snapshot, pose, route.points), computedTick: snapshot.tick,
    work: progress.work, basis: 'continued-native-search' };
}

/** Reprice the native point list with this hull's actual limits and wind.
 * This is a route forecast; combat, congestion and future hostile movement are
 * handled elsewhere. No geometric or price result is a straight-line fallback. */
function pointRouteTicks(snapshot: GameSnapshot, ship: Unit, points: readonly ShipPose[]): number {
  const pose = { ...ship, sailing: { ...ship.sailing! } }; shareShipProfile(ship, pose);
  const limits = shipMotionLimits(pose);
  let previous = { x: pose.x, y: pose.y, heading: pose.sailing.heading ?? 0 }, seconds = 0;
  for (const point of points) {
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    const performance = coursePerformance(pose, snapshot.map, point.heading, { assumeTrimmed: true });
    const speed = Math.min(Math.max(performance.targetSpeed, performance.auxiliarySpeed), point.speedLimit ?? Infinity);
    const turn = Math.abs(Math.atan2(Math.sin(point.heading - previous.heading), Math.cos(point.heading - previous.heading)));
    if (!(speed > 0) || !(limits.turnRate > 0)) throw new Error('Invalid native point-route motion');
    seconds += length / speed + turn / limits.turnRate;
    pose.x = point.x; pose.y = point.y; previous = point;
  }
  seconds += Math.max(0, limits.speed - (ship.sailing?.speed ?? 0)) / Math.max(1, limits.acceleration);
  return Math.ceil(seconds * SIM_TICKS_PER_SECOND);
}
