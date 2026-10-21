import { goalValueKey } from './goal-facts';
import type { GoalActionProvider, GoalCandidates, GoalDeferredCandidate, GoalFact, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';

/** Observe the same grounding calls made by a declaration provider. Deferral
 * is planning evidence, not an invented action or a change to world truth. */
export function discoverGoalActions(provider: GoalActionProvider, fact: GoalFact, context: GoalPlanningContext) {
  const deferred = new Map<string, GoalDeferredCandidate>();
  const track = <T>(result: GoalCandidates<T>): GoalCandidates<T> => {
    if (result.state === 'pending') {
      const id = `grounding:${goalValueKey([provider.id, fact.id, result.requestIds])}`;
      deferred.set(id, { id, requestIds: result.requestIds, reason: result.reason });
    } else if (result.state === 'met') for (const item of result.deferred ?? []) deferred.set(item.id, item);
    return result;
  };
  const source = context.grounding;
  const grounding: GoalGroundingReader | undefined = source && { ...source,
    buildSites: (...args) => track(source.buildSites(...args)),
    productionOptions: (...args) => track(source.productionOptions(...args)),
    transportOptions: (...args) => track(source.transportOptions(...args)),
    ...(source.combatOptions ? { combatOptions: (...args: Parameters<NonNullable<GoalGroundingReader['combatOptions']>>) => track(source.combatOptions!(...args)) } : {}),
    ...(source.resolveCohort ? { resolveCohort: (...args: Parameters<NonNullable<GoalGroundingReader['resolveCohort']>>) => track(source.resolveCohort!(...args)) } : {}),
  };
  const actions = provider.actionsFor(fact, grounding ? { ...context, grounding } : context);
  return { actions, deferred: [...deferred.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
