import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AllocationBudget, IssuedActionCommand, StrategyAllocationMemory } from './allocation-types';
import { applyAllocationPayments, refreshAllocationCapital, reservedAllocationGold } from './allocation-ledger';
import { restoreGoalAuthorityReferences } from './goal-authority-references';
import { reserveAdmittedGoalCapital } from './goal-capital-commitment';

const fixture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
function savedHall() {
  const f = fixture('goal-capital-near-1725');
  const memory = reserveAdmittedGoalCapital(restoreGoalAuthorityReferences(structuredClone(f.memoryAfter.strategyAllocation)),
    f.observation.output.plans, f.snapshot.players.planner.gold, f.snapshot.tick);
  const budget = Object.values(memory.budgets)[0]!;
  expect([budget.amountGold, budget.plannedGold, budget.paidGold]).toEqual([85, 400, 0]);
  return { memory, budget };
}
function issuedBuild() {
  const f = fixture('goal-authority-paid-build-t15'), tick = f.tick;
  const prior = restoreGoalAuthorityReferences(structuredClone(tick.memoryBefore.strategyAllocation));
  const budget = Object.values(prior.budgets)[0]!;
  const memory: StrategyAllocationMemory = { ...prior, budgets: { ...prior.budgets,
    [budget.id]: { ...budget, plannedGold: 120, expectedPaymentTick: 15 } } };
  return { memory, budget: memory.budgets[budget.id]!, tick };
}

it('shrinks the original unissued hall85 to observed19 and refills only actual incoming cash after JSON', () => {
  //19 is the original near4575 cash observation (gzip e9b6eb5f2994db53...).
  //This is an API replay, not a revised-game trajectory through those purchases.
  const { memory, budget } = savedHall(), unchanged = JSON.stringify(memory);
  const dropped = refreshAllocationCapital(JSON.parse(unchanged), 19, 4575);
  expect(dropped.budgets[budget.id]).toMatchObject({ amountGold: 19, plannedGold: 400, paidGold: 0, state: 'reserved' });
  expect(reservedAllocationGold(dropped)).toBe(19);
  const replenished = refreshAllocationCapital(JSON.parse(JSON.stringify(dropped)), 129, 5250);
  expect(replenished.budgets[budget.id]!.amountGold).toBe(129);
  const funded = refreshAllocationCapital(replenished, 500, 6000);
  expect(funded.budgets[budget.id]!.amountGold).toBe(400);
  expect(funded.budgets[budget.id]!.externalReservationIds).toEqual(['naval:islandHall']);
  expect(funded.budgets[budget.id]!.expectedPaymentTick).toBe(budget.expectedPaymentTick);
  expect(JSON.stringify(memory)).toBe(unchanged);
});

it('keeps the actual issued foundation budget through zero-cash refresh so its original payment can still ACK once', () => {
  const { memory, budget, tick } = issuedBuild();
  const refreshed = refreshAllocationCapital(JSON.parse(JSON.stringify(memory)), 0, 15);
  expect(refreshed.budgets[budget.id]).toEqual(memory.budgets[budget.id]);
  expect(refreshed.issuedCommands).toEqual(memory.issuedCommands);
  const receipt = { ...tick.feedbacks[0].payments[0], budgetId: budget.id };
  const paid = applyAllocationPayments(refreshed, tick.snapshot, budget.action, [receipt]);
  expect(paid.budgets[budget.id]).toMatchObject({ paidGold: 120, amountGold: 120, state: 'spent' });
  expect(paid.budgets[budget.id]!.nativePayments).toHaveLength(1);
  expect(applyAllocationPayments(paid, tick.snapshot, budget.action, [receipt])).toEqual(paid);
});

it('also preserves same-token issued training capital without inferring a born unit or a payment', () => {
  const { memory, budget } = issuedBuild();
  const command = Object.values(memory.issuedCommands)[0]!;
  const train: IssuedActionCommand = { ...command, executor: 'goal.train', command: {
    type: 'train', buildingId: 'producer', unitKind: 'footman' } };
  const input = { ...memory, issuedCommands: { [train.id]: train } };
  const refreshed = refreshAllocationCapital(input, 0, 15);
  expect(refreshed.budgets[budget.id]).toEqual(budget);
  expect(refreshed.budgets[budget.id]!.paidGold).toBe(0);
  expect(refreshed.budgets[budget.id]!.nativePayments).toBeUndefined();
});

