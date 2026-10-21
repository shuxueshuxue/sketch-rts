import type { DecisionFacts } from './decision';
import type { Objective } from './types';
import type { StrategyAllocationMemory } from './allocation-types';
import type { GoalPlan } from './goal-planner-types';
import { readGoalObjective } from './goal-authority-references';
import { appendAllocationEvent } from './allocation-lifecycle';

/** Discovery proposes new goals. Once granted, its original world effects
 * remain a planning request even after the opportunity leaves the collector. */
export function retainCommittedGoalObjectives(memory: StrategyAllocationMemory | undefined,
  collected: readonly DecisionFacts<Objective>[]): readonly DecisionFacts<Objective>[] {
  if (!memory) return collected;
  const current = new Map(collected.map(objective => [objective.id, objective]));
  const retained = Object.keys(memory.objectives).sort().flatMap(id => {
    const discovered = current.get(id);
    if (discovered && discovered.status !== 'complete') return [];
    const definition = readGoalObjective(memory, id);
    if (!definition) return [];
    current.delete(id);
    return [{ ...definition, status: 'active' as const,
      reasons: [...definition.reasons.filter(reason => reason.code !== 'admitted-goal-retained-after-discovery'),
        { code: 'admitted-goal-retained-after-discovery', factIds: [id],
          values: { sinceTick: memory.objectives[id]!.sinceTick } }] }];
  });
  return [...current.values(), ...retained].sort((a, b) => a.id.localeCompare(b.id));
}

/** World completion settles only after the admitted native tasks have supplied
 * their receipts. A still-active protection obligation keeps its real leases. */
export function settleCommittedGoals(memory: StrategyAllocationMemory, plans: readonly GoalPlan[],
  observed: readonly DecisionFacts<Objective>[], tick: number): StrategyAllocationMemory {
  for (const prior of Object.values(memory.objectives)) {
    if (!prior.goalDefinitionRef || ['complete', 'failed', 'abandoned'].includes(prior.status)) continue;
    const actual = observed.find(objective => objective.id === prior.objectiveId);
    const explicit = actual && ['failed', 'abandoned'].includes(actual.status) ? actual : undefined;
    const plan = plans.find(plan => plan.goal.id === prior.objectiveId);
    const actions = prior.actionIds.map(id => memory.executions[id]).filter(action => !!action);
    const finished = plan?.status === 'complete' && plan.goal.effects.length > 0
      && plan.goal.effects.every(fact => plan.facts.some(node => node.id === fact.id && node.observation.state === 'met'
        && node.observation.observedTick === tick && (node.observation.availableTick ?? tick) <= tick))
      && actions.length > 0 && actions.every(action => action.status === 'complete');
    if (!explicit && !finished) continue;
    const status = explicit ? explicit.status as 'failed' | 'abandoned' : 'complete' as const;
    const execution = actions[0]; if (!execution) continue;
    memory = { ...memory, objectives: { ...memory.objectives, [prior.objectiveId]: { ...prior, status, committedUtilityGold: null } },
      ...(explicit ? { executions: Object.fromEntries(Object.entries(memory.executions).map(([id, action]) => [id,
        action.objectiveId === prior.objectiveId && !['complete', 'failed', 'abandoned'].includes(action.status)
          ? { ...action, status: 'abandoned' as const, phase: 'parent-explicitly-ended' } : action])) } : {}) };
    memory = appendAllocationEvent(memory, { kind: 'parent-invalidated', objectiveId: prior.objectiveId, methodId: prior.methodId,
      action: execution.token, releasedLeaseIds: Object.values(memory.leases).filter(lease => lease.objectiveId === prior.objectiveId).map(lease => lease.id),
      releasedBudgetIds: Object.values(memory.budgets).filter(budget => budget.objectiveId === prior.objectiveId && budget.state === 'reserved').map(budget => budget.id),
      reason: { code: explicit ? 'committed-goal-explicitly-ended' : 'committed-goal-world-effects-complete',
        factIds: explicit ? explicit.reasons.flatMap(reason => reason.factIds ?? []) : plan!.goal.effects.map(fact => fact.id),
        values: { status, ...(explicit ? { sourceReasonCodes: explicit.reasons.map(reason => reason.code).join(',') } : {}) } } }, tick);
  }
  return memory;
}
