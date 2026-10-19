import { groundSteeringRoute, routeClearsDisks, routeLeavesDisks, routeTravelTicks } from '../../shared/route-selection';
import { groundTravelCost } from '../../shared/terrain';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { isEnemyOwner } from '../policy/ownership';
import { castThreatReach, mountedThreatReach, THINK_TICKS } from './mounted-micro';

export function armedFoes(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
}

/** Earliest physical contact is a lower bound; a rescuer's road time is a separate measure. */
export function earliestThreatContactTicks(snapshot: GameSnapshot, foe: Unit, unit: Unit) {
  const closing = foe.speed + unit.speed;
  const horizon = Math.ceil(Math.max(0, distance(foe, unit) - foe.attackRange) * SIM_TICKS_PER_SECOND / closing);
  const reach = retreatThreatReach(snapshot, foe, unit, horizon + THINK_TICKS);
  return Math.ceil(Math.max(0, distance(foe, unit) - reach) * SIM_TICKS_PER_SECOND / closing);
}

/** Check the native steering road; each task owns its destination's arrival range. */
export function safeLandTravelTicks(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly (Unit | Building)[], arrives?: (end: Point) => boolean): number | undefined {
  const road = nativeLandRoad(snapshot, unit, goal);
  if (!road || arrives && !arrives(road.points[road.points.length - 1]!)) return undefined;
  return routeClearsDisks(road.points, landThreatDisks(snapshot, unit, foes, road.ticks)) ? road.ticks : undefined;
}

/** Check the same building-aware steering road that a recovery move will execute. */
export function retreatLandTravelTicks(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly (Unit | Building)[]): number | undefined {
  const road = retreatLandRoad(snapshot, unit, goal, foes);
  return road && Math.hypot(road.points[road.points.length - 1]!.x - goal.x, road.points[road.points.length - 1]!.y - goal.y)
    <= MOVE_ORDER_ARRIVAL_RANGE ? road.ticks : undefined;
}

/** A native retreat road may end beside a building; the task decides its arrival range. */
export function retreatLandRoad(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly (Unit | Building)[]) {
  const road = nativeLandRoad(snapshot, unit, goal);
  if (!road) return undefined;
  const { points, ticks } = road;
  const disks = foes.flatMap(foe => {
    const reach = retreatThreatReach(snapshot, foe, unit, THINK_TICKS + ticks);
    return reach > 0 ? [{ x: foe.x, y: foe.y, radius: reach + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND }] : [];
  });
  return routeLeavesDisks(points, disks) ? { points, ticks } : undefined;
}

/** Shared geometry for admission and retreats; threat policies remain separate. */
export function nativeLandRoad(snapshot: GameSnapshot, unit: Unit, goal: Point) {
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

/** Avoid-combat movement suppresses native normal fire; active casts remain possible within the next think. */
export function retreatThreatReach(snapshot: GameSnapshot, foe: Unit | Building, patient: Unit | Building, horizon: number) {
  return 'order' in foe && foe.order.type === 'move' && foe.order.avoidCombat
    ? castThreatReach(snapshot, foe, patient, Math.min(horizon, THINK_TICKS)) : mountedThreatReach(snapshot, foe, patient, horizon);
}

function landThreatDisks(snapshot: GameSnapshot, unit: Unit, foes: readonly (Unit | Building)[], ticks: number) {
  return foes.map(foe => ({ x: foe.x, y: foe.y, radius: mountedThreatReach(snapshot, foe, unit, THINK_TICKS + ticks)
    + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND }));
}
