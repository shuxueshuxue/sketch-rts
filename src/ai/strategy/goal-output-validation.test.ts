import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import type { ActionGrant, ExecutionAction, ExecutorFeedback, ExecutorInput, StrategyAllocationMemory, StrategyExecutor } from './allocation-types';
import { allocationGrants, applyExecutorFeedback } from './allocation-lifecycle';
import { applyAllocationPayments, recordAllocationCommands } from './allocation-ledger';
import { createStrategyCommandGateway } from './command-gateway';
import { createStrategyAllocationMemory } from './control';
import { goalBuildExecutor, goalTrainExecutor } from './executors/goal-economy';
import { withAllocationLandRoutes } from './allocation-arrival-query';
import type { GoalExecutableIntent } from './goal-execution-types';

function fixture(executor: StrategyExecutor, kind: 'train' | 'build', parameters: GoalExecutableIntent['parameters'], outputs: string[], gold: number) {
  const game = sketchScene('central-goal-output-validation').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 3000 })
    .townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 400, 700, { id: 'producer' }).worker('us', 700, 400, { id: 'worker' }).build().createGame();
  game.scriptedVictory = true;
  const token = { actionId: 'atom', generation: 1 }, target = { point: { x: 900, y: 900 } };
  const execution: ExecutionAction = { token, objectiveId: 'goal', methodId: 'plan', executor: executor.id,
    intent: { kind: 'goal-action', actionKind: kind, goalId: 'goal', declarationId: 'declaration', parameters, outputs },
    target, completionEffects: [], dependsOn: [], status: 'ready', phase: 'ready', sinceTick: 0, lastProgressTick: 0, state: {} };
  const objective: ExecutorInput['objective'] = { id: 'goal', owner: 'us', kind: 'ExpandLand', target, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: 0, rank: null, reasons: [], methodIds: ['plan'],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  const method: ExecutorInput['method'] = { id: 'plan', objectiveId: 'goal', kind: 'land-expansion', preconditions: [], subgoals: [],
    demands: [], estimatedTicks: null, status: 'selected', reasons: [] };
  const key = kind === 'train' ? 'queue:producer' as const : 'unit:worker' as const;
  let memory: StrategyAllocationMemory = { ...createStrategyAllocationMemory('us', game.tick), revision: 1,
    executions: { atom: execution }, leases: { [key]: { id: `lease:${key}`, resourceKey: key, objectiveId: 'goal', methodId: 'plan',
      action: token, sinceTick: 0, minimumStayUntilTick: 0, origin: 'allocator' as const, incumbentTask: null } },
    budgets: { capital: { id: 'capital', spendId: 'capital', objectiveId: 'goal', methodId: 'plan', action: token,
      amountGold: gold, paidGold: 0, state: 'reserved', sinceTick: 0, releasedTick: null,
      includedUtilityTermCodes: [], externalReservationIds: [] } } };
  let sequence = 0;
  const input = (): ExecutorInput => ({ snapshot: snapshotGame(game), owner: 'us', objective, method,
    execution: memory.executions.atom!, grant: allocationGrants(memory)[0]!, events: memory.events });
  const apply = (feedback: ExecutorFeedback) => {
    const snapshot = snapshotGame(game);
    memory = applyExecutorFeedback(memory, snapshot, feedback);
    const gateway = createStrategyCommandGateway({ snapshot, owner: 'us', memory, grants: allocationGrants(memory), queuedTick: null });
    const admitted = gateway.admit(feedback.commands.map(entry => ({ id: `command:${sequence++}`, source: 'executor', executor: executor.id,
      action: token, allocationRevision: memory.revision, purpose: entry.purpose, command: entry.command })));
    expect(admitted.admissions.every(admission => admission.status === 'accepted')).toBe(true);
    memory = recordAllocationCommands(memory, snapshot, admitted.admissions);
    issueCommandFrame(game, admitted.accepted.map(entry => ({ playerId: 'us', scriptId: entry.executor, command: entry.command })));
  };
  const think = () => {
    const request = input();
    const feedback = withAllocationLandRoutes((from, to) => ({ status: 'known', distance: Math.hypot(to.x - from.x, to.y - from.y), points: [to] }),
      () => executor.execute(request));
    apply(feedback); return feedback;
  };
  return { game, input, apply, think, get memory() { return memory; }, restore() { memory = JSON.parse(JSON.stringify(memory)); } };
}

