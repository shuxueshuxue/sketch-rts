import type { GoalRegenerate, GoalRegenerateInput } from './goal-search-format';
import { goalGlobalStepKey, readGoalGlobalStepKey } from './goal-search-format';

/** Explicit provider calls replace ambient declaration getters. The adapter
 * receives the causal prefix, bindings and published-reader port together;
 * there is no allocator, SDK, interning or query-advance port here. */
export function createGoalRegenerate(providers: readonly Readonly<{ id: string; regenerate: GoalRegenerate }>[]): GoalRegenerate {
  const registry = new Map(providers.map(provider => [provider.id, provider.regenerate]));
  if (registry.size !== providers.length) throw Error('Duplicate goal regeneration provider');
  return (input: GoalRegenerateInput) => {
    const key = goalGlobalStepKey(input.goalId, input.selector), regenerate = registry.get(input.selector.provider);
    if (!regenerate) return { state: 'invalid', step: key, reason: 'goal-regeneration-provider-missing' };
    for (const step of input.prefix) if (step.action.id !== goalGlobalStepKey(input.goalId, step.selector)
      || step.action.kind !== step.selector.kind || !Number.isFinite(step.startTick)
      || !Number.isFinite(step.finishTick) || step.finishTick < step.startTick)
      return { state: 'invalid', step: key, reason: 'goal-regeneration-prefix-invalid' };
    for (const reference of Object.values(input.bindings)) if (reference.kind === 'output') readGoalGlobalStepKey(reference.actionId);
    const result = regenerate(input);
    if (result.state === 'known' && (result.action.id !== key || result.action.kind !== input.selector.kind))
      return { state: 'invalid', step: key, reason: 'goal-regeneration-selector-mismatch' };
    return result;
  };
}
