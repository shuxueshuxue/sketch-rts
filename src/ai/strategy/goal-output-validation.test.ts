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
import { observeGoalTraining, goalTrainingReader } from './goal-training-ledger';
import { landIdAt, regionIndex } from './regions';

function fixture(executor: StrategyExecutor, kind: 'train' | 'build', parameters: GoalExecutableIntent['parameters'], outputs: string[], gold: number) {
  const game = sketchScene('central-goal-output-validation').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 3000 })
    .townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 400, 700, { id: 'producer' }).building('us', 'barracks', 800, 700, { id: 'other-producer' }).worker('us', 700, 400, { id: 'worker' }).build().createGame();
  game.scriptedVictory = true; regionIndex(game.map);
  if (kind === 'train') parameters = { ...parameters, at: { point: { x: 400, y: 700 }, landId: landIdAt(game.map, { x: 400, y: 700 })! } };
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
  const input = (actionId = 'atom'): ExecutorInput => {
    const snapshot = snapshotGame(game); memory = observeGoalTraining(memory, snapshot);
    return { snapshot, owner: 'us', objective, method, execution: memory.executions[actionId]!,
      grant: allocationGrants(memory).find(grant => grant.action.actionId === actionId)!, events: memory.events, goalTraining: goalTrainingReader(memory, snapshot) };
  };
  const apply = (feedback: ExecutorFeedback) => {
    const snapshot = snapshotGame(game);
    memory = applyExecutorFeedback(memory, snapshot, feedback);
    const gateway = createStrategyCommandGateway({ snapshot, owner: 'us', memory, grants: allocationGrants(memory), queuedTick: null });
    const admitted = gateway.admit(feedback.commands.map(entry => ({ id: `command:${sequence++}`, source: 'executor', executor: executor.id,
      action: feedback.action, allocationRevision: memory.revision, purpose: entry.purpose, command: entry.command })));
    expect(admitted.admissions.every(admission => admission.status === 'accepted')).toBe(true);
    memory = recordAllocationCommands(memory, snapshot, admitted.admissions);
    issueCommandFrame(game, admitted.accepted.map(entry => ({ playerId: 'us', scriptId: entry.executor, command: entry.command })));
  };
  const think = (actionId = 'atom') => {
    const request = input(actionId);
    const feedback = withAllocationLandRoutes((from, to) => ({ status: 'known', distance: Math.hypot(to.x - from.x, to.y - from.y), points: [to] }),
      () => executor.execute(request));
    apply(feedback); return feedback;
  };
  const addTraining = () => {
    const action = { actionId: 'other-atom', generation: 2 }, original = memory.executions.atom!;
    if (original.intent.kind !== 'goal-action') throw Error('Missing goal intent');
    const next: ExecutionAction = { ...original, token: action, status: 'ready', state: {}, intent: { ...original.intent,
      parameters: { ...original.intent.parameters, count: 1, producer: { kind: 'existing', entityId: 'other-producer' } } } };
    memory = { ...memory, executions: { ...memory.executions, 'other-atom': next },
      leases: { ...memory.leases, 'queue:other-producer': { ...memory.leases['queue:producer']!, id: 'lease:other', resourceKey: 'queue:other-producer', action } },
      budgets: { ...memory.budgets, 'other-capital': { ...memory.budgets.capital!, id: 'other-capital', spendId: 'other-capital', action,
        amountGold: UNIT_DEFS.footman.cost, paidGold: 0, state: 'reserved' } } };
  };
  return { game, input, apply, think, addTraining, get memory() { return memory; }, restore() { memory = JSON.parse(JSON.stringify(memory)); } };
}

it('settles two native jobs into quantities without entity output slots and pays equal jobs exactly once', () => {
  const cost = UNIT_DEFS.footman.cost;
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 2 }, [], cost * 2);
  const payments: NonNullable<ExecutorFeedback['payments']>[number][] = [];
  for (let frame = 0; frame < 100 && f.memory.executions.atom!.status !== 'complete'; frame++) {
    const previous = f.memory, saved = JSON.stringify(previous);
    const result = f.think(); payments.push(...result.payments ?? []);
    expect(JSON.stringify(previous)).toBe(saved);
    f.restore();
    for (let tick = 0; tick < 15; tick++) stepGame(f.game);
  }
  expect(f.memory.executions.atom!.status).toBe('complete');
  expect(f.memory.executions.atom!.state.goalOutputBindings).toBeUndefined();
  expect(f.memory.goalTraining!.jobs.map(job => job.state)).toEqual(['fulfilled', 'fulfilled']);
  expect(f.game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman')).toHaveLength(2);
  expect(payments).toHaveLength(2);
  expect(f.memory.budgets.capital).toMatchObject({ paidGold: 2 * cost, state: 'spent' });
  expect(f.memory.budgets.capital!.nativePayments).toHaveLength(2);
  expect(f.game.players.us!.gold).toBe(3000 - 2 * cost);
  const replay = applyAllocationPayments(f.memory, snapshotGame(f.game), f.memory.executions.atom!.token, payments);
  expect(replay.budgets).toEqual(f.memory.budgets);
  expect(() => applyAllocationPayments(f.memory, snapshotGame(f.game), f.memory.executions.atom!.token,
    [{ ...payments[0]!, amountGold: cost + 1 }])).toThrow('changed after acknowledgement');
});

