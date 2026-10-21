import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { restoreGoalAuthorityReferences, readGoalIntent } from './goal-authority-references';
import { reconcileGoalCapitalReceipts } from './goal-capital-receipts';
import { reconcileGoalWorldExecutions } from './goal-world-receipts';
import { withGoalPlannerInput } from './goal-planner-input';
import { goalFact } from './goal-facts';
import { settleCommittedGoals } from './goal-commitment-objectives';
import { collectGoalRequests } from './goal-requests';
import { readGoalObjective } from './goal-authority-references';
import type { StrategyAllocationMemory } from './allocation-types';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { planAiOwnerCommandEntries } from '../planner-context';
import type { BootstrapStrategyOutput } from './bootstrap-control';

function frame(prefix: 'world' | 'capital', name: string) {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/goal-${prefix}-597-${name}.json.gz`, import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memoryBefore: AiPolicyMemory;
  };
}
function observe(original: ReturnType<typeof frame>) {
  const memory = structuredClone(original.memoryBefore);
  memory.strategyAllocation = reconcileGoalCapitalReceipts(restoreGoalAuthorityReferences(memory.strategyAllocation!), original.snapshot);
  return withGoalPlannerInput({ snapshot: original.snapshot, owner: 'planner', version: 'v9_knight', memory, goals: [] },
    input => reconcileGoalWorldExecutions(memory.strategyAllocation!, input.context));
}
function workers(authority: StrategyAllocationMemory) {
  return Object.values(authority.executions).filter(execution => execution.intent.kind === 'goal-action' && execution.intent.actionKind === 'transport-worker');
}

it.each([['world', 'near-5025'], ['world', 'far-7140']] as const)('records actual cargo without claiming delivery: %s/%s', (prefix, name) => {
  const original = frame(prefix, name), before = JSON.stringify(original), next = observe(original);
  const active = workers(next).filter(execution => !['complete', 'failed', 'abandoned'].includes(execution.status));
  expect(active.length).toBeGreaterThan(0);
  expect(active.every(execution => Array.isArray(execution.state.goalLoadedIds)
    && execution.state.goalLoadedIds.includes('scene-public-planner-frame-planner-worker-1'))).toBe(true);
  expect(active.every(execution => (execution.state.goalLandedIds as unknown[]).length === 0)).toBe(true);
  expect(JSON.stringify(original)).toBe(before);
});

it.each([['capital', 'near-6150'], ['world', 'far-7680']] as const)('settles actual target-land delivery for every admitted generation: %s/%s', (prefix, name) => {
  const original = frame(prefix, name), before = JSON.stringify(original), next = observe(original);
  const settled = workers(next).filter(execution => execution.status !== 'failed' && execution.status !== 'abandoned');
  expect(settled.length).toBeGreaterThan(0);
  for (const execution of settled) {
    expect(execution).toMatchObject({ status: 'complete', phase: 'delivered',
      state: { goalLandedIds: ['scene-public-planner-frame-planner-worker-1'] } });
    expect(next.events).toContainEqual(expect.objectContaining({ kind: 'action-finished', outcome: 'complete', action: execution.token,
      reason: { code: 'observed-goal-world-effect', factIds: ['scene-public-planner-frame-planner-worker-1'], values: { actionKind: 'transport-worker' } } }));
  }
  const memory = structuredClone(original.memoryBefore); memory.strategyAllocation = JSON.parse(JSON.stringify(next));
  withGoalPlannerInput({ snapshot: original.snapshot, owner: 'planner', version: 'v9_knight', memory, goals: [] }, input => {
    expect(reconcileGoalWorldExecutions(memory.strategyAllocation!, input.context)).toEqual(next);
  });
  const absent = { ...original, snapshot: { ...original.snapshot,
    units: original.snapshot.units.filter(unit => unit.id !== 'scene-public-planner-frame-planner-worker-1') } };
  expect(workers(observe(absent)).some(execution => execution.status === 'blocked' || execution.status === 'active')).toBe(true);
  expect(JSON.stringify(original)).toBe(before);
});

it('settles both the paid original build and same-foundation repair from the actual completed hall', () => {
  const original = frame('capital', 'near-6840'), next = observe(original);
  const hall = original.snapshot.buildings.find(building => building.kind === 'townHall' && building.x === 2832 && building.y === 720)!;
  const matching = Object.values(next.executions).filter(execution => execution.intent.kind === 'goal-action'
    && execution.intent.actionKind === 'build' && (() => {
      const p = readGoalIntent(next, execution.intent).parameters;
      return p.foundationId === hall.id || (execution.state.goalOutputBindings as { building?: string } | undefined)?.building === hall.id;
    })());
  expect(matching.length).toBeGreaterThanOrEqual(2);
  expect(matching.every(execution => execution.status === 'complete')).toBe(true);
  const budget = Object.values(next.budgets).find(budget => budget.plannedGold === 400)!;
  expect(budget.paidGold).toBe(400); expect(budget.nativePayments).toHaveLength(1);
  const foundation = observe(frame('capital', 'near-6285'));
  expect(Object.values(foundation.executions).some(execution => execution.intent.kind === 'goal-action'
    && execution.intent.actionKind === 'build' && execution.status !== 'complete')).toBe(true);
});

it('does not settle the original8040 parent from a completed static tower and idle soldiers', () => {
  const original = frame('world', 'near-8040'), memory = structuredClone(original.memoryBefore);
  memory.strategyAllocation = restoreGoalAuthorityReferences(memory.strategyAllocation!);
  const authority = memory.strategyAllocation, before = JSON.stringify(original.snapshot);
  withGoalPlannerInput({ snapshot: original.snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
    const mine = { entityId: 'resource-1', landId: 'land:2', point: { x: 2976, y: 896 } } as const;
    const guard = input.context.readFact(goalFact({ kind: 'garrison-ready', mineId: 'resource-1', at: mine, throughTick: 12001 }));
    expect(guard).toMatchObject({ state: 'unmet', reason: { code: 'formal-garrison-hold-required' } });
    const definition = readGoalObjective(authority, 'ConquerIsland:planner:resource-1')!;
    expect(definition).toBeDefined();
    const requests = collectGoalRequests([definition], input.context);
    expect(requests[0]!.effects.some(fact => fact.predicate.kind === 'garrison-ready')).toBe(true);
    // The normal planning reader already denies the false world proof. Even a
    // stale complete plan cannot release this parent without its hold receipt.
    const result = settleCommittedGoals(authority, [{ id: 'stale-plan', goal: requests[0]!, status: 'complete',
      facts: requests[0]!.effects.map(fact => ({ id: fact.id, observation: fact.predicate.kind === 'garrison-ready' ? guard
        : input.context.readFact(fact), producerActionIds: [] })) } as never], [], original.snapshot.tick);
    expect(result.objectives[definition.id]!.status).not.toBe('complete');
  });
  expect(JSON.stringify(original.snapshot)).toBe(before);
});

it('starts and retains native formal holds from the original completed-hall world in a separate continuation', () => {
  const original = frame('capital', 'near-6840'), unchanged = JSON.stringify(original);
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, original.snapshot, 100000);
  let memory = structuredClone(original.memoryBefore), token = '', formalHolds = 0, through = 0;
  for (let think = 0; think < 3; think++) {
    const snapshot = snapshotGame(game); let output: BootstrapStrategyOutput | undefined;
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'planner', version: 'v9_knight', memory }, { strategyControl: true,
      observeBootstrapPlan(_context, _entries, observed) { output = observed; } });
    const authority = memory.strategyAllocation!;
    const held = Object.values(authority.executions).filter(execution => execution.intent.kind === 'goal-action'
      && execution.intent.actionKind === 'hold-position' && execution.status === 'active');
    expect(held).toHaveLength(1);
    const hold = held[0]!, intent = hold.intent;
    if (intent.kind !== 'goal-action') throw Error('hold identity');
    const p = readGoalIntent(authority, intent).parameters;
    if (think === 0) { token = JSON.stringify(hold.token); through = p.throughTick as number; }
    expect(JSON.stringify(hold.token)).toBe(token); expect(p.throughTick).toBe(through);
    expect(through).toBe(12015); expect(p.protectionWindowTicks).toBe(2400);
    expect(authority.objectives[hold.objectiveId]!.status).toBe('active');
    const commands = entries.filter(entry => entry.scriptId === 'goal.hold-position' && entry.command.type === 'holdPosition');
    formalHolds += commands.length;
    if (think === 0) expect(commands).toHaveLength(4);
    else {
      expect(commands).toHaveLength(0);
      expect(hold.state.goalProtectionCheckedTick).toBe(snapshot.tick);
      expect(hold.state.goalProtectionCheckedThrough).toBe(snapshot.tick + 2400);
      expect(output!.goalPlanner!.plans.find(plan => plan.goal.id === hold.objectiveId)!.status).not.toBe('complete');
    }
    expect(entries.some(entry => entry.command.type === 'build' && entry.command.buildingKind === 'townHall')).toBe(false);
    const budget = Object.values(authority.budgets).find(budget => budget.plannedGold === 400)!;
    expect(budget.paidGold).toBe(400); expect(budget.nativePayments).toHaveLength(1);
    issueCommandFrame(game, entries);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(formalHolds).toBe(4);
  expect(JSON.stringify(original)).toBe(unchanged);
});
