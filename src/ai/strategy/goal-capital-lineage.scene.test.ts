import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { reconcileGoalCapitalReceipts } from './goal-capital-receipts';
import { refreshAllocationCapital, reserveAllocationSpends, releaseEndedGoalCapital } from './allocation-ledger';
import type { ExecutableMethod } from './allocation-types';

function original(name: string) {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/goal-capital-597-${name}.json.gz`, import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memoryBefore: AiPolicyMemory;
  };
}

it('records the original6150 admitted purchase against its asset spend before any native payment', () => {
  const frame = original('near-6150'), snapshotBefore = JSON.stringify(frame.snapshot);
  const memory = JSON.parse(JSON.stringify(frame.memoryBefore)) as AiPolicyMemory;
  const entries = planAiOwnerCommandEntries(frame.snapshot, { playerId: 'planner', version: 'v9_knight', memory }, { strategyControl: true });
  const builds = entries.filter(entry => entry.scriptId === 'goal.build' && entry.command.type === 'build');
  expect(builds).toHaveLength(1);
  expect(builds[0]!.command).toMatchObject({ buildingKind: 'townHall', x: 2832, y: 720 });
  const authority = memory.strategyAllocation!, budget = Object.values(authority.budgets).find(budget => budget.plannedGold === 400)!;
  const issued = Object.values(authority.issuedCommands).find(command => command.command.type === 'build' && command.acceptedTick === 6150)!;
  expect(issued.spendIds).toEqual([budget.spendId]);
  expect(budget).toMatchObject({ amountGold: 400, paidGold: 0, state: 'reserved', action: issued.action });
  expect(refreshAllocationCapital(authority, 0, 6165).budgets[budget.id]).toEqual(budget);
  expect(JSON.stringify(frame.snapshot)).toBe(snapshotBefore);
});

it.each(['near-6285', 'near-6345', 'near-6840', 'far-7815'])('settles the original native hall once across wait/repair generations: %s', name => {
  const frame = original(name), unchanged = JSON.stringify(frame), prior = frame.memoryBefore.strategyAllocation!;
  const originalBudget = Object.values(prior.budgets).find(budget => budget.plannedGold === 400)!;
  expect(originalBudget.paidGold).toBe(0);
  const next = reconcileGoalCapitalReceipts(prior, frame.snapshot), budget = next.budgets[originalBudget.id]!;
  expect(budget).toMatchObject({ spendId: originalBudget.spendId, plannedGold: 400, amountGold: 400, paidGold: 400,
    state: 'spent', releasedTick: null });
  expect(budget.nativePayments).toHaveLength(1);
  const receipt = budget.nativePayments![0]!, foundation = frame.snapshot.buildings.find(building => building.id === receipt.entityId)!;
  expect(receipt).toMatchObject({ kind: 'foundation', amountGold: 400 });
  expect([foundation.kind, foundation.x, foundation.y]).toEqual(['townHall', 2832, 720]);
  const purchase = next.issuedCommands[receipt.commandId]!;
  expect(budget.action).toEqual(purchase.action);
  expect(next.executions[purchase.action.actionId]!.state.goalOutputBindings).toEqual({ building: foundation.id });
  expect(Object.keys(next.executions)).toEqual(Object.keys(prior.executions));
  expect(Object.keys(next.budgets)).toEqual(Object.keys(prior.budgets));
  expect(reconcileGoalCapitalReceipts(JSON.parse(JSON.stringify(next)), frame.snapshot)).toEqual(next);
  const refreshed = refreshAllocationCapital(next, 0, frame.snapshot.tick);
  expect(refreshed.budgets[budget.id]).toEqual(budget);
  expect(JSON.stringify(frame)).toBe(unchanged);
});

it('keeps an admitted spend and receipt through a zero-spend wait method and plan revision', () => {
  const frame = original('near-6285'), prior = frame.memoryBefore.strategyAllocation!;
  const budget = Object.values(prior.budgets).find(budget => budget.plannedGold === 400)!;
  const next = reconcileGoalCapitalReceipts(prior, frame.snapshot), method = next.methods[budget.methodId]!;
  const empty: ExecutableMethod = { ...method, spends: [], actions: method.actions.map(action => ({ ...action, spendIds: [] })) };
  const replay = reserveAllocationSpends({ memory: next, method: empty, actions: Object.values(next.executions),
    cashGold: 0, tick: frame.snapshot.tick + 15 }).memory;
  expect(replay.budgets[budget.id]).toEqual(next.budgets[budget.id]);
  expect(releaseEndedGoalCapital(replay, [{ goal: { id: budget.objectiveId }, status: 'complete' }], frame.snapshot.tick + 15)
    .budgets[budget.id]).toEqual(next.budgets[budget.id]);
});

it('does not infer payment or an output from cash loss, an old foundation or a different exact site', () => {
  const frame = original('near-6285'), prior = frame.memoryBefore.strategyAllocation!;
  const building = frame.snapshot.buildings.find(building => building.kind === 'townHall' && building.x === 2832 && building.y === 720)!;
  const noFoundation = { ...frame.snapshot, buildings: frame.snapshot.buildings.filter(item => item.id !== building.id) };
  expect(Object.values(reconcileGoalCapitalReceipts(prior, noFoundation).budgets).every(budget => budget.paidGold === 0)).toBe(true);
  const moved = { ...frame.snapshot, buildings: frame.snapshot.buildings.map(item => item.id === building.id ? { ...item, x: item.x + 1 } : item) };
  expect(Object.values(reconcileGoalCapitalReceipts(prior, moved).budgets).every(budget => budget.paidGold === 0)).toBe(true);
  const old = { ...prior, issuedCommands: Object.fromEntries(Object.entries(prior.issuedCommands).map(([id, command]) => [id,
    command.command.type === 'build' ? { ...command, worldBefore: { kind: 'construction' as const, buildingIds: [building.id] } } : command])) };
  expect(Object.values(reconcileGoalCapitalReceipts(old, frame.snapshot).budgets).every(budget => budget.paidGold === 0)).toBe(true);
});
