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
export type AllocationLandRouteReader = (from: Target['point'], goal: Target['point']) =>
  Readonly<{ status: 'known'; points: readonly Target['point'][]; distance: number }>
  | Readonly<{ status: 'unknown' | 'unreachable'; reasonCode: string }>;
let currentLandRoute: AllocationLandRouteReader | undefined;
export function currentAllocationLandRouteReader() { return currentLandRoute; }
export function withAllocationLandRoutes<T>(reader: AllocationLandRouteReader, run: () => T): T {
  const previous = currentLandRoute; currentLandRoute = reader;
  try { return run(); } finally { currentLandRoute = previous; }
}

/** One query and deterministic work allowance for every materialization and
 * gross/net counterfactual in this transaction. The callback never escapes
 * into persisted methods or memory; all of its answers concern this snapshot. */
export function withAllocationArrivalQuery<T>(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  run: (fixedArrival: NonNullable<AllocationMethodQuoteInput['fixedVoyageArrival']>,
    loading: NonNullable<StrategyAllocationInput['fixedVoyageLoading']>,
    arrival: AllocationArrivalReader, landRoute: AllocationLandRouteReader) => T, fieldBudget = 1): T {
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick, () => withStrategyFrame(() => {
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, owner, memory);
    const fields = createPlanningDistanceQuery(snapshot, fieldBudget, 'land', preparation);
    const query = createArrivalQuery(snapshot, owner, memory, fields, fieldBudget, regionIndex(snapshot.map), preparation);
    const landRoute: AllocationLandRouteReader = (from, goal) => {
      const published = fields.field(goal);
      if (!published) return { status: 'unknown', reasonCode: 'assembly-rally-route-pending' };
      const distance = published.field.cost(from), points = published.field.road(from, goal);
      return distance === undefined || !points ? { status: 'unreachable', reasonCode: 'assembly-rally-route-unreachable' }
        : { status: 'known', distance, points };
    };
    try {
      return withAllocationLandRoutes(landRoute, () => run((unit, target, voyage) => decisionProjection(() => query.fixedVoyageArrival(unit, target, voyage), false).facts,
        (unit, voyage) => query.fixedVoyageLoading(unit, voyage),
        (unit, target) => decisionProjection(() => query.arrival(unit, target, landIdAt(snapshot.map, unit)), false).facts,
        landRoute));
    } finally { boundObservationMemory(preparation); }
  }));
}
