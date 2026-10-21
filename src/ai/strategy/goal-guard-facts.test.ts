import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { EXPANSION_GARRISON_COVERAGE_RADIUS } from '../bootstrap_1/expansion-garrison-rules';
import { allocateStrategy } from './allocator';
import { allocationGrants, applyExecutorFeedback } from './allocation-lifecycle';
import type { AllocationMethodProvider, ExecutableMethod, StrategyAllocationMemory, ExecutorInput } from './allocation-types';
import { createStrategyCommandGateway } from './command-gateway';
import { goalHoldPositionExecutor } from './executors/goal-land';
import { goalFact } from './goal-facts';
import { readGoalGuardFact } from './goal-guard-facts';
import { withGoalPlannerInput } from './goal-planner-input';
import type { DecisionFacts } from './decision';
import type { Objective } from './types';
import { landIdAt } from './regions';

/** An allocation/execution contract, not a supplied solution to a public
 * puzzle. Authority is obtained from the actual allocator and gateway. */
function fixture(post = { x: 1000, y: 1000 }, rolling = false) {
  const game = sketchScene('native-formal-garrison-proof').map('bareDuel').replaceDefaults().player('us')
    .townHall('us', 1150, 1000, { id: 'hall' }).goldMine('mine', 1000, 1000, 10000)
    .unit('us', 'footman', post.x, post.y, { id: 'guard' }).build().createGame();
  const snapshot = snapshotGame(game), policy = createAiPolicyMemory();
  let authority!: StrategyAllocationMemory;
  let holdingInput!: Pick<ExecutorInput, 'objective' | 'method'>;
  const through = rolling ? 6000 : 1200;
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory: policy, goals: [] }, planning => {
    const at = { point: post, landId: landIdAt(snapshot.map, post)! };
    const mine = { point: { x: 1000, y: 1000 }, landId: landIdAt(snapshot.map, { x: 1000, y: 1000 })!, entityId: 'mine' };
    const objective: DecisionFacts<Objective> = { id: 'guard-contract', owner: 'us', kind: 'ExpandLand', target: at, effects: [],
      sinceTick: snapshot.tick, status: 'candidate', rank: null, reasons: [], methodIds: [],
      stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 },
      utility: { horizonTicks: 1200, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 1000 } };
    const method: ExecutableMethod = { id: 'guard-bundle', objectiveId: objective.id, kind: 'goal-plan', stage: 'goal-plan',
      goalBundle: { planId: 'guard-plan', unitIds: ['guard'] }, providerId: 'guard-contract', preference: 0, status: 'candidate',
      demands: [], spends: [], preconditions: [], subgoals: [], reasons: [], estimatedTicks: through,
      actions: [{ id: 'hold', executor: 'goal.hold-position', target: at, unitIds: ['guard'], demands: [], spendIds: [], dependsOn: [], completionEffects: [],
        intent: { kind: 'goal-action', goalId: objective.id, declarationId: 'hold-contract', actionKind: 'hold-position', outputs: [],
          parameters: { target: at, throughTick: through, ...(rolling ? { protectionWindowTicks: 2400 } : {}), cohort: [{ kind: 'existing', entityId: 'guard' }],
            garrisonMineId: 'mine', garrisonAt: mine } } }] };
    const provider: AllocationMethodProvider = { id: 'guard-contract', buildMethods: () => [method], quote: () => ({
      methodId: method.id, status: 'feasible', force: null, missingPreconditions: [], potentialUtility: null,
      reason: { code: 'contract-price', factIds: [], values: {} }, utility: { horizonTicks: 1200,
        benefit: [{ code: 'contract', value: 1000 }], cost: [], successProbability: 1, persistenceBonus: 0, score: 1000 } }) };
    const result = allocateStrategy({ snapshot, situation: planning.context.situation, objectives: [objective], methods: [method], providers: [provider], previous: null });
    authority = result.memory;
    const grant = result.grants[0]!, execution = authority.executions[grant.action.actionId]!;
    holdingInput = { objective, method };
    expect(authority.leases['unit:guard']!.minimumStayUntilTick).toBe(through);
    const feedback = goalHoldPositionExecutor.execute({ snapshot, owner: 'us', objective, method, execution, grant,
      goalFacts: planning.context.readFact, events: authority.events, goalReferences: authority.goalReferences! });
    authority = applyExecutorFeedback(authority, snapshot, feedback);
    const admitted = createStrategyCommandGateway({ snapshot, owner: 'us', memory: authority, grants: allocationGrants(authority), queuedTick: null })
      .admit(feedback.commands.map((entry, index) => ({ id: `guard-command-${index}`, source: 'executor', executor: execution.executor,
        action: execution.token, allocationRevision: authority.revision, purpose: entry.purpose, command: entry.command })));
    expect(admitted.accepted).toHaveLength(1);
    issueCommandFrame(game, admitted.accepted.map(entry => ({ playerId: 'us', scriptId: entry.executor, command: entry.command })));
    // Observe the native order after application. The proposal above cannot
    // publish the holding receipt before the SDK has actually applied it.
    authority = applyExecutorFeedback(authority, snapshotGame(game), goalHoldPositionExecutor.execute({
      snapshot: snapshotGame(game), owner: 'us', objective, method, execution: authority.executions[grant.action.actionId]!,
      grant: allocationGrants(authority)[0]!, goalFacts: planning.context.readFact, events: authority.events, goalReferences: authority.goalReferences! }));
  });
  return { game, policy, authority, holdingInput };
}

