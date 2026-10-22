import { expect, it } from 'vitest';
import { compareConfirmedGoalChoices } from './goal-quote-comparison';
import type { GoalActionDeclaration } from './goal-planner-types';
const action = (cost: number, preferred = false, precision: 'coarse' | 'exact' = 'exact'): GoalActionDeclaration => ({
  id: `quote-${cost}-${preferred}-${precision}`, kind: 'assemble', precision, preconditions: [], effects: [], demands: [], flows: [], outputs: [],
  executor: { executor: 'goal.assemble', parameters: {} }, duration: { state: 'met', value: 0, factIds: [] },
  cost: { state: 'met', value: [{ code: 'expected-loss', gold: cost, at: 'start', factIds: [] }], factIds: [] },
  successProbability: { state: 'met', value: 1, factIds: [] },
  reasons: preferred ? [{ code: 'goal-exact-incumbent-choice', factIds: [], values: {} }] : [],
});
it('preserves the confirmed choice inside one gold after both alternatives are exact', () => {
  expect(compareConfirmedGoalChoices(action(10, true), action(9.5), 1000)).toBe(-1);
  expect(compareConfirmedGoalChoices(action(9.5), action(10, true), 1000)).toBe(1);
  expect(compareConfirmedGoalChoices(action(10, true), action(8), 1000)).toBeGreaterThan(0);
});
it('requires exact timing, loss and probability on both sides of a confirmed comparison', () => {
  expect(compareConfirmedGoalChoices(action(10, true), action(9.5, false, 'coarse'), 1000)).toBe(0);
  expect(compareConfirmedGoalChoices(action(9.5, true, 'coarse'), action(10), 1000)).toBe(0);
  const delayed = { ...action(9.5), duration: { state: 'met' as const, value: 100, factIds: [] } };
  expect(compareConfirmedGoalChoices(action(10, true), delayed, 1000)).toBeLessThan(0);
});

it('quotes a coarse challenger before it can replace the confirmed executable choice', async () => {
  const { goalFact } = await import('./goal-facts');
  const { FactWorkQueue } = await import('./fact-work');
  const { planGoals } = await import('./goal-planner');
  const { applyGoalRefinements, createGoalPlanRefiner } = await import('./goal-plan-refinement');
  const effect = goalFact({ kind: 'camp-cleared', campId: 'quotation-comparison' });
  const proposal = (id: string, gold: number, precision: 'coarse' | 'exact') => ({ ...action(gold, false, precision), id,
    effects: [{ fact: effect, operation: 'establish' as const, at: 'finish' as const }],
    executor: { executor: 'goal.assemble', parameters: { cohort: [{ kind: 'existing' as const, entityId: id.slice(0, 1) }] } },
    refinementFor: { providerId: 'comparison-provider', effect } });
  const coarseA = proposal('a-coarse', 10, 'coarse'), exactA = proposal('a-exact', 10, 'exact');
  const coarseB = proposal('b-coarse', 0, 'coarse'), exactB = proposal('b-exact', 9.5, 'exact');
  let published = false;
  const provider = { id: 'comparison-provider', actionsFor: (_effect: unknown, context: { precision?: string }) => context.precision !== 'exact'
    ? [coarseA, coarseB] : [exactA, published ? exactB : { ...exactB,
      duration: { state: 'pending' as const, requestIds: ['challenger-proof'], reason: { code: 'native-proof-pending', factIds: [], values: {} } } }] };
  const memory: import('./goal-plan-refinement').GoalRefinementMemory = { revision: 0, entries: [{
    coarse: coarseA, exact: [exactA], state: 'known', preferredExactIndex: 0, reason: { code: 'known', factIds: [], values: {} },
  }] };
  const context = { tick: 0, owner: 'us', precision: 'coarse', readFact: (fact: typeof effect) => ({ fact,
    state: 'unmet', observedTick: 0, revision: 'unchanged-world', evidence: [], reason: { code: 'not-done', factIds: [], values: {} } }) } as unknown as import('./goal-planner-types').GoalPlanningContext;
  const input = () => ({ context, goals: [{ id: 'quoted-choice', owner: 'us', effects: [effect], rewardGold: 1000, deadlineTick: null, reasons: [] }],
    providers: [applyGoalRefinements(provider, memory)], initialBalances: [], declarationRevision: `quotes:${memory.revision}`,
    refinementRevision: () => `quotes:${memory.revision}`, work: new FactWorkQueue(0), limits: { maxDepth: 4, maxExpansions: 256, maxPlans: 8 },
    refineSelected: createGoalPlanRefiner({ memory, providers: [provider], maxAlternativeQuotes: 1,
      exactContext: () => ({ ...context, precision: 'exact' }) }) });
  const pending = planGoals(input());
  expect(pending.readyActions).toEqual([]);
  expect(memory.entries.find(entry => entry.coarse.id === coarseA.id)?.preferredExactIndex, JSON.stringify({ memory, pending })).toBe(0);
  expect(pending.plans[0]!.actions[0]!.declaration.reasons.some(reason => reason.code === 'goal-exact-challenger-awaits-quote')).toBe(true);
  published = true;
  const resolved = planGoals(input());
  expect(resolved.readyActions.map(row => row.action.declaration.id), JSON.stringify({ resolved, memory })).toEqual([exactA.id]);
  expect(memory.entries.filter(entry => entry.state === 'known')).toHaveLength(2);
  const pressure = planGoals({ ...input(), refineSelected: createGoalPlanRefiner({ memory, providers: [provider], maxAlternativeQuotes: 0,
    exactContext: () => ({ ...context, precision: 'exact' }) }) });
  // Zero unreferenced quotes does not evict either side of a live comparison.
  expect(pressure.readyActions.map(row => row.action.declaration.id)).toEqual([exactA.id]);
  expect(memory.entries.filter(entry => entry.state === 'known')).toHaveLength(2);
  expect(pressure.plans[0]!.capacityPressure).toBeUndefined();
}, 60_000);
