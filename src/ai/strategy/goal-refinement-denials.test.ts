import { expect, it } from 'vitest';
import { goalFact } from './goal-facts';
import { applyGoalRefinements, type GoalRefinementMemory } from './goal-plan-refinement';
import { retainGoalRefinementChoices } from './goal-search-retention';
import type { GoalActionDeclaration, GoalPlan, GoalPlanningContext } from './goal-planner-types';

function fixture() {
  const effect = goalFact({ kind: 'camp-cleared', campId: 'comparison' });
  const dependency = goalFact({ kind: 'supply-cap', minimum: 1 });
  let revision = 'fact-v1', source = 'source-v1';
  const action = (id: string, gold: number, precision: 'coarse' | 'exact'): GoalActionDeclaration => ({ id, kind: 'assemble', precision,
    preconditions: [dependency], effects: [{ fact: effect, operation: 'establish', at: 'finish' }], demands: [], flows: [], outputs: [],
    executor: { executor: 'goal.assemble', parameters: {} }, duration: { state: 'met', value: 0, factIds: [] },
    cost: { state: 'met', value: [{ code: 'loss', gold, at: 'start', factIds: [] }], factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, reasons: [], refinementFor: { providerId: 'test', effect } });
  const rows = [10, 12, 15].map((cost, index) => ({ planId: 'plan', coarse: action(`c${index}`, 0, 'coarse'),
    exact: [action(`e${index}`, cost, 'exact')], state: 'known' as const, sourceRevision: source,
    ...(index === 0 ? { preferredExactIndex: 0 } : {}), reason: { code: 'quoted', factIds: [], values: {} } }));
  // Distinct actor choices must also have distinct physical proposals.
  rows.forEach((row, index) => { row.coarse = { ...row.coarse, executor: { executor: 'goal.assemble', parameters: { choice: index } } }; });
  const memory: GoalRefinementMemory = { revision: 3, entries: rows };
  const readFact: GoalPlanningContext['readFact'] = fact => ({ fact, state: 'met', observedTick: 0, revision,
    availableTick: 0, evidence: [], reason: { code: 'current', factIds: [], values: {} } });
  const plan = { id: 'plan', goal: { id: 'goal', rewardGold: 1000, effects: [effect] },
    actions: [{ id: 'e0', declaration: rows[0]!.exact[0] }], facts: [{ id: effect.id }],
    alternatives: [{ actionId: 'e1' }] } as unknown as GoalPlan;
  // Only the winner and one opponent survive the graph retention step.
  retainGoalRefinementChoices(memory, [plan], readFact, 1);
  const context = { readFact, precision: 'coarse' } as GoalPlanningContext;
  const provider = { id: 'test', actionsFor: () => [rows[2]!.coarse] };
  const regenerate = () => applyGoalRefinements(provider, memory, () => source, () => ['plan']).actionsFor(effect, context);
  return { memory, regenerate, changeFact: () => { revision = 'fact-v2'; }, changeSource: () => { source = 'source-v2'; } };
}
it('retains a small exact denial after discarding the full losing proof', () => {
  const f = fixture(); expect(f.memory.entries).toHaveLength(2); expect(f.memory.denials).toHaveLength(1);
  const denial = f.memory.denials![0]!;
  expect(denial.declaration.id).toBe('c2'); expect(denial.value.costs[0]!.gold).toBe(15);
  expect('exact' in denial).toBe(false); expect(denial.dependencies[0]!.revision).toBe('fact-v1');
  expect(f.memory.denialCapacity?.pressure).toBeUndefined();
});
it('uses the denied exact price after JSON instead of refining the optimistic proposal again', () => {
  const f = fixture(); Object.assign(f.memory, JSON.parse(JSON.stringify(f.memory)));
  expect(f.regenerate()).toEqual([]); expect(f.memory.revision).toBe(3);
});
it('allows a fresh challenge when any depended-on fact changes', () => {
  const f = fixture(); f.changeFact(); expect(f.regenerate()).toHaveLength(1);
  expect(f.regenerate()[0]!.precision).toBe('coarse');
});
it('allows a fresh challenge when the physical quotation source changes', () => {
  const f = fixture(); f.changeSource(); expect(f.regenerate()).toHaveLength(1);
});
it('requires a new executable proof if the retained confirmed comparison disappears', () => {
  const f = fixture(); f.memory.entries = [];
  const result = f.regenerate(); expect(result).toHaveLength(1); expect(result[0]!.precision).toBe('coarse');
  expect(result[0]!.cost.state === 'met' && result[0]!.cost.value[0]!.gold).toBe(15);
  expect(result[0]!.reasons[0]!.code).toBe('goal-denied-challenger-proof-required');
});
