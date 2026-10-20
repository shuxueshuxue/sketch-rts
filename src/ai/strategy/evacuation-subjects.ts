import type { DecisionFacts } from './decision';
import type { Objective } from './types';

/** Explicit evacuation effects identify people, not interchangeable worker slots.
 * A DefendSite fallback without such effects remains scoped to its worker grant. */
export function evacuationSubjectIds(objective: DecisionFacts<Objective>): readonly string[] | undefined {
  const effects = objective.effects.filter(effect => effect.kind === 'assets-evacuated');
  return effects.length ? [...new Set(effects.flatMap(effect => effect.unitIds))].sort() : undefined;
}
