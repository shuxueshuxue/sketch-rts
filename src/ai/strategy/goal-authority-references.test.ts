import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { ExecutableMethod, StrategyAllocationMemory } from './allocation-types';
import { assertStrategyAllocationBounds, createStrategyAllocationMemory } from './control';
import { readGoalIntent, restoreGoalAuthorityReferences, retainGoalAuthorityReferences, storeGoalMethod } from './goal-authority-references';
import { internGoalReference } from './goal-versioned-references';
import { reserveAllocationSpends } from './allocation-ledger';

function shortControlIdentities(value: unknown, path = 'authority') {
  const fields = new Set(['id', 'actionId', 'declarationId', 'optionId', 'spendId', 'quoteId', 'commandId',
    'interruptedCommandId', 'parentActionId', 'budgetId']);
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'goalReferences') continue; // Version contents are data, not copied control identities.
    if (fields.has(key) && typeof item === 'string') expect(item.length, `${path}.${key}`).toBeLessThanOrEqual(256);
    shortControlIdentities(item, `${path}.${key}`);
  }
}

it('maps the original far106 live tokens and every lease/command reference into short saved identities once', () => {
  const compressed = readFileSync(new URL('./fixtures/goal-authority-488c-far-t1590.json.gz', import.meta.url));
  expect(createHash('sha256').update(compressed).digest('hex')).toBe('92be5dca6a91d8ad5248bf948508d5064b70d0ab2e2fd9d0ee34265d729fd863');
  const frame = JSON.parse(gunzipSync(compressed).toString()) as { memoryAfter: { strategyAllocation: StrategyAllocationMemory } };
  const before = frame.memoryAfter.strategyAllocation, unchanged = JSON.stringify(before), after = restoreGoalAuthorityReferences(before);
  expect(Buffer.byteLength(unchanged)).toBe(256237);
  expect(assertStrategyAllocationBounds(after)).toBeLessThan(64 * 1024);
  expect(Object.keys(after.executions)).toHaveLength(Object.keys(before.executions).length);
  const byGeneration = new Map(Object.values(after.executions).map(execution => [execution.token.generation, execution]));
  const identities: string[] = [];
  for (const old of Object.values(before.executions)) {
    const current = byGeneration.get(old.token.generation)!;
    expect(current).toBeDefined();
    expect(current.status).toBe(old.status); expect(current.phase).toBe(old.phase);
    identities.push(current.token.actionId);
    if (old.intent.kind === 'goal-action' && current.intent.kind === 'goal-action') {
      const expanded = readGoalIntent(after, current.intent);
      expect([expanded.goalId, expanded.actionKind, expanded.parameters, expanded.outputs])
        .toEqual([old.intent.goalId, old.intent.actionKind, old.intent.parameters, old.intent.outputs]);
      expect(current.intent.parameters).toEqual({});
      identities.push(current.intent.declarationId, current.intent.parametersRef!);
    }
  }
  for (const group of [after.assignments, after.leases, after.issuedCommands, after.issuedOrders]) for (const value of Object.values(group)) {
    identities.push(value.action.actionId);
    const execution = after.executions[value.action.actionId];
    if (execution) expect(execution.token.generation).toBe(value.action.generation);
  }
  for (const event of after.events) identities.push(event.id, event.action.actionId);
  for (const method of Object.values(after.methods)) identities.push(method.id, ...method.actions.map(action => action.id), ...method.spends.map(spend => spend.spendId));
  expect(identities.every(id => id.length <= 256)).toBe(true);
  shortControlIdentities(after);
  expect(restoreGoalAuthorityReferences(JSON.parse(JSON.stringify(after)))).toEqual(after);
  expect(JSON.stringify(before)).toBe(unchanged);
});