function read(f: ReturnType<typeof fixture>, authority = f.authority, composed = false) {
  const snapshot = snapshotGame(f.game), policy = createAiPolicyMemory();
  if (composed) policy.strategyAllocation = authority;
  return withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory: policy, goals: [] }, input => {
    const fact = goalFact({ kind: 'garrison-ready', mineId: 'mine', at: { entityId: 'mine', point: { x: 1000, y: 1000 },
      landId: landIdAt(snapshot.map, { x: 1000, y: 1000 })! } });
    return composed ? input.context.readFact(fact) : readGoalGuardFact(fact, input.context, authority);
  });
}

it('observes a completed native hall, actual hold cohort and retained whole-window authority together', () => {
  const f = fixture();
  expect(read(f)).toMatchObject({ state: 'met', entityIds: ['guard'], reason: { code: 'observed-formal-guard-obligation',
    values: { retainedLease: true, supportedThroughTick: 1200 } } });
  expect(read(f, JSON.parse(JSON.stringify(f.authority)))).toEqual(read(f));
});

it('rejects a hall or state ACK without the real post, action generation, lease window and uninterrupted cohort', () => {
  const f = fixture(), lease = f.authority.leases['unit:guard']!;
  expect(read(f, { ...f.authority, leases: {} })).toBeNull();
  expect(read(f, { ...f.authority, leases: { ...f.authority.leases, 'unit:guard': { ...lease, minimumStayUntilTick: 1199 } } })).toBeNull();
  expect(read(f, { ...f.authority, leases: { ...f.authority.leases, 'unit:guard': { ...lease, action: { ...lease.action, generation: lease.action.generation + 1 } } } })).toBeNull();
  f.game.units.find(unit => unit.id === 'guard')!.x += 1000;
  expect(read(f)).toBeNull();
});

it('does not promote a foundation or a mere accepted hold command to garrison readiness', () => {
  const f = fixture();
  f.game.buildings.find(building => building.id === 'hall')!.complete = false;
  expect(read(f)).toBeNull();
  f.game.buildings.find(building => building.id === 'hall')!.complete = true;
  f.game.units.find(unit => unit.id === 'guard')!.order = { type: 'idle' };
  expect(read(f)).toBeNull();
});

it('does not count a real leased hold on a distant post in the same land as mining coverage', () => {
  // The original audit input: both guard and declared post are 2828 units
  // from the mine, while allocator, hold command and SDK proof are valid.
  const f = fixture({ x: 3000, y: 3000 });
  expect(read(f)).toMatchObject({ state: 'unmet', reason: { code: 'garrison-post-outside-mine-coverage' } });
  expect(read(f, f.authority, true)).toMatchObject({ state: 'unmet', reason: { code: 'garrison-post-outside-mine-coverage' } });
});

it('uses the native inclusive coverage boundary for both the post and its actual cohort', () => {
  const edge = 1000 + EXPANSION_GARRISON_COVERAGE_RADIUS;
  expect(read(fixture({ x: edge, y: 1000 }))?.state).toBe('met');
  expect(read(fixture({ x: edge + .001, y: 1000 }))).toMatchObject({ state: 'unmet',
    reason: { code: 'garrison-post-outside-mine-coverage' } });
  const inside = fixture({ x: edge - 50, y: 1000 });
  inside.game.units.find(unit => unit.id === 'guard')!.x = edge + 1;
  expect(read(inside)).toMatchObject({ state: 'unmet', reason: { code: 'garrison-cohort-outside-mine-coverage' } });
});

