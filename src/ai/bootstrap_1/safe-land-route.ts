import { pointSegmentDistanceSquared } from '../../shared/navigation-math';
import { routeTravelTicks } from '../../shared/route-selection';
import { walkRoute } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { Point } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { isEnemyOwner } from '../policy/ownership';
import { mountedThreatReach, THINK_TICKS } from './mounted-micro';

export function armedFoes(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
}

/** Terrain travel time, admitted only when every road segment clears known attack coverage. */
export function safeLandTravelTicks(snapshot: GameSnapshot, unit: Unit, goal: Point, foes: readonly (Unit | Building)[]): number | undefined {
  const ticks = routeTravelTicks(snapshot.map, unit, goal, 'land', unit.speed);
  if (ticks === undefined) return undefined;
  const route = walkRoute(snapshot.map, unit, goal);
  if (route === undefined) return undefined;
  const horizon = THINK_TICKS + ticks, points = [unit, ...route];
  return foes.every(foe => {
    const range = mountedThreatReach(snapshot, foe, unit, horizon)
      + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND;
    return points.slice(1).every((point, index) => pointSegmentDistanceSquared(foe, points[index]!, point) > range * range);
  }) ? ticks : undefined;
}
