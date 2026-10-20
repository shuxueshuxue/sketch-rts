import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { buildStrategyPlanTrace, type ObjectiveFamily } from './plan';
import type { SituationObservation, StrategyPlanTrace } from './types';
import { decisionProjection } from './explanations';

/** Explanatory prose is not a decision dependency. Source/claim identity,
 * reason codes, provenance ticks, route geometry and utility terms remain facts. */
export type DecisionFacts<T> = T extends readonly (infer Item)[] ? readonly DecisionFacts<Item>[]
  : T extends object ? { readonly [Key in keyof T as Key extends 'evidence' | 'detail' | 'explanation' ? never : Key]: DecisionFacts<T[Key]> }
  : T;
export type StrategyDecision = DecisionFacts<StrategyPlanTrace>;
const observedDecision = Symbol('ObservedStrategyDecision');
export type ObservedStrategyDecision = StrategyDecision & Readonly<{ [observedDecision]: true }>;

// Both views share one immutable fact graph. Explanations are projections of
// that evaluation, not another think or a lookup into current world state.
const projections = new WeakMap<StrategyDecision, () => StrategyPlanTrace>();

/** Read-only future always-on boundary. Does not build the module-state trace,
 * serialize explanations, allocate troops, or execute another policy think. */
export function buildStrategyDecision(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  families?: readonly ObjectiveFamily[], observation?: SituationObservation, fieldBuildBudget = 1): StrategyDecision {
  return decisionProjection(() => buildStrategyPlanTrace(snapshot, owner, options, undefined, families, observation, fieldBuildBudget), false).facts;
}

/** Request observations at this boundary, rather than collecting explanation
 * indexes during every ordinary decision. Neither path runs a second think. */
export function buildObservedStrategyDecision(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  families?: readonly ObjectiveFamily[], observation?: SituationObservation, fieldBuildBudget = 1): ObservedStrategyDecision {
  const { facts, explain } = decisionProjection(() => buildStrategyPlanTrace(snapshot, owner, options, undefined, families, observation, fieldBuildBudget), true);
  const observed = Object.assign(facts, { [observedDecision]: true as const });
  projections.set(observed, explain!); return observed;
}

/** Request the complete, compatible trace view. Reading/serializing its lazy
 * explanation fields materializes them at most once; numerical facts are shared. */
export function projectStrategyTrace(decision: ObservedStrategyDecision): StrategyPlanTrace {
  const explain = projections.get(decision);
  if (!explain) throw new Error('Strategy decision was not produced by the observation evaluator');
  return explain();
}
