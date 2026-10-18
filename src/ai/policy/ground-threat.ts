import { strikeGap } from '../../shared/combat-geometry';
import { routeArrivals, routeWithinDistance } from '../../shared/route-selection';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameSnapshot, Unit } from '../../shared/types';
import type { Point } from './spatial';
import type { V6BaseIntel, V6Intel } from './v6/intel';
import { strengthOf, TOWER_STRENGTH } from './v6/strength';
import { LOCAL_RANGE } from './v6/general';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { THINK_TICKS } from './threat-reach';

/** Fire crosses terrain; a land reinforcement outside firing range needs a road. */
export function groundThreatWithin(snapshot: GameSnapshot, unit: Unit, point: Point, range: number) {
  const gap = strikeGap(unit, point);
  if (gap <= unit.attackRange) return true;
  if (gap > range) return false;
  return routeWithinDistance(snapshot.map, unit, point, 'land', range);
}

/** Enemy reinforcements and counterraids both compete with the time spent marching away. */
export function groundRespondingPower(snapshot: GameSnapshot, intel: V6Intel, target: V6BaseIntel, front: Unit[]) {
  const arrival = routeArrivals(snapshot.map, front, target.hall, 'land').reduce((last, unit) => Math.max(last, unit.ticks), 0);
  const army = intel.enemies.flatMap(enemy => enemy.army);
  const firing = army.filter(unit => strikeGap(unit, target.hall) <= unit.attackRange);
  const responders = routeArrivals(snapshot.map, army.filter(unit => !firing.includes(unit)), target.hall, 'land')
    .filter(unit => unit.ticks <= arrival).map(unit => unit.unit);
  const income = intel.ownHalls.filter(hall => hall.complete && snapshot.resources.some(mine =>
    mine.amount > 0 && Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange));
  const counterraiders = income.flatMap(hall => routeArrivals(snapshot.map, army, hall, 'land')
    .filter(unit => unit.ticks <= arrival).map(unit => unit.unit));
  return strengthOf([...new Set([...firing, ...responders, ...counterraiders])]);
}

/** A remote member cannot move the center away from the soldiers actually exposed to fire. */
export function groundFrontThreat(snapshot: GameSnapshot, intel: V6Intel, front: Unit[]) {
  const army = intel.enemies.flatMap(enemy => enemy.army).filter(enemy =>
    front.some(unit => groundThreatWithin(snapshot, enemy, unit, LOCAL_RANGE)));
  const towers = intel.enemies.flatMap(enemy => enemy.buildings).filter(tower => tower.complete && tower.attackDamage > 0
    && front.some(unit => strikeGap(tower, unit) <= tower.attackRange + unit.speed * THINK_TICKS / SIM_TICKS_PER_SECOND));
  return { units: army, towerPower: towers.length * TOWER_STRENGTH };
}
