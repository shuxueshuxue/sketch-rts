import { goalResourceKey, goalValueKey } from './goal-facts';
import { projectGoalResources } from './goal-resource-ledger';
import type { GoalFact, GoalFactReader, GoalPlan, GoalPlanCacheEntry, GoalResourceBalance } from './goal-planner-types';
import type { GoalSearchMemory, GoalSearchPath } from './goal-search-state';
import { goalPlanningIdentity, hydrateGoalPlanningValue } from './goal-planning-references';
import { currentFactWork } from './fact-work';

/** Derived graph views and resource events are projections of the selected
 * declarations, their schedules and opening balances, not resident searches. */
export function storeGoalSearchRecords(entries: readonly GoalPlanCacheEntry[]): readonly GoalPlanCacheEntry[] {
  return entries.map(entry => {
    const plan = entry.plan, opening = new Map<string, GoalResourceBalance>();
    for (const event of plan.resourceTimeline) if (!opening.has(goalResourceKey(event.resource)))
      opening.set(goalResourceKey(event.resource), { resource: event.resource, quantity: event.before, asOfTick: plan.observedTick, factIds: [] });
    const { edges: _edges, subgoals: _subgoals, resourceTimeline: _timeline, ...view } = plan;
    const wire = { ...view, facts: plan.facts.map(({ observation, producerActionIds }) => ({ fact: observation.fact, producerActionIds })),
      actions: plan.actions.map(({ id: _id, prerequisiteFactIds: _requires, ...node }) => node),
      alternatives: plan.alternatives.map(alternative => ({ factId: alternative.factId, status: alternative.status,
        ...(alternative.declaration ? { declaration: alternative.declaration } : { actionId: alternative.actionId,
          costGold: alternative.costGold, finishTick: alternative.finishTick, reason: alternative.reason }) })),
      openingBalances: Object.fromEntries([...opening.values()].map(balance => [goalPlanningIdentity('resource', balance.resource), balance.quantity])),
      projectResourceTimeline: plan.resourceTimeline.length > 0 };
    const state = entry.continuation;
    const { dependencies: _dependencies, ...header } = entry;
    if (!state?.demandDriven) return entry;
    const { alternatives: _alternatives, observed: _observed, deferred: _deferred, ...cursor } = state;
    const { deferredCandidates: _deferredPlan, ...selectedWire } = wire;
    const factIds = new Set(plan.facts.map(fact => fact.id));
    const sameSolution = state.phase === 'done' && state.solutions.length === 1
      && plan.actions.every(node => node.startTick !== null && node.finishTick !== null)
      && state.solutions[0]!.steps.map(step => step.action.id).join('\n') === plan.actions.map(node => node.id).join('\n');
    return { ...header, plan: selectedWire, continuation: { ...cursor,
      ...(state.deferred?.length || plan.deferredCandidates?.length ? { regenerateDeferred: true } : {}),
      ...(sameSolution ? { solutions: [], coarse: undefined, restoreSelectedSolution: {
        bindings: state.solutions[0]!.bindings, cost: state.solutions[0]!.cost, probability: state.solutions[0]!.probability } } : {}),
      observed: state.observed.filter(observation => !factIds.has(observation.fact.id)).map(observation => ({ fact: observation.fact })) } } as unknown as GoalPlanCacheEntry;
  });
}

