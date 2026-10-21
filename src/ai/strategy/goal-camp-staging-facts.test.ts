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
function fixture(options: { pendingGround?: boolean; pendingRoute?: boolean; pendingRisk?: boolean; extraCasters?: boolean } = {}) {
  const scene = sketchScene('real-camp-garrison-domain').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us' }).player('foe', { team: 'foe' })
    .townHall('us', 700, 1000, { id: 'home' }).goldMine('future-mine', 2500, 2100, 10000)
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
});
