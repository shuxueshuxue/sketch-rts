import { describe, expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import { createUnit } from '../../shared/map';
import type { AllocationMethodProvider, ExecutableMethod, MethodAllocationQuote, StrategyAllocationInput } from './allocation-types';
import { allocateStrategy } from './allocator';
import { createStrategyAllocationMemory } from './control';
import { recordAllocationCommands } from './allocation-ledger';
import type { DecisionFacts } from './decision';
import type { Objective, Situation } from './types';
import { resolveValuation, valuationWindow } from './utility';

function fixture() {
  const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] }));
  snapshot.units = ['one', 'two'].map(id => createUnit(id, 'player', 'footman', 1000, 1000));
  const target = { entityId: 'post', landId: 'land:1' as const, point: { x: 1000, y: 1000 } };
  const unit = (id: string) => ({ id, owner: 'player', kind: 'footman' as const, hp: 100, maxHp: 100, strength: 1,
    roles: ['frontline' as const], expiresTick: null, location: { kind: 'land' as const, landId: 'land:1' as const, point: target.point },
    commitments: [], arrivals: [{ targetId: 'post', arrival: { status: 'reachable' as const, ticks: 0, landTicks: 0, crossings: [] } }] });
  const situation: DecisionFacts<Situation> = { tick: snapshot.tick, owner: 'player', horizonTicks: 2400,
    assets: [], opportunities: [], lands: [], seas: [], limitations: [], units: snapshot.units.map(unit => unit.id).map(unit),
    economy: { cashGold: 1000, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] } };
  const goal = (id: string): DecisionFacts<Objective> => ({ id, kind: 'DefendSite', owner: 'player', target,
    effects: [{ kind: 'site-safe', siteId: id, throughTick: 1000 }], status: 'candidate', sinceTick: 0, rank: null, reasons: [], methodIds: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: null },
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } });
  const goals = [goal('pair'), goal('single')];
  const method = (id: string): ExecutableMethod => ({ id: `${id}/method`, objectiveId: id, kind: 'local-squad',
    providerId: 'test-provider', preference: 0, spends: [], demands: [{ kind: 'force', metric: 'camp-force', strength: id === 'pair' ? 2 : 1,
      roles: ['frontline'], at: target, neededByTick: null, permanent: false }], preconditions: [], subgoals: [], estimatedTicks: 0,
    status: 'candidate', reasons: [], actions: [{ id: `${id}/act`, executor: 'strategy.defend-site', intent: { kind: 'defend-site' },
      target, demands: [{ kind: 'force', metric: 'camp-force', strength: 1, roles: ['frontline'], at: target, neededByTick: null, permanent: false }],
      spendIds: [], dependsOn: [], completionEffects: [] }] });
  const provider: AllocationMethodProvider = { id: 'test-provider', buildMethods: () => [], quote(input): MethodAllocationQuote {
    const required = input.objective.id === 'pair' ? 2 : 1;
    const reason = { code: 'whole-group-quote', factIds: input.unitIds, values: {} };
    if (input.unitIds.length < required) return { methodId: input.method.id, status: 'blocked', utility: null, potentialUtility: null,
      force: null, reason, missingPreconditions: [{ id: `${input.method.id}/missing-force`, kind: 'force', status: 'unmet',
        reason, demand: input.method.demands[0]!, subgoalIds: [] }] };
    const valuation = resolveValuation({ objectiveId: input.objective.id, methodId: input.method.id,
      unitIds: input.unitIds, window: valuationWindow(0, input.valuation) }, input.valuation);
    if (valuation.phase === 'net' && valuation.opportunity?.status !== 'known') return {
      methodId: input.method.id, status: 'blocked', utility: null, potentialUtility: null, force: null,
      reason: { ...reason, code: 'opportunity-unknown' }, missingPreconditions: [], valuation };
    const benefit = input.objective.id === 'pair' ? 100 : 300;
    const cost = valuation.opportunity?.status === 'known' ? valuation.opportunity.gold : 0;
    return { methodId: input.method.id, status: 'feasible', potentialUtility: null, force: null, missingPreconditions: [], reason, valuation,
      utility: { horizonTicks: valuation.window.horizonTicks, successProbability: 1, persistenceBonus: 0,
        benefit: [{ code: 'protected-assets', value: benefit }], cost: [{ code: 'opportunity', value: cost }], score: benefit - cost } };
  } };
  const input: StrategyAllocationInput = { snapshot, situation, objectives: goals, methods: goals.map(goal => method(goal.id)), providers: [provider], previous: null };
  return { input, provider, goals, method };
}

