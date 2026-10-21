import { describe, expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import { createBuilding, createUnit } from '../../shared/map';
import type { AllocationMethodProvider, ExecutableMethod, MethodAllocationQuote, PlannedVoyage, StrategyAllocationInput, StrategyAllocationMemory } from './allocation-types';
import { allocateStrategy } from './allocator';
import { assembleForceExecutor } from './executors/assemble-force';
import { allocationResponseCandidates } from './allocation-eligibility';
import { createStrategyAllocationMemory } from './control';
import { recordAllocationCommands } from './allocation-ledger';
import type { DecisionFacts } from './decision';
import type { Objective, Situation } from './types';
import { resolveValuation, valuationWindow } from './utility';
import { assemblyPostArrivalId } from './assembly-facts';
import type { AssemblyFactsRequest } from './assembly-facts';
import { forecastForceAssembly } from './force-assembly-forecast';

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
  it('binds assembly facts to each actual gross/net bundle and its current resource exclusions', () => {
    const { input, provider } = fixture();
    const expected: AssemblyFactsRequest[] = [], seen: AssemblyFactsRequest[] = [];
    const wrapped: AllocationMethodProvider = { ...provider, quote(request) {
      expected.push({ objective: request.objective, methodId: request.method.id, campTarget: request.objective.target,
        requiredForce: 3, posts: [], unitIds: request.unitIds, interruptedUnitIds: request.interruptedUnitIds ?? [],
        ...(request.valuation ? { valuation: request.valuation } : {}),
        ...(request.responseEligibleUnitIds ? { responseEligibleUnitIds: request.responseEligibleUnitIds } : {}) });
      request.assemblyFacts!({ objective: input.objectives[0]!, methodId: 'stale-method', campTarget: request.objective.target,
        requiredForce: 3, posts: [], unitIds: ['ungranted-member'], interruptedUnitIds: ['fake-patient'] });
      return provider.quote(request);
    } };
    allocateStrategy({ ...input, providers: [wrapped], assemblyFacts: request => {
      seen.push(request);
      return { forecast: forecastForceAssembly({ snapshot: input.snapshot, owner: input.situation.owner,
        rallies: [], target: { metric: 'field-strength', requiredForce: 3 }, unitSupply: [], paidJobRoutes: [],
        throughTick: 1000, conditionalProduction: null }), continuation: null, missing: [] };
    } });
    expect(seen).toEqual(expected);
    expect(new Set(seen.map(request => request.valuation?.phase))).toEqual(new Set(['gross', 'net']));
    expect(seen.every(request => !request.unitIds.includes('ungranted-member'))).toBe(true);
  });

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

  it('does not price or preempt an unused engineer when a full skeleton specializes to assembly', () => {
    const { input, provider } = fixture();
    input.snapshot.units.push(createUnit('engineer', 'player', 'worker', 1000, 1000));
    const worker: DecisionFacts<Situation>['units'][number] = { ...input.situation.units[0]!, id: 'engineer', kind: 'worker', roles: ['worker'] };
    const memory = createStrategyAllocationMemory('player', input.snapshot.tick);
    const oldLease = { id: 'old-builder', resourceKey: 'unit:engineer' as const, objectiveId: 'unpriced-build', methodId: 'unpriced-build',
      action: { actionId: 'old-builder', generation: 1 }, sinceTick: 0, minimumStayUntilTick: 0, origin: 'imported-task' as const,
      incumbentTask: { source: 'landExpansion', taskId: 'old-build' } };
    const observed: string[][] = [], conflicts: string[][] = [];
    const methods = input.methods.map(method => ({ ...method, demands: [...method.demands,
      { kind: 'workers' as const, count: 1, at: method.actions[0]!.target }] }));
    const result = allocateStrategy({ ...input, situation: { ...input.situation, units: [...input.situation.units, worker] }, methods,
      previous: { ...memory, leases: { 'unit:engineer': oldLease } },
      switchingCost: request => { conflicts.push([...request.resourceKeys]); return 0; },
      observeCandidate: request => observed.push([...request.unitIds]), providers: [{ ...provider, materialize: request => ({
        ...request.method, stage: 'assembly', actions: request.method.actions.map(action => ({ ...action,
          executor: 'strategy.assemble-force', intent: { kind: 'assemble-force', campTarget: request.objective.target,
            requiredForce: 1, posts: [{ id: 'home', target: action.target, unitIds: request.unitIds.filter(id => id !== 'engineer') }] },
          unitIds: request.unitIds.filter(id => id !== 'engineer') })) }) }] });
    expect(result.memory.objectives.single).toBeDefined();
    expect(result.memory.leases['unit:engineer']).toEqual(oldLease);
    expect(observed.every(ids => !ids.includes('engineer'))).toBe(true);
    expect(conflicts.every(keys => !keys.includes('unit:engineer'))).toBe(true);
  });

  it('selects and assigns members by their own land post ETA rather than the final mine', () => {
    const { input } = fixture(), original = input.methods[1]!, action = original.actions[0]!;
    const posts = [{ id: 'home', target: { point: { x: 3000, y: 1000 }, landId: 'land:1' as const }, unitIds: [] },
      { id: 'island', target: { point: { x: 5000, y: 1000 }, landId: 'land:2' as const }, unitIds: [] }];
    const method: ExecutableMethod = { ...original, kind: 'staged-beachhead', stage: 'assembly', actions: [{ ...action, executor: 'strategy.assemble-force',
      intent: { kind: 'assemble-force', campTarget: action.target, requiredForce: 1, posts } }] };
    const situation = { ...input.situation, units: input.situation.units.map((unit, index) => ({ ...unit,
      location: { ...unit.location, kind: 'land' as const, landId: index ? 'land:2' as const : 'land:1' as const },
      arrivals: [{ targetId: action.id, arrival: { status: 'reachable' as const, ticks: index ? 1000 : 1, landTicks: 1, crossings: [] } },
        { targetId: assemblyPostArrivalId(action.id, posts[index]!.id),
          arrival: { status: 'reachable' as const, ticks: index ? 5 : 100, landTicks: index ? 5 : 100, crossings: [] } }] })) };
    const result = allocateStrategy({ ...input, situation, methods: [method], objectives: [{ ...input.objectives[1]!, kind: 'ConquerIsland' }],
      providers: input.providers.map(provider => ({ ...provider, materialize: request => ({ ...request.method,
        actions: request.method.actions.map(action => ({ ...action, unitIds: request.unitIds })) }), quote(request) {
          const quote = provider.quote(request);
          if (quote.status !== 'feasible') return quote;
          const occupation = request.unitIds.length * 10;
          return { ...quote, utility: { ...quote.utility, cost: [...quote.utility.cost, { code: 'occupation', value: occupation }],
            score: quote.utility.score - occupation } };
        } })) });
    expect(Object.values(result.memory.assignments)).toMatchObject([{ unitId: 'two', target: posts[1]!.target,
      stage: 'assigned', eta: { status: 'known', arrivalTick: 5 } }]);
  });

  it('counts selected lower-bound decisions once per think and retains their trace basis rather than counting trial quotes', () => {
    const { input, provider } = fixture(), calls: string[] = [];
    const basis = { kind: 'proven-lower-bound' as const, probabilityLower: .5, probabilityUpper: 1, unresolvedProbability: .5 };
    const bounded: AllocationMethodProvider = { ...provider, quote(request) {
      calls.push(request.valuation?.phase ?? 'gross');
      const quote = provider.quote(request);
      return quote.status === 'feasible' ? { ...quote, valuationBasis: basis } : quote;
    } };
    const request = { ...input, objectives: input.objectives.slice(1), methods: input.methods.slice(1), providers: [bounded] };
    const result = allocateStrategy(request);
    expect(calls.length).toBeGreaterThan(1);
    expect(result.memory.decisionCounts).toEqual({ lowerBoundSelections: 1, lowerBoundInitialSelections: 1 });
    expect(result.events.filter(event => event.kind === 'valuation-bound-selected')).toMatchObject([{ basis, renewal: false }]);
    expect(result.memory.objectives.single!.valuationBasis).toEqual(basis);
    expect(allocateStrategy({ ...request, previous: result.memory }).memory).toEqual(result.memory);
    const later = allocateStrategy({ ...request, previous: result.memory, snapshot: { ...request.snapshot, tick: 15 },
      situation: { ...request.situation, tick: 15 } });
    expect(later.memory.decisionCounts).toEqual({ lowerBoundSelections: 2, lowerBoundInitialSelections: 1 });
    expect(later.events.filter(event => event.kind === 'valuation-bound-selected')).toMatchObject([{ basis, renewal: true }]);
    expect(allocateStrategy({ ...request, previous: JSON.parse(JSON.stringify(result.memory)), snapshot: { ...request.snapshot, tick: 15 },
      situation: { ...request.situation, tick: 15 } })).toEqual(later);
  });

  it('lets valuable defense displace two assembly members by a formal delay bound and keeps progress for replacement supply', () => {
    const { input } = fixture(), ids = ['one', 'two', 'three', 'four'];
    const snapshot = { ...input.snapshot, units: [...ids.map(id => createUnit(id, 'player', 'footman', 1000, 1000)),
      createUnit('guard', 'neutral', 'ogreWarrior', 1100, 1000)] };
    const situation = { ...input.situation, units: ids.map(id => ({ ...input.situation.units[0]!, id })) };
    const objective = { ...input.objectives[0]!, kind: 'ConquerIsland' as const };
    const original = input.methods[0]!, campTarget = { ...objective.target, point: { x: 1100, y: 1000 } };
    const assembly: ExecutableMethod = { ...original, kind: 'staged-beachhead', stage: 'assembly', actions: [{ ...original.actions[0]!,
      executor: 'strategy.assemble-force', intent: { kind: 'assemble-force', campTarget, requiredForce: 5,
        posts: [{ id: 'home', target: objective.target, unitIds: ids }] } }] };
    const defense = { ...input.methods[1]!, demands: [{ ...input.methods[1]!.demands[0]!, strength: 2 }] };
    const basis = { kind: 'proven-lower-bound' as const, probabilityLower: .5, probabilityUpper: 1, unresolvedProbability: .5 };
    const provider: AllocationMethodProvider = { id: 'test-provider', buildMethods: () => [],
      materialize: request => ({ ...request.method, actions: request.method.actions.map(action => ({ ...action, unitIds: request.unitIds,
        ...(action.intent.kind === 'assemble-force' ? { intent: { ...action.intent,
          posts: action.intent.posts.map(post => ({ ...post, unitIds: request.unitIds })) } } : {}) })) }),
      quote(request) {
        const feasible = request.objective.id === 'pair' ? request.unitIds.length >= 4 : request.unitIds.length === 2;
        const reason = { code: 'explicit-contract-fixture', factIds: request.unitIds, values: {} };
        if (!feasible) return { methodId: request.method.id, status: 'blocked', utility: null, potentialUtility: null, force: null, reason,
          missingPreconditions: [{ id: `${request.method.id}/force`, kind: 'force', status: 'unmet', demand: request.method.demands[0]!, subgoalIds: [], reason }] };
        const valuation = resolveValuation({ objectiveId: request.objective.id, methodId: request.method.id, unitIds: request.unitIds,
          window: valuationWindow(0, request.valuation) }, request.valuation);
        if (valuation.phase === 'net' && valuation.opportunity?.status !== 'known') return { methodId: request.method.id, status: 'blocked',
          utility: null, potentialUtility: null, force: null, reason, missingPreconditions: [], valuation };
        const benefit = request.objective.id === 'pair' ? 100 : 1000;
        const cost = valuation.opportunity?.status === 'known' ? valuation.opportunity.gold : 0;
        return { methodId: request.method.id, status: 'feasible', force: null, potentialUtility: null, reason, missingPreconditions: [], valuation,
          ...(request.objective.id === 'pair' ? { valuationBasis: basis } : {}),
          utility: { horizonTicks: valuation.window.horizonTicks, successProbability: 1, persistenceBonus: 0,
            benefit: [{ code: 'conditional-value', value: benefit }], cost: [{ code: 'opportunity', value: cost }], score: benefit - cost } };
      } };
    const first = allocateStrategy({ ...input, snapshot, situation, objectives: [objective], methods: [assembly], providers: [provider] });
    const actionId = assembly.actions[0]!.id;
    const previous = { ...first.memory, executions: { ...first.memory.executions, [actionId]: { ...first.memory.executions[actionId]!,
      status: 'active' as const, phase: 'waiting-for-force', state: { checkpoint: 'preserved', arrivedUnitIds: ids } } },
      objectives: { ...first.memory.objectives, pair: { ...first.memory.objectives.pair!, minimumStayUntilTick: 0,
        challengerId: 'single', challengerThinks: 2 } } };
    const later: StrategyAllocationInput = { ...input, snapshot: { ...snapshot, tick: 500 }, situation: { ...situation, tick: 500 },
      previous, objectives: [objective, input.objectives[1]!], methods: [assembly, defense], providers: [provider], switchingCost: () => 10,
      assemblyDelayLossUpperBound: request => ({ status: 'known', bound: { targetId: 'post', gold: 300,
        continuationUpperGold: 300, window: request.window, mode: 'whole-value-cap',
        components: [{ code: 'finite-continuation-cap', valueGold: 300, factIds: ['post'] }] } }) };
    const displaced = allocateStrategy(later);
    expect(displaced.memory.objectives.pair!.assignmentIds).toHaveLength(2);
    expect(displaced.memory.objectives.single!.assignmentIds).toHaveLength(2);
    expect(displaced.memory.executions[actionId]!.token).toEqual(previous.executions[actionId]!.token);
    expect(displaced.memory.executions[actionId]!.state).toEqual(previous.executions[actionId]!.state);
    expect(displaced.events.find(event => event.kind === 'preempted')).toMatchObject({ handoff: 'shrink',
      quotation: { displacedLossGold: 300, switchingCostGold: 10, displacedLoss: { kind: 'assembly-delay-upper-bound' } } });
    const blocked = allocateStrategy({ ...later, assemblyDelayLossUpperBound: () => ({ status: 'unknown', reasonCode: 'assembly-continuation-value-unknown' }) });
    expect(blocked.memory.objectives.pair!.assignmentIds).toHaveLength(4);
    expect(blocked.events.some(event => event.kind === 'preempted')).toBe(false);
    expect(blocked.memory.decisionCounts!.assemblyValueUnknownComparisons).toBeGreaterThan(0);
    const newIds = ['replacement-a', 'replacement-b'];
    const refillSnapshot = { ...later.snapshot, tick: 515,
      units: [...later.snapshot.units, ...newIds.map(id => createUnit(id, 'player', 'footman', 1000, 1000))] };
    const refilled = allocateStrategy({ ...later, previous: displaced.memory, snapshot: refillSnapshot,
      situation: { ...later.situation, tick: 515, units: [...situation.units, ...newIds.map(id => ({ ...situation.units[0]!, id }))] } });
    expect(refilled.memory.objectives.pair!.assignmentIds).toHaveLength(4);
    expect(refilled.memory.executions[actionId]!.token).toEqual(previous.executions[actionId]!.token);
    expect(refilled.memory.executions[actionId]!.state.checkpoint).toBe('preserved');
    const grant = refilled.grants.find(grant => grant.methodId === assembly.id)!;
    const continued = assembleForceExecutor.execute({ snapshot: refillSnapshot, owner: 'player', objective,
      method: refilled.memory.methods[assembly.id]!, execution: refilled.memory.executions[actionId]!, grant, events: refilled.events });
    expect(continued.status).toBe('active'); expect(continued.state.checkpoint).toBe('preserved');
    expect(continued.state.arrivedUnitIds).toHaveLength(4);
  });

  it('publishes loading-stage epochs without requiring later legs and preserves them after actual boarding', () => {
    const { input, method } = fixture(), tick = 100;
    const departure = { point: { x: 1000, y: 1000 }, landId: 'land:1' as const };
    const destination = { entityId: 'post', point: { x: 3000, y: 1000 }, landId: 'land:2' as const };
    const crossing = { seaId: 'sea:1' as const, shipId: 'two', departure: departure.point, landing: destination.point,
      waitTicks: 0, boardingTicks: 30, sailingTicks: 100, unloadingTicks: 0, requiresNewShip: false as const };
    const voyage: PlannedVoyage = { id: 'physical-voyage', actionId: 'single/act', ship: { kind: 'existing', unitId: 'two' },
      unitIds: ['one'], departure, destination, departureGround: departure, landingGround: destination, crossing, required: true };
    const original = method('single');
    const transport: ExecutableMethod = { ...original, voyagePlans: [voyage], actions: original.actions.map(action => ({ ...action,
      executor: 'strategy.transport', intent: { kind: 'load' }, target: destination,
      demands: [...action.demands, { kind: 'transport', payloadMass: 1, seaId: 'sea:1',
        departure: departure.point, landing: destination.point }] })) };
    const request: StrategyAllocationInput = { ...input, snapshot: { ...input.snapshot, tick,
      units: [input.snapshot.units[0]!, createUnit('two', 'player', 'transport', 1000, 1000)] },
      situation: { ...input.situation, tick, units: input.situation.units.map(unit => ({ ...unit,
        ...(unit.id === 'two' ? { kind: 'transport' as const, roles: ['transport' as const] } : {}),
        arrivals: [{ targetId: 'post', arrival: { status: 'reachable', ticks: 200, landTicks: 0, crossings: [crossing] } }] })) },
      objectives: [{ ...input.objectives[1]!, kind: 'ConquerIsland', target: destination }], methods: [transport],
      providers: [{ ...input.providers[0]!, materialize: value => ({ ...value.method,
        voyagePlans: value.unitIds.includes('one') && value.unitIds.includes('two') ? [voyage] : [] }) }],
      fixedVoyageArrival: () => ({ status: 'unknown', reason: { code: 'later-leg-unpublished', detail: 'later-leg-unpublished', evidence: [] } }),
      fixedVoyageLoading: () => ({ status: 'known', forecastTick: tick, walkTicks: 50, approachTicks: 20,
        boardingTicks: 30, expectedLoadedTick: tick + 100 }) };
    const first = allocateStrategy(request);
    expect(first.memory.voyages[voyage.id]).toMatchObject({ expectedFreeTick: null, expectedLoadedTick: 200, loadingForecastTick: 100 });
    const later = { ...request, previous: first.memory, snapshot: { ...request.snapshot, tick: 115 }, situation: { ...request.situation, tick: 115 } };
    const stale = allocateStrategy(later);
    expect(stale.memory.voyages[voyage.id]).toMatchObject({ expectedLoadedTick: null, loadingForecastTick: null });
    const missing = allocateStrategy({ ...later, fixedVoyageLoading: () => ({ status: 'unknown', reasonCode: 'loading-route-unpublished' }) });
    expect(missing.memory.voyages[voyage.id]).toMatchObject({ expectedLoadedTick: null, loadingForecastTick: null });
    const boarded: StrategyAllocationInput = { ...later, snapshot: { ...later.snapshot,
      units: later.snapshot.units.map(unit => unit.id === 'one' ? { ...unit, deck: { shipId: 'two', x: 0, y: 0 } } : unit) },
      situation: { ...later.situation, units: later.situation.units.map(unit => unit.id === 'one'
        ? { ...unit, location: { kind: 'aboard', shipId: 'two', compartment: 'deck', point: departure.point, seaId: 'sea:1' } } : unit) } };
    expect(allocateStrategy(boarded).memory.voyages[voyage.id]).toMatchObject({ expectedLoadedTick: 200, loadingForecastTick: 100 });
    expect(allocateStrategy({ ...boarded, previous: JSON.parse(JSON.stringify(first.memory)) })).toEqual(allocateStrategy(boarded));
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

  it('admits only imported losses by a same-window upper bound and records its composition', () => {
    const { input } = fixture();
    const initial = allocateStrategy({ ...input, objectives: input.objectives.slice(0, 1), methods: input.methods.slice(0, 1) });
    const previous = { ...initial.memory, leases: Object.fromEntries(Object.entries(initial.memory.leases).map(([key, lease]) => [key,
      { ...lease, origin: 'imported-task' as const, incumbentTask: { source: 'naval.ferries', taskId: 'observed-old-ferry' } }])) };
    const later: StrategyAllocationInput = { ...input, objectives: input.objectives.slice(1), methods: input.methods.slice(1), previous,
      snapshot: { ...input.snapshot, tick: 500 }, situation: { ...input.situation, tick: 500 }, switchingCost: () => 50,
      handoffImported: requests => requests.map(request => ({ eventId: request.eventId, disposition: 'shrink' })) };
    const bounded = (gold: number): NonNullable<StrategyAllocationInput['importedUpperBound']> => (_id, window) => ({
      targetId: 'mine', gold, window, components: [{ code: 'full-potential', valueGold: gold, factIds: ['mine'] }] });
    const unknown = allocateStrategy(later);
    expect(unknown.memory.leases['unit:one']!.objectiveId).toBe('pair');
    let memory: StrategyAllocationMemory = previous;
    for (let think = 0; think < 3; think++) {
      const request = { ...later, previous: memory, snapshot: { ...later.snapshot, tick: 500 + think * 15 },
        situation: { ...later.situation, tick: 500 + think * 15 }, importedUpperBound: bounded(100) };
      const result = allocateStrategy(request);
      expect(JSON.stringify(allocateStrategy({ ...request, previous: JSON.parse(JSON.stringify(memory)) }))).toBe(JSON.stringify(result));
      memory = result.memory;
    }
    expect(memory.leases['unit:one']!.objectiveId).toBe('single');
    expect(memory.events.find(event => event.kind === 'preempted')).toMatchObject({ kind: 'preempted',
      quotation: { marginalBenefitGold: 300, displacedLossGold: 100, switchingCostGold: 50,
        displacedLoss: { kind: 'upper-bound', bound: { targetId: 'mine', gold: 100,
          components: [{ code: 'full-potential', valueGold: 100, factIds: ['mine'] }] } } } });
    const ready = { ...previous, objectives: { pair: { ...previous.objectives.pair!, challengerId: 'single', challengerThinks: 2 } } };
    expect(allocateStrategy({ ...later, previous: ready, importedUpperBound: bounded(250) }).memory.leases['unit:one']!.objectiveId).toBe('pair');
    expect(allocateStrategy({ ...later, previous: ready, importedUpperBound: bounded(0) }).memory.leases['unit:one']!.objectiveId).toBe('single');
    let calls = 0;
    const formal = allocateStrategy({ ...later, previous: initial.memory, importedUpperBound: (...args) => { calls++; return bounded(0)(...args); } });
    expect(calls).toBe(0);
    expect(formal.memory.leases['unit:one']!.objectiveId).toBe('pair');
  });

  it('transfers matched imported progress without displacement or challenger delay, while still requiring producer acknowledgement', () => {
    const { input } = fixture();
    const initial = allocateStrategy({ ...input, objectives: input.objectives.slice(0, 1), methods: input.methods.slice(0, 1) });
    const previous = { ...initial.memory, leases: Object.fromEntries(Object.entries(initial.memory.leases).map(([key, lease]) => [key,
      { ...lease, origin: 'imported-task' as const, incumbentTask: { source: 'naval.ferries', taskId: 'observed-old-ferry' } }])) };
    const later: StrategyAllocationInput = { ...input, objectives: input.objectives.slice(1), methods: input.methods.slice(1), previous,
      snapshot: { ...input.snapshot, tick: 15 }, situation: { ...input.situation, tick: 15 },
      continuesImported: (from, to) => from === 'pair' && to === 'single', switchingCost: () => 0,
      importedUpperBound: () => { throw Error('same goal progress charged a displacement envelope'); } };
    expect(allocateStrategy(later).memory.leases['unit:one']!.objectiveId).toBe('pair');
    const result = allocateStrategy({ ...later, handoffImported: requests => requests.map(request => ({ eventId: request.eventId, disposition: 'shrink' })) });
    expect(result.memory.leases['unit:one']!.objectiveId).toBe('single');
    expect(result.events.find(event => event.kind === 'preempted')).toMatchObject({ kind: 'preempted',
      quotation: { displacedLossGold: 0, switchingCostGold: 0, reason: { code: 'same-goal-imported-progress' } } });
    expect(allocateStrategy({ ...later, previous: initial.memory }).memory.leases['unit:one']!.objectiveId).toBe('pair');
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
      methods: input.methods.slice(1).map(method => ({ ...method, kind: 'main-army-recall' as const,
        actions: method.actions.map(action => ({ ...action, target })) })) };
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

  it('keeps a temporarily unpriced commitment while refreshing its current ETA', () => {
    const { input, provider } = fixture(), first = allocateStrategy({ ...input, objectives: input.objectives.slice(1), methods: input.methods.slice(1) });
    const blocked: AllocationMethodProvider = { ...provider, quote(request) { return { methodId: request.method.id,
      status: 'blocked', utility: null, potentialUtility: null, force: null, missingPreconditions: [],
      reason: { code: 'new-route-still-evaluating', factIds: [], values: {} } }; } };
    const result = allocateStrategy({ ...input, previous: first.memory, providers: [blocked], snapshot: { ...input.snapshot, tick: 15 },
      situation: { ...input.situation, tick: 15, units: input.situation.units.map(unit => ({ ...unit,
        arrivals: [{ targetId: 'post', arrival: { status: 'reachable', ticks: 50, landTicks: 50, crossings: [] } }] })) } });
    expect(result.memory.leases['unit:one']).toEqual(first.memory.leases['unit:one']);
    expect(result.memory.assignments['assignment:one']!.eta).toEqual({ status: 'known', forecastTick: 15, arrivalTick: 65 });
  });

  it.each(['DefendSite', 'Evacuate'] as const)('releases %s authority when this think proves the site threat has cleared', kind => {
    const { input } = fixture(), first = allocateStrategy({ ...input, objectives: input.objectives.slice(1), methods: input.methods.slice(1) });
    const objective = { ...input.objectives[1]!, kind, status: kind === 'DefendSite' ? 'complete' as const : 'abandoned' as const };
    const clear = { siteId: 'post', horizonTicks: 900, attackers: [], arrivedStrength: 0, incomingStrength: 0,
      friendlyOnStationStrength: 0, firstArrivalTicks: null, lossProbability: 0 };
    const later = { ...input, objectives: [objective], previous: first.memory, snapshot: { ...input.snapshot, tick: 15 },
      situation: { ...input.situation, tick: 15, lands: [{ id: 'land:1' as const, anchor: objective.target.point,
        assetIds: [], unitIds: ['one', 'two'], adjacentSeaIds: [], threats: [clear] }] } };
    const result = allocateStrategy(later);
    expect(result.memory.leases).toEqual({});
    expect(result.memory.assignments).toEqual({});
    expect(result.memory.objectives.single!.status).toBe(objective.status);
    expect(result.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'parent-invalidated',
      reason: { code: 'current-site-threat-cleared', factIds: ['post'], values: {} } })]));
    expect(JSON.stringify(allocateStrategy({ ...later, previous: JSON.parse(JSON.stringify(first.memory)) }))).toBe(JSON.stringify(result));
    const missing = allocateStrategy({ ...later, situation: { ...later.situation, lands: [] } });
    expect(missing.memory.leases['unit:one']).toBeDefined();
    const tower = createBuilding('hostile-cover', 'enemy', 'defenseTower', 1100, 1000, true);
    const underTower = allocateStrategy({ ...later, snapshot: { ...later.snapshot,
      buildings: [...later.snapshot.buildings, tower] } });
    expect(underTower.memory.leases['unit:one']).toBeDefined();
  });

  it('releases a terminal graph and records a disappeared assignee as a vacancy without inventing a preemption', () => {
    const { input } = fixture(), first = allocateStrategy({ ...input, objectives: input.objectives.slice(1), methods: input.methods.slice(1) });
    const action = Object.values(first.memory.executions)[0]!;
    const complete = allocateStrategy({ ...input, methods: [], objectives: [], snapshot: { ...input.snapshot, tick: 15 },
      previous: { ...first.memory, executions: { [action.token.actionId]: { ...action, status: 'complete' } } } });
    expect(complete.memory.leases).toEqual({}); expect(complete.memory.assignments).toEqual({});
    expect(complete.memory.objectives.single!.status).toBe('complete');
    const missing = allocateStrategy({ ...input, methods: [], objectives: [], snapshot: { ...input.snapshot, tick: 15,
      units: input.snapshot.units.filter(unit => unit.id !== 'one') }, situation: { ...input.situation, tick: 15,
      units: input.situation.units.filter(unit => unit.id !== 'one') }, previous: first.memory });
    expect(missing.memory.leases['unit:one']).toBeUndefined();
    expect(Object.values(missing.memory.vacancies)[0]!.reason.code).toBe('observed-assignee-no-longer-present');
    expect(missing.events.some(event => event.kind === 'preempted')).toBe(false);
  });

  it('requires a fresh old-method price and explicit switch cost before replacing an active method', () => {
    const { input, provider } = fixture(), methods = input.methods.slice(0, 1);
    const first = allocateStrategy({ ...input, objectives: input.objectives.slice(0, 1), methods });
    const replacement = { ...methods[0]!, id: `${methods[0]!.id}/replacement`, actions: methods[0]!.actions.map(action => ({ ...action, id: `${action.id}/replacement` })) };
    const repricing: AllocationMethodProvider = { ...provider, quote(request) {
      const quote = provider.quote(request);
      return quote.status === 'feasible' && request.method.id === replacement.id ? { ...quote,
        utility: { ...quote.utility, score: quote.utility.score! + 200,
          benefit: [...quote.utility.benefit, { code: 'better-current-post', value: 200 }] } } : quote;
    } };
    const later = { ...input, objectives: input.objectives.slice(0, 1), methods: [...methods, replacement], providers: [repricing],
      previous: first.memory, snapshot: { ...input.snapshot, tick: 500 }, situation: { ...input.situation, tick: 500 } };
    expect(allocateStrategy(later).memory.objectives.pair!.methodId).toBe(methods[0]!.id);
    const switched = allocateStrategy({ ...later, switchingCost: () => 0 });
    expect(switched.memory.objectives.pair!.methodId).toBe(replacement.id);
    expect(switched.memory.executions[methods[0]!.actions[0]!.id]).toBeUndefined();
    expect(Object.values(switched.memory.leases).every(lease => lease.methodId === replacement.id)).toBe(true);
    expect(switched.events.some(event => event.reason.code === 'same-objective-method-replaced-after-current-requote')).toBe(true);
  });

  it('hands a completed expansion garrison to formal defense without an idle interval or a priced preemption', () => {
    const { input } = fixture(), first = allocateStrategy({ ...input, objectives: input.objectives.slice(0, 1), methods: input.methods.slice(0, 1) });
    const old = Object.values(first.memory.executions)[0]!;
    const previous = { ...first.memory, executions: { [old.token.actionId]: { ...old, executor: 'strategy.establish-garrison',
      status: 'complete' as const, state: { hallId: 'post' } } } };
    const transferred = allocateStrategy({ ...input, previous, objectives: input.objectives.slice(1), methods: input.methods.slice(1),
      snapshot: { ...input.snapshot, tick: 15 }, situation: { ...input.situation, tick: 15 } });
    expect(Object.values(transferred.memory.leases).map(lease => lease.id).sort()).toEqual(Object.values(first.memory.leases).map(lease => lease.id).sort());
    expect(Object.values(transferred.memory.leases).every(lease => lease.objectiveId === 'single')).toBe(true);
    expect(transferred.memory.executions[old.token.actionId]!.state.leasesTransferredTo).toBe('single');
    expect(transferred.events.find(event => event.reason.code === 'observed-expansion-garrison-to-defense')).toMatchObject({
      kind: 'lease-transferred', fromObjectiveId: 'pair', toObjectiveId: 'single' });
    expect(transferred.events.some(event => event.kind === 'preempted')).toBe(false);
  });
});