it('permanently withdraws a cancelled job when another producer supplies the only new unit', () => {
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 1 }, [], UNIT_DEFS.footman.cost);
  f.think(); f.think();
  const ownJob = f.game.buildings.find(building => building.id === 'producer')!.queue[0]!;
  const command = Object.values(f.memory.issuedCommands)[0]!;
  issueCommandFrame(f.game, [
    { playerId: 'us', scriptId: 'cancel-native', command: { type: 'cancelTraining', buildingId: 'producer', jobId: ownJob.id! } },
    { playerId: 'us', scriptId: 'other-native', command: { type: 'train', buildingId: 'other-producer', unitKind: 'footman' } },
  ]);
  for (let tick = 0; tick < 15; tick++) stepGame(f.game);
  f.think();
  expect(f.memory.executions.atom!.status).toBe('failed');
  for (let frame = 0; frame < 25; frame++) {
    for (let tick = 0; tick < 15; tick++) stepGame(f.game);
    const observation = f.input().goalTraining!({ acceptedCommandId: command.id, producerId: 'producer', jobId: ownJob.id!, unitKind: 'footman' });
    expect(observation).toMatchObject({ state: 'cancelled', creditedQuantity: 0 });
    f.restore();
  }
  expect(f.game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman')).toHaveLength(1);
  expect(f.memory.executions.atom!.state.goalOutputBindings).toBeUndefined();
});

it('credits two simultaneous same-kind producers against the shared pool exactly once', () => {
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 1 }, [], UNIT_DEFS.footman.cost);
  f.addTraining(); f.think(); f.think('other-atom'); f.think(); f.think('other-atom');
  for (let frame = 0; frame < 40 && Object.values(f.memory.executions).some(action => action.status !== 'complete'); frame++) {
    for (let tick = 0; tick < 15; tick++) stepGame(f.game);
    if (f.memory.executions.atom!.status !== 'complete') f.think();
    if (f.memory.executions['other-atom']!.status !== 'complete') f.think('other-atom');
    f.restore();
  }
  expect(Object.values(f.memory.executions).map(action => action.status)).toEqual(['complete', 'complete']);
  expect(f.memory.goalTraining!.jobs.filter(job => job.state === 'fulfilled')).toHaveLength(2);
  expect(f.memory.goalTraining!.pools[0]).toMatchObject({ credited: 2, count: 2 });
  expect(f.game.players.us!.gold).toBe(3000 - 2 * UNIT_DEFS.footman.cost);
});

it('rejects adapter-supplied unit bindings and completion without central quantity credits', () => {
  const f = fixture(goalTrainExecutor, 'train', { producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman', count: 1 }, [], UNIT_DEFS.footman.cost);
  const legitimate = goalTrainExecutor.execute(f.input());
  f.apply({ ...legitimate, commands: [], status: 'complete', state: { goalOutputBindings: { 'unit-0': 'worker' } },
    goalOutputs: [{ output: 'unit-0', entityId: 'worker', observedTick: f.game.tick,
      proof: { kind: 'foundation', acceptedCommandId: 'fake' } }] });
  expect(f.memory.executions.atom).toMatchObject({ status: 'active', phase: 'await-pool-quantity' });
  expect(f.memory.executions.atom!.state.goalOutputBindings).toBeUndefined();
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

it.each(['unknown', 'unreachable'] as const)('preserves paid foundation receipts while the construction route is %s', status => {
  const at = { point: { x: 900, y: 900 } }, cost = BUILDING_DEFS.farm.cost;
  const f = fixture(goalBuildExecutor, 'build', { buildingKind: 'farm', worker: { kind: 'existing', entityId: 'worker' },
    at, approach: at, foundationId: null }, ['building'], cost);
  const first = f.think();
  expect(first.commands).toHaveLength(1);
  expect(Object.values(f.memory.issuedCommands)).toHaveLength(1);
  let foundation = f.game.buildings.find(building => building.kind === 'farm');
  for (let tick = 0; tick < 1200 && !foundation; tick++) {
    stepGame(f.game);
    foundation = f.game.buildings.find(building => building.kind === 'farm');
  }
  expect(foundation).toMatchObject({ owner: 'us', kind: 'farm', complete: false, x: at.point.x, y: at.point.y });
  expect(f.game.players.us!.gold).toBe(3000 - cost);
  expect(f.memory.budgets.capital!.paidGold).toBe(0);
  f.restore();
  const input = f.input(), before = JSON.stringify(input);
  const feedback = withAllocationLandRoutes(() => ({ status, reasonCode: 'construction-route-not-published' }),
    () => goalBuildExecutor.execute(input));
  expect(JSON.stringify(input)).toBe(before);
  expect(feedback).toMatchObject({ status: 'blocked', commands: [],
    reasons: [{ reason: status === 'unreachable' ? 'goal-building-route-unreachable' : 'goal-building-route-pending' }] });
  const acceptedCommandId = Object.values(f.memory.issuedCommands)[0]!.id;
  expect(feedback.payments).toEqual([{ budgetId: 'capital', amountGold: cost,
    proof: { kind: 'foundation', buildingId: foundation!.id, acceptedCommandId } }]);
  expect(feedback.goalOutputs).toEqual([{ output: 'building', entityId: foundation!.id, observedTick: f.game.tick,
    proof: { kind: 'foundation', acceptedCommandId } }]);
  f.apply(feedback);
  expect(f.memory.executions.atom).toMatchObject({ status: 'blocked', state: { goalOutputBindings: { building: foundation!.id } } });
  expect(f.memory.budgets.capital).toMatchObject({ paidGold: cost, state: 'spent' });
  expect(f.memory.budgets.capital!.nativePayments).toHaveLength(1);
  const replay = applyAllocationPayments(f.memory, snapshotGame(f.game), f.memory.executions.atom!.token, feedback.payments!);
  expect(replay.budgets).toEqual(f.memory.budgets);
  expect(f.game.players.us!.gold).toBe(3000 - cost);
  expect(Object.values(f.memory.issuedCommands)).toHaveLength(1);
});