it('validates two actual native births, publishes ACKs centrally, and pays distinct equal jobs exactly once', () => {
  const cost = UNIT_DEFS.footman.cost;
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 2 }, ['unit-0', 'unit-1'], cost * 2);
  const payments: NonNullable<ExecutorFeedback['payments']>[number][] = [];
  for (let frame = 0; frame < 100 && f.memory.executions.atom!.status !== 'complete'; frame++) {
    const previous = f.memory, saved = JSON.stringify(previous);
    const result = f.think(); payments.push(...result.payments ?? []);
    expect(JSON.stringify(previous)).toBe(saved);
    f.restore();
    for (let tick = 0; tick < 15; tick++) stepGame(f.game);
  }
  expect(f.memory.executions.atom!.status).toBe('complete');
  const bindings = f.memory.executions.atom!.state.goalOutputBindings as Record<string, string>;
  expect(Object.keys(bindings)).toEqual(['unit-0', 'unit-1']); expect(new Set(Object.values(bindings)).size).toBe(2);
  for (const id of Object.values(bindings)) expect(f.game.units.find(unit => unit.id === id)).toMatchObject({ owner: 'us', kind: 'footman' });
  expect(payments).toHaveLength(2);
  expect(f.memory.budgets.capital).toMatchObject({ paidGold: 2 * cost, state: 'spent' });
  expect(f.memory.budgets.capital!.nativePayments).toHaveLength(2);
  expect(f.game.players.us!.gold).toBe(3000 - 2 * cost);
  const replay = applyAllocationPayments(f.memory, snapshotGame(f.game), f.memory.executions.atom!.token, payments);
  expect(replay.budgets).toEqual(f.memory.budgets);
  expect(() => applyAllocationPayments(f.memory, snapshotGame(f.game), f.memory.executions.atom!.token,
    [{ ...payments[0]!, amountGold: cost + 1 }])).toThrow('changed after acknowledgement');
});

it('does not bind one of two observed births even when the adapter nominates a valid-kind real entity', () => {
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 1 }, ['unit-0'], UNIT_DEFS.footman.cost);
  f.think(); f.think();
  const job = f.game.buildings.find(building => building.id === 'producer')!.queue[0]!;
  const command = Object.values(f.memory.issuedCommands)[0]!;
  for (let tick = 0; tick < UNIT_DEFS.footman.trainTime + 1; tick++) stepGame(f.game);
  const other = f.game.spawnUnit('us', 'footman', 900, 900);
  const feedback = goalTrainExecutor.execute(f.input());
  f.apply({ ...feedback, status: 'complete', commands: [], goalOutputs: [{ output: 'unit-0', entityId: other.id,
    observedTick: f.game.tick, proof: { kind: 'birth', acceptedCommandId: command.id, producerId: 'producer', jobId: job.id! } }] });
  expect(f.memory.executions.atom).toMatchObject({ status: 'active', phase: 'await-output-validation', state: { goalOutputBindings: {} } });
});

it('rejects adapter-supplied bindings and completion without an admitted native job/birth', () => {
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 1 }, ['unit-0'], UNIT_DEFS.footman.cost);
  const legitimate = goalTrainExecutor.execute(f.input());
  f.apply({ ...legitimate, commands: [], status: 'complete', state: { goalOutputBindings: { 'unit-0': 'worker' } },
    goalOutputs: [{ output: 'unit-0', entityId: 'worker', observedTick: f.game.tick,
      proof: { kind: 'birth', acceptedCommandId: 'fake', jobId: 'fake', producerId: 'producer' } }] });
  expect(f.memory.executions.atom).toMatchObject({ status: 'active', phase: 'await-output-validation', state: { goalOutputBindings: {} } });
  expect(f.game.players.us!.gold).toBe(3000);
});

it('binds only a paid exact native foundation and keeps completion gated by real construction', () => {
  const point = { x: 900, y: 900 }, at = { point };
  const f = fixture(goalBuildExecutor, 'build', { buildingKind: 'farm', worker: { kind: 'existing', entityId: 'worker' },
    at, approach: at, foundationId: null }, ['building'], BUILDING_DEFS.farm.cost);
  const actual = snapToFootprint(f.game.map, BUILDING_DEFS.farm.radius, point);
  expect(actual).toEqual(point);
  let published = false;
  for (let frame = 0; frame < 140 && f.memory.executions.atom!.status !== 'complete'; frame++) {
    f.think(); f.restore();
    const bindings = f.memory.executions.atom!.state.goalOutputBindings as Record<string, string>;
    if (bindings.building) { published = true; expect(f.game.buildings.find(building => building.id === bindings.building)).toMatchObject({ owner: 'us', kind: 'farm' }); }
    for (let tick = 0; tick < 15; tick++) stepGame(f.game);
  }
  expect(published).toBe(true); expect(f.memory.executions.atom!.status).toBe('complete');
  expect(f.memory.budgets.capital!.paidGold).toBe(BUILDING_DEFS.farm.cost);
  expect(f.memory.budgets.capital!.nativePayments).toHaveLength(1);
});
