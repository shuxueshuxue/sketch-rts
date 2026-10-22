import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { ActionToken, StrategyAllocationMemory } from './allocation-types';
import { createStrategyAllocationMemory } from './control';
import { restoreGoalAuthorityReferences } from './goal-authority-references';
import { reconcileGoalCapitalReceipts } from './goal-capital-receipts';
import { reserveAllocationSpends } from './allocation-ledger';
import { migrateGoalAuthoritySelectors, type GoalPriorDefinition } from './goal-search-migration';
import { goalGlobalStepKey } from './goal-search-format';
import { createGoalPlanningReferences } from './goal-planning-references';

const step = (goal: string) => goalGlobalStepKey(goal, { provider: 'economy', kind: 'build', grounding: { buildingKind: 'farm' } });
const eventFor = (goal: string, action: ActionToken): StrategyAllocationMemory['events'][number] => ({
  id: 'scope-evidence', objectiveId: goal, methodId: `goal-bundle:${goal}`, action,
  kind: 'action-finished', outcome: 'complete', tick: 15, revision: 1,
  reason: { code: 'observed-complete', factIds: [], values: {} },
});
function barePaid() {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-authority-paid-build-t15.json.gz', import.meta.url))).toString());
  const original = restoreGoalAuthorityReferences(fixture.tick.authority as StrategyAllocationMemory);
  const purchase = Object.values(original.issuedCommands).find(command => command.executor === 'goal.build')!;
  const goal = original.executions[purchase.action.actionId]!.objectiveId;
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return value === purchase.action.actionId ? 'goal-v1' : value;
    if (Array.isArray(value)) return value.map(rewrite);
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key === purchase.action.actionId ? 'goal-v1' : key, rewrite(item)])) : value;
  };
  const { goalReferences, ...records } = original;
  const authority: StrategyAllocationMemory = { ...rewrite(records) as StrategyAllocationMemory, goalReferences: structuredClone(goalReferences!) };
  const table = createGoalPlanningReferences();
  table.entries['goal-v1'] = { namespace: 'action', content: { kind: 'build', buildingKind: 'farm' } }; table.nextVersion = 2;
  return { fixture, authority, table, goal, purchase };
}

it('scopes the real paid receipt bare token in every root and keeps payment/binding unchanged through JSON', () => {
  const { fixture, authority, table, goal, purchase } = barePaid(), before = JSON.stringify([authority, table]);
  const calls: GoalPriorDefinition[] = [];
  let current = migrateGoalAuthoritySelectors(authority, table, row => {
    calls.push(row); expect(row.goalId).toBe(goal); return step(goal);
  });
  expect(calls.some(row => row.id === 'goal-v1')).toBe(true);
  expect(JSON.stringify([authority, table])).toBe(before);
  expect(current.issuedCommands[purchase.id]!.action).toEqual({ actionId: step(goal), generation: purchase.action.generation });
  expect(current.executions[step(goal)]!.token).toEqual(current.issuedCommands[purchase.id]!.action);
  expect(Object.values(current.issuedOrders).every(order => order.action.actionId === step(goal))).toBe(true);
  expect(current.goalReferences!.nextVersion).toBe(authority.goalReferences!.nextVersion);
  expect(Object.keys(current.goalReferences!.entries)).toEqual(Object.keys(authority.goalReferences!.entries));
  for (let i = 0; i < 3; i++) {
    current = JSON.parse(JSON.stringify(current));
    current = reconcileGoalCapitalReceipts(current, fixture.tick.snapshot);
    const method = Object.values(current.methods).find(method => method.kind === 'goal-plan' && method.spends.length)!;
    current = reserveAllocationSpends({ memory: current, method, actions: Object.values(current.executions),
      cashGold: fixture.tick.snapshot.players[current.owner].gold, tick: fixture.tick.snapshot.tick }).memory;
    expect(current.budgets).toEqual(migrateGoalAuthoritySelectors(authority, table, () => step(goal)).budgets);
    expect(Object.values(current.budgets)).toHaveLength(1);
    expect(Object.values(current.budgets)[0]!.paidGold).toBe(120);
    expect(Object.values(current.budgets)[0]!.nativePayments).toHaveLength(1);
    expect(current.executions[step(goal)]!.state).toEqual(authority.executions['goal-v1']!.state);
    expect(current.issuedCommands[purchase.id]!.action.generation).toBe(purchase.action.generation);
  }
});

