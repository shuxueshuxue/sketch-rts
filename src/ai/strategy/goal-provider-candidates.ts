import { goalValueKey } from './goal-facts';
import type { GoalActionDeclaration, GoalActionProvider, GoalCandidates, GoalDeclarationContext, GoalDeferredCandidate, GoalFact, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';

export function goalDeclarationContext(action: GoalActionDeclaration, saved: GoalDeclarationContext): GoalDeclarationContext {
  if (saved.precision !== 'exact' || !saved.transportSelections || !['transport-force', 'transport-worker'].includes(action.kind)) return saved;
  // The selected coarse action identifies the physical alternative. Its exact
  // native contact can differ from the coarse ground point. A reconstruction
  // must seed that same contact, rather than select a different one again.
  const parameters = action.executor.parameters;
  return { ...saved, transportSelections: saved.transportSelections.map(selected => selected.kind === action.kind
    && goalValueKey(selected.executor.parameters.cohort) === goalValueKey(parameters.cohort)
    && goalValueKey(selected.executor.parameters.transport) === goalValueKey(parameters.transport)
    ? { ...selected, executor: action.executor } : selected) };
}

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
    ...(source.cohortOptions ? { cohortOptions: (...args: Parameters<NonNullable<GoalGroundingReader['cohortOptions']>>) => track(source.cohortOptions!(...args)) } : {}),
    ...(source.resolveCohort ? { resolveCohort: (...args: Parameters<NonNullable<GoalGroundingReader['resolveCohort']>>) => track(source.resolveCohort!(...args)) } : {}),
  };
  const declarations = provider.actionsFor(fact, grounding ? { ...context, grounding } : context);
  const selected = context.precision === 'coarse' ? declarations.map(action => action.precision === 'exact' ? action : ({ ...action,
    precision: 'coarse' as const, refinementFor: { providerId: provider.id, effect: fact } })) : declarations;
  const actions = selected.map(action => !context.declarationContext || !context.declarationSourceRevision
    || action.precision === 'exact' && action.regeneration ? action : ({ ...action,
    regeneration: { providerId: provider.id, effect: fact, groundingKey: action.id, context: goalDeclarationContext(action, context.declarationContext),
      sourceRevision: context.declarationSourceRevision(action), dependencies: action.preconditions.map(fact => {
        const observation = context.readFact(fact); return { fact, revision: observation.revision, state: observation.state };
      }) } }));
  return { actions, deferred: [...deferred.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
