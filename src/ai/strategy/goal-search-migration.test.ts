import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createAiPolicyMemory } from '../memory';
import type { StrategyAllocationMemory } from './allocation-types';
import { createStrategyAllocationMemory } from './control';
import { readGoalIntent, restoreGoalAuthorityReferences, storeGoalMethod } from './goal-authority-references';
import { reserveAllocationSpends } from './allocation-ledger';
import { reconcileGoalCapitalReceipts } from './goal-capital-receipts';
import { migrateGoalAuthoritySelectors, migrateGoalSearchMemory } from './goal-search-migration';
import { goalGlobalStepKey } from './goal-search-format';
import { createGoalPlanningReferences, withGoalPlanningReferences } from './goal-planning-references';
import { withGoalPlanningMemory } from './goal-planning-restore';
import { createGoalWorldFactMemory } from './goal-world-facts';

const global = (goalId: string) => goalGlobalStepKey(goalId, { provider: 'economy', kind: 'build',
  grounding: { buildingKind: 'townHall', mineId: 'mine' } });
function paid() {
  return JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-authority-paid-build-t15.json.gz', import.meta.url))).toString());
}

it('decodes all authority roots before dropping search definitions and preserves the real paid foundation across JSON', () => {
  const fixture = paid(), original = restoreGoalAuthorityReferences(fixture.tick.authority as StrategyAllocationMemory);
  const memory = createAiPolicyMemory(), table = createGoalPlanningReferences();
  table.entries['goal-v1'] = { namespace: 'target', content: { mineId: 'mine' } };
  table.entries['goal-v2'] = { namespace: 'action', content: { producer: { targetRef: 'goal-v1' }, kind: 'build' } };
  table.nextVersion = 3;
  const authority = JSON.parse(JSON.stringify(original)) as StrategyAllocationMemory;
  const declarations = Object.values(authority.goalReferences!.entries).filter(entry => entry.namespace === 'declaration');
  declarations.forEach(entry => { entry.content = { ...(entry.content as Record<string, any>), priorId: 'goal-v2' }; });
  const budget = Object.values(authority.budgets)[0]!;
  const spend = authority.goalReferences!.entries[budget.spendId]!;
  spend.content = { priorId: 'goal-v1' };
  memory.strategyAllocation = authority; memory.goalPlanningReferences = table;
  const unchanged = JSON.stringify(memory), calls: string[] = [];
  const after = migrateGoalSearchMemory(memory, entry => {
    calls.push(entry.id);
    if (entry.id === 'goal-v2') expect(entry.content).toEqual({ producer: { mineId: 'mine' }, kind: 'build' });
    return entry.id === 'goal-v2' ? global(entry.goalId!) : 'goal-capital:mine';
  });
  expect(calls.sort()).toEqual(['goal-v1', 'goal-v2']);
  expect(after).not.toHaveProperty('goalPlanningReferences'); expect(after).not.toHaveProperty('goalPlanning');
  expect(JSON.stringify(memory)).toBe(unchanged);
  let current = after.strategyAllocation!;
  expect(current.goalReferences!.nextVersion).toBe(authority.goalReferences!.nextVersion);
  expect(Object.keys(current.goalReferences!.entries)).toEqual(Object.keys(authority.goalReferences!.entries));
  for (let i = 0; i < 3; i++) {
    current = JSON.parse(JSON.stringify(current));
    const oldBudget = Object.values(original.budgets)[0]!, nextBudget = Object.values(current.budgets)[0]!;
    expect([nextBudget.spendId, nextBudget.amountGold, nextBudget.paidGold, nextBudget.state])
      .toEqual([oldBudget.spendId, oldBudget.amountGold, 120, 'spent']);
    expect(nextBudget.nativePayments).toEqual(oldBudget.nativePayments);
    expect(Object.keys(current.issuedCommands)).toEqual(Object.keys(original.issuedCommands));
    for (const [id, command] of Object.entries(original.issuedCommands)) expect(current.issuedCommands[id]).toMatchObject(command);
    expect(current.leases).toEqual(original.leases); expect(current.assignments).toEqual(original.assignments);
    for (const execution of Object.values(current.executions)) if (execution.intent.kind === 'goal-action') {
      expect(readGoalIntent(current, execution.intent).declarationId).toBe(global(execution.intent.goalId));
      expect(execution.state).toEqual(original.executions[execution.token.actionId]!.state);
      expect(execution.token).toEqual(original.executions[execution.token.actionId]!.token);
    }
    current = reconcileGoalCapitalReceipts(current, fixture.tick.snapshot);
    const method = Object.values(current.methods).find(method => method.kind === 'goal-plan' && method.spends.length)!;
    const regenerated = { ...method, actions: method.actions.map(action => {
      if (action.intent.kind !== 'goal-action') return action;
      const { parametersRef: _parameters, ...intent } = readGoalIntent(current, action.intent);
      return { ...action, id: `goal:${intent.goalId}:${intent.declarationId}`, intent };
    }) };
    const repacked = storeGoalMethod(current, regenerated);
    expect(repacked.method.actions.map(action => action.id)).toEqual(method.actions.map(action => action.id));
    expect(repacked.memory.goalReferences!.nextVersion).toBe(current.goalReferences!.nextVersion);
    current = reserveAllocationSpends({ memory: current, method, actions: Object.values(current.executions),
      cashGold: fixture.tick.snapshot.players[current.owner].gold, tick: fixture.tick.snapshot.tick }).memory;
    expect(Object.values(current.budgets)).toHaveLength(1);
    expect(Object.values(current.budgets)[0]!.paidGold).toBe(120);
  }
  expect(migrateGoalSearchMemory(JSON.parse(JSON.stringify(after)), () => { throw Error('already migrated'); })).toEqual(after);
});

