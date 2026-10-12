import { groundApproachRoute, groundSteeringRoute, routeClearsDisks, routeLeavesDisks, routeTravelTicks } from '../../shared/route-selection';
import { groundTravelCost } from '../../shared/terrain';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { isEnemyOwner } from '../policy/ownership';
import { castThreatReach, mountedThreatReach, THINK_TICKS } from './mounted-micro';

export function armedFoes(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
}

/** Terrain travel time, admitted only when every road segment clears known attack coverage. */
export function safeLandTravelTicks(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly (Unit | Building)[]): number | undefined {
  const ticks = routeTravelTicks(snapshot.map, unit, goal, 'land', unit.speed);
  if (ticks === undefined) return undefined;
  const route = groundApproachRoute(snapshot.map, unit, goal);
  if (route === undefined) return undefined;
  return routeClearsDisks([unit, ...route], landThreatDisks(snapshot, unit, foes, ticks)) ? ticks : undefined;
}

/** Check the same building-aware steering road that a recovery move will execute. */
export function retreatLandTravelTicks(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly (Unit | Building)[]): number | undefined {
  if (routeTravelTicks(snapshot.map, unit, goal, 'land', unit.speed) === undefined) return undefined;
  const points = groundSteeringRoute(snapshot.map, unit, goal), end = points[points.length - 1]!;
  if (Math.hypot(end.x - goal.x, end.y - goal.y) > MOVE_ORDER_ARRIVAL_RANGE) return undefined;
  const cost = points.slice(1).reduce((sum, point, index) => sum + groundTravelCost(snapshot.map, points[index]!, point)!, 0);
  const ticks = Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
  const disks = foes.flatMap(foe => {
    const reach = retreatThreatReach(snapshot, foe, unit, THINK_TICKS + ticks);
    return reach > 0 ? [{ x: foe.x, y: foe.y, radius: reach + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND }] : [];
  });
  return routeLeavesDisks(points, disks) ? ticks : undefined;
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
