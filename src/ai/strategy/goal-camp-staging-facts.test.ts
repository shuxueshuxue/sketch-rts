import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import { isOpenGround } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapCampApproach } from '../bootstrap_1/camp-geometry';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedCampBattle } from './allocated-force';
import type { AllocationLandRouteReader } from './allocation-arrival-query';
import type { GoalNativeGroundReader } from './goal-boarding-geometry';
import { readGoalCampStagingFact } from './goal-camp-staging-facts';
import { goalCampStagingOutsideAlert } from './goal-camp-staging-geometry';
import { readGoalSiteSafetyFact } from './goal-site-safety-facts';
import { goalCampId, goalFact } from './goal-facts';
import { createGoalNavalCombatGrounding, type GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalCombatOption, GoalEstimate, GoalPlanningContext } from './goal-planner-types';
import { createGoalFactReader, createGoalWorldFactMemory } from './goal-world-facts';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import { evaluateSituation, situationConstructionCount } from './situation';
import type { Target } from './types';
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['published-model'] });
function fixture(options: { pendingGround?: boolean; pendingRoute?: boolean; pendingRisk?: boolean; extraCasters?: boolean; minePoint?: { x: number; y: number } } = {}) {
  const scene = sketchScene('real-camp-garrison-domain').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us' }).player('foe', { team: 'foe' })
    .townHall('us', 700, 1000, { id: 'home' }).goldMine('future-mine', options.minePoint?.x ?? 2500, options.minePoint?.y ?? 2100, 10000)
    .unit('us', 'footman', 1000, 1000, { id: 'fighter-a', hp: 70 })
    .unit('us', 'archer', 1020, 1000, { id: 'fighter-b', hp: 50 })
    .unit('neutral', 'ogreWarrior', 2000, 2000, { id: 'guard-a' })
    .unit('neutral', 'ogreMage', 2040, 2000, { id: 'guard-b' });
  if (options.extraCasters) scene.unit('us', 'priest', 1020, 1020, { id: 'non-garrison-healer' })
    .unit('us', 'summoner', 1040, 1020, { id: 'non-garrison-caster' });
  const snapshot = snapshotGame(scene.build().createGame());
  regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory()), camp = neutralCampExposure(snapshot).camps[0]!, campId = goalCampId(camp.memberIds);
  const landRoute: AllocationLandRouteReader = options.pendingRoute ? () => ({ status: 'unknown', reasonCode: 'shared-field-pending' })
    : (from, to) => ({ status: 'known', points: [to], distance: Math.hypot(from.x - to.x, from.y - to.y) });
  const readGroundPoint = vi.fn<GoalNativeGroundReader>(request => options.pendingGround ? { state: 'pending', requestIds: ['native-ground-77'],
    reason: { code: 'native-ground-pending', factIds: [], values: {} } } : request.kind === 'project-goal' && isOpenGround(snapshot.map, request.point.x, request.point.y)
    ? { state: 'met', value: request.point, factIds: ['published-exact-ground'] }
    : { state: 'unmet', reason: { code: 'ground-blocked', factIds: [], values: {} } });
  const ports: GoalNavalCombatGroundingPorts = { landRoute, readGroundPoint, arrival: vi.fn(() => ({ status: 'reachable' as const, ticks: 50, landTicks: 50, crossings: [] })),
    resolveCohort: refs => ({ state: 'met', candidates: refs.flatMap(reference => {
      const unit = reference.kind === 'existing' ? snapshot.units.find(unit => reference.kind === 'existing' && unit.id === reference.entityId) : undefined;
      return unit ? [{ reference, assessment: unit }] : [];
    }), factIds: ['actual-cohort'] }),
    movementRisk: options.pendingRisk ? () => ({ state: 'pending', requestIds: ['same-model-risk-99'], reason: { code: 'model-risk-unpublished', factIds: [], values: {} } })
      : () => known({ expectedLossGold: 3, survivalProbability: .9 }),
  };
  let context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_knight', readFact: () => { throw Error('unbound'); } };
  const original = createGoalFactReader({ ...context, memory: createGoalWorldFactMemory('us'), ports: {
    geometryRevision: 'fixed-native-domain-port', reservedGold: 0, geometry: () => ({ state: 'pending', requestIds: ['unused-geometry'], reason: { code: 'not-used', factIds: [], values: {} } }),
    regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point), landRoute,
  } });
  const readFact: GoalPlanningContext['readFact'] = fact => readGoalCampStagingFact(fact, context, { landRoute, readGroundPoint, resolveCohort: ports.resolveCohort }) ?? original(fact);
  context = { ...context, readFact };
  const factory = createGoalNavalCombatGrounding(context, ports);
  context = { ...context, grounding: { buildSites: () => { throw Error('private selection'); }, productionOptions: () => { throw Error('private selection'); },
    transportOptions: () => { throw Error('private selection'); }, resolveCohort: ports.resolveCohort, ...factory } };
  return { context, ports, camp, campId, read: factory.combatOptions! };
}
function rows(result: ReturnType<NonNullable<ReturnType<typeof createGoalNavalCombatGrounding>['combatOptions']>>): readonly GoalCombatOption[] {
  expect(result.state).toBe('met'); if (result.state !== 'met') throw Error(JSON.stringify(result)); return result.candidates;
}
describe('camp staging and unbuilt mining garrisons', () => {
  it('rejects a target-alert staging point before either geometry publication or camp exposure exemptions', () => {
    const f = fixture(), camp = f.camp, group = f.context.snapshot.units.filter(unit => unit.owner === 'us');
    const guard = camp.members[0]!, radius = guard.alertRadius + Math.max(...group.map(unit => unit.radius)) + camp.camp.creeps[0]!.radius;
    const point = { x: guard.point.x - radius, y: guard.point.y };
    expect(goalCampStagingOutsideAlert(camp, point, group)).toBe(false);
    const fact = goalFact({ kind: 'camp-staging', campId: f.campId, at: { landId: landIdAt(f.context.snapshot.map, point)!, point },
      cohort: group.map(unit => ({ kind: 'existing', entityId: unit.id })) });
    expect(strict(() => readGoalCampStagingFact(fact, f.context, { landRoute: f.ports.landRoute, readGroundPoint: f.ports.readGroundPoint!,
      resolveCohort: f.ports.resolveCohort }))).toMatchObject({ state: 'unmet', reason: { code: 'staging-inside-target-alert' } });
    const inside = { x: guard.point.x - 100, y: guard.point.y };
    const projectedInside = createGoalNavalCombatGrounding(f.context, { ...f.ports,
      readGroundPoint: () => ({ state: 'met', value: inside, factIds: ['published-but-inside-alert'] }) });
    expect(strict(() => projectedInside.combatOptions!(goalFact({ kind: 'camp-cleared', campId: f.campId }))).state).toBe('unmet');
  });
  it('grounds real camp clearing and each native bounty at staging, not inside the enemy camp or behind a site-safe cycle', () => {
    const f = fixture(), snapshot = f.context.snapshot, before = JSON.stringify(snapshot), count = situationConstructionCount();
    const effect = goalFact({ kind: 'camp-cleared', campId: f.campId }), full = strict(() => rows(f.read(effect))).find(option => option.cohort.length === 2)!;
    expect(full.campId).toBe(f.campId); expect(full.target.point).not.toEqual(f.camp.camp.center);
    const nativePost = bootstrapCampApproach(snapshot, { x: 700, y: 1000 }, snapshot.units.filter(unit => unit.owner === 'us'), f.camp.camp,
      snapshot.units.find(unit => unit.id === 'fighter-a')!, neutralCampExposure(snapshot).camps.map(row => row.camp))!;
    expect(full.target.point).toEqual(nativePost.staging);
    const staging = full.preconditions.find(fact => fact.predicate.kind === 'camp-staging')!;
    expect(strict(() => f.context.readFact(staging)).state).toBe('met');
    const action = strict(() => goalNavalActionProvider.actionsFor(effect, f.context)).find(action => action.executor.parameters.cohort instanceof Array
      && action.executor.parameters.cohort.length === 2)!;
    expect(action.kind).toBe('clear-camp'); expect(action.preconditions).toContainEqual(staging);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(false);
    expect(action.preconditions.find(fact => fact.predicate.kind === 'force-at')?.predicate).toMatchObject({ at: full.target, metric: 'camp-force', campId: f.campId });
    expect(full.cost.state).toBe('met'); expect(full.successProbability.state).toBe('met');
    const native = assessAllocatedCampBattle({ snapshot, situation: f.context.situation, target: { landId: full.target.landId!, point: f.camp.camp.center },
      unitIds: ['fighter-a', 'fighter-b'], battleStartTicks: full.preconditions.filter(fact => fact.predicate.kind === 'route').reduce((max, fact) => Math.max(max, f.context.readFact(fact).route!.ticks!), 0) });
    if (full.cost.state === 'met') expect(full.cost.value.map(term => term.gold)).toEqual([.9 * native.attrition.expectedLossGold, 3]);
    expect(goalNavalActionProvider.actionsFor(goalFact({ kind: 'gold', minimum: 100, byTick: 1500 }), f.context).some(action => action.kind === 'clear-camp'
      && action.flows.some(flow => flow.source?.kind === 'event' && flow.delta > 0))).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before); expect(situationConstructionCount()).toBe(count);
  });
  it('uses the same dedicated geometry prerequisite when collecting a camp-force cohort', () => {
    const f = fixture(), full = rows(strict(() => f.read(goalFact({ kind: 'camp-cleared', campId: f.campId })))).find(option => option.cohort.length === 2)!;
    const effect = goalFact({ kind: 'force-at', at: full.target, minimum: full.requiredForce, metric: 'camp-force', campId: f.campId, byTick: 1200, cohort: full.cohort });
    const action = strict(() => goalNavalActionProvider.actionsFor(effect, f.context))[0]!;
    expect(action.kind).toBe('assemble'); expect(action.preconditions.some(fact => fact.predicate.kind === 'camp-staging')).toBe(true);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(false);
  });
  it('keeps original ground/route requests and unpriced risk pending without hiding the camp candidate', () => {
    const ground = fixture({ pendingGround: true }), effect = goalFact({ kind: 'camp-cleared', campId: ground.campId });
    expect(strict(() => ground.read(effect))).toMatchObject({ state: 'pending', requestIds: ['native-ground-77'] });
    const route = fixture({ pendingRoute: true }); expect(strict(() => route.read(effect)).state).toBe('pending');
    const risk = fixture({ pendingRisk: true }), options = strict(() => rows(risk.read(effect)));
    expect(options.every(option => option.cost.state === 'pending' && option.successProbability.state === 'pending')).toBe(true);
    expect(options[0]!.cost).toMatchObject({ requestIds: ['same-model-risk-99'] });
  });
  it('does not accept an enemy center, unbound pool or foreign cohort as a staging fact, nor churn geometry on attack clocks', () => {
    const f = fixture(), full = rows(f.read(goalFact({ kind: 'camp-cleared', campId: f.campId })))[0]!;
    const fact = goalFact({ kind: 'camp-staging', campId: f.campId, at: full.target, cohort: full.cohort });
    const ports = { landRoute: f.ports.landRoute, readGroundPoint: f.ports.readGroundPoint!, resolveCohort: f.ports.resolveCohort };
    const before = strict(() => readGoalCampStagingFact(fact, f.context, ports))!; expect(before.state).toBe('met');
    const changed = { ...f.context, snapshot: { ...f.context.snapshot, units: f.context.snapshot.units.map(unit => ({ ...unit, attackCooldownRemaining: 100 })) } };
    expect(strict(() => readGoalCampStagingFact(fact, changed, ports))!.revision).toBe(before.revision);
    expect(strict(() => readGoalCampStagingFact(goalFact({ kind: 'camp-staging', campId: f.campId, at: full.target }), f.context, ports))!.state).toBe('pending');
    expect(strict(() => readGoalCampStagingFact(goalFact({ kind: 'camp-staging', campId: f.campId, at: full.target, cohort: [] }), f.context, ports))!.state).toBe('unmet');
    expect(strict(() => readGoalCampStagingFact(goalFact({ kind: 'camp-staging', campId: f.campId, at: { ...full.target, point: f.camp.camp.center }, cohort: full.cohort }), f.context, ports))!.state).toBe('unmet');
    expect(strict(() => readGoalCampStagingFact(goalFact({ kind: 'camp-staging', campId: f.campId, at: full.target,
      cohort: [{ kind: 'existing', entityId: 'guard-a' }] }), f.context, ports))!.state).toBe('unmet');
  });
  it('declares the common hold atom before the hall/SiteThreat exists, retaining its full duration and pending protection', () => {
    const f = fixture({ extraCasters: true }), mine = f.context.snapshot.resources.find(resource => resource.id === 'future-mine')!;
    const at: Target = { entityId: mine.id, landId: landIdAt(f.context.snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
    expect(f.context.situation.lands.flatMap(land => land.threats).some(threat => threat.siteId === mine.id)).toBe(false);
    const effect = goalFact({ kind: 'garrison-ready', mineId: mine.id, at });
    const options = strict(() => rows(f.read(effect))); expect(options.length).toBe(3);
    expect(JSON.stringify(options)).not.toContain('non-garrison');
    expect(options.every(option => option.duration.state === 'met' && option.duration.value === f.context.situation.horizonTicks)).toBe(true);
    expect(options.every(option => option.cost.state === 'pending' && option.successProbability.state === 'pending')).toBe(true);
    const action = strict(() => goalNavalActionProvider.actionsFor(effect, f.context))[0]!;
    expect(action.kind).toBe('hold-position'); expect(action.executor.executor).toBe('goal.hold-position');
    expect(action.preconditions.some(fact => fact.predicate.kind === 'hall-complete' && fact.predicate.mineId === mine.id)).toBe(true);
    expect(action.effects.find(effect => effect.fact.predicate.kind === 'garrison-ready')?.at).toBe('start');
    expect(action.demands.every(demand => demand.until === 'finish')).toBe(true);
  });
  it('prices a conditional landing cohort only after its exact pool prerequisite and preserves actual HP/weapons', () => {
    const f = fixture(), snapshot = f.context.snapshot, before = JSON.stringify(snapshot);
    const group = snapshot.units.filter(unit => unit.owner === 'us');
    const refs = group.map(unit => ({ kind: 'existing' as const, entityId: unit.id }));
    const from: Target = { landId: landIdAt(snapshot.map, { x: 2400, y: 1500 })!, point: { x: 2400, y: 1500 } };
    const pool = goalFact({ kind: 'force-available', at: from, cohort: refs, metric: 'combat-rating', minimum: 1, byTick: 2000 });
    const cohortOptions = vi.fn(() => ({ state: 'met' as const, factIds: ['published-landing'], candidates: [{
      id: 'conditional-actual-landing', from, preconditions: [pool], factIds: ['published-landing'], availableTick: null,
      // A source cannot replace an existing member's real injury or weapon.
      members: group.map(unit => ({ reference: { kind: 'existing' as const, entityId: unit.id }, assessment: {
        ...unit, x: from.point.x, y: from.point.y, hp: 999, attackDamage: 999 } })),
    }] }));
    const factory = createGoalNavalCombatGrounding(f.context, { ...f.ports, cohortOptions });
    const effect = goalFact({ kind: 'camp-cleared', campId: f.campId });
    const options = rows(strict(() => factory.combatOptions!(effect)));
    const actual = rows(strict(() => f.read(effect)));
    expect(options.filter(option => !option.preconditions.some(fact => fact.id === pool.id))).toEqual(actual);
    const option = options.find(option => option.preconditions.some(fact => fact.id === pool.id))!;
    expect(option).toBeDefined(); expect(option.from).toEqual(from); expect(option.cohort).toEqual(refs);
    expect(option.factIds).toContain('published-landing'); expect(option.cost.state).toBe('met');
    const native = assessAllocatedCampBattle({ snapshot, situation: f.context.situation,
      target: { landId: from.landId!, point: f.camp.camp.center }, unitIds: group.map(unit => unit.id),
      battleStartTicks: option.preconditions.filter(fact => fact.predicate.kind === 'route')
        .reduce((max, fact) => Math.max(max, f.context.readFact(fact).route!.ticks!), 0) });
    if (option.cost.state === 'met') expect(option.cost.value.map(term => term.gold)).toEqual([.9 * native.attrition.expectedLossGold, 3]);
    const context = { ...f.context, grounding: { ...f.context.grounding!, ...factory } };
    const action = strict(() => goalNavalActionProvider.actionsFor(effect, context)).find(action => action.preconditions.some(fact => fact.id === pool.id))!;
    expect(action.kind).toBe('clear-camp'); expect(action.executor.parameters.cohort).toEqual(refs);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'force-at' && fact.predicate.metric === 'camp-force')).toBe(true);
    expect(f.context.readFact(pool).state).toBe('unmet');
    expect(JSON.stringify(snapshot)).toBe(before);
    const mine = snapshot.resources.find(resource => resource.id === 'future-mine')!;
    const at = { entityId: mine.id, landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
    const guard = rows(strict(() => factory.combatOptions!(goalFact({ kind: 'garrison-ready', mineId: mine.id, at }))))
      .find(option => option.preconditions.some(fact => fact.id === pool.id))!;
    expect(guard).toBeDefined(); expect(guard.from).toEqual(from);
    expect(guard.cost.state).toBe('pending'); expect(guard.successProbability.state).toBe('pending');
  });
  it('retains unresolved landing alternatives and refuses conditional positions without the exact pool or granted cohort', () => {
    const f = fixture(), effect = goalFact({ kind: 'camp-cleared', campId: f.campId });
    const from: Target = { landId: landIdAt(f.context.snapshot.map, { x: 2400, y: 1500 })!, point: { x: 2400, y: 1500 } };
    const members = f.context.snapshot.units.filter(unit => unit.owner === 'us').map(unit => ({
      reference: { kind: 'existing' as const, entityId: unit.id }, assessment: { ...unit, x: from.point.x, y: from.point.y } }));
    const bad = createGoalNavalCombatGrounding(f.context, { ...f.ports, cohortOptions: () => ({ state: 'met', factIds: [], candidates: [{
      id: 'unproved-landing', from, members, preconditions: [], availableTick: null, factIds: [] }] }) });
    const rejected = strict(() => bad.combatOptions!(effect));
    expect(rejected.state).toBe('met');
    if (rejected.state === 'met') {
      expect(rejected.deferred).toContainEqual({ id: 'unproved-landing', requestIds: ['unproved-landing'],
        reason: { code: 'combat-conditional-origin-pool-unproved', factIds: [effect.id], values: {} } });
      expect(rejected.candidates).toEqual(rows(f.read(effect)));
    }
    const pool = goalFact({ kind: 'force-available', at: from, cohort: members.map(member => member.reference), metric: 'combat-rating', minimum: 1, byTick: 2000 });
    const excluded = createGoalNavalCombatGrounding(f.context, { ...f.ports, allowedUnitIds: ['fighter-a'], cohortOptions: () => ({ state: 'met',
      factIds: [], candidates: [{ id: 'excluded-landing', from, members, preconditions: [pool], availableTick: null, factIds: [] }] }) });
    expect(rows(strict(() => excluded.combatOptions!(effect))).every(option => option.cohort.length === 1
      && option.cohort[0]?.kind === 'existing' && option.cohort[0].entityId === 'fighter-a')).toBe(true);
  });
  it('quotes holding conditional on the actual complete camp-clearing safety rule without turning that rule into current safety', () => {
    const f = fixture({ minePoint: { x: 2050, y: 2120 } }), snapshot = f.context.snapshot, before = JSON.stringify(snapshot);
    const mine = snapshot.resources.find(resource => resource.id === 'future-mine')!;
    const at: Target = { entityId: mine.id, landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
    let context = f.context;
    context = { ...context, readFact: fact => readGoalSiteSafetyFact(fact, context, {
      regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point),
    }) ?? f.context.readFact(fact) };
    const read = createGoalNavalCombatGrounding(context, f.ports).combatOptions!;
    const options = rows(strict(() => read(goalFact({ kind: 'garrison-ready', mineId: mine.id, at }))));
    const option = options.find(option => option.cohort.length === 2)!;
    const safetyFact = option.preconditions.find(fact => fact.predicate.kind === 'site-safe')!;
    const safety = strict(() => context.readFact(safetyFact));
    expect(safety.state).toBe('unmet'); expect(safety.derived?.allOf).toContainEqual(goalFact({ kind: 'camp-cleared', campId: f.campId }));
    expect(option.cost).toMatchObject({ state: 'met', value: [] });
    expect(option.successProbability).toMatchObject({ state: 'met', value: 1 });
    expect(option.factIds).toContain(goalFact({ kind: 'camp-cleared', campId: f.campId }).id);
    const incomplete = { ...context, readFact: (fact: Parameters<typeof context.readFact>[0]) => {
      const row = context.readFact(fact); if (fact.id !== safetyFact.id) return row;
      const { derived: _derived, ...withoutProof } = row; return withoutProof;
    } };
    const missing = rows(createGoalNavalCombatGrounding(incomplete, f.ports).combatOptions!(goalFact({ kind: 'garrison-ready', mineId: mine.id, at })));
    expect(missing.find(row => row.cohort.length === 2)!.cost.state).toBe('pending');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