it('qualifies the same prior declaration by goal and rejects a shared output definition with contradictory scopes', () => {
  const authority = createStrategyAllocationMemory('us', 0), table = createGoalPlanningReferences();
  table.entries['goal-v1'] = { namespace: 'action', content: { kind: 'build' } }; table.nextVersion = 2;
  const input: StrategyAllocationMemory = { ...authority, goalReferences: { version: 1, nextVersion: 4, entries: {
    'goal-ref:declaration:v1': { namespace: 'declaration', content: { goal: 'one', kind: 'build', priorId: 'goal-v1', parametersRef: 'goal-ref:parameters:v3' } },
    'goal-ref:declaration:v2': { namespace: 'declaration', content: { goal: 'two', kind: 'build', priorId: 'goal-v1', parametersRef: 'goal-ref:parameters:v3' } },
    'goal-ref:parameters:v3': { namespace: 'parameters', content: {} },
  } } };
  const result = migrateGoalAuthoritySelectors(input, table, row => global(row.goalId!));
  expect(result.goalReferences!.entries['goal-ref:declaration:v1']!.content).toMatchObject({ priorId: global('one') });
  expect(result.goalReferences!.entries['goal-ref:declaration:v2']!.content).toMatchObject({ priorId: global('two') });
  input.goalReferences!.entries['goal-ref:parameters:v3']!.content = { producer: { kind: 'output', actionId: 'goal-v1', output: 'building' } };
  const unchanged = JSON.stringify(input);
  expect(() => migrateGoalAuthoritySelectors(input, table, row => global(row.goalId!))).toThrow('Ambiguous shared');
  expect(JSON.stringify(input)).toBe(unchanged);
});

it('atomically maps direct tokens, fallback capital, output references and orphan journal roots without allocating versions', () => {
  const memory = createStrategyAllocationMemory('us', 0), table = createGoalPlanningReferences();
  table.entries['goal-v1'] = { namespace: 'action', content: { kind: 'train', unitKind: 'transport' } }; table.nextVersion = 2;
  const input = { ...memory, objectives: {}, events: [{ id: 'event', objectiveId: 'island', methodId: 'goal-bundle:island',
    action: { actionId: 'goal:island:goal-v1', generation: 7 }, kind: 'action-finished', outcome: 'complete', tick: 3, revision: 1,
    reason: { code: 'done', factIds: ['goal-v1'], values: {} } }],
    budgets: { 'budget:goal-capital:goal:island:goal-v1': { id: 'budget:goal-capital:goal:island:goal-v1',
      spendId: 'goal-capital:goal:island:goal-v1', action: { actionId: 'goal:island:goal-v1', generation: 7 },
      amountGold: 100, paidGold: 100, state: 'spent' } },
    goalReferences: { version: 1, nextVersion: 9, entries: { 'goal-ref:parameters:v8': { namespace: 'parameters', content: {
      producer: { kind: 'output', actionId: 'goal-v1', output: 'building' },
    } } } },
  } as unknown as StrategyAllocationMemory;
  const key = global('island'), before = JSON.stringify(input), result = migrateGoalAuthoritySelectors(input, table, () => key);
  expect(result.events[0]!.action).toEqual({ actionId: `goal:island:${key}`, generation: 7 });
  expect(result.events[0]!.reason.factIds).toEqual([key]);
  const [budget] = Object.values(result.budgets);
  expect(budget!.spendId).toBe(`goal-capital:goal:island:${key}`);
  expect(result.budgets[budget!.id]).toBe(budget); expect(budget!.paidGold).toBe(100);
  expect(result.goalReferences!.nextVersion).toBe(9);
  expect(result.goalReferences!.entries['goal-ref:parameters:v8']!.content).toMatchObject({ producer: { kind: 'output', actionId: key } });
  expect(JSON.stringify(input)).toBe(before);
});

it('fails closed before modifying either authority or its only decoding table', () => {
  const input = { ...createStrategyAllocationMemory('us', 0), unmet: [{ factId: 'goal-v9' }] } as unknown as StrategyAllocationMemory;
  const table = createGoalPlanningReferences(), before = JSON.stringify([input, table]);
  expect(() => migrateGoalAuthoritySelectors(input, table, () => global('one'))).toThrow('Missing prior');
  table.entries['goal-v9'] = { namespace: 'action', content: { nested: 'goal-v9' } }; table.nextVersion = 10;
  expect(() => migrateGoalAuthoritySelectors(input, table, () => global('one'))).toThrow('cyclic');
  table.entries = {}; table.nextVersion = 1;
  expect(JSON.stringify([input, table])).toBe(before);
});