it('keeps proposed idle reservations eligible without erasing their observation facts', () => {
  const { input } = fixture();
  const situation = { ...input.situation, units: input.situation.units.map(unit => ({ ...unit, commitments: [{
    source: 'landExpansion', taskId: 'candidate', objectiveId: 'old-candidate', role: 'frontline' as const }] })) };
  const snapshot = structuredClone(input.snapshot), memory = createStrategyAllocationMemory('player', snapshot.tick);
  snapshot.units[0]!.order = { type: 'idle' };
  snapshot.units[1]!.order = { type: 'move', x: 1200, y: 1000 };
  expect(allocationResponseCandidates(snapshot, situation, memory)).toEqual(['one']);
  expect(situation.units.every(unit => unit.commitments.length === 1)).toBe(true);
  const held = { ...memory, leases: { 'unit:one': { id: 'lease:one', resourceKey: 'unit:one' as const,
    objectiveId: 'guard', methodId: 'guard/method', action: { actionId: 'guard/act', generation: 1 },
    sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator' as const, incumbentTask: null } } };
  expect(allocationResponseCandidates(snapshot, situation, held)).toEqual([]);
  const fork = JSON.parse(JSON.stringify(held));
  expect(allocationResponseCandidates(snapshot, situation, fork)).toEqual([]);
});
