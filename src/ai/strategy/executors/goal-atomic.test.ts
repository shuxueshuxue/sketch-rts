import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { BUILDING_DEFS, UNIT_DEFS } from '../../../shared/catalog';
import { withNavigationAudit, withNavigationPhase } from '../../../shared/navigation-audit';
import { snapshotGame, stepGame, type Game } from '../../../shared/sim';
import { snapToFootprint } from '../../../shared/terrain';
import type { GameSnapshot } from '../../../shared/types';
import { createAiPolicyMemory } from '../../memory';
import { withAllocationLandRoutes, type AllocationLandRouteReader } from '../allocation-arrival-query';
import type { ExclusiveResourceKey, ExecutorFeedback, ExecutorInput, StrategyExecutor } from '../allocation-types';
import { buildObservedStrategyDecision } from '../decision';
import { FactWorkQueue } from '../fact-work';
import { readGoalEconomicFact } from '../goal-economy-facts';
import { readGoalLandCapabilityFact } from '../goal-land-facts';
import type { GoalExecutableIntent } from '../goal-execution-types';
import { createGoalGeometryReader } from '../goal-geometry-source';
import type { GoalPlanningContext } from '../goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from '../regions';
import { goalBuildExecutor, goalTrainExecutor, goalWaitIncomeExecutor } from './goal-economy';
import { goalDestroyTargetExecutor, goalEngageUnitsExecutor, goalHoldPositionExecutor } from './goal-land';

const ref = (entityId: string) => ({ kind: 'existing' as const, entityId });
function nativeGame() {
  const game = sketchScene('goal-executors-native-orders').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'blue' }).player('ally', { team: 'blue' }).player('foe', { team: 'red' })
    .playerState('us', { gold: 3000 }).townHall('us', 400, 400, { id: 'hall' }).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 400, 700, { id: 'producer' }).worker('us', 700, 400, { id: 'worker' })
    .unit('us', 'footman', 1300, 600, { id: 'fighter' }).unit('ally', 'footman', 1500, 600, { id: 'ally' })
    .unit('foe', 'footman', 1380, 600, { id: 'target', hp: 1 }).build().createGame();
  game.scriptedVictory = true; return game;
}
function request(game: Game, executor: StrategyExecutor, actionKind: GoalExecutableIntent['actionKind'],
  parameters: GoalExecutableIntent['parameters'], resources: ExclusiveResourceKey[], gold = 0, outputs: string[] = []): ExecutorInput {
  const snapshot = snapshotGame(game); regionIndex(snapshot.map);
  const objectiveId = 'goal', methodId = 'plan', token = { actionId: 'atomic-action', generation: 1 };
  const target = { point: { x: 900, y: 900 } };
  return { snapshot, owner: 'us', objective: { id: objectiveId, owner: 'us', kind: 'ExpandLand', target, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: 0, rank: 1, reasons: [], methodIds: [methodId],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } },
  method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'selected', reasons: [] },
  execution: { token, objectiveId, methodId, executor: executor.id, intent: { kind: 'goal-action', goalId: objectiveId,
    declarationId: 'declared-atom', actionKind, parameters, outputs }, target, dependsOn: [], completionEffects: [], status: 'active',
  phase: 'ready', sinceTick: 0, lastProgressTick: 0, state: {} },
  grant: { revision: 1, action: token, objectiveId, methodId, assignments: [], budgets: gold ? [{ id: 'capital', spendId: 'declared-capital',
    objectiveId, methodId, action: token, amountGold: gold, paidGold: 0, state: 'reserved', sinceTick: 0, releasedTick: null,
    includedUtilityTermCodes: [], externalReservationIds: [] }] : [], voyages: [], orders: [], commands: [], orderOverrides: [],
  leases: resources.map(resourceKey => ({ id: `lease:${resourceKey}`, resourceKey, objectiveId, methodId, action: token,
    sinceTick: 0, minimumStayUntilTick: 0, origin: 'allocator', incumbentTask: null })) }, events: [] };
}
const known: AllocationLandRouteReader = (from, goal) => ({ status: 'known', distance: Math.hypot(goal.x - from.x, goal.y - from.y), points: [goal] });
const unknown: AllocationLandRouteReader = () => ({ status: 'unknown', reasonCode: 'shared-route-pending' });
function execute(executor: StrategyExecutor, input: ExecutorInput, route = known) {
  regionIndex(input.snapshot.map);
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(`Unbudgeted native ${event.operation}`);
  }, () => withNavigationPhase('strategy-planning', () => withAllocationLandRoutes(route, () => executor.execute(input))));
}
function apply(game: Game, input: ExecutorInput, feedback: ExecutorFeedback): ExecutorInput {
  const commands = [...input.grant.commands];
  for (const entry of feedback.commands) {
    const command = entry.command, before = snapshotGame(game);
    const worldBefore = command.type === 'train' ? { kind: 'production' as const, buildingId: command.buildingId,
      jobs: before.buildings.find(building => building.id === command.buildingId)!.queue.map(job => ({ id: job.id ?? null, unitKind: 'unitKind' in job ? job.unitKind : null })) }
      : command.type === 'build' ? { kind: 'construction' as const, buildingIds: before.buildings.map(building => building.id) } : undefined;
    issueCommandFrame(game, [{ command, playerId: 'us', scriptId: input.execution.executor }]);
    commands.push({ id: `actual-sdk-admission:${commands.length}`, action: input.execution.token, executor: input.execution.executor,
      purpose: entry.purpose, acceptedTick: game.tick, command, ...(worldBefore ? { worldBefore } : {}) });
  }
  const paid = (feedback.payments ?? []).reduce((sum, payment) => sum + payment.amountGold, 0);
  return { ...input, snapshot: snapshotGame(game), execution: { ...input.execution, state: feedback.state, phase: feedback.phase },
    grant: { ...input.grant, commands, budgets: input.grant.budgets.map(budget => ({ ...budget,
      paidGold: budget.paidGold + paid, state: budget.paidGold + paid >= budget.amountGold ? 'spent' : budget.state })) } };
}

