import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating } from '../policy/v6/strength';
import { assessAllocatedForce } from './allocated-force';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import { FactWorkQueue } from './fact-work';
import { goalFact } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import { createGoalNavalCombatGrounding, type GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalCombatOption, GoalEntityReference, GoalEstimate, GoalPlanningContext } from './goal-planner-types';
import { createGoalFactReader, createGoalWorldFactMemory } from './goal-world-facts';
import { landIdAt, seaIdAt, regionIndex } from './regions';
import { evaluateSituation, situationConstructionCount } from './situation';
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['published-risk'] });
const ref = (entityId: string): GoalEntityReference => ({ kind: 'existing', entityId });
function fixture(overrides: Partial<GoalNavalCombatGroundingPorts> = {}) {
  const snapshot = snapshotGame(sketchScene('actual-naval-combat-grounding').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us', race: 'grove' }).player('foe', { team: 'foe', race: 'ember' })
    .townHall('us', 1400, 1400, { id: 'hall' })
    .unit('us', 'footman', 800, 1200, { id: 'fighter-a', hp: 60 })
    .unit('us', 'archer', 820, 1220, { id: 'fighter-b', hp: 50 })
    .worker('us', 780, 1260, { id: 'rescue-worker' }).worker('us', 900, 1250, { id: 'other-worker' })
    .unit('foe', 'emberRavager', 1500, 1400, { id: 'intruder', order: { type: 'attack', targetId: 'hall' } })
    .build().createGame());
  regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
  const work = new FactWorkQueue(snapshot.tick, 0), landRoute: AllocationLandRouteReader = overrides.landRoute
    ?? ((from, to) => ({ status: 'known', points: [from, to], distance: Math.hypot(from.x - to.x, from.y - to.y) }));
  const ports: GoalNavalCombatGroundingPorts = {
    landRoute, arrival: vi.fn(() => ({ status: 'reachable' as const, ticks: 20, landTicks: 20, crossings: [] })),
    resolveCohort: refs => ({ state: 'met', candidates: refs.flatMap(reference => {
      const unit = reference.kind === 'existing' ? snapshot.units.find(unit => unit.id === reference.entityId) : undefined;
      return unit ? [{ reference, assessment: unit }] : [];
    }), factIds: ['actual-snapshot-members'] }),
    movementRisk: () => known({ expectedLossGold: 11, survivalProbability: .8 }), ...overrides,
  };
  const site = { entityId: 'hall', landId: landIdAt(snapshot.map, { x: 1400, y: 1400 })!, point: { x: 1400, y: 1400 } };
  const at = { landId: site.landId, point: { x: 1000, y: 1000 } };
  let context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_knight', readFact: () => { throw Error('reader not bound'); } };
  const readFact = createGoalFactReader({ ...context, memory: createGoalWorldFactMemory('us'), ports: {
    geometryRevision: 'published-domain-boundary', reservedGold: 0,
    geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory: { version: 1, entries: [] } }),
    regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point), landRoute,
  } });
  context = { ...context, readFact };
  const factory = createGoalNavalCombatGrounding(context, ports);
  context = { ...context, grounding: { buildSites: () => { throw Error('private economic selection'); },
    productionOptions: () => { throw Error('private economic selection'); }, transportOptions: () => { throw Error('private transport selection'); },
    resolveCohort: ports.resolveCohort, ...factory } };
  return { snapshot, situation, context, site, at, ports, work, read: factory.combatOptions! };
}
function options(result: ReturnType<NonNullable<ReturnType<typeof createGoalNavalCombatGrounding>['combatOptions']>>): readonly GoalCombatOption[] {
  expect(result.state).toBe('met'); if (result.state !== 'met') throw Error(JSON.stringify(result)); return result.candidates;
}

