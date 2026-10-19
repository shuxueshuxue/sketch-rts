import { groundSteeringRoute, routeTravelTicks } from '../../shared/route-selection';
import { groundTravelCost } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, Unit } from '../../shared/types';
import type { Point } from './spatial';

type Road = { points: ReturnType<typeof groundSteeringRoute>; ticks: number };
let roadReuse: WeakMap<GameSnapshot, WeakMap<Unit, Map<string, Road | undefined>>> | undefined;

/** Scope immutable steering geometry to one synchronous owner think. */
export function withNativeLandRoadReuse<T>(run: () => T): T {
  const previous = roadReuse;
  roadReuse = new WeakMap();
  try { return run(); }
  finally { roadReuse = previous; }
}

function reuseFor(snapshot: GameSnapshot) {
  if (!roadReuse) return undefined;
  let roads = roadReuse.get(snapshot);
  if (!roads) roadReuse.set(snapshot, roads = new WeakMap());
  return roads;
}

/** Shared geometry for admission and retreats; threat policies remain separate. */
export function nativeLandRoad(snapshot: GameSnapshot, unit: Unit, goal: Point) {
  const reuse = reuseFor(snapshot);
  if (!reuse) return computeNativeLandRoad(snapshot, unit, goal);
  let goals = reuse.get(unit);
  if (!goals) reuse.set(unit, goals = new Map());
  const key = `${goal.x}:${goal.y}`;
  if (!goals.has(key)) goals.set(key, computeNativeLandRoad(snapshot, unit, goal));
  const road = goals.get(key);
  // Callers own their returned road, just as they do outside the reuse scope.
  if (!road) return undefined;
  const points: Road['points'] = [{ ...road.points[0] }, ...road.points.slice(1).map(point => ({ ...point }))];
  return { ticks: road.ticks, points };
}

function computeNativeLandRoad(snapshot: GameSnapshot, unit: Unit, goal: Point) {
  const invalid = (from: Point, to: Point, value: unknown) => new Error(
    `Invalid native land travel for ${unit.id} (${unit.kind}, speed ${unit.speed}): (${from.x},${from.y}) -> (${to.x},${to.y}), cost/ticks ${String(value)}`);
  if (!Number.isFinite(unit.speed) || unit.speed <= 0) throw invalid(unit, goal, unit.speed);
  if (routeTravelTicks(snapshot.map, unit, goal, 'land', unit.speed) === undefined) return undefined;
  const points = groundSteeringRoute(snapshot.map, unit, goal);
  let cost = 0;
  for (let index = 1; index < points.length; index++) {
    const segment = groundTravelCost(snapshot.map, points[index - 1]!, points[index]!);
    if (segment === undefined || !Number.isFinite(segment)) throw invalid(points[index - 1]!, points[index]!, segment);
    cost += segment;
  }
  const ticks = Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
  if (!Number.isFinite(ticks)) throw invalid(unit, goal, ticks);
  return { points, ticks };
}

