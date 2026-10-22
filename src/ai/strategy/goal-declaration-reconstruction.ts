import { bindGoalAction } from './goal-fact-matching';
import { retimeGoalActionPreconditions } from './goal-action-facts';
import { goalValueKey } from './goal-facts';
import { discoverGoalActions } from './goal-provider-candidates';
import { goalPlanningGroundingParameters, setGoalDeclarationResolver, type GoalDeclarationRecipe } from './goal-planning-references';
import type { GoalActionDeclaration, GoalActionProvider, GoalDeclarationContext, GoalPlanningContext } from './goal-planner-types';

/** A recipe is not execution authority. A changed dependency or numeric quote
 * retires the cached declaration and lets ordinary regression rediscover it. */
export function installGoalDeclarationReconstruction(input: {
  providers: readonly GoalActionProvider[]; context: (saved: GoalDeclarationContext) => GoalPlanningContext;
}) {
  setGoalDeclarationResolver(recipe => {
    const origin = recipe.regeneration;
    const expired = (reason: string): GoalActionDeclaration => ({ id: recipe.id, kind: recipe.kind, precision: 'coarse',
      preconditions: origin?.dependencies.map(row => row.fact) ?? [],
      effects: origin ? [{ fact: origin.effect, operation: 'establish', at: 'finish' }] : [],
      demands: [], flows: [], outputs: [], executor: { executor: recipe.executor,
        parameters: goalPlanningGroundingParameters(origin?.groundingKey ?? recipe.id) ?? {} },
      duration: { state: 'pending', requestIds: [recipe.id], reason: { code: reason, factIds: [recipe.id], values: {} } },
      cost: { state: 'pending', requestIds: [recipe.id], reason: { code: reason, factIds: [recipe.id], values: {} } },
      successProbability: { state: 'pending', requestIds: [recipe.id], reason: { code: reason, factIds: [recipe.id], values: {} } },
      ...(recipe.refinementFor ? { refinementFor: recipe.refinementFor } : {}), reasons: [{ code: reason, factIds: [recipe.id], values: {} }] });
    if (!origin) return expired('goal-declaration-recipe-missing-origin');
    // Older caches did not record the provider context or prerequisite epochs.
    // They cannot authorize reconstruction. In particular, do not enumerate an
    // exact provider just to reject this already expired recipe: enumeration
    // can enqueue native geometry requests for every discarded candidate.
    if (origin.sourceRevision.startsWith('prior-declaration-')) return expired('goal-declaration-dependency-expired');
    const context = input.context(origin.context);
    // The source fingerprint includes the published native fact versions and
    // actor/world price inputs; every explicit prerequisite is checked too.
    const provider = input.providers.find(provider => provider.id === origin.providerId);
    if (!provider || !context.declarationSourceRevision) return expired('goal-declaration-provider-unavailable');
    const dependenciesChanged = origin.dependencies.some(dependency => {
      const current = context.readFact(dependency.fact);
      return current.revision !== dependency.revision || current.state !== dependency.state;
    });
    const coarse = recipe.precision === 'coarse' && origin.context.precision === 'coarse';
    if (dependenciesChanged && !coarse) return expired('goal-declaration-dependency-expired');
    const declarations = discoverGoalActions(provider, origin.effect, context).actions;
    let action = declarations.find(action => action.id === origin.groundingKey);
    if (!action) return expired('goal-declaration-grounding-expired');
    // A coarse recipe is only a regeneration cursor. Its newly generated
    // proposal can remain coarse when the world changed; it never borrows an
    // old exact price or turns into executor authority.
    if (coarse) return { ...action, precision: 'coarse' };
    if (context.declarationSourceRevision(action) !== origin.sourceRevision) return expired('goal-declaration-dependency-expired');
    if (origin.bindings) action = bindGoalAction(action, origin.bindings);
    if (origin.finishTick !== undefined) action = retimeGoalActionPreconditions(action, origin.finishTick) ?? undefined;
    if (!action) return expired('goal-declaration-schedule-expired');
    const numeric = (row: Pick<GoalDeclarationRecipe, 'duration' | 'cost' | 'successProbability'>) => [
      row.duration.state === 'met' ? row.duration.value : row.duration.state,
      row.cost.state === 'met' ? row.cost.value.map(({ code, gold, at }) => ({ code, gold, at })) : row.cost.state,
      row.successProbability.state === 'met' ? row.successProbability.value : row.successProbability.state,
    ];
    if (goalValueKey(numeric(action)) !== goalValueKey(numeric(recipe))) return expired('goal-declaration-quote-expired');
    return { ...action, precision: recipe.precision ?? action.precision ?? 'exact', regeneration: origin,
      ...(recipe.refinementFor ? { refinementFor: recipe.refinementFor } : {}) };
  });
}
