import type { Point } from './ship-geometry';
import { groundSegmentAdvance, groundTravelCost, segmentWalkable, walkingDistance, walkRoute, type Mover } from './terrain';
import type { GameMap } from './types';
import { SIM_TICKS_PER_SECOND } from './time';
import { pointSegmentDistanceSquared } from './navigation-math';
import { MOVE_ORDER_ARRIVAL_RANGE } from './movement-rules';

/** Forecast a clear ground move using terrain pace and the move order's arrival radius.
 * Body detours, status effects and per-tick boundary rounding remain actual movement work. */
export function groundMoveForecast(map: Pick<GameMap, 'terrain'>, from: Point, goal: Point, speed: number, ticks: number): Point {
  const gap = Math.hypot(goal.x - from.x, goal.y - from.y);
  if (gap <= MOVE_ORDER_ARRIVAL_RANGE) return from;
  const portion = (gap - MOVE_ORDER_ARRIVAL_RANGE) / gap;
  return groundSegmentAdvance(map, from, { x: from.x + (goal.x - from.x) * portion,
    y: from.y + (goal.y - from.y) * portion }, speed * ticks / SIM_TICKS_PER_SECOND);
}

/** Check every actual road segment against physical circles, independently of route length. */
export function routeClearsDisks(points: readonly Point[], disks: readonly (Point & { radius: number })[]): boolean {
  return points.slice(1).every((point, index) => disks.every(disk =>
    pointSegmentDistanceSquared(disk, points[index]!, point) > disk.radius * disk.radius));
}

/** Terrain approach geometry uses a visible straight segment before terrain roads.
 * Building detours, body clearance and flow-field corner smoothing remain movement work. */
export function groundApproachRoute(map: Pick<GameMap, 'terrain'>, from: Point, goal: Point): Point[] | undefined {
  const ground = { ...map };
  return segmentWalkable(ground, from, goal, 'land') ? [goal] : walkRoute(ground, from, goal);
}

/** Estimated terrain travel at a supplied speed; land includes ground pace costs.
 * Sea uses constant-speed road length, excluding wind, acceleration and turning. */
export function routeTravelTicks(map: Pick<GameMap, 'terrain'>, from: Point, to: Point, mover: Mover, speed: number): number | undefined {
  const road = mover === 'land' ? groundTravelCost(map, from, to) : walkingDistance(map, from, to, mover);
  return road === undefined ? undefined : Math.ceil(road / speed * SIM_TICKS_PER_SECOND);
}

/** Reachability and road length within a distance budget; terrain pace belongs to travel time. */
export function routeWithinDistance(map: Pick<GameMap, 'terrain'>, from: Point, to: Point, mover: Mover, range: number): boolean {
  const road = walkingDistance(map, from, to, mover);
  return road !== undefined && road <= range;
}

/** Reachable movers in estimated arrival order, including land pace and each mover's speed. */
export function routeArrivals<T extends Point & { speed: number }>(map: Pick<GameMap, 'terrain'>, candidates: readonly T[], destination: Point, mover: Mover): { unit: T; ticks: number }[] {
  return candidates.flatMap(unit => {
    const ticks = routeTravelTicks(map, unit, destination, mover, unit.speed);
    return ticks === undefined ? [] : [{ unit, ticks }];
  }).sort((a, b) => a.ticks - b.ticks);
}

/** Shortest terrain route to one destination. Unreachable candidates do not compete.
 * Building detours, body clearance and sailing time belong to movement planning.
 * A single destination reuses the terrain's distance field for every candidate. */
export function nearestByRoute<T extends Point>(map: Pick<GameMap, 'terrain'>, candidates: readonly T[], destination: Point, mover: Mover): T | undefined {
  let best: T | undefined;
  let shortest = Infinity;
  for (const candidate of candidates) {
    const route = walkingDistance(map, candidate, destination, mover);
    if (route !== undefined && route < shortest) {
      best = candidate;
      shortest = route;
    }
  }
  return best;
}
