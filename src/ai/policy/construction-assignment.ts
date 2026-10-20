import type { BuildingKind, GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { workerContinuationEndReason } from './worker-continuation';

type Construction = Readonly<{ buildingKind: BuildingKind; x: number; y: number }>;

/** Responsibility for a site, never a claim that the worker is physically there.
 * Native construction and an interrupted, still valid parent are the same
 * existing assignment for duplicate-work checks. Invalid parents disappear
 * immediately, including queries before the script runner prunes memory. */
export function assignedConstruction(snapshot: GameSnapshot, unit: Unit, memory: AiPolicyMemory): Construction | undefined {
  if (unit.order.type === 'build') return unit.order;
  const claim = memory.unitClaims[unit.id], state = claim?.kind === 'workerSafety' ? claim.evacuation?.continuation : undefined;
  return state && unit.hp > 0 && !workerContinuationEndReason(snapshot, unit, state) ? state.parent : undefined;
}

/** Callers retain their existing site/kind policy and worker set. */
export function hasAssignedConstruction(snapshot: GameSnapshot, workers: readonly Unit[], memory: AiPolicyMemory,
  matches: (site: Construction) => boolean = () => true) {
  return workers.some(worker => {
    const site = assignedConstruction(snapshot, worker, memory);
    return site !== undefined && matches(site);
  });
}
