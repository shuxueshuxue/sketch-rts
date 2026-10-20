import { routeLeavesDisks } from '../../shared/route-selection';
import { guardedField, segmentWalkable } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameCommand, GameSnapshot, Unit } from '../../shared/types';
import type { Point } from '../policy/spatial';
import { retreatThreatReach } from './safe-land-route';
import { THINK_TICKS } from './mounted-micro';

type Road = { points: [Point, ...Point[]]; ticks: number };
type Router = (goal: Point) => Road | undefined;
const routers = new WeakMap<GameSnapshot, Map<string, Router>>();

/** Roads that stay out of every foe's attack disk (or leave the disks the unit stands in), from one guarded field of the
 * land (see @@@guarded-field): every goal's time is read from it, and a road is traced only for the goal ridden to, as
 * straight walkable legs clear of the disks (so the native walk between them goes straight). */
export function threatLandRouter(snapshot: GameSnapshot, unit: Unit, foes: readonly (Unit | Building)[]): Router {
  const disks = foes.flatMap(foe => {
    const radius = retreatThreatReach(snapshot, foe, unit, THINK_TICKS + unit.cooldown)
      + ('order' in foe ? foe.speed * THINK_TICKS / SIM_TICKS_PER_SECOND : 0);
    return radius > 0 ? [{ x: foe.x, y: foe.y, radius }] : [];
  });
  return landDiskRouter(snapshot, unit, disks);
}

/** Shared geometry only; callers supply their own role's exposure disks. */
export function landDiskRouter(snapshot: GameSnapshot, unit: Unit, disks: readonly (Point & { radius: number })[]): Router {
  let key = `${unit.id}:${unit.x}:${unit.y}:${unit.radius}:${unit.speed}:${disks.length}`;
  for (const disk of disks) key += `:${disk.x},${disk.y},${disk.radius}`;
  let cache = routers.get(snapshot);
  if (cache === undefined) { cache = new Map(); routers.set(snapshot, cache); }
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const clear = (from: Point, to: Point) => segmentWalkable(snapshot.map, from, to) && routeLeavesDisks([from, to], disks);
  const field = guardedField(snapshot.map, unit, disks);
  const roads = new Map<string, Road | undefined>();
  const route: Router = goal => {
    const id = `${goal.x}:${goal.y}`;
    if (roads.has(id)) return roads.get(id);
    let road: Road | undefined;
    const cost = field?.cost(goal);
    if (cost !== undefined) {
      let points: [Point, ...Point[]] | undefined;
      road = { ticks: Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND), get points() { return points ??= straighten(unit, [...field!.cells(goal)!, goal], clear); } };
    }
    roads.set(id, road);
    return road;
  };
  cache.set(key, route);
  return route;
}

// The walk's cells as few straight legs: from each corner, on to the farthest later cell it clears to (the next cell
// always, a step of the walk).
function straighten(from: Point, path: readonly Point[], clear: (from: Point, to: Point) => boolean): [Point, ...Point[]] {
  const points: [Point, ...Point[]] = [from];
  for (let at = -1; at < path.length - 1;) {
    const corner = points[points.length - 1]!;
    let next = path.length - 1;
    while (next > at + 1 && !clear(corner, path[next]!)) next -= 1;
    points.push(path[next]!);
    at = next;
  }
  return points;
}

/** Queued native waypoints preserve the admitted detour rather than replanning straight through cover. */
export function threatRoadCommands(unit: Unit, road: Road): GameCommand[] {
  return road.points.slice(1).map((point, index) => ({ type: 'move', unitIds: [unit.id], ...point,
    avoidCombat: true, queued: index > 0 }));
}