it('finds the surviving ownership anchor in a lease or assignment before mapping orphan commands/orders', () => {
  for (const root of ['leases', 'assignments'] as const) {
    const { authority, table, goal, purchase } = barePaid();
    const input = { ...createStrategyAllocationMemory(authority.owner, 0), [root]: authority[root],
      issuedCommands: authority.issuedCommands, issuedOrders: authority.issuedOrders };
    expect(Object.keys(input[root]).length).toBeGreaterThan(0);
    const result = migrateGoalAuthoritySelectors(input, table, row => {
      expect(row.goalId).toBe(goal); return step(goal);
    });
    expect(result.issuedCommands[purchase.id]!.action.actionId).toBe(step(goal));
    expect(Object.values(result.issuedOrders).every(order => order.action.actionId === step(goal))).toBe(true);
  }
});

it('rejects contradictory token ownership in the complete authority before invoking any selector', () => {
  const { authority, table } = barePaid(), first = Object.values(authority.assignments)[0]!;
  const input = { ...authority, assignments: { ...authority.assignments,
    contradictory: { ...first, objectiveId: 'another-goal' } } };
  const before = JSON.stringify([input, table]); let calls = 0;
  expect(() => migrateGoalAuthoritySelectors(input, table, () => { calls++; return step('another-goal'); }))
    .toThrow('Conflicting authority token goals');
  expect(calls).toBe(0); expect(JSON.stringify([input, table])).toBe(before);
});

it('scopes the same action ID separately by generation, including command map keys', () => {
  const { authority, table, purchase, goal } = barePaid();
  const event = eventFor(goal, { ...purchase.action, actionId: 'goal-v1' });
  const action = (generation: number): ActionToken => ({ actionId: 'goal-v1', generation });
  const input = { ...createStrategyAllocationMemory(authority.owner, 0),
    events: [1, 2].map(generation => ({ ...event, objectiveId: `goal-${generation}`, action: action(generation) })),
    issuedCommands: Object.fromEntries([1, 2].map(generation => [String(generation), { ...purchase,
      id: String(generation), action: action(generation) }])) };
  const result = migrateGoalAuthoritySelectors(input, table, row => {
    expect(row.goalId).toMatch(/^goal-[12]$/); return step(row.goalId!);
  });
  expect(result.issuedCommands['1']!.action).toEqual({ actionId: step('goal-1'), generation: 1 });
  expect(result.issuedCommands['2']!.action).toEqual({ actionId: step('goal-2'), generation: 2 });
});

it('does not borrow another generation owner or drop the only source table for an orphan bare token', () => {
  const { authority, table, purchase, goal } = barePaid();
  const event = eventFor(goal, { ...purchase.action, actionId: 'goal-v1' });
  const input = { ...createStrategyAllocationMemory(authority.owner, 0),
    events: [{ ...event, action: { ...event.action, generation: purchase.action.generation + 1 } }],
    issuedCommands: { [purchase.id]: { ...purchase, action: { ...purchase.action, actionId: 'goal-v1' } } } };
  const before = JSON.stringify([input, table]); let calls = 0;
  expect(() => migrateGoalAuthoritySelectors(input, table, () => { calls++; return step('wrong'); }))
    .toThrow('Missing authority token goal');
  expect(calls).toBe(0); expect(JSON.stringify([input, table])).toBe(before);
});
