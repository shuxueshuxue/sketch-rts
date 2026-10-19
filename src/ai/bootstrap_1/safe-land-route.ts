import { routeClearsDisks, routeLeavesDisks } from '../../shared/route-selection';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { isEnemyOwner } from '../policy/ownership';
import { castThreatReach, mountedThreatReach, THINK_TICKS } from './mounted-micro';

import { withNavalShoreReuse } from '../policy/naval-shore-reuse';
import { nativeLandRoad, withNativeLandRoadReuse } from '../policy/land-road';
export { nativeLandRoad } from '../policy/land-road';
type Threat = Unit | Building;
type RoadReuse = {
  checks: WeakMap<Unit, Map<string, { foes: readonly Threat[]; clear: boolean }>>;
};
let roadReuse: WeakMap<GameSnapshot, RoadReuse> | undefined;

/** Only immutable world geometry is reused, never assignments or mutable policy memory. */
export function withLandRoadReuse<T>(run: () => T): T {
  // One synchronous owner think, including context preparation and script claims/run.
  // A later think (even with the same snapshot object) and a nested planner get a
  // fresh scope. Budget views have distinct snapshot keys. Finally also clears on error.
  const previous = roadReuse;
  roadReuse = new WeakMap();
  try { return withNativeLandRoadReuse(() => withNavalShoreReuse(run)); }
  finally { roadReuse = previous; }
}

function reuseFor(snapshot: GameSnapshot) {
  if (!roadReuse) return undefined;
  let reuse = roadReuse.get(snapshot);
  if (!reuse) roadReuse.set(snapshot, reuse = { checks: new WeakMap() });
  return reuse;
}

function roadClear(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly Threat[], retreat: boolean, compute: () => boolean) {
  const reuse = reuseFor(snapshot);
  if (!reuse) return compute();
  let checks = reuse.checks.get(unit);
  if (!checks) reuse.checks.set(unit, checks = new Map());
  const key = `${retreat}:${goal.x}:${goal.y}`, previous = checks.get(key);
  // Claims and team options can change between scripts; their selected foe list
  // must still match. Store our own list because callers may sort/filter theirs.
  if (previous && previous.foes.length === foes.length && previous.foes.every((foe, index) => foe === foes[index])) return previous.clear;
  const clear = compute();
  checks.set(key, { foes: [...foes], clear });
  return clear;
}

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
  return roadClear(snapshot, unit, goal, foes, false,
    () => routeClearsDisks(road.points, landThreatDisks(snapshot, unit, foes, road.ticks))) ? road.ticks : undefined;
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
  const clear = roadClear(snapshot, unit, goal, foes, true, () => {
    const disks = foes.flatMap(foe => {
      const reach = retreatThreatReach(snapshot, foe, unit, THINK_TICKS + ticks);
      return reach > 0 ? [{ x: foe.x, y: foe.y, radius: reach + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND }] : [];
    });
    return routeLeavesDisks(points, disks);
  });
  return clear ? { points, ticks } : undefined;
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
