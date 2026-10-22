import { retainCacheMap, readCacheMap } from './bounded-cache';
import { shareShipProfile } from '../../shared/ship-geometry';
import { shipMotionLimits } from '../../shared/ship-handling';
import { coursePerformance, windAt } from '../../shared/ship-wind';
import type { Terrain } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, Unit } from '../../shared/types';
import { createPlanningDistanceQuery } from './distance-fields';
import type { Point } from './types';
import type { StrategyObservationMemory } from './observation-memory';

type Estimate = Readonly<{ status: 'known'; ticks: number; computedTick: number; geometryTick: number | null } | { status: 'pending' | 'unreachable' }>;
const pending: Estimate = { status: 'pending' }, unreachable: Estimate = { status: 'unreachable' };
type SeaFacts = { roads: Map<string, readonly Point[] | undefined>; prices: Map<string, number> };
// Terrain identity is the sea-basin geometry version. Terrain is immutable; a
// replacement terrain gets its own namespace. Buildings do not change this grid.
const facts = new WeakMap<Terrain, SeaFacts>();
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
function retain<T>(values: Map<string, T>, key: string, value: T, limit: number) {
  retainCacheMap(values, key, value, limit);
}

/** Pricing is a pure projection of endpoints, motion rates, rig and uniform wind.
 * Identity, passengers and fitting records matter only through shipMotionLimits.
 * Fixed dock legs start aligned; a live approach also includes its actual heading.
 * Refresh mode is an audit seam: calculate the same quote without reading/writing
 * price/road caches. Both modes still share the native weighted distance field. */
export function createSeaTravelQuery(snapshot: GameSnapshot, buildBudget = Infinity, cache: 'reuse' | 'refresh' = 'reuse', observation?: StrategyObservationMemory) {
  const fields = createPlanningDistanceQuery(snapshot, buildBudget, 'sea', observation);
  const terrain = snapshot.map.terrain;
  let shared = terrain && facts.get(terrain);
  if (terrain && !shared) facts.set(terrain, shared = { roads: new Map(), prices: new Map() });
  const local = new Map<string, Estimate>(), poses = new WeakMap<Unit, Unit>();
  const stats = { requests: 0, localHits: 0, priceHits: 0, geometryBuilds: 0, pricings: 0 };
  function travel(ship: Unit, from: Point, to: Point, future = false, requestWork = true): Estimate {
    stats.requests++;
    if (gap(from, to) <= 1e-7) return { status: 'known', ticks: 0, computedTick: snapshot.tick, geometryTick: null };
    const limits = shipMotionLimits(ship);
    if (!(limits.speed > 0) || !(limits.turnRate > 0)) return unreachable;
    const fixed = future || from.x !== ship.x || from.y !== ship.y;
    const roadKey = `${from.x}:${from.y}:${to.x}:${to.y}`;
    const windKey = windAt(snapshot.map, from).key;
    const key = `${roadKey}:${ship.kind}:${limits.speed}:${limits.acceleration}:${limits.turnRate}:${windKey}:${fixed ? 'aligned' : ship.sailing?.heading ?? 0}`;
    // Publication depends on this owner's serialized work, before either cache.
    const field = fields.field(to, requestWork);
    if (!field) return pending;
    const localHit = cache === 'reuse' && local.get(key);
    if (localHit) { stats.localHits++; return localHit; }
    const hit = cache === 'reuse' && fixed ? shared ? readCacheMap(shared.prices, key) : undefined : undefined;
    if (hit !== undefined) {
      stats.priceHits++; retain(shared!.prices, key, hit, 1024);
      const result: Estimate = { status: 'known', ticks: hit, geometryTick: field.builtTick, computedTick: snapshot.tick };
      local.set(key, result); return result;
    }
    const knownRoad = cache === 'reuse' && shared?.roads.has(roadKey);
    let road = knownRoad ? readCacheMap(shared!.roads, roadKey) : undefined;
    const geometryTick = field.builtTick;
    if (!fixed || !knownRoad) {
      road = field.field.road(from, to);
      if (road && gap(road.at(-1)!, to) > 240) road = undefined;
      if (fixed) {
        stats.geometryBuilds++;
        if (cache === 'reuse' && shared) retain(shared.roads, roadKey, road, 512);
      }
    }
    if (!road) { if (cache === 'reuse') local.set(key, unreachable); return unreachable; }
    let pose = poses.get(ship);
    if (!pose) { pose = { ...ship }; shareShipProfile(ship, pose); poses.set(ship, pose); }
    pose.x = from.x; pose.y = from.y;
    const speedFor = (course: number) => {
      const wind = coursePerformance(pose!, snapshot.map, course, { assumeTrimmed: true });
      return wind.noGo ? Math.max(wind.auxiliarySpeed,
        coursePerformance(pose!, snapshot.map, course + wind.beatAngle, { assumeTrimmed: true }).targetSpeed * Math.cos(wind.beatAngle),
        coursePerformance(pose!, snapshot.map, course - wind.beatAngle, { assumeTrimmed: true }).targetSpeed * Math.cos(wind.beatAngle))
        : Math.max(wind.auxiliarySpeed, wind.targetSpeed);
    };
    const first = road[1] ?? to;
    let previous = from, heading = Math.atan2(first.y - from.y, first.x - from.x), seconds = 0;
    if (!fixed) {
      const length = field.field.cost(from)!;
      seconds = length / speedFor(heading) + angleGap(ship.sailing?.heading ?? 0, heading) / limits.turnRate;
    } else for (const point of road.slice(1)) {
      const length = gap(previous, point); if (!length) continue;
      const course = Math.atan2(point.y - previous.y, point.x - previous.x);
      pose.x = previous.x; pose.y = previous.y;
      seconds += length / speedFor(course) + angleGap(heading, course) / limits.turnRate;
      heading = course; previous = point;
    }
    seconds += limits.speed / Math.max(1, limits.acceleration);
    const ticks = Math.ceil(seconds * SIM_TICKS_PER_SECOND);
    if (!Number.isFinite(ticks)) throw new Error(`Non-finite strategy sailing ETA for ${ship.id}`);
    stats.pricings++;
    const result: Estimate = { status: 'known', ticks, computedTick: snapshot.tick, geometryTick };
    if (cache === 'reuse') {
      local.set(key, result);
      if (fixed && shared) retain(shared.prices, key, ticks, 1024);
    }
    return result;
  }
  return { travel, prepareField: (goal: Point) => { fields.field(goal); }, stats,
    get deferredFields() { return fields.deferred; } };
}
