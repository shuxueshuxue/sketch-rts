import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { planAiOwnerCommandEntries } from '../planner-context';
import type { AiPolicyMemory } from '../memory';
import { navalBudgetReserve } from '../policy/naval';
import { allocationGrants } from './allocation-lifecycle';
import { allocationCommandCost, refreshAllocationCapital, releaseEndedGoalCapital, reserveAllocationSpends, reservedAllocationGold } from './allocation-ledger';
import { readGoalIntent, restoreGoalAuthorityReferences, storeGoalMethod } from './goal-authority-references';
import { createStrategyCommandGateway } from './command-gateway';
import { reserveAdmittedGoalCapital } from './goal-capital-commitment';
import { continueGoalMethod } from './goal-execution-continuation';
import { withGoalPlannerInput } from './goal-planner-input';
import { goalFact } from './goal-facts';
import { goalPlanCapital } from './goal-plan-capital';
import type { GoalPlan } from './goal-planner-types';
import type { StrategyAllocationMemory } from './allocation-types';

function original(name: string) {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memoryBefore: AiPolicyMemory; memoryAfter: AiPolicyMemory;
    observation: { output: { plans: GoalPlan[] }; commands: { scriptId: string; command: import('../../shared/types').GameCommand }[] };
  };
}
function registered(frame: ReturnType<typeof original>) {
  const plan = frame.observation.output.plans[0]!, memory = frame.memoryAfter.strategyAllocation!;
  const capital = goalPlanCapital(plan);
  expect(capital.pending).toEqual([]); expect(capital.spends).toHaveLength(1);
  const admitted = Object.values(memory.methods).find(method => method.goalBundle?.planId === plan.id)!;
  const packed = storeGoalMethod(memory, { ...admitted, spends: capital.spends.map(({ paymentSchedule: _evidence, ...spend }) => spend) });
  const result = reserveAllocationSpends({ memory: packed.memory, method: packed.method,
    actions: Object.values(memory.executions), cashGold: frame.snapshot.players[memory.owner]!.gold, tick: frame.snapshot.tick });
  return { ...result, plan, method: packed.method };
}

it('earmarks the original near future hall from actual cash and exposes it once to the existing naval reserve', () => {
  for (const tick of [1725, 3690]) {
    const frame = original(`goal-capital-near-${tick}`), unchanged = JSON.stringify(frame);
    expect(frame.snapshot.players.planner!.gold).toBe(85);
    const { memory, plan } = registered(frame), budget = Object.values(memory.budgets)[0]!;
    expect(Object.values(memory.budgets)).toHaveLength(1);
    expect([budget.plannedGold, budget.amountGold, budget.paidGold]).toEqual([400, 85, 0]);
    expect(budget.expectedPaymentTick).toBe(tick === 1725 ? 4395 : 6427);
    expect(budget.externalReservationIds).toEqual(['naval:islandHall']);
    expect(reservedAllocationGold(memory)).toBe(85);
    expect(reservedAllocationGold(memory, plan.goal.id)).toBe(0);
    expect(reservedAllocationGold(memory, 'another-plan')).toBe(85);
    expect(navalBudgetReserve(frame.snapshot, memory.owner, { memory: { ...frame.memoryAfter, strategyAllocation: memory } })).toBe(85);
    expect(allocationGrants(memory).flatMap(grant => grant.budgets)).toEqual([]); // Saving is not another action's purchasing grant.
    expect(JSON.stringify(frame)).toBe(unchanged);
  }
});

