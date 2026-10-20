import { describe, expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { createGame, snapshotGame } from '../../shared/sim';
import type { ExecutionAction, ExecutorFeedback, StrategyAllocationMemory, ExecutableMethod } from './allocation-types';
import { createStrategyAllocationMemory } from './control';
import { advanceAllocationLeases, allocationGrants, applyExecutorFeedback, settleAllocationState } from './allocation-lifecycle';

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
