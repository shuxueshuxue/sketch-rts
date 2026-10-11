import { strikeGap } from '../../shared/combat-geometry';
import { routeArrivals } from '../../shared/route-selection';
import { walkingDistance } from '../../shared/terrain';
import type { GameSnapshot, Unit } from '../../shared/types';
import type { Point } from './spatial';
import type { V6BaseIntel, V6Intel } from './v6/intel';
import { strengthOf } from './v6/strength';

/** Fire crosses terrain; a land reinforcement outside firing range needs a road. */
export function groundThreatWithin(snapshot: GameSnapshot, unit: Unit, point: Point, range: number) {
  const gap = strikeGap(unit, point);
  if (gap <= unit.attackRange) return true;
  if (gap > range) return false;
  const road = walkingDistance(snapshot.map, unit, point, 'land');
  return road !== undefined && road <= range;
}

/** Compare actual movers' terrain arrival times, rather than distances from army centroids. */
export function groundRespondingPower(snapshot: GameSnapshot, intel: V6Intel, target: V6BaseIntel, front: Unit[]) {
  const arrival = routeArrivals(snapshot.map, front, target.hall, 'land').reduce((last, unit) => Math.max(last, unit.ticks), 0);
  const army = intel.enemies.flatMap(enemy => enemy.army);
  const firing = army.filter(unit => strikeGap(unit, target.hall) <= unit.attackRange);
  const responders = routeArrivals(snapshot.map, army.filter(unit => !firing.includes(unit)), target.hall, 'land')
    .filter(unit => unit.ticks <= arrival).map(unit => unit.unit);
  return strengthOf([...firing, ...responders]);
}
