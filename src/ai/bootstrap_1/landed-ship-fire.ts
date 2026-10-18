import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { unitMover } from '../../shared/catalog';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { groundSteeringRoute } from '../../shared/route-selection';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import type { GameSnapshot, Unit } from '../../shared/types';
import { mountedEscape } from './mounted-micro';

/** Landing ends the land fight, not a ship's working fire across the shore. */
export function landedShipFireEscape(snapshot: GameSnapshot, unit: Unit, ships: readonly Unit[]) {
  if (unit.deck || unit.cabin || unit.orderQueue?.length
    || !['idle', 'move', 'attackMove', 'attack'].includes(unit.order.type)) return;
  const covering = ships.filter(ship => workingWeaponGeometry(snapshot, ship, unit).some(weapon => weapon.covers));
  if (!covering.length || covering.some(ship => workingWeaponGeometry(snapshot, unit, ship).some(weapon => weapon.covers))) return;
  const command = mountedEscape(snapshot, unit, covering, 0, undefined, true);
  if (command.type !== 'move' || command.x === unit.x && command.y === unit.y) return;
  const bodies = snapshot.units.filter(body => body.id !== unit.id && !body.deck && !body.cabin
    && unitMover(body.kind) === 'land' && !(body.kind === 'worker' && body.order.type === 'mine'));
  const road = groundSteeringRoute(snapshot.map, unit, command);
  const end = road[road.length - 1]!;
  if (Math.hypot(end.x - command.x, end.y - command.y) > MOVE_ORDER_ARRIVAL_RANGE) return;
  if (road.slice(1).some((point, index) => !capsuleClearsBodies(road[index]!, point, unit.radius, bodies))) return;
  return command;
}