describe('deterministic whole-bundle allocation', () => {
  it('compares nonlinear complete cohorts and grants the better marginal use exactly once', () => {
    const { input } = fixture(), before = JSON.stringify(input.snapshot);
    const result = allocateStrategy(input);
    expect(Object.keys(result.memory.objectives)).toEqual(['single']);
    expect(Object.values(result.memory.leases).map(lease => lease.resourceKey)).toEqual(['unit:one']);
    expect(result.memory.objectives.single!.committedUtilityGold).toBe(200);
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0]!.assignments[0]).toMatchObject({ unitId: 'one', stage: 'on-station', eta: { status: 'known' } });
    expect(JSON.stringify(input.snapshot)).toBe(before);
  });

  it('reproduces reversed offer order, repeated same tick and a serialized mid-game continuation', () => {
    const { input } = fixture(), first = allocateStrategy(input);
    const reverse = allocateStrategy({ ...input, methods: [...input.methods].reverse(), objectives: [...input.objectives].reverse() });
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(first));
    expect(allocateStrategy({ ...input, previous: first.memory }).memory).toEqual(first.memory);
    const next = { ...input, snapshot: { ...input.snapshot, tick: input.snapshot.tick + 15 },
      situation: { ...input.situation, tick: input.situation.tick + 15 }, previous: first.memory };
    const restored = { ...next, previous: JSON.parse(JSON.stringify(first.memory)), snapshot: structuredClone(next.snapshot), situation: structuredClone(next.situation) };
    expect(JSON.stringify(allocateStrategy(restored))).toBe(JSON.stringify(allocateStrategy(next)));
  });

  it('does not turn an unpriced executed commitment into a free resource', () => {
    const { input } = fixture(), memory = createStrategyAllocationMemory('player', input.snapshot.tick);
    const lease = { id: 'old', resourceKey: 'unit:one' as const, objectiveId: 'unpriced', methodId: 'unpriced',
      action: { actionId: 'old-act', generation: 1 }, sinceTick: 0, minimumStayUntilTick: 0, origin: 'imported-task' as const,
      incumbentTask: { source: 'naval.ferries', taskId: 'actual-voyage' } };
    const result = allocateStrategy({ ...input, previous: { ...memory, leases: { 'unit:one': lease } } });
    expect(result.memory.leases['unit:one']).toEqual(lease);
    expect(result.memory.events.some(event => event.kind === 'preempted')).toBe(false);
    expect(result.memory.objectives.single).toBeDefined();
    expect(result.memory.leases['unit:two']?.objectiveId).toBe('single');
  });

  it('keeps unknown/blocked prerequisites outside feasible allocation and rejects hidden recruitment', () => {
    const { input, provider } = fixture();
    const blocked: AllocationMethodProvider = { ...provider, quote(request) { return { status: 'blocked', methodId: request.method.id,
      force: null, utility: null, potentialUtility: null, reason: { code: 'geometry-pending', factIds: [], values: {} },
      missingPreconditions: [{ id: 'route', kind: 'route', status: 'unknown', reason: { code: 'geometry-pending', factIds: [], values: {} },
        demand: { kind: 'workers', count: 1, at: request.objective.target }, subgoalIds: [] }] }; } };
    const result = allocateStrategy({ ...input, providers: [blocked] });
    expect(result.grants).toEqual([]); expect(result.unmet[0]!.reason.code).toBe('geometry-pending');
    const recruiting: AllocationMethodProvider = { ...provider, materialize(request) { return { ...request.method,
      actions: request.method.actions.map(action => ({ ...action, unitIds: ['hidden-reinforcement'] })) }; } };
    expect(() => allocateStrategy({ ...input, providers: [recruiting] })).toThrow('ungranted unit');
  });

  it('requires a known switching price and three distinct thinks before an ordinary committed handoff', () => {
    const { input } = fixture();
    const first = allocateStrategy({ ...input, objectives: input.objectives.slice(0, 1), methods: input.methods.slice(0, 1) });
    expect(Object.keys(first.memory.objectives)).toEqual(['pair']);
    const later = { ...input, snapshot: { ...input.snapshot, tick: 500 }, situation: { ...input.situation, tick: 500 }, previous: first.memory };
    const unpriced = allocateStrategy(later);
    expect(unpriced.memory.leases['unit:one']!.objectiveId).toBe('pair');
    expect(unpriced.events.some(event => event.kind === 'preempted')).toBe(false);
    let memory = first.memory;
    for (let think = 0; think < 3; think++) {
      const tick = 500 + think * 15;
      const result = allocateStrategy({ ...later, snapshot: { ...later.snapshot, tick }, situation: { ...later.situation, tick },
        previous: memory, switchingCost: () => 50 });
      memory = result.memory;
      if (think < 2) {
        expect(memory.leases['unit:one']!.objectiveId).toBe('pair');
        expect(result.events.some(event => event.kind === 'preempted')).toBe(false);
        expect(memory.objectives.pair!.challengerThinks).toBe(think + 1);
      } else {
        expect(memory.leases['unit:one']!.objectiveId).toBe('single');
        expect(result.events.find(event => event.kind === 'preempted')).toMatchObject({ kind: 'preempted', handoff: 'shrink',
          quotation: { marginalBenefitGold: 300, displacedLossGold: 100, switchingCostGold: 50 } });
        expect(memory.objectives.pair!.assignmentIds).toEqual(['assignment:two']);
      }
    }
    const tooCostly = allocateStrategy({ ...later, previous: { ...first.memory, objectives: { pair: {
      ...first.memory.objectives.pair!, challengerId: 'single', challengerThinks: 2 } } }, switchingCost: () => 200 });
    expect(tooCostly.memory.leases['unit:one']!.objectiveId).toBe('pair');
  });

  it('reprices the remaining cohort after a grant so disjoint useful tasks can run together', () => {
    const { input } = fixture();
    const last = { ...input.situation.units[1]!, id: 'three' };
    const result = allocateStrategy({ ...input, snapshot: { ...input.snapshot,
      units: [...input.snapshot.units, createUnit('three', 'player', 'footman', 1000, 1000)] },
      situation: { ...input.situation, units: [...input.situation.units, last] } });
    expect(Object.keys(result.memory.objectives).sort()).toEqual(['pair', 'single']);
    expect(Object.values(result.memory.assignments).filter(assignment => assignment.objectiveId === 'pair')).toHaveLength(2);
    expect(new Set(Object.values(result.memory.assignments).map(assignment => assignment.unitId)).size).toBe(3);
  });

  it('separates assignment from observed native travel and actual arrival', () => {
    const { input } = fixture(), point = { x: 3000, y: 1000 };
    const target = { entityId: 'post', landId: 'land:1' as const, point };
    const request = { ...input, objectives: input.objectives.slice(1).map(goal => ({ ...goal, target })),
      methods: input.methods.slice(1).map(method => ({ ...method, actions: method.actions.map(action => ({ ...action, target })) })) };
    const first = allocateStrategy(request), assignment = Object.values(first.memory.assignments)[0]!;
    expect(assignment.stage).toBe('assigned');
    const execution = first.memory.executions[assignment.action.actionId]!;
    const withReceipt = recordAllocationCommands(first.memory, request.snapshot, [{ commandId: 'native-move', source: 'executor',
      executor: execution.executor, action: execution.token, allocationRevision: first.memory.revision, purpose: 'task',
      command: { type: 'move', unitIds: [assignment.unitId], ...point }, status: 'accepted', admittedTick: request.snapshot.tick, queuedTick: null }]);
    const next = { ...request, previous: withReceipt, snapshot: { ...request.snapshot, tick: 15,
      units: request.snapshot.units.map(unit => unit.id === assignment.unitId ? { ...unit, order: { type: 'move' as const, ...point } } : unit) },
      situation: { ...request.situation, tick: 15 } };
    const travelling = allocateStrategy(next);
    expect(travelling.memory.assignments[assignment.id]!.stage).toBe('en-route');
    const arrived = allocateStrategy({ ...next, previous: travelling.memory, snapshot: { ...next.snapshot, tick: 30,
      units: next.snapshot.units.map(unit => unit.id === assignment.unitId ? { ...unit, ...point, order: { type: 'idle' as const } } : unit) },
      situation: { ...next.situation, tick: 30, units: next.situation.units.map(unit => unit.id === assignment.unitId
        ? { ...unit, location: { kind: 'land' as const, landId: 'land:1' as const, point } } : unit) } });
    expect(arrived.memory.assignments[assignment.id]!.stage).toBe('on-station');
  });
});