it('shares immutable exact parameter versions, retains control roots and expands original executor values after JSON', () => {
  const memory = createStrategyAllocationMemory('us', 0);
  const parameters = { transport: { kind: 'existing', entityId: 'real-hull' }, cohort: [{ kind: 'existing', entityId: 'real-worker' }],
    landing: { ground: { x: 100, y: 100 }, water: { x: 100, y: 64 }, heading: 0 }, optionId: 'option-content:'.repeat(600) };
  const method: ExecutableMethod = { id: 'goal-bundle:one', objectiveId: 'one', kind: 'goal-plan', stage: 'goal-plan',
    goalBundle: { planId: 'goal-plan:one', unitIds: ['real-worker', 'real-hull'] }, providerId: 'contract', preference: 0,
    status: 'candidate', reasons: [], preconditions: [], subgoals: [], demands: [], spends: [], estimatedTicks: 10,
    actions: [{ id: 'long-action:'.repeat(600), executor: 'goal.transport-worker', target: { point: { x: 100, y: 100 } },
      unitIds: ['real-worker', 'real-hull'], spendIds: [], demands: [], dependsOn: [], completionEffects: [],
      intent: { kind: 'goal-action', goalId: 'one', actionKind: 'transport-worker', declarationId: 'long-definition:'.repeat(500), parameters, outputs: [] } }] };
  const first = storeGoalMethod(memory, method), second = storeGoalMethod(first.memory, JSON.parse(JSON.stringify(method)));
  expect(second.method.actions[0]!.id).toBe(first.method.actions[0]!.id);
  expect(second.memory.goalReferences!.nextVersion).toBe(first.memory.goalReferences!.nextVersion);
  const action = second.method.actions[0]!;
  if (action.intent.kind !== 'goal-action') throw Error('missing goal intent');
  const restored = JSON.parse(JSON.stringify(second.memory)) as StrategyAllocationMemory;
  expect(readGoalIntent(restored, action.intent).parameters).toEqual(parameters);
  const quoted = { ...second.method, actions: [{ ...action, intent: readGoalIntent(restored, action.intent) }] };
  const repacked = storeGoalMethod(second.memory, quoted);
  expect(repacked.method).toEqual(second.method);
  expect(repacked.memory.goalReferences).toEqual(second.memory.goalReferences);
  const { parametersRef: _reference, ...unquotedIntent } = action.intent;
  const changed = storeGoalMethod(second.memory, { ...method, actions: [{ ...method.actions[0]!, intent: {
    ...unquotedIntent, parameters: { ...parameters, landing: { ...parameters.landing, heading: 1 } } } }] });
  expect(changed.method.actions[0]!.id).not.toBe(action.id);
  const table = structuredClone(second.memory.goalReferences!);
  const unused = internGoalReference(table, 'parameters', { unreferenced: true });
  const active = retainGoalAuthorityReferences({ ...second.memory, goalReferences: table, methods: { [method.id]: second.method } });
  expect(active.goalReferences!.entries[unused]).toBeUndefined();
  expect(readGoalIntent(active, action.intent).parameters).toEqual(parameters);
});

it('restores the real paid foundation budget under its new spend and never reserves it twice', () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-authority-paid-build-t15.json.gz', import.meta.url))).toString());
  expect(fixture.sourceSHA256).toBe('9aabb872e6c2a523093f296fe548b2254d3adbadcfad3daebf058309bcff80a3');
  const original = fixture.tick.authority as StrategyAllocationMemory, unchanged = JSON.stringify(original);
  for (const detached of [false, true]) {
    const input = detached ? { ...original, methods: {} } : original;
    const restored = restoreGoalAuthorityReferences(input), paid = Object.values(restored.budgets);
    shortControlIdentities(restored);
    expect(paid).toHaveLength(1);
    const budget = paid[0]!;
    expect(restored.budgets[`budget:${budget.spendId}`]).toBe(budget);
    expect(budget.id).toBe(`budget:${budget.spendId}`);
    expect([budget.paidGold, budget.amountGold, budget.state]).toEqual([120, 120, 'spent']);
    expect(budget.nativePayments).toEqual(Object.values(original.budgets)[0]!.nativePayments);
    if (!detached) {
      const method = Object.values(restored.methods).find(method => method.kind === 'goal-plan' && method.spends.length)!;
      const repeated = reserveAllocationSpends({ memory: JSON.parse(JSON.stringify(restored)), method,
        actions: Object.values(restored.executions), cashGold: fixture.tick.snapshot.players[restored.owner].gold, tick: fixture.tick.snapshot.tick });
      expect(Object.values(repeated.memory.budgets)).toHaveLength(1);
      expect(Object.values(repeated.memory.budgets)[0]!.paidGold).toBe(120);
    }
  }
  expect(JSON.stringify(original)).toBe(unchanged);
});
