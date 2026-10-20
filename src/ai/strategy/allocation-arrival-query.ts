import { setBuildingBodies, withGoalDistanceFieldLease } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput, StrategyAllocationInput } from './allocation-types';
import { createArrivalQuery } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { decisionProjection } from './explanations';
import { withStrategyFrame } from './frame-reuse';
import { boundObservationMemory, observationMemory } from './observation-memory';
import { regionIndex } from './regions';

/** One query and deterministic work allowance for every materialization and
 * gross/net counterfactual in this transaction. The callback never escapes
 * into persisted methods or memory; all of its answers concern this snapshot. */
export function withAllocationArrivalQuery<T>(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  run: (arrival: NonNullable<AllocationMethodQuoteInput['fixedVoyageArrival']>,
    loading: NonNullable<StrategyAllocationInput['fixedVoyageLoading']>) => T, fieldBudget = 1): T {
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick, () => withStrategyFrame(() => {
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, owner, memory);
    const query = createArrivalQuery(snapshot, owner, memory,
      createPlanningDistanceQuery(snapshot, fieldBudget, 'land', preparation), fieldBudget, regionIndex(snapshot.map), preparation);
    try {
      return run((unit, target, voyage) => decisionProjection(() => query.fixedVoyageArrival(unit, target, voyage), false).facts,
        (unit, voyage) => query.fixedVoyageLoading(unit, voyage));
    } finally { boundObservationMemory(preparation); }
  }));
}
