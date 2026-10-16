import { groundSteeringRoute, routeLeavesDisks } from '../../shared/route-selection';
import { groundTravelCost, isOpenGround } from '../../shared/terrain';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameCommand, GameSnapshot, Unit } from '../../shared/types';
import type { Point } from '../policy/spatial';
import { retreatThreatReach } from './safe-land-route';
import { THINK_TICKS } from './mounted-micro';

type Road = { points: [Point, ...Point[]]; ticks: number };
type Router = (goal: Point) => Road | undefined;
const routers = new WeakMap<GameSnapshot, Map<string, Router>>();

/** The current known coverage used by both road admission and its next step. */
export function threatLandDisks(snapshot: GameSnapshot, unit: Unit, foes: readonly (Unit | Building)[]) {
  return foes.flatMap(foe => {
    const radius = retreatThreatReach(snapshot, foe, unit, THINK_TICKS + unit.cooldown)
      + ('order' in foe ? foe.speed * THINK_TICKS / SIM_TICKS_PER_SECOND : 0);
    return radius > 0 ? [{ x: foe.x, y: foe.y, radius }] : [];
  });
}

/** A visibility graph joins native terrain roads around physical attack disks, including continuous maps. */
export function threatLandRouter(snapshot: GameSnapshot, unit: Unit, foes: readonly (Unit | Building)[]): Router {
  const disks = threatLandDisks(snapshot, unit, foes);
  const key = `${unit.id}:${unit.x}:${unit.y}:${unit.radius}:${unit.speed}:${JSON.stringify(disks)}`;
  let cache = routers.get(snapshot);
  if (cache === undefined) { cache = new Map(); routers.set(snapshot, cache); }
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const roads = new Map<string, Road | undefined>();
  const geometry = new Map<string, [Point, ...Point[]]>();
  const edge = (from: Point, goal: Point) => {
    const id = `${from.x}:${from.y}:${goal.x}:${goal.y}`;
    if (roads.has(id)) return roads.get(id);
    const points = groundSteeringRoute(snapshot.map, from, goal), end = points[points.length - 1]!;
    geometry.set(id, points);
    let road: Road | undefined;
    if (Math.hypot(end.x - goal.x, end.y - goal.y) <= MOVE_ORDER_ARRIVAL_RANGE && routeLeavesDisks(points, disks)) {
      const cost = points.slice(1).reduce((sum, point, index) => sum + groundTravelCost(snapshot.map, points[index]!, point)!, 0);
      road = { points, ticks: Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND) };
    }
    roads.set(id, road);
    return road;
  };
  const search: Router = goal => {
    const direct = edge(unit, goal);
    if (direct !== undefined) return direct;
    const points = geometry.get(`${unit.x}:${unit.y}:${goal.x}:${goal.y}`)!;
    const relevant = new Set(disks.filter(disk => !routeLeavesDisks(points, [disk])));
    let added = true;
    while (added) {
      added = false;
      for (const disk of disks) if (!relevant.has(disk) && [...relevant].some(other =>
        Math.hypot(disk.x - other.x, disk.y - other.y)
          <= Math.SQRT2 * (disk.radius + other.radius + 2 * MOVE_ORDER_ARRIVAL_RANGE))) {
        relevant.add(disk); added = true;
      }
    }
    const corners = [...relevant].flatMap(disk => {
      const span = disk.radius + MOVE_ORDER_ARRIVAL_RANGE;
      return [-1, 1].flatMap(dx => [-1, 1].map(dy => ({ x: disk.x + dx * span, y: disk.y + dy * span })));
    }).filter(point => point.x >= 0 && point.y >= 0 && point.x < snapshot.map.width && point.y < snapshot.map.height
      && isOpenGround(snapshot.map, point.x, point.y)
      && disks.every(disk => Math.hypot(point.x - disk.x, point.y - disk.y) > disk.radius));
    const nodes = [unit, goal, ...corners], costs = nodes.map(() => Infinity), parents = new Map<number, { from: number; road: Road }>();
    const remaining = new Set(nodes.map((_node, index) => index));
    costs[0] = 0;
    while (remaining.size) {
      const index = [...remaining].sort((a, b) => costs[a]! - costs[b]!)[0]!;
      if (costs[index] === Infinity) return undefined;
      if (index === 1) {
        const legs: Road[] = [];
        let cursor = index;
        while (cursor !== 0) { const leg = parents.get(cursor)!; legs.unshift(leg.road); cursor = leg.from; }
        return { points: [unit, ...legs.flatMap(leg => leg.points.slice(1))], ticks: costs[index]! };
      }
      remaining.delete(index);
      for (const other of remaining) {
        const road = edge(nodes[index]!, nodes[other]!);
        if (road !== undefined && costs[index]! + road.ticks < costs[other]!) {
          costs[other] = costs[index]! + road.ticks;
          parents.set(other, { from: index, road });
        }
      }
    }
    return undefined;
  };
  const targets = new Map<string, Road | undefined>();
  const route: Router = goal => {
    const id = `${goal.x}:${goal.y}`;
    if (targets.has(id)) return targets.get(id);
    const road = search(goal);
    targets.set(id, road);
    return road;
  };
  cache.set(key, route);
  return route;
}

/** Queued native waypoints preserve the admitted detour rather than replanning straight through cover. */
export function threatRoadCommands(unit: Unit, road: Road): GameCommand[] {
  return road.points.slice(1).map((point, index) => ({ type: 'move', unitIds: [unit.id], ...point,
    avoidCombat: true, queued: index > 0 }));
}