it('funds only observed later cash while unrelated training preserves the earmark and ended plans release it', () => {
  const first = original('goal-capital-near-1725'), later = original('goal-capital-near-5250');
  const saved = registered(first), owner = saved.memory.owner;
  const memory = refreshAllocationCapital(JSON.parse(JSON.stringify(saved.memory)), later.snapshot.players[owner]!.gold, later.snapshot.tick);
  expect(later.snapshot.players[owner]!.gold).toBe(129);
  expect(reservedAllocationGold(memory)).toBe(129);
  const barracks = later.snapshot.buildings.find(building => building.owner === owner && building.kind === 'barracks')!;
  const command = { type: 'train' as const, buildingId: barracks.id, unitKind: 'lancer' as const };
  expect(allocationCommandCost(later.snapshot, owner, command)).toBeLessThanOrEqual(129);
  const proposal = { id: 'ordinary-production', source: 'script' as const, executor: 'v6Economy', action: null,
    allocationRevision: null, purpose: 'task' as const, command };
  const run = (memory: StrategyAllocationMemory) => createStrategyCommandGateway({ snapshot: later.snapshot, owner, memory,
    grants: allocationGrants(memory), queuedTick: null }).admit([proposal]);
  expect(run(memory).admissions[0]).toMatchObject({ status: 'rejected', reason: { reason: 'command-cash-owned-by-another-action' } });
  const pending = releaseEndedGoalCapital(memory, [{ goal: { id: saved.plan.goal.id }, status: 'blocked' }], later.snapshot.tick);
  expect(reservedAllocationGold(pending)).toBe(129);
  const ended = releaseEndedGoalCapital(memory, [{ goal: { id: saved.plan.goal.id }, status: 'complete' }], later.snapshot.tick);
  expect(reservedAllocationGold(ended)).toBe(0);
  expect(run(ended).admissions[0]!.status).toBe('accepted');
  const failed = refreshAllocationCapital({ ...memory, objectives: { ...memory.objectives, [saved.plan.goal.id]: {
    ...memory.objectives[saved.plan.goal.id]!, status: 'failed' } } }, 129, later.snapshot.tick);
  expect(reservedAllocationGold(failed)).toBe(0);
});

it('blocks the original far v6Economy expansion only at the controlled target and preserves off and in-flight commands', () => {
  const frame = original('goal-managed-build-far-7485'), memory = frame.memoryAfter.strategyAllocation!, owner = memory.owner;
  const returned = frame.observation.commands.find(row => row.scriptId === 'v6Economy' && row.command.type === 'build')!;
  expect(returned.command).toMatchObject({ type: 'build', buildingKind: 'townHall', x: 2928, y: 688 });
  const proposal = { id: 'original-v6-build', source: 'script' as const, executor: 'v6Economy', action: null,
    allocationRevision: null, purpose: 'task' as const, command: returned.command };
  const managedExpansionSites = [frame.observation.output.plans[0]!.goal.effects.find(fact => fact.predicate.kind === 'hall-complete')!.predicate];
  const at = managedExpansionSites[0]!;
  if (at.kind !== 'hall-complete') throw Error('missing hall target');
  const input = { snapshot: frame.snapshot, owner, memory, grants: allocationGrants(memory), queuedTick: null };
  expect(createStrategyCommandGateway({ ...input, managedExpansionSites: [at.at] }).admit([proposal]).admissions[0])
    .toMatchObject({ status: 'rejected', reason: { reason: 'goal-managed-expansion-requires-formal-builder' } });
  expect(createStrategyCommandGateway(input).admit([proposal]).admissions[0]!.status).toBe('accepted');
  if (returned.command.type !== 'build') throw Error('missing build');
  const command = returned.command, snapshot = structuredClone(frame.snapshot);
  const worker = snapshot.units.find(unit => unit.id === command.unitId)!;
  worker.order = { type: 'build', buildingKind: command.buildingKind, x: command.x, y: command.y };
  expect(createStrategyCommandGateway({ ...input, snapshot, managedExpansionSites: [at.at] }).admit([proposal]).admissions[0]!.status).toBe('accepted');
});


it('keeps future capital through method continuation and JSON while excluding it from the parent purchase grant', () => {
  const frame = original('goal-capital-near-1725'), saved = registered(frame);
  const authority = { ...saved.memory, methods: { ...saved.memory.methods, [saved.method.id]: saved.method } };
  const continued = continueGoalMethod(saved.method, JSON.parse(JSON.stringify(authority)));
  expect(continued.spends).toEqual(saved.method.spends);
  const repeat = reserveAllocationSpends({ memory: authority, method: continued, actions: Object.values(authority.executions),
    cashGold: 85, tick: frame.snapshot.tick });
  expect(Object.values(repeat.memory.budgets)).toHaveLength(1);
  expect(reservedAllocationGold(repeat.memory)).toBe(85);
  expect(allocationGrants(repeat.memory).flatMap(grant => grant.budgets)).toEqual([]);
});

it('uses its own saved cash once in world facts and resource opening balances while another goal cannot spend it', () => {
  const frame = original('goal-capital-near-5250'), saved = registered(original('goal-capital-near-1725'));
  const authority = refreshAllocationCapital(saved.memory, 129, frame.snapshot.tick);
  withGoalPlannerInput({ snapshot: frame.snapshot, owner: authority.owner, version: 'v9_knight',
    memory: { ...frame.memoryAfter, strategyAllocation: authority } }, input => {
    const fact = goalFact({ kind: 'gold', minimum: 129, byTick: frame.snapshot.tick });
    const own = input.contextForGoal!(saved.plan.goal), other = input.contextForGoal!({ ...saved.plan.goal, id: 'another-plan' });
    expect(own.context.readFact(fact)).toMatchObject({ state: 'met', quantity: 129 });
    expect(other.context.readFact(fact)).toMatchObject({ state: 'unmet', quantity: 0 });
    expect(own.initialBalances.find(balance => balance.resource.kind === 'gold')!.quantity).toBe(129);
    expect(other.initialBalances.find(balance => balance.resource.kind === 'gold')!.quantity).toBe(0);
    expect(input.work.receipt.used).toBe(0);
  });
});