describe('declarative economy and land executors at the existing command boundary', () => {
  it('requires the exact queue and capital, then proposes a real native job/birth without guessing an output identity', () => {
    const game = nativeGame(); let input = request(game, goalTrainExecutor, 'train', { unitKind: 'footman', count: 1,
      producer: ref('producer') }, ['queue:producer'], UNIT_DEFS.footman.cost, ['unit-0']);
    expect(execute(goalTrainExecutor, { ...input, grant: { ...input.grant, leases: [] } }).commands).toEqual([]);
    expect(execute(goalTrainExecutor, { ...input, grant: { ...input.grant, budgets: [] } }).commands).toEqual([]);
    const first = execute(goalTrainExecutor, input); expect(first.commands).toHaveLength(1); expect(first.goalOutputs).toEqual([]);
    input = apply(game, input, first);
    let result = execute(goalTrainExecutor, input); expect(result.phase).toBe('training'); expect(result.payments).toHaveLength(1);
    expect(result.goalOutputs).toEqual([]); input = apply(game, input, result);
    expect(execute(goalTrainExecutor, JSON.parse(JSON.stringify(input)))).toEqual(execute(goalTrainExecutor, input));
    for (let tick = 0; tick < 1000 && result.status !== 'complete'; tick += 15) {
      for (let i = 0; i < 15; i++) stepGame(game);
      input = { ...input, snapshot: snapshotGame(game) }; result = execute(goalTrainExecutor, input); input = apply(game, input, result);
    }
    expect(result.status).toBe('complete'); expect(input.grant.commands).toHaveLength(1);
    const output = result.goalOutputs![0]!;
    expect(output.proof).toMatchObject({ kind: 'birth', producerId: 'producer', acceptedCommandId: 'actual-sdk-admission:0' });
    expect(game.units.find(unit => unit.id === output.entityId)).toMatchObject({ kind: 'footman', owner: 'us' });
    expect(game.players.us!.gold).toBe(3000 - UNIT_DEFS.footman.cost);
    // This is a proposal. The common lifecycle, not this adapter test, owns
    // publication of the world binding after validating the command baseline.
  });

  it('does not adopt a cancelled job or spend another queue, and serializes a multi-unit request', () => {
    const game = nativeGame(); let input = request(game, goalTrainExecutor, 'train', { unitKind: 'footman', count: 2,
      producer: ref('producer') }, ['queue:producer'], UNIT_DEFS.footman.cost * 2, ['unit-0', 'unit-1']);
    const first = execute(goalTrainExecutor, input); expect(first.commands).toHaveLength(1);
    input = apply(game, input, first); const running = execute(goalTrainExecutor, input); input = apply(game, input, running);
    const job = game.buildings.find(building => building.id === 'producer')!.queue[0]!;
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'native-cancel-test', command: { type: 'cancelTraining', buildingId: 'producer', jobId: job.id! } }]);
    input = { ...input, snapshot: snapshotGame(game) };
    const cancelled = execute(goalTrainExecutor, input);
    expect(cancelled.commands).toEqual([]); expect(cancelled.goalOutputs ?? []).toEqual([]);
    expect(cancelled.reasons[0]!.reason).toBe('goal-training-job-ended-early');
  });

  it('proposes separate same-price payments for two real jobs in one batch, advancing only after an output ACK', () => {
    const game = nativeGame(); let input = request(game, goalTrainExecutor, 'train', { unitKind: 'footman', count: 2,
      producer: ref('producer') }, ['queue:producer'], UNIT_DEFS.footman.cost * 2, ['unit-0', 'unit-1']);
    const payments: NonNullable<ExecutorFeedback['payments']>[number][] = [];
    const bindings: Record<string, string> = {};
    let result = execute(goalTrainExecutor, input), pausedForAck = false;
    for (let turn = 0; turn < 200; turn++) {
      payments.push(...(result.payments ?? []));
      input = apply(game, input, result);
      for (const output of result.goalOutputs ?? []) {
        expect(game.units.find(unit => unit.id === output.entityId)).toMatchObject({ owner: 'us', kind: 'footman' });
        expect(input.grant.commands.some(command => command.id === output.proof.acceptedCommandId && command.command.type === 'train')).toBe(true);
        if (output.output === 'unit-0' && !bindings[output.output]) {
          const waiting = execute(goalTrainExecutor, input);
          expect(waiting).toMatchObject({ status: 'active', phase: 'await-output-validation', commands: [] });
          pausedForAck = true;
        }
        // Explicit consumer ACK models the shared interface only. The central
        // proof validator must independently derive this from native evidence;
        // this test does not accept feedback state as its own proof.
        bindings[output.output] = output.entityId;
      }
      input = { ...input, execution: { ...input.execution, state: { ...input.execution.state, goalOutputBindings: { ...bindings } } } };
      if (result.status === 'complete') break;
      for (let tick = 0; tick < 15; tick++) stepGame(game);
      input = { ...input, snapshot: snapshotGame(game) }; result = execute(goalTrainExecutor, input);
    }
    expect(result.status).toBe('complete'); expect(pausedForAck).toBe(true);
    expect(input.grant.commands).toHaveLength(2);
    expect(payments.map(payment => payment.amountGold)).toEqual([UNIT_DEFS.footman.cost, UNIT_DEFS.footman.cost]);
    expect(new Set(payments.map(payment => payment.proof.acceptedCommandId)).size).toBe(2);
    expect(new Set(payments.map(payment => payment.proof.kind === 'production' ? payment.proof.jobId : null)).size).toBe(2);
    expect(Object.keys(bindings).sort()).toEqual(['unit-0', 'unit-1']);
    expect(new Set(Object.values(bindings)).size).toBe(2);
    expect(input.grant.budgets[0]!.paidGold).toBe(2 * UNIT_DEFS.footman.cost);
    expect(game.players.us!.gold).toBe(3000 - 2 * UNIT_DEFS.footman.cost);
  });

  it('builds one exact native site, pays at the observed foundation and proposes only that actual output', () => {
    const game = nativeGame(), point = snapToFootprint(game.map, BUILDING_DEFS.farm.radius, { x: 900, y: 900 });
    const at = { point, landId: landIdAt(game.map, point)! };
    let input = request(game, goalBuildExecutor, 'build', { buildingKind: 'farm', at, approach: at, worker: ref('worker'), foundationId: null },
      ['unit:worker'], BUILDING_DEFS.farm.cost, ['building']);
    expect(execute(goalBuildExecutor, input, unknown).reasons[0]!.reason).toBe('goal-building-route-pending');
    const before = JSON.stringify(input), first = execute(goalBuildExecutor, input);
    expect(first.commands).toEqual([{ command: { type: 'build', unitId: 'worker', buildingKind: 'farm', ...point }, purpose: 'task' }]);
    expect(JSON.stringify(input)).toBe(before); input = apply(game, input, first);
    let result = first, payments = 0;
    for (let tick = 0; tick < 1400 && result.status !== 'complete'; tick += 15) {
      for (let i = 0; i < 15; i++) stepGame(game);
      input = { ...input, snapshot: snapshotGame(game) }; result = execute(goalBuildExecutor, input);
      payments += (result.payments ?? []).length; input = apply(game, input, result);
    }
    expect(result.status).toBe('complete'); expect(payments).toBe(1);
    expect(input.grant.commands.filter(command => command.command.type === 'build')).toHaveLength(1);
    const output = result.goalOutputs![0]!;
    expect(game.buildings.find(building => building.id === output.entityId)).toMatchObject({ owner: 'us', kind: 'farm', complete: true, ...point });
    expect(output.proof).toEqual({ kind: 'foundation', acceptedCommandId: 'actual-sdk-admission:0' });
  });

  it('waits on current free gold from the same fact reader instead of treating gross cash or a forecast as a budget', () => {
    const game = nativeGame(), snapshot = snapshotGame(game);
    const input = request(game, goalWaitIncomeExecutor, 'wait-income', { minimumGold: 500, byTick: 5000 }, []);
    expect(execute(goalWaitIncomeExecutor, input).status).toBe('blocked');
    const situation = buildObservedStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }).situation;
    const context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner', readFact: () => { throw Error('unexpected nested fact'); } };
    const source = (reservedGold: number): ExecutorInput => ({ ...input, goalFacts: fact => readGoalEconomicFact(fact, context, {
      reservedGold, geometryRevision: 'native-original', geometry: createGoalGeometryReader({ tick: snapshot.tick,
        work: new FactWorkQueue(snapshot.tick, 0), memory: { version: 1, entries: [] } }),
      regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point),
    })! });
    expect(execute(goalWaitIncomeExecutor, source(2900))).toMatchObject({ status: 'active', commands: [] });
    expect(execute(goalWaitIncomeExecutor, source(0))).toMatchObject({ status: 'complete', commands: [] });
  });

  it('holds only an already-present granted cohort until the declared end and preserves interruptions', () => {
    const game = nativeGame(), fighter = game.units.find(unit => unit.id === 'fighter')!;
    let input = request(game, goalHoldPositionExecutor, 'hold-position', { target: { landId: landIdAt(game.map, fighter)!,
      point: { x: fighter.x, y: fighter.y } }, cohort: [ref('fighter')], throughTick: 30 }, ['unit:fighter']);
    const first = execute(goalHoldPositionExecutor, input); expect(first.status).toBe('active'); expect(first.commands).toHaveLength(1);
    input = apply(game, input, first); expect(execute(goalHoldPositionExecutor, input).commands).toEqual([]);
    for (let tick = 0; tick < 30; tick++) stepGame(game);
    input = { ...input, snapshot: snapshotGame(game) }; expect(execute(goalHoldPositionExecutor, input).status).toBe('complete');
    expect(execute(goalHoldPositionExecutor, { ...input, grant: { ...input.grant, leases: [] } }).status).toBe('blocked');
    const late = { ...input, execution: { ...input.execution, state: {}, intent: input.execution.intent.kind === 'goal-action'
      ? { ...input.execution.intent, parameters: { ...input.execution.intent.parameters, throughTick: 15 } } : input.execution.intent } };
    expect(execute(goalHoldPositionExecutor, late).reasons[0]!.reason).toBe('goal-hold-window-already-expired');
  });

  it('attacks only the explicit hostile target through native commands, never allies or an ungranted unit', () => {
    const game = nativeGame(), target = game.units.find(unit => unit.id === 'target')!;
    let input = request(game, goalDestroyTargetExecutor, 'destroy-target', { target: { entityId: target.id,
      landId: landIdAt(game.map, target)!, point: { x: target.x, y: target.y } }, cohort: [ref('fighter')] }, ['unit:fighter']);
    const first = execute(goalDestroyTargetExecutor, input); expect(first.commands).toHaveLength(1); input = apply(game, input, first);
    for (let tick = 0; tick < 100 && game.units.some(unit => unit.id === target.id && unit.hp > 0); tick++) stepGame(game);
    input = { ...input, snapshot: snapshotGame(game) }; const absent = execute(goalDestroyTargetExecutor, input);
    expect(absent.commands).toEqual([]); // Missing lifecycle remains pending if native already removed the target.
    const ally = request(game, goalDestroyTargetExecutor, 'destroy-target', { target: { entityId: 'ally',
      landId: landIdAt(game.map, target)!, point: { x: 1500, y: 600 } }, cohort: [ref('fighter')] }, ['unit:fighter']);
    expect(execute(goalDestroyTargetExecutor, ally).reasons[0]!.reason).toBe('goal-destroy-target-not-hostile');
    expect(execute(goalDestroyTargetExecutor, { ...input, grant: { ...input.grant, leases: [] } }).commands).toEqual([]);
    const engage = request(game, goalEngageUnitsExecutor, 'engage-units', { target: { entityId: 'hall', landId: landIdAt(game.map, target)!, point: { x: 400, y: 400 } },
      cohort: [ref('fighter')], throughTick: 500 }, ['unit:fighter']);
    expect(execute(goalEngageUnitsExecutor, engage).reasons[0]!.reason).toBe('goal-interception-capability-pending');
  });

  it('uses the same land capability resolver for the exact granted interception group', () => {
    const game = nativeGame(), snapshot = snapshotGame(game), target = snapshot.units.find(unit => unit.id === 'target')!;
    const situation = buildObservedStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }).situation;
    const context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner',
      readFact: fact => ({ fact, state: 'met', observedTick: snapshot.tick, revision: 'published-route-port', evidence: [],
        reason: { code: 'published-route-port', factIds: [fact.id], values: {} }, route: { distance: 80, ticks: 0, points: [] } }) };
    const base = request(game, goalEngageUnitsExecutor, 'engage-units', { target: { entityId: target.id,
      landId: landIdAt(game.map, target)!, point: { x: target.x, y: target.y } }, cohort: [ref('fighter')], throughTick: 500 }, ['unit:fighter']);
    const input: ExecutorInput = { ...base, goalFacts: fact => readGoalLandCapabilityFact(fact, context,
      { regionAt: point => landIdAt(snapshot.map, point) ?? null })! };
    expect(execute(goalEngageUnitsExecutor, input).commands).toEqual([
      { command: { type: 'attack', unitIds: ['fighter'], targetId: target.id }, purpose: 'task' },
    ]);
    expect(execute(goalEngageUnitsExecutor, { ...input, grant: { ...input.grant, leases: [] } }).commands).toEqual([]);
  });
});
