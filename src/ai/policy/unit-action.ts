import type { GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyMemory, AiPolicyUnitClaim } from '../memory';
import { nativeLandRoad } from './land-road';

/** Share dependency progress without giving the parent another actor's order. */
export function withClearingProgress(parent: NonNullable<AiPolicyUnitClaim['campTravel']>, progress: NonNullable<AiPolicyUnitClaim['campTravel']>) {
  return { ...parent,
    ...(progress.clearingStage ? { clearingStage: progress.clearingStage } : {}),
    ...(progress.clearingSinceTick !== undefined ? { clearingSinceTick: progress.clearingSinceTick } : {}),
    ...(progress.clearingStaging ? { clearingStaging: progress.clearingStaging } : {}),
    ...(parent.subgoal && progress.subgoal ? { subgoal: { ...parent.subgoal, status: progress.subgoal.status } } : {}) };
}

/** A detour changes native movement, while retaining the admitted parent action.
 * Task consumers must not mistake that movement for an abandoned construction. */
export function retainedUnitAction(unit: Unit, memory: AiPolicyMemory) {
  const claim = memory.unitClaims[unit.id];
  // A retained vacancy is not a builder walking to the site. Otherwise the
  // screen follows the evacuation back home and leaves the prerequisite behind.
  if (claim?.interruption && (claim.interruption.phase !== 'resuming' || claim.interruption.pendingBinding)
    || claim?.campTravel?.clearingIds?.length) return unit.order;
  return claim?.interruption?.parent ?? claim?.campTravel?.command ?? unit.order;
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