it('continues the actual prior paid foundation under one spend when the current plan adopts a world-asset identity', () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-authority-paid-build-t15.json.gz', import.meta.url))).toString());
  const authority = restoreGoalAuthorityReferences(fixture.tick.authority as StrategyAllocationMemory);
  const prior = Object.values(authority.methods).find(method => method.kind === 'goal-plan' && method.spends.length)!;
  const spend = prior.spends[0]!, nextId = 'goal-capital:world-asset-current';
  const next = { ...prior, spends: [{ ...spend, spendId: nextId, expectedPaymentTick: fixture.tick.snapshot.tick }],
    actions: prior.actions.map(action => ({ ...action, id: `current:${action.id}`,
      intent: action.intent.kind === 'goal-action' ? readGoalIntent(authority, action.intent) : action.intent,
      spendIds: [nextId] })) };
  const packed = storeGoalMethod(authority, continueGoalMethod(next, JSON.parse(JSON.stringify(authority))));
  const repeated = reserveAllocationSpends({ memory: packed.memory, method: packed.method, actions: Object.values(authority.executions),
    cashGold: fixture.tick.snapshot.players[authority.owner].gold, tick: fixture.tick.snapshot.tick });
  expect(packed.method.actions[0]!.id).toBe(prior.actions[0]!.id);
  expect(packed.method.spends).toHaveLength(1);
  const budget = Object.values(repeated.memory.budgets);
  expect(budget).toHaveLength(1);
  expect([budget[0]!.paidGold, budget[0]!.state]).toEqual([120, 'spent']);
  expect(budget[0]!.nativePayments).toEqual(Object.values(authority.budgets)[0]!.nativePayments);
});


it('registers the original already granted near chain even while the next action has no ready quotation', () => {
  const frame = original('goal-capital-near-3690'), prior = frame.memoryAfter.strategyAllocation!, plan = frame.observation.output.plans[0]!;
  expect(plan.readyActionIds).toEqual([]);
  const registered = reserveAdmittedGoalCapital(prior, [plan], 85, frame.snapshot.tick);
  expect(Object.values(registered.budgets)).toHaveLength(1);
  expect(Object.values(registered.budgets)[0]).toMatchObject({ plannedGold: 400, amountGold: 85, expectedPaymentTick: 6427 });
  expect(Object.keys(registered.executions)).toEqual(Object.keys(prior.executions));
  expect(registered.leases).toEqual(prior.leases);
});


it('returns the formal builder from the original far owner entry and registers an existing near pending chain without extra planning calls', () => {
  for (const name of ['goal-building-324-far-t7470', 'goal-managed-build-far-7485', 'goal-capital-near-1725', 'goal-capital-near-3690']) {
    const frame = original(name), before = JSON.stringify(frame.snapshot), memory = structuredClone(frame.memoryBefore);
    const entries = planAiOwnerCommandEntries(frame.snapshot, { playerId: 'planner', version: 'v9_knight', memory }, { strategyControl: true });
    const budgets = Object.values(memory.strategyAllocation!.budgets);
    expect(budgets).toHaveLength(1);
    if (name.includes('far')) {
      expect(entries).toEqual([{ playerId: 'planner', scriptId: 'goal.build', command: { type: 'build',
        unitId: 'scene-public-planner-frame-planner-worker-1', buildingKind: 'townHall', x: 2832, y: 720 } }]);
      expect(budgets[0]).toMatchObject({ plannedGold: 400, amountGold: 400, paidGold: 0, state: 'reserved' });
      const execution = memory.strategyAllocation!.executions[budgets[0]!.action.actionId]!;
      expect(execution.executor).toBe('goal.build');
      expect(memory.strategyAllocation!.leases['unit:scene-public-planner-frame-planner-worker-1']!.action).toEqual(execution.token);
    } else {
      expect(budgets[0]).toMatchObject({ plannedGold: 400, amountGold: 85, paidGold: 0, state: 'reserved' });
    }
    expect(JSON.stringify(frame.snapshot)).toBe(before);
  }
});
