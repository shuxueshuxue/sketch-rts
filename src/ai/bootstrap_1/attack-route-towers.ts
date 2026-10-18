import { groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import type { GameSnapshot, Unit } from '../../shared/types';
import type { V6BaseIntel, V6Intel } from '../policy/v6/intel';

/** Known transit towers on the native march to a hall, counted once per army.
 * The destination's towers are already charged by the ordinary attack gate. */
export function attackRouteTowers(snapshot: GameSnapshot, intel: V6Intel, front: readonly Unit[], target: V6BaseIntel) {
  const counted = new Set(target.towers.map(tower => tower.id));
  const towers = intel.enemies.flatMap(enemy => enemy.buildings).filter(tower =>
    tower.kind === 'defenseTower' && tower.complete && tower.hp > 0 && tower.attackDamage > 0 && !counted.has(tower.id));
  if (!towers.length) return [];
  const roads = front.map(unit => groundSteeringRoute(snapshot.map, unit, target.hall));
  return [...new Map(towers.filter(tower => roads.some(road => !routeClearsDisks(road,
    [{ x: tower.x, y: tower.y, radius: tower.attackRange }]))).map(tower => [tower.id, tower])).values()];
}