export function readGoalSearchRecords(entries: readonly GoalPlanCacheEntry[], readFact?: GoalFactReader): readonly GoalPlanCacheEntry[] {
  return entries.map(entry => {
    const read = () => {
    if (!entry.continuation?.demandDriven) return entry;
    if (!readFact) throw Error('A selected goal cache requires current fact observations');
    const wire = entry.plan as GoalPlan & { openingBalances: Record<string, number>; projectResourceTimeline: boolean };
    const { openingBalances, projectResourceTimeline, ...view } = wire;
    const actions = wire.actions.map(node => ({ ...node, id: node.declaration.id,
      prerequisiteFactIds: node.declaration.preconditions.map(fact => fact.id) }));
    const alternatives = wire.alternatives.map(alternative => {
      const actionId = alternative.declaration?.id ?? alternative.actionId;
      const costGold = alternative.declaration?.cost.state === 'met'
        ? alternative.declaration.cost.value.reduce((sum, term) => sum + term.gold, 0) : alternative.costGold ?? null;
      return { ...alternative, actionId, costGold,
        finishTick: actions.find(action => action.id === actionId)?.finishTick ?? null,
        reason: alternative.reason ?? { code: alternative.status === 'chosen' ? 'goal-achiever-chosen' : alternative.status === 'rejected'
          ? costGold !== null && costGold > (wire.costGold ?? Infinity) ? 'goal-alternative-cost-above-plan' : 'goal-alternative-not-in-selected-plan'
          : 'goal-alternative-search-unresolved', factIds: [alternative.factId], values: { selectedCostGold: wire.costGold } },
        id: `alternative:${goalValueKey([alternative.factId, actionId])}` };
    });
    const facts = wire.facts.map(node => {
      const fact = (node as unknown as { fact: GoalFact }).fact;
      return { id: fact.id, observation: readFact(fact), producerActionIds: node.producerActionIds };
    });
    const met = new Set(facts.filter(node => node.observation.state === 'met').map(node => node.id));
    const scheduled = actions.map(node => {
      if (node.startTick === null || node.finishTick === null) throw Error('A cached selected plan has an unquoted schedule');
      return { action: node.declaration, startTick: node.startTick, finishTick: node.finishTick, dependsOn: [...node.dependsOnActionIds] };
    });
    const initial = Object.entries(openingBalances).map(([resourceRef, quantity]) => ({ resource: hydrateGoalPlanningValue({ resourceRef }) as unknown as GoalResourceBalance['resource'],
      quantity, asOfTick: wire.observedTick, factIds: [] }));
    const projected = projectResourceTimeline ? projectGoalResources({ epoch: wire.observedTick, initial, actions: scheduled }) : null;
    const plan: GoalPlan = { ...view, actions, alternatives, facts,
      edges: actions.flatMap(node => [
        ...node.prerequisiteFactIds.map(from => ({ from, to: node.id, kind: 'requires' as const })),
        ...node.declaration.effects.filter(effect => effect.operation === 'establish' && !met.has(effect.fact.id))
          .map(effect => ({ from: node.id, to: effect.fact.id, kind: 'establishes' as const })),
        ...node.dependsOnActionIds.map(from => ({ from, to: node.id, kind: 'resource-before' as const })),
      ]).concat(facts.flatMap(node => node.observation.derived?.allOf.map(fact => ({ from: fact.id, to: node.id, kind: 'requires' as const })) ?? [])),
      subgoals: facts.map(node => ({ id: `subgoal:${node.id}`, factId: node.id, parentGoalId: wire.goal.id,
        requestedByActionIds: actions.filter(action => action.prerequisiteFactIds.includes(node.id)).map(action => action.id),
        state: node.observation.state, chosenActionId: alternatives.find(alternative => alternative.factId === node.id && alternative.status === 'chosen')?.actionId ?? null,
        chosenActionIds: alternatives.filter(alternative => alternative.factId === node.id && alternative.status === 'chosen').map(alternative => alternative.actionId),
        alternativeIds: alternatives.filter(alternative => alternative.factId === node.id).map(alternative => alternative.id) })),
      resourceTimeline: projected && projected.state !== 'pending' ? projected.timeline : [] };
    const cursor = entry.continuation as GoalSearchMemory & { restoreSelectedSolution?: Pick<GoalSearchPath, 'bindings' | 'cost' | 'probability'> };
    const { restoreSelectedSolution, ...state } = cursor;
    const observed = [...facts.map(node => node.observation), ...cursor.observed.map(row => readFact(row.fact))];
    return { ...entry, plan, dependencies: [], continuation: { ...state, alternatives, observed,
      ...(restoreSelectedSolution ? { solutions: [{ ...restoreSelectedSolution, steps: scheduled }] } : {}) } };
    };
    const work = currentFactWork();
    return work ? work.withConsumer(entry.plan.goal.id, entry.plan.valueGold, read) : read();
  });
}