it('rolls the current protection check while keeping the full formal obligation and lease', () => {
  const f = fixture(undefined, true), checked: number[] = [];
  let authority = f.authority;
  const step = (tick: number, safety: 'met' | 'pending' | 'unmet' = 'met') => {
    const snapshot = { ...snapshotGame(f.game), tick }, grant = allocationGrants(authority)[0]!;
    const execution = authority.executions[grant.action.actionId]!;
    const feedback = goalHoldPositionExecutor.execute({ ...f.holdingInput, snapshot, owner: 'us', execution, grant,
      events: authority.events, goalReferences: authority.goalReferences!, goalFacts: fact => {
        if (fact.predicate.kind !== 'site-safe') throw Error('unexpected protection predicate');
        checked.push(fact.predicate.throughTick);
        return { fact, state: safety, observedTick: tick, revision: `contract:${tick}`, evidence: [],
          ...(safety === 'pending' ? { requestId: fact.id, requestedTick: tick } : {}),
          reason: { code: 'contract-observation', factIds: [], values: {} } } as import('./goal-planner-types').GoalFactObservation;
      } });
    authority = applyExecutorFeedback(authority, snapshot, feedback);
    return feedback;
  };
  expect(step(1000)).toMatchObject({ status: 'active', commands: [], state: {
    goalProtectionCheckedTick: 1000, goalProtectionCheckedThrough: 3400, goalProtectionLeaseThrough: 6000 } });
  expect(step(1015, 'pending')).toMatchObject({ status: 'blocked', commands: [] });
  expect(step(1030, 'unmet')).toMatchObject({ status: 'blocked', commands: [] });
  expect(step(2000).status).toBe('active');
  expect(step(4000).status).toBe('active');
  expect(step(6000).status).toBe('complete');
  expect(checked).toEqual([3400, 3415, 3430, 4400, 6000, 6000]);
  // The actual hold, full leases and overlapping fresh checks produced a
  // completed receipt; releasing those finished leases does not erase it.
  withGoalPlannerInput({ snapshot: { ...snapshotGame(f.game), tick: 6000 }, owner: 'us', version: 'v9_knight', memory: createAiPolicyMemory(), goals: [] }, input => {
    const fact = goalFact({ kind: 'garrison-ready', mineId: 'mine', at: { entityId: 'mine', landId: 'land:1', point: { x: 1000, y: 1000 } }, throughTick: 6000 });
    expect(readGoalGuardFact(fact, input.context, { ...authority, leases: {}, assignments: {} })).toMatchObject({ state: 'met',
      entityIds: ['guard'], reason: { code: 'observed-formal-guard-obligation', values: { historicalReceipt: true } } });
  });
});

it('keeps a formal in-progress guard unfinished and rejects completion before native hold application', () => {
  const f = fixture(undefined, true);
  withGoalPlannerInput({ snapshot: snapshotGame(f.game), owner: 'us', version: 'v9_knight', memory: createAiPolicyMemory(), goals: [] }, input => {
    const fact = goalFact({ kind: 'garrison-ready', mineId: 'mine', at: { entityId: 'mine', landId: 'land:1', point: { x: 1000, y: 1000 } }, throughTick: 6000 });
    expect(readGoalGuardFact(fact, input.context, f.authority)).toMatchObject({ state: 'unmet', entityIds: ['guard'],
      reason: { code: 'formal-garrison-obligation-in-progress', values: { nativeHoldingNow: true } } });
  });
  f.game.units.find(unit => unit.id === 'guard')!.order = { type: 'idle' };
  const snapshot = { ...snapshotGame(f.game), tick: 6000 }, grant = allocationGrants(f.authority)[0]!, execution = f.authority.executions[grant.action.actionId]!;
  const feedback = goalHoldPositionExecutor.execute({ ...f.holdingInput, snapshot, owner: 'us', execution, grant,
    events: f.authority.events, goalReferences: f.authority.goalReferences!, goalFacts: fact => ({ fact, state: 'met', observedTick: 6000,
      revision: 'contract', evidence: [], reason: { code: 'contract-observation', factIds: [], values: {} } }) });
  expect(feedback.status).toBe('active'); expect(feedback.commands).toHaveLength(1);
  const rejected = applyExecutorFeedback(f.authority, snapshot, { ...feedback, status: 'complete' });
  expect(rejected.executions[execution.token.actionId]).toMatchObject({ status: 'blocked', phase: 'await-native-guard-proof' });
  expect(rejected.executions[execution.token.actionId]!.state.goalProtectionCheckedTick).toBeUndefined();
});