it('reads saved intents from authority outside or inside an unrelated planner scope', () => {
  const fixture = paid(), authority = restoreGoalAuthorityReferences(fixture.tick.authority);
  const execution = Object.values(authority.executions).find(action => action.intent.kind === 'goal-action')!;
  if (execution.intent.kind !== 'goal-action') throw Error('missing build');
  const intent = execution.intent;
  const expected = readGoalIntent(authority, execution.intent), table = createGoalPlanningReferences();
  table.priorDeclarations = { [execution.intent.declarationId]: 'wrong-other-owner' };
  withGoalPlanningReferences(table, () => expect(readGoalIntent(authority, intent)).toEqual(expected));
});

it('materializes the old alias into the existing authority declaration rather than consulting planner state on every read', () => {
  const fixture = paid(), authority = restoreGoalAuthorityReferences(fixture.tick.authority);
  const memory = createAiPolicyMemory(), references = createGoalPlanningReferences();
  const execution = Object.values(authority.executions).find(action => action.intent.kind === 'goal-action')!;
  if (execution.intent.kind !== 'goal-action') throw Error('missing build');
  references.priorIdentitiesRestored = true;
  references.priorDeclarations = { [execution.intent.declarationId]: global('one') };
  memory.strategyAllocation = authority; memory.goalPlanningReferences = references;
  withGoalPlanningMemory(memory, () => {});
  expect(readGoalIntent(memory.strategyAllocation!, execution.intent).declarationId).toBe(global('one'));
  expect(memory.goalPlanningReferences!.priorDeclarations).toBeUndefined();
  expect(memory.strategyAllocation!.goalReferences!.nextVersion).toBe(authority.goalReferences!.nextVersion);
});

it('honors the saved declaration alias before decoding and removing its only source table', () => {
  const fixture = paid(), authority = restoreGoalAuthorityReferences(fixture.tick.authority);
  const memory = createAiPolicyMemory(), table = createGoalPlanningReferences();
  const execution = Object.values(authority.executions).find(action => action.intent.kind === 'goal-action')!;
  if (execution.intent.kind !== 'goal-action') throw Error('missing build');
  const id = execution.intent.declarationId, entry = authority.goalReferences!.entries[id]!;
  entry.content = { ...(entry.content as Record<string, any>), priorId: 'goal-v1' };
  table.entries['goal-v1'] = { namespace: 'action', content: { kind: 'wrong-old-number' } };
  table.entries['goal-v2'] = { namespace: 'action', content: { kind: 'build', original: true } };
  table.nextVersion = 3; table.priorDeclarations = { [id]: 'goal-v2' };
  memory.strategyAllocation = authority; memory.goalPlanningReferences = table;
  const original = JSON.stringify(memory);
  const migrated = migrateGoalSearchMemory(memory, row => {
    expect(row.id).toBe('goal-v2'); expect(row.content).toEqual({ kind: 'build', original: true });
    return global(row.goalId!);
  });
  expect(readGoalIntent(migrated.strategyAllocation!, execution.intent).declarationId).toBe(global(execution.intent.goalId));
  expect(JSON.stringify(memory)).toBe(original);
});

it('retains native publications and only their definition closure, without retaining the discarded search', () => {
  const memory = createAiPolicyMemory(), table = createGoalPlanningReferences();
  table.entries['goal-v1'] = { namespace: 'geometry-request', content: { targetRef: 'goal-v2' } };
  table.entries['goal-v2'] = { namespace: 'target', content: { point: { x: 1, y: 2 } } };
  table.entries['goal-v3'] = { namespace: 'recipe', content: { discardedSearch: true } }; table.nextVersion = 4;
  memory.goalPlanningReferences = table;
  const world = createGoalWorldFactMemory('us'); world.requests.push({ id: 'goal-v1', requestedTick: 10 });
  memory.goalPlanning = { version: 1, owner: 'us', world, refinements: { revision: 1, entries: [] } };
  const before = JSON.stringify(memory), result = migrateGoalSearchMemory(memory, () => { throw Error('No authority mapping required'); });
  expect(result.goalPlanning).toBeUndefined(); expect(result.goalPlanningReferences).toBeUndefined();
  expect(result.goalPublications!.memory.world).toEqual(world);
  expect(Object.keys(result.goalPublications!.references!.entries)).toEqual(['goal-v1', 'goal-v2']);
  expect(result.goalPublications!.references!.nextVersion).toBe(4);
  expect(result.goalPublications!.memory).not.toHaveProperty('refinements');
  expect(JSON.stringify(memory)).toBe(before);
  expect(migrateGoalSearchMemory(JSON.parse(JSON.stringify(result)), () => { throw Error('already migrated'); })).toEqual(result);
});
