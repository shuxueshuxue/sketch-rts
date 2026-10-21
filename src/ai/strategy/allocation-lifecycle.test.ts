import { describe, expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { createGame, snapshotGame } from '../../shared/sim';
import type { ExecutionAction, ExecutorFeedback, StrategyAllocationMemory, ExecutableMethod } from './allocation-types';
import { assertStrategyAllocationBounds, createStrategyAllocationMemory } from './control';
import { advanceAllocationLeases, allocationGrants, applyExecutorFeedback, pruneAllocationProvenance, settleAllocationState } from './allocation-lifecycle';
import { retainAllocationExecutions } from './allocation-execution-retention';

function fixture() {
  const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] }));
  const target = { entityId: 'camp', landId: 'land:1' as const, point: { x: 1000, y: 1000 } };
  snapshot.units = ['landed', 'optional', 'ship'].map(id => createUnit(id, 'player', id === 'ship' ? 'transport' : 'footman', 1000, 1000));
  snapshot.units[1]!.deck = { shipId: 'ship', x: 0, y: 0 };
  const action = (id: string, executor: string, unitIds: string[], dependsOn: string[]): ExecutableMethod['actions'][number] => ({ id, executor,
    intent: { kind: executor === 'strategy.transport' ? 'deliver-force' : 'borrow-force' }, unitIds,
    target, demands: [], dependsOn, spendIds: [], completionEffects: [] });
  const method: ExecutableMethod = { id: 'method', objectiveId: 'goal', providerId: 'test', kind: 'staged-beachhead', preference: 0,
    status: 'selected', preconditions: [], subgoals: [], demands: [], reasons: [], estimatedTicks: null, spends: [],
    actions: [action('delivery', 'strategy.transport', ['landed', 'optional', 'ship'], []), action('clear', 'strategy.clear-camp', ['landed', 'optional'], ['delivery'])] };
  const execution = (action: typeof method.actions[number]): ExecutionAction => ({ ...action, token: { actionId: action.id, generation: 1 },
    objectiveId: 'goal', methodId: 'method', status: action.id === 'delivery' ? 'active' : 'waiting', phase: 'test', sinceTick: 0, lastProgressTick: 0, state: {} });
  let memory: StrategyAllocationMemory = { ...createStrategyAllocationMemory('player', 0), revision: 1,
    methods: { method }, executions: Object.fromEntries(method.actions.map(action => [action.id, execution(action)])),
    objectives: { goal: { objectiveId: 'goal', methodId: 'method', target, effectKeys: [], status: 'active', actionIds: ['delivery', 'clear'],
      assignmentIds: [], budgetIds: [], sinceTick: 0, minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0, committedUtilityGold: null, force: null } } };
  memory = { ...memory, leases: Object.fromEntries(snapshot.units.map(unit => [`unit:${unit.id}`, { id: `lease:${unit.id}`,
    resourceKey: `unit:${unit.id}` as const, objectiveId: 'goal', methodId: 'method', action: memory.executions.delivery!.token,
    sinceTick: 0, minimumStayUntilTick: 0, origin: 'allocator' as const, incumbentTask: null }])),
    assignments: Object.fromEntries(snapshot.units.map(unit => [`assignment:${unit.id}`, { authority: 'committed' as const,
      id: `assignment:${unit.id}`, leaseId: `lease:${unit.id}`, unitId: unit.id, role: 'frontline' as const,
      objectiveId: 'goal', methodId: 'method', action: memory.executions.delivery!.token, target, stage: 'en-route' as const,
      eta: { status: 'unknown' as const, forecastTick: 0, arrivalTick: null, reason: { code: 'test', factIds: [], values: {} } },
      lastLocation: { kind: 'land' as const, landId: 'land:1' as const, point: target.point }, interruption: null }])) };
  const ground = { ...target, landId: 'land:1' as const };
  memory = { ...memory, voyages: { optional: { id: 'optional', objectiveId: 'goal', action: memory.executions.delivery!.token,
    shipAssignmentId: 'assignment:ship', crewAssignmentIds: ['assignment:optional'], passengerIds: ['optional'],
    departure: target, destination: target, departureGround: ground, landingGround: ground, phase: 'sailing', startedTick: 0,
    expectedFreeTick: null, decision: 'continue' } } };
  const feedback = (pending: string[]): ExecutorFeedback => ({ action: memory.executions.delivery!.token, allocationRevision: 1,
    status: 'complete', phase: 'required-wave-unloaded', state: { pendingVoyageIds: pending }, commands: [], reasons: [], blocked: [], payments: [], progress: [], handoffs: [] });
  return { memory, snapshot, feedback };
}