function hullFixture() {
  const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const ship = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
  const regions = regionIndex(snapshot.map), seaId = seaIdAt(snapshot.map, ship)!;
  const shore = regions.shores.find(shore => shore.seaId === seaId
    && Math.hypot(shore.water.x - ship.x, shore.water.y - ship.y) > ship.radius)!;
  const context: GoalPlanningContext = { snapshot, owner, situation: evaluateSituation(snapshot, owner, createAiPolicyMemory()),
    tick: snapshot.tick, version: 'v9_knight', precision: 'coarse',
    readFact: () => { throw Error('coarse hull requested a fact'); } };
  const effect = goalFact({ kind: 'transport-at', transport: ref(ship.id), at: { seaId, point: shore.water },
    tolerance: ship.radius, byTick: snapshot.tick + 2000 });
  const forbidden = vi.fn(() => { throw Error('coarse hull requested private exact work'); });
  const ports: GoalNavalCombatGroundingPorts = { arrival: forbidden, landRoute: forbidden, resolveCohort: forbidden,
    transportFacts: { seaLeg: forbidden }, movementRisk: forbidden, readGroundPoint: forbidden };
  return { snapshot, ship, context, effect, ports, forbidden };
}

describe('coarse transport time from the published sea field', () => {
  it('retains the supplied sailing estimate and its dependencies without exact work', () => {
    const f = hullFixture(), before = JSON.stringify(f.snapshot);
    const estimate: GoalEstimate<number> = { state: 'met', value: 2843, factIds: ['published-sea-field', 'native-sailing-profile'] };
    const coarseSeaTicks = vi.fn(() => estimate);
    const factory = createGoalNavalCombatGrounding(f.context, { ...f.ports, coarseSeaTicks });
    const row = strict(() => options(factory.combatOptions!(f.effect)))[0]!;
    expect(row.duration).toEqual(estimate);
    expect(coarseSeaTicks).toHaveBeenCalledTimes(1);
    expect(coarseSeaTicks).toHaveBeenCalledWith(f.ship, { x: f.ship.x, y: f.ship.y },
      f.effect.predicate.kind === 'transport-at' ? f.effect.predicate.at.point : undefined, false);
    expect(row.preconditions).toHaveLength(1);
    expect(row.preconditions[0]!.predicate).toMatchObject({ kind: 'route', mover: 'sea', actor: ref(f.ship.id) });
    expect(f.forbidden).not.toHaveBeenCalled(); expect(JSON.stringify(f.snapshot)).toBe(before);
  });

  it.each(['pending', 'unmet'] as const)('preserves a %s field estimate instead of substituting straight-line time', state => {
    const f = hullFixture();
    const reason = { code: 'published-sea-time-unavailable', factIds: ['sea-field-version'], values: {} };
    const estimate: GoalEstimate<number> = state === 'pending'
      ? { state, requestIds: ['existing-sea-field-request'], reason } : { state, reason };
    const factory = createGoalNavalCombatGrounding(f.context, { ...f.ports, coarseSeaTicks: () => estimate });
    expect(strict(() => options(factory.combatOptions!(f.effect)))[0]!.duration).toEqual(estimate);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('keeps the inclusive arrival tolerance at zero without consulting an unavailable field', () => {
    const f = hullFixture();
    if (f.effect.predicate.kind !== 'transport-at') throw Error('transport fixture');
    const coarseSeaTicks = vi.fn(() => { throw Error('an arrived hull must not wait for a sea field'); });
    const factory = createGoalNavalCombatGrounding(f.context, { ...f.ports, coarseSeaTicks });
    for (const tolerance of [0, f.ship.radius]) {
      const effect = goalFact({ ...f.effect.predicate,
        at: { ...f.effect.predicate.at, point: { x: f.ship.x + tolerance, y: f.ship.y } }, tolerance });
      expect(strict(() => options(factory.combatOptions!(effect)))[0]!.duration)
        .toEqual({ state: 'met', value: 0, factIds: [effect.id] });
    }
    expect(coarseSeaTicks).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('keeps the no-port estimate compatible and leaves the exact sea-leg contract untouched', () => {
    const f = hullFixture();
    if (f.effect.predicate.kind !== 'transport-at') throw Error('transport fixture');
    const point = f.effect.predicate.at.point;
    const fallback = createGoalNavalCombatGrounding(f.context, f.ports);
    expect(strict(() => options(fallback.combatOptions!(f.effect)))[0]!.duration).toEqual({ state: 'met', factIds: [f.effect.id],
      value: Math.ceil(Math.hypot(point.x - f.ship.x, point.y - f.ship.y) / Math.max(1, f.ship.speed) * SIM_TICKS_PER_SECOND) });
    const coarseSeaTicks = vi.fn(() => { throw Error('exact hull consulted the coarse field'); });
    const exact = createGoalNavalCombatGrounding({ ...f.context, precision: 'exact' }, { ...f.ports, coarseSeaTicks,
      transportFacts: { seaLeg: () => ({ state: 'met', factIds: ['exact-native-route'], value: {
        ticks: 321, endpoint: point, heading: f.ship.sailing!.heading,
      } }) } });
    expect(strict(() => options(exact.combatOptions!(f.effect)))[0]!.duration)
      .toEqual({ state: 'met', value: 321, factIds: ['exact-native-route'] });
    expect(coarseSeaTicks).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
});

describe('naval combat grounding on actual observation cohorts', () => {
  it('quotes rolling defend response and movement only within current support while keeping the full obligation', () => {
    const movementRisk = vi.fn<NonNullable<GoalNavalCombatGroundingPorts['movementRisk']>>(() => known({ expectedLossGold: 11, survivalProbability: .8 }));
    const f = fixture({ movementRisk }), before = JSON.stringify(f.snapshot);
    const short = goalFact({ kind: 'site-safe', site: f.site, throughTick: f.snapshot.tick + f.situation.horizonTicks });
    const long = goalFact({ kind: 'site-safe', site: f.site, throughTick: f.snapshot.tick + 12000 });
    const current = options(f.read(short)).find(option => option.cohort.length === 2)!;
    const retained = options(f.read(long)).find(option => option.cohort.length === 2)!;
    expect(current.cost.state).toBe('met'); expect(retained.cost.state).toBe('met');
    if (current.cost.state !== 'met' || retained.cost.state !== 'met') throw Error('current response missing');
    expect(retained.cost.value.map(term => ({ code: term.code, gold: term.gold })))
      .toEqual(current.cost.value.map(term => ({ code: term.code, gold: term.gold })));
    expect(retained.cost.value.some(term => term.gold > 0)).toBe(true);
    if (current.successProbability.state !== 'met' || retained.successProbability.state !== 'met') throw Error('current P missing');
    expect(retained.successProbability.value).toBe(current.successProbability.value);
    expect(retained.successProbability.value).toBeLessThan(1);
    expect(retained.duration).toMatchObject({ state: 'met', value: 12000 });
    expect(retained.byTick).toBe(f.snapshot.tick + 12000);
    expect(movementRisk.mock.calls.every(([request]) => request.throughTick <= f.snapshot.tick + f.situation.horizonTicks)).toBe(true);
    const action = goalNavalActionProvider.actionsFor(long, f.context).find(action => (action.executor.parameters.cohort as unknown[]).length === 2)!;
    expect(action.effects[0]!.fact).toEqual(long);
    expect(action.executor.parameters.throughTick).toBe(f.snapshot.tick + 12000);
    expect(action.demands.every(demand => demand.until === 'finish')).toBe(true);
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });

  it.each(['risk', 'response'] as const)('retains unknown current %s in rolling defend quotes', field => {
    const unquoted = { state: 'pending' as const, requestIds: ['current-march-risk'], reason: { code: 'current-march-risk', factIds: [], values: {} } };
    const f = fixture({ movementRisk: field === 'risk' ? () => unquoted : () => known({ expectedLossGold: 11, survivalProbability: .8 }) });
    const site = field === 'response' ? { ...f.site, entityId: 'unpublished-protected-site' } : f.site;
    const effect = goalFact({ kind: 'site-safe', site, throughTick: f.snapshot.tick + 12000 });
    const result = f.read(effect);
    if (field === 'response') expect(result).toMatchObject({ state: 'pending', reason: { code: 'combat-candidate-facts-pending' } });
    else {
      const row = options(result).find(option => option.cohort.length === 2)!;
      expect(row.cost).toMatchObject({ state: 'pending', requestIds: ['current-march-risk'] });
      expect(row.successProbability.state).toBe('pending');
    }
  });
  it('offers local defense with a native combat-rating requirement and the same physical post in declaration/execution', () => {
    const f = fixture(), effect = goalFact({ kind: 'site-safe', site: f.site, throughTick: 900 });
    const before = JSON.stringify(f.snapshot), count = situationConstructionCount(), rows = strict(() => options(f.read(effect)));
    expect(rows).toHaveLength(3); // Actual whole land group and each contributor.
    const full = rows.find(row => row.cohort.length === 2)!;
    const foe = f.snapshot.units.find(unit => unit.id === 'intruder')!;
    expect(full.requiredForce).toBeCloseTo(effectiveCombatRating(f.snapshot, foe) * 1.25, 12);
    const threat = f.situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === 'hall')!;
    expect(full.requiredForce).not.toBeCloseTo((threat.arrivedStrength + threat.incomingStrength) * 1.25, 5);
    expect(full.cost.state).toBe('met'); expect(full.successProbability.state).toBe('met');
    expect(full.target.point).not.toEqual(f.site.point);
    const action = strict(() => goalNavalActionProvider.actionsFor(effect, f.context)).find(action =>
      Array.isArray(action.executor.parameters.cohort) && action.executor.parameters.cohort.length === 2)!;
    expect(action.kind).toBe('defend'); expect(action.executor.parameters.at).toEqual(full.target);
    expect(action.executor.parameters.protectedSite).toEqual(f.site);
    expect(action.effects[0]!.fact).toEqual(effect); expect(action.effects[0]!.at).toEqual({ offsetTicks: 20 });
    expect(situationConstructionCount()).toBe(count); expect(JSON.stringify(f.snapshot)).toBe(before);
    expect(strict(() => f.read(effect))).toEqual(f.read(effect));
    strict(() => f.work.flush()); expect(f.work.receipt.used).toBe(0);
  });

  it('keeps shared route requests and unquoted risk pending rather than giving zero cost or P=1', () => {
    const f = fixture({ landRoute: () => ({ status: 'unknown', reasonCode: 'same-owner-field-pending' }) });
    const effect = goalFact({ kind: 'force-at', at: f.at, minimum: 3, metric: 'field-strength', byTick: 900 });
    const rows = strict(() => options(f.read(effect)));
    expect(rows.every(row => row.duration.state === 'pending' && row.cost.state === 'pending' && row.successProbability.state === 'pending')).toBe(true);
    expect(f.ports.arrival).not.toHaveBeenCalled();
    for (const row of rows) {
      expect(row.preconditions.length).toBe(row.cohort.length);
      if (row.duration.state === 'pending') expect(row.duration.requestIds).toEqual(row.preconditions.map(fact => f.context.readFact(fact))
        .flatMap(observed => observed.state === 'pending' ? [observed.requestId] : []).sort());
    }
    const missing = fixture();
    const noRisk = createGoalNavalCombatGrounding(missing.context, { arrival: missing.ports.arrival, landRoute: missing.ports.landRoute,
      resolveCohort: missing.ports.resolveCohort });
    const first = options(strict(() => noRisk.combatOptions!(goalFact({ kind: 'site-safe', site: missing.site, throughTick: 900 }))))[0]!;
    expect(first.cost).toMatchObject({ state: 'pending', reason: { code: 'combat-movement-risk-unquoted' } });
    expect(first.successProbability.state).toBe('pending');
  });

  it('evacuates only the named real workers and uses the published movement loss/probability', () => {
    const f = fixture(), effect = goalFact({ kind: 'assets-safe', unitIds: ['rescue-worker'], at: f.at, throughTick: 900 });
    const rows = strict(() => options(f.read(effect)));
    expect(rows).toHaveLength(1); expect(rows[0]!.cohort).toEqual([ref('rescue-worker')]);
    expect(rows[0]!.cost).toMatchObject({ state: 'met', value: [{ code: 'combat-movement-loss', gold: 11 }] });
    expect(rows[0]!.successProbability).toMatchObject({ state: 'met', value: .8 });
    const action = strict(() => goalNavalActionProvider.actionsFor(effect, f.context))[0]!;
    expect(action.kind).toBe('evacuate'); expect(action.executor.parameters.unitIds).toEqual(['rescue-worker']);
    expect(JSON.stringify(action)).not.toContain('other-worker');
    expect(action.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(true);
  });

  it('contributes actual field strength without relabelling its goal minimum or its resource flows', () => {
    const f = fixture(), cohort = [ref('fighter-a'), ref('fighter-b')];
    const effect = goalFact({ kind: 'force-at', at: f.at, cohort, minimum: 37, metric: 'field-strength', byTick: 900 });
    const actions = strict(() => goalNavalActionProvider.actionsFor(effect, f.context));
    expect(actions).toHaveLength(1); const action = actions[0]!;
    const actual = f.snapshot.units.filter(unit => ['fighter-a', 'fighter-b'].includes(unit.id));
    const measured = assessAllocatedForce('us', actual, { metric: 'field-strength', requiredForce: 0 }).force;
    expect(action.effects.find(effect => effect.fact.predicate.kind === 'force-at' && effect.fact.predicate.metric === 'field-strength')?.fact.predicate)
      .toMatchObject({ minimum: measured, cohort });
    expect(action.flows.filter(flow => flow.resource.kind === 'force').every(flow => flow.resource.kind === 'force' && flow.resource.metric === 'combat-rating')).toBe(true);
    expect(action.preconditions.find(fact => fact.predicate.kind === 'force-available')?.predicate).toMatchObject({ metric: 'combat-rating' });
    expect(action.preconditions.some(fact => fact.predicate.kind === 'assembly-post')).toBe(true);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(false);
  });

  it('does not recruit interrupted/excluded/foreign members, substitute private future IDs, or ignore an unreachable road', () => {
    const f = fixture({ allowedUnitIds: ['fighter-a', 'fighter-b'], interruptedUnitIds: ['fighter-b'] });
    const effect = goalFact({ kind: 'force-at', at: f.at, minimum: 1, metric: 'combat-rating', byTick: 900 });
    expect(options(strict(() => f.read(effect))).map(option => option.cohort)).toEqual([[ref('fighter-a')]]);
    const impossible = fixture({ landRoute: () => ({ status: 'unreachable', reasonCode: 'actual-field-unreachable' }) });
    expect(options(strict(() => impossible.read(effect))).every(option => option.duration.state === 'unmet')).toBe(true);
    expect(f.read(goalFact({ ...effect.predicate, kind: 'force-at', at: f.at, metric: 'combat-rating', minimum: 1, byTick: 900, cohort: [ref('intruder')] })).state).toBe('unmet');
    const future: GoalEntityReference = { kind: 'binding', name: 'pool-selected-fighter' };
    const requestId = 'actual-pool-binding-not-yet-selected';
    const factory = createGoalNavalCombatGrounding(f.context, { ...f.ports, resolveCohort: () => ({ state: 'pending', requestIds: [requestId],
      reason: { code: 'pool-selection-pending', factIds: [], values: {} } }) });
    expect(factory.combatOptions!(goalFact({ kind: 'force-at', at: f.at, cohort: [future], minimum: 1, metric: 'combat-rating', byTick: 900 })))
      .toMatchObject({ state: 'pending', requestIds: [requestId] });
  });

  it('retains a conditional post origin and its exact source proof through the provider', () => {
    const f = fixture(), refs = [ref('fighter-a'), ref('fighter-b')];
    const from = { landId: f.at.landId, point: { x: 1200, y: 1100 } };
    const members = refs.map(reference => {
      const unit = f.snapshot.units.find(unit => reference.kind === 'existing' && unit.id === reference.entityId)!;
      return { reference, assessment: { ...unit, x: from.point.x, y: from.point.y } };
    });
    const force = members.reduce((sum, member) => sum + effectiveCombatRating(f.snapshot, member.assessment), 0);
    const source = goalFact({ kind: 'force-at', at: from, minimum: force,
      metric: 'combat-rating', cohort: refs, byTick: 900 });
    const effect = goalFact({ kind: 'force-at', at: f.at, minimum: force, metric: 'combat-rating', cohort: refs, byTick: 900 });
    const make = (proof: typeof source) => {
      const ports = { ...f.ports, cohortOptions: () => ({ state: 'met' as const, candidates: [
        { id: 'selected-prefix-post', from, members, preconditions: [proof], availableTick: null, factIds: [proof.id] },
      ], factIds: [proof.id] }) };
      const context = { ...f.context, precision: 'coarse' as const };
      const factory = createGoalNavalCombatGrounding(context, ports);
      const grounding = { ...f.context.grounding!, ...factory };
      return strict(() => goalNavalActionProvider.actionsFor(effect, { ...context, grounding }));
    };
    const before = JSON.stringify(f.snapshot), actions = make(source);
    const selected = actions.find(action => action.preconditions.some(fact => fact.id === source.id))!;
    expect(selected).toBeDefined();
    expect(selected.executor.parameters.from).toEqual(from);
    expect(selected.executor.parameters.fromScope).toBe('post');
    expect(selected.preconditions.some(fact => fact.predicate.kind === 'force-available')).toBe(false);
    expect(selected.flows.filter(flow => flow.resource.kind === 'force').map(flow => flow.resource))
      .toEqual([{ kind: 'force', at: from, scope: 'post', metric: 'combat-rating' },
        { kind: 'force', at: f.at, scope: 'post', metric: 'combat-rating' }]);
    if (source.predicate.kind !== 'force-at') throw Error('source');
    const wrong = goalFact({ ...source.predicate, at: f.at });
    expect(make(wrong).some(action => action.preconditions.some(fact => fact.id === wrong.id))).toBe(false);
    expect(JSON.stringify(f.snapshot)).toBe(before); expect(f.work.receipt.used).toBe(0);
  });

  it('offers exact real aboard and land manifests to transport grounding without an invented departure shore or cross-water road', () => {
    const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
    const situation = evaluateSituation(snapshot, owner, createAiPolicyMemory()), before = JSON.stringify(snapshot);
    const context: GoalPlanningContext = { snapshot, owner, situation, tick: snapshot.tick, version: 'v9_knight',
      readFact: () => { throw Error('manifest requested a fabricated land route'); } };
    const resolveCohort: GoalNavalCombatGroundingPorts['resolveCohort'] = refs => ({ state: 'met', factIds: [], candidates: refs.flatMap(reference => {
      const unit = reference.kind === 'existing' ? snapshot.units.find(unit => unit.id === reference.entityId) : undefined;
      return unit ? [{ reference, assessment: unit }] : [];
    }) });
    const read = createGoalNavalCombatGrounding(context, { resolveCohort,
      arrival: () => { throw Error('manifest requested a crossing ETA as a local walk'); },
      landRoute: () => { throw Error('manifest requested a cross-water land road'); } }).combatOptions!;
    const mine = snapshot.resources.find(mine => mine.id === 'gold-satellite-4')!;
    const at = { entityId: mine.id, landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
    const rows = strict(() => options(read(goalFact({ kind: 'force-available', at, minimum: 3, metric: 'combat-rating', byTick: 8000 }))));
    const aboard = rows.find(row => row.cohort.some(ref => ref.kind === 'existing' && ref.entityId === 'unit-p4-emberRavager-1176'))!;
    expect(aboard.from).toMatchObject({ seaId: 'sea:1' }); expect(aboard.from).not.toHaveProperty('landId');
    expect(aboard.preconditions).toEqual([]); expect(aboard.duration.state).toBe('pending');
    expect(aboard.successProbability.state).toBe('pending');
    expect(rows.some(row => row.from?.landId === 'land:2')).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
