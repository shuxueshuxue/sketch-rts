import type { GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { nativeLandRoad } from './land-road';

/** A detour changes native movement, while retaining the admitted parent action.
 * Task consumers must not mistake that movement for an abandoned construction. */
export function retainedUnitAction(unit: Unit, memory: AiPolicyMemory) {
  return memory.unitClaims[unit.id]?.campTravel?.command ?? unit.order;
}

/** The native road that current orders will actually execute, including queued
 * detour legs. It never substitutes the original parent's straight route. */
export function issuedUnitRoad(snapshot: GameSnapshot, unit: Unit) {
  const points: { x: number; y: number }[] = [{ x: unit.x, y: unit.y }];
  let from = unit;
  for (const order of [unit.order, ...(unit.orderQueue ?? [])]) {
    if (order.type !== 'move' && order.type !== 'attackMove' && order.type !== 'build') continue;
    const road = nativeLandRoad(snapshot, from, order);
    if (!road) break;
    points.push(...road.points.slice(1));
    from = { ...unit, ...points.at(-1)! };
  }
  return points;
}