it.each(['generation', 'action', 'nonpurchase'] as const)('does not protect a future claim using a %s-mismatched receipt', mode => {
  const { memory, budget } = issuedBuild(), command = Object.values(memory.issuedCommands)[0]!;
  const other: IssuedActionCommand = mode === 'nonpurchase' ? { ...command, command: { type: 'holdPosition', unitIds: ['builder'] } }
    : { ...command, action: mode === 'generation' ? { ...command.action, generation: command.action.generation + 1 }
      : { ...command.action, actionId: 'different-action' } };
  const refreshed = refreshAllocationCapital({ ...memory, issuedCommands: { [other.id]: other } }, 0, 15);
  expect(refreshed.budgets[budget.id]).toMatchObject({ amountGold: 0, plannedGold: 120, paidGold: 0 });
});

it('does not freeze a future hall merely because its earlier parent issued an unrelated purchase', () => {
  const { memory, budget } = issuedBuild(), method = memory.methods[budget.methodId]!;
  const actions = method.actions.map(action => action.id === budget.action.actionId ? { ...action, spendIds: ['earlier-purchase'] } : action);
  const refreshed = refreshAllocationCapital({ ...memory, methods: { ...memory.methods, [method.id]: { ...method, actions } } }, 0, 15);
  expect(refreshed.budgets[budget.id]!.amountGold).toBe(0);
});

it('retains an issued receipt when its historical method is absent, without losing the pending ACK lineage', () => {
  const { memory, budget } = issuedBuild();
  const refreshed = refreshAllocationCapital({ ...memory, methods: {} }, 0, 15);
  expect(refreshed.budgets[budget.id]).toEqual(budget);
});

it('preserves ordinary current budgets and existing claim ownership, trimming later due capital first', () => {
  const { memory, budget } = savedHall();
  const late: AllocationBudget = { ...budget, id: 'budget:z', spendId: 'z', expectedPaymentTick: 5000, amountGold: 60 };
  const early: AllocationBudget = { ...budget, amountGold: 40 };
  const existing = { ...memory, budgets: { [early.id]: early, [late.id]: late } };
  expect(refreshAllocationCapital(existing, 100, 2000).budgets).toEqual(existing.budgets);
  const reduced = refreshAllocationCapital(existing, 70, 2000);
  expect([reduced.budgets[early.id]!.amountGold, reduced.budgets[late.id]!.amountGold]).toEqual([40, 30]);
  const { plannedGold: _planned, expectedPaymentTick: _payment, ...ordinary } = budget;
  const current: AllocationBudget = { ...ordinary, id: 'budget:current', spendId: 'current', amountGold: 60 };
  const withCurrent = refreshAllocationCapital({ ...memory, budgets: { [budget.id]: budget, [current.id]: current } }, 79, 2000);
  expect(withCurrent.budgets[current.id]).toEqual(current);
  expect(withCurrent.budgets[budget.id]!.amountGold).toBe(19);
});

it('preserves paid receipts and terminal release behavior while only shrinking the unpaid future balance', () => {
  const { memory, budget } = savedHall();
  const payment = { kind: 'foundation' as const, commandId: 'acknowledged-purchase', entityId: 'real-foundation', amountGold: 20, observedTick: 1600 };
  const partial: AllocationBudget = { ...budget, paidGold: 20, nativePayments: [payment] };
  const reduced = refreshAllocationCapital({ ...memory, budgets: { [partial.id]: partial } }, 10, 2000);
  expect(reduced.budgets[budget.id]).toMatchObject({ amountGold: 30, paidGold: 20, nativePayments: [payment] });
  expect(reservedAllocationGold(reduced)).toBe(10);
  const objective = memory.objectives[budget.objectiveId]!;
  const ended = refreshAllocationCapital({ ...memory, objectives: { ...memory.objectives,
    [budget.objectiveId]: { ...objective, status: 'failed' } } }, 19, 2000);
  expect(ended.budgets[budget.id]).toMatchObject({ state: 'released', releasedTick: 2000 });
  expect(reservedAllocationGold(ended)).toBe(0);
});
