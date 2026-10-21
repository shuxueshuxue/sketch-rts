import { setBuildingBodies, withGoalDistanceFieldLease } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput, StrategyAllocationInput } from './allocation-types';
import { createArrivalQuery } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { decisionProjection } from './explanations';
import { withStrategyFrame } from './frame-reuse';
import { boundObservationMemory, observationMemory } from './observation-memory';
import { landIdAt, regionIndex } from './regions';
import type { DecisionFacts } from './decision';
import type { Arrival, Target } from './types';

export type AllocationArrivalReader = (unit: Unit, target: Target) => DecisionFacts<Arrival>;

/** One query and deterministic work allowance for every materialization and
 * gross/net counterfactual in this transaction. The callback never escapes
 * into persisted methods or memory; all of its answers concern this snapshot. */
export function withAllocationArrivalQuery<T>(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  run: (fixedArrival: NonNullable<AllocationMethodQuoteInput['fixedVoyageArrival']>,
    loading: NonNullable<StrategyAllocationInput['fixedVoyageLoading']>,
    arrival: AllocationArrivalReader) => T, fieldBudget = 1): T {
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick, () => withStrategyFrame(() => {
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, owner, memory);
    const query = createArrivalQuery(snapshot, owner, memory,
      createPlanningDistanceQuery(snapshot, fieldBudget, 'land', preparation), fieldBudget, regionIndex(snapshot.map), preparation);
    try {
      return run((unit, target, voyage) => decisionProjection(() => query.fixedVoyageArrival(unit, target, voyage), false).facts,
        (unit, voyage) => query.fixedVoyageLoading(unit, voyage),
        (unit, target) => decisionProjection(() => query.arrival(unit, target, landIdAt(snapshot.map, unit)), false).facts);
    } finally { boundObservationMemory(preparation); }
  }));
}