describe('authority along observed execution dependencies', () => {
  const retired = (memory: StrategyAllocationMemory, id: string): ExecutionAction => ({ ...memory.executions.delivery!,
    token: { actionId: id, generation: 3 }, dependsOn: [], executor: 'goal.assemble', status: 'complete', state: {},
    intent: { kind: 'goal-action', goalId: 'goal', actionKind: 'assemble', declarationId: id, parameters: {}, outputs: [] } });

  it('reclaims replaced ready frontiers inside a still-active goal without growing the authority archive', () => {
    const { memory } = fixture();
    // Long declaration identities reproduce the real retained-assembly byte
    // pressure; the current graph and all its authority remain byte-identical.
    const archived = Object.fromEntries(Array.from({ length: 100 }, (_, index) => {
      const id = `retired:${index}:${'native-cohort-and-post:'.repeat(70)}`;
      return [id, retired(memory, id)];
    }));
    const input = { ...memory, executions: { ...memory.executions, ...archived } }, before = JSON.stringify(input);
    expect(() => assertStrategyAllocationBounds(input)).toThrow('byte limit');
    const next = pruneAllocationProvenance(input);
    expect(next.executions).toEqual(memory.executions);
    expect(next.methods).toEqual(memory.methods); expect(next.leases).toEqual(memory.leases);
    expect(next.assignments).toEqual(memory.assignments); expect(next.voyages).toEqual(memory.voyages);
    expect(assertStrategyAllocationBounds(next)).toBeLessThan(256 * 1024);
    expect(pruneAllocationProvenance(JSON.parse(JSON.stringify(input)))).toEqual(next);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps terminal graph ancestors, resource owners, output proofs, jobs and pending handoffs reachable', () => {
    const { memory } = fixture();
    const ids = ['ancestor', 'lease', 'budget', 'output', 'training', 'handoff', 'orphan'];
    const actions = Object.fromEntries(ids.map(id => [id, retired(memory, id)]));
    actions.output = { ...actions.output!, intent: { kind: 'goal-action', goalId: 'goal', actionKind: 'build',
      declarationId: 'output', parameters: {}, outputs: ['hall'] }, state: { goalOutputBindings: { hall: 'real-hall' } } };
    const input: StrategyAllocationMemory = { ...memory,
      executions: { ...memory.executions, ...actions, clear: { ...memory.executions.clear!, dependsOn: ['ancestor'] } },
      leases: { ...memory.leases, 'unit:proof': { ...memory.leases['unit:landed']!, action: actions.lease!.token } },
      budgets: { paid: { id: 'paid', spendId: 'paid', objectiveId: 'goal', methodId: 'method', action: actions.budget!.token,
        amountGold: 400, paidGold: 400, state: 'spent', sinceTick: 0, releasedTick: null, includedUtilityTermCodes: [], externalReservationIds: [] } },
      goalTraining: { version: 1, owner: 'player', pools: [], jobs: [{ action: actions.training!.token,
        query: { acceptedCommandId: 'paid-train', jobId: 'native-job', producerId: 'producer', unitKind: 'footman' },
        poolKey: 'pool', creditFloor: 0, acceptedTick: 0, observedTick: 0, remaining: 60, state: 'training', reasonCode: 'observed' }] },
      events: [{ id: 'pending', tick: 0, revision: 1, objectiveId: 'goal', methodId: 'method', action: actions.handoff!.token,
        kind: 'preempted', handoff: 'pending', quotation: { fromObjectiveId: 'goal', toObjectiveId: 'next', resourceKeys: [],
          marginalBenefitGold: 10, displacedLossGold: 1, switchingCostGold: 0, reason: { code: 'handoff', factIds: [], values: {} } },
        reason: { code: 'handoff', factIds: [], values: {} } }] };
    const next = retainAllocationExecutions(input);
    expect(Object.keys(next.executions).sort()).toEqual(['delivery', 'clear', ...ids.filter(id => id !== 'orphan')].sort());
    expect(next.budgets).toBe(input.budgets); expect(next.goalTraining).toBe(input.goalTraining);
    expect(next.events).toBe(input.events); expect(next.executions.output).toBe(input.executions.output);
  });

  it('retains a completed assembly coordinator and cohort until the same method expands to execution', () => {
    const { memory, snapshot } = fixture(), original = memory.methods.method!, action = original.actions[0]!;
    const assembly: ExecutableMethod = { ...original, stage: 'assembly', actions: [{ ...action,
      executor: 'strategy.assemble-force', intent: { kind: 'assemble-force', campTarget: action.target, requiredForce: .5,
        posts: [{ id: 'home', target: action.target, unitIds: ['landed'] }] } }] };
    snapshot.units.push(createUnit('guard', 'neutral', 'ogreWarrior', 1100, 1000));
    const completed = { ...memory, methods: { method: assembly }, voyages: {},
      leases: { 'unit:landed': memory.leases['unit:landed']! }, assignments: { 'assignment:landed': memory.assignments['assignment:landed']! },
      objectives: { goal: { ...memory.objectives.goal!, actionIds: ['delivery'] } },
      executions: { delivery: { ...memory.executions.delivery!, intent: assembly.actions[0]!.intent,
        executor: 'strategy.assemble-force', status: 'complete' as const, phase: 'ready-for-departure' } } };
    const held = advanceAllocationLeases(settleAllocationState(completed, snapshot), snapshot);
    expect(held.objectives.goal!.status).toBe('active');
    expect(held.leases['unit:landed']).toEqual(completed.leases['unit:landed']);
    expect(held.assignments['assignment:landed']).toBeDefined();
    expect(allocationGrants(held)).toEqual([]);
    expect(advanceAllocationLeases(settleAllocationState(JSON.parse(JSON.stringify(completed)), snapshot), snapshot)).toEqual(held);
    const moved = structuredClone(snapshot); moved.units.find(unit => unit.id === 'landed')!.x += 500;
    expect(settleAllocationState(held, moved).executions.delivery!.status).toBe('ready');
    const executionMethod: ExecutableMethod = { ...assembly, stage: 'execution', actions: [...assembly.actions, {
      ...original.actions[1]!, unitIds: ['landed'], dependsOn: ['delivery'] }] };
    const expanded = advanceAllocationLeases({ ...held, methods: { method: executionMethod }, executions: {
      ...held.executions, clear: { ...memory.executions.clear!, dependsOn: ['delivery'] } } }, snapshot);
    expect(expanded.leases['unit:landed']!.action).toEqual(expanded.executions.clear!.token);
    expect(settleAllocationState({ ...expanded, objectives: { goal: { ...expanded.objectives.goal!, actionIds: ['delivery', 'clear'] } } }, moved)
      .executions.delivery!.status).toBe('complete');
  });

  it('keeps optional voyages owned while transferring only the troops actually unloaded', () => {
    const { memory, snapshot, feedback } = fixture();
    const partial = advanceAllocationLeases(applyExecutorFeedback(memory, snapshot, feedback(['optional'])), snapshot);
    expect(partial.executions.delivery!.status).toBe('active');
    expect(partial.executions.clear!.status).toBe('ready');
    expect(partial.leases['unit:landed']!.action.actionId).toBe('clear');
    expect(partial.leases['unit:optional']!.action.actionId).toBe('delivery');
    expect(partial.leases['unit:ship']!.action.actionId).toBe('delivery');
    expect(allocationGrants(partial).flatMap(grant => grant.leases).map(lease => lease.id).sort()).toEqual(['lease:landed', 'lease:optional', 'lease:ship']);
    const fork = JSON.parse(JSON.stringify(partial));
    delete snapshot.units[1]!.deck; snapshot.tick += 15;
    const continueOnce = (input: StrategyAllocationMemory) => advanceAllocationLeases(applyExecutorFeedback(input, snapshot, feedback([])), snapshot);
    const done = continueOnce(partial);
    expect(done.leases['unit:optional']!.action.actionId).toBe('clear');
    expect(done.leases['unit:ship']).toBeUndefined();
    expect(done.assignments['assignment:ship']).toBeUndefined();
    expect(JSON.stringify(continueOnce(fork))).toBe(JSON.stringify(done));
  });

  it('releases a finished production lane while its parent graph is still running', () => {
    const { memory, snapshot } = fixture(), production = { ...memory.executions.delivery!, token: { actionId: 'production', generation: 2 },
      status: 'complete' as const, executor: 'strategy.train-transport' };
    const next = advanceAllocationLeases({ ...memory, executions: { ...memory.executions, production }, leases: { ...memory.leases,
      'queue:yard': { id: 'production-lane', resourceKey: 'queue:yard', objectiveId: 'goal', methodId: 'method', action: production.token,
        sinceTick: 0, minimumStayUntilTick: 0, origin: 'allocator', incumbentTask: null } } }, snapshot);
    expect(next.leases['queue:yard']).toBeUndefined(); expect(next.objectives.goal!.status).toBe('active');
  });

  it('retains a completed garrison until formal defense acknowledges the same cohort', () => {
    const { memory, snapshot } = fixture(), action = { ...memory.executions.delivery!, executor: 'strategy.establish-garrison',
      status: 'complete' as const, state: { hallId: 'new-hall' } };
    const held = settleAllocationState({ ...memory, objectives: { goal: { ...memory.objectives.goal!, actionIds: ['delivery'] } },
      executions: { delivery: action } }, snapshot);
    expect(held.objectives.goal!.status).toBe('active'); expect(held.leases['unit:landed']).toBeDefined();
    const acknowledged = settleAllocationState({ ...held, executions: { delivery: { ...action, state: {
      ...action.state, leasesTransferredTo: 'DefendSite:new-hall' } } } }, snapshot);
    expect(acknowledged.objectives.goal!.status).toBe('complete');
    expect(acknowledged.leases).toEqual({});
  });
});
