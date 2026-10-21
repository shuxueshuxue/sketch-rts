import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createBuilding } from '../../shared/map';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { bodyMass } from '../../shared/physical-body';
import { shipProfile } from '../../shared/ship-geometry';
import { trainingRecruitPrototype } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { createGoalCoarseTransport, type GoalCoarseFutureHullReader } from './goal-coarse-transport';
import { goalEconomyActionProvider } from './goal-economy-provider';
import { goalActionContributes } from './goal-fact-matching';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalHullCandidate } from './goal-grounding-ports';
import { declareGoalForceTransport, declareGoalWorkerTransport } from './goal-naval-actions';
import { createGoalNavalCombatGrounding } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalCohortMember, GoalEntityReference, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import { createGoalTransportCohorts } from './goal-transport-cohorts';
import { regionIndex } from './regions';
import type { Target } from './types';

const raw = gunzipSync(readFileSync(new URL('./fixtures/public-navy-zero-597.json.gz', import.meta.url)));
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
const ref = (entityId: string): GoalEntityReference => ({ kind: 'existing', entityId });
const from: Target = { landId: 'land:1', point: { x: 1184, y: 704 } };
const to: Target = { landId: 'land:2', point: { x: 2976, y: 896 } };
const fighters = [1, 2, 3, 4].map(n => ref(`scene-public-planner-frame-planner-footman-${n}`));
const worker = ref('scene-public-planner-frame-planner-worker-1');

function fixture(run: (f: ReturnType<typeof compose>) => void) {
  expect(createHash('sha256').update(raw).digest('hex')).toBe('8d29faf796809089ee8856f34f49a2c613ed7f04eeaed2c7c549a4a65bf38103');
  const snapshot: GameSnapshot = JSON.parse(raw.toString()), before = JSON.stringify(snapshot);
  expect(snapshot.units.some(unit => unit.kind === 'transport' || unit.kind === 'carrier')).toBe(false);
  expect(snapshot.buildings.some(building => building.kind === 'shipyard')).toBe(false);
  strict(() => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight',
    memory: createAiPolicyMemory(), precision: 'coarse', goals: [] }, input => {
    run(compose(input.context));
    expect(input.work.receipt.used).toBe(0);
  }));
  expect(JSON.stringify(snapshot)).toBe(before);
}

// Test-side implementation of the source-owned metadata port. It uses the
// original prepared contacts, production options and native upgraded recruit
// constructor. No future unit enters the snapshot, no world fact is filled,
// and no berth/point/route query is issued. Production source wiring is a
// separate central integration, not asserted by this domain contract.
function compose(context: GoalPlanningContext) {
  const regions = regionIndex(context.snapshot.map), registry = new Map<string, GoalCohortMember>();
  const resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']> = refs => {
    const members: GoalCohortMember[] = [];
    for (const reference of refs) {
      const projected = registry.get(goalValueKey(reference));
      if (projected) members.push(projected);
      else {
        const actual = context.grounding!.resolveCohort!([reference]);
        if (actual.state !== 'met') return actual;
        members.push(...actual.candidates);
      }
    }
    return { state: 'met', candidates: members, factIds: [] };
  };
  const hulls: GoalHullCandidate[] = [];
  const futureHulls = vi.fn<GoalCoarseFutureHullReader>((seaId, source) => {
    const home = context.snapshot.buildings.find(building => building.owner === context.owner && building.kind === 'townHall')!;
    const shore = [...(source.landId ? regions.shoresByLand.get(source.landId)?.get(seaId) ?? [] : [])]
      .sort((a, b) => Math.hypot(a.ground.x - home.x, a.ground.y - home.y)
        - Math.hypot(b.ground.x - home.x, b.ground.y - home.y))[0];
    if (!shore) throw Error('original production coast missing');
    const production = context.grounding!.productionOptions('transport', { landId: source.landId!, seaId, point: shore.water });
    if (production.state !== 'met') return production;
    const candidates = production.candidates.map(option => {
      const yard = createBuilding('future-yard-assessment', context.owner, option.buildingKind, shore.water.x, shore.water.y, true);
      const assessment = trainingRecruitPrototype(context.snapshot, yard, { unitKind: 'transport', remaining: 0 });
      const reference: GoalEntityReference = { kind: 'binding', name: `source-hull:${goalValueKey([option.producer, seaId])}` };
      registry.set(goalValueKey(reference), { reference, assessment });
      const hull: GoalHullCandidate = { id: `source-hull:${option.id}`, reference, assessment, seaId,
        capacity: shipProfile(assessment)!.loadCapacity, cargoUnitIds: [], availableTick: context.tick,
        preconditions: option.preconditions, factIds: option.factIds };
      hulls.push(hull); return hull;
    });
    return { state: 'met', candidates, factIds: production.factIds };
  });
  const seaTicks = vi.fn(() => ({ state: 'met' as const, value: 321, factIds: ['published-sea-field-contract'] }));
  const transportOptions = createGoalCoarseTransport(context, regions, resolveCohort, undefined, seaTicks, futureHulls);
  const cohortOptions = createGoalTransportCohorts(context, { transportOptions });
  const forbidden = vi.fn(() => { throw Error('coarse domain requested exact work'); });
  const naval = createGoalNavalCombatGrounding(context, { resolveCohort, cohortOptions,
    coarseSeaTicks: seaTicks, arrival: forbidden, landRoute: forbidden, readGroundPoint: forbidden, movementRisk: forbidden });
  const ctx: GoalPlanningContext = { ...context, grounding: { ...context.grounding!, ...naval,
    transportOptions, cohortOptions, resolveCohort } };
  function crossing(cohort: readonly GoalEntityReference[]) {
    const result = transportOptions(from, to, 0, { cohort });
    expect(result.state).toBe('met');
    if (result.state !== 'met') throw Error(JSON.stringify(result));
    expect(result.candidates.length).toBeGreaterThan(0); return result.candidates[0]!;
  }
  return { context: ctx, regions, resolveCohort, futureHulls, hulls, seaTicks, forbidden, crossing, transportOptions };
}

describe('future hull transport from the original zero-navy frame', () => {
  it('declares both cargo types with generic native capacity and retains producer prerequisites', () => fixture(f => {
    for (const cohort of [fighters, [worker]]) {
      const option = f.crossing(cohort);
      expect(option.transport.kind).toBe('binding'); expect(option.loadedUnitIds).toEqual([]);
      const hull = f.hulls.find(hull => goalValueKey(hull.reference) === goalValueKey(option.transport))!;
      const members = f.resolveCohort(cohort); if (members.state !== 'met') throw Error('actual original cohort');
      const mass = members.candidates.reduce((sum, member) => sum + bodyMass(member.assessment), 0);
      expect(option.preconditions).toEqual(expect.arrayContaining([...hull.preconditions]));
      expect(option.preconditions).toContainEqual(goalFact({ kind: 'transport-in', seaId: option.seaId,
        capacity: mass, byTick: f.context.planThroughTick! }));
      const input = { snapshot: f.context.snapshot, owner: f.context.owner, cohort: members.candidates,
        byTick: f.context.planThroughTick!, option, berthTolerance: hull.assessment.radius, pickupRoutes: [],
        estimates: { duration: option.duration, cost: option.cost!, successProbability: option.successProbability! } };
      const action = cohort.length === 4 ? declareGoalForceTransport(input)! : declareGoalWorkerTransport(input)!;
      expect(action).toBeTruthy();
      expect(action.preconditions.filter(fact => fact.predicate.kind === 'transport-in').every(fact => !('transport' in fact.predicate))).toBe(true);
      expect(action.demands.filter(demand => demand.resource.kind === 'transport-capacity')
        .every(demand => !('transport' in demand.resource))).toBe(true);
      expect(action.executor.parameters.transport).toEqual(option.transport);
      expect(JSON.stringify(action)).not.toContain(hull.assessment.id);
      const available = action.preconditions.find(fact => fact.predicate.kind === 'transport-in')!;
      const trains = goalEconomyActionProvider.actionsFor(available, f.context);
      expect(trains.some(train => train.kind === 'train' && goalActionContributes(train, available))).toBe(true);
    }
    expect(f.forbidden).not.toHaveBeenCalled();
  }));

  it('exposes original army and worker transport declarations through the normal naval provider', () => fixture(f => {
    const force = goalFact({ kind: 'force-available', at: to, metric: 'combat-rating', minimum: 4, cohort: fighters,
      byTick: f.context.planThroughTick! });
    const engineer = goalFact({ kind: 'worker-at', at: to, count: 1, worker, byTick: f.context.planThroughTick! });
    for (const [effect, kind] of [[force, 'transport-force'], [engineer, 'transport-worker']] as const) {
      const actions = goalNavalActionProvider.actionsFor(effect, f.context).filter(action => action.kind === kind);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every(action => action.precision === 'coarse')).toBe(true);
      expect(actions.every(action => action.executor.parameters.transport
        && (action.executor.parameters.transport as GoalEntityReference).kind === 'binding')).toBe(true);
    }
    expect(f.forbidden).not.toHaveBeenCalled();
  }));

  it('prices future positioning from the supplied native exit and never supplies exact authority for an unbuilt ship', () => fixture(f => {
    const option = f.crossing(fighters); if (option.origin !== 'land') throw Error('original land cohort');
    const hull = f.hulls.find(hull => goalValueKey(hull.reference) === goalValueKey(option.transport))!;
    const candidates = f.context.grounding!.combatOptions!(option.approach);
    expect(candidates.state).toBe('met'); if (candidates.state !== 'met') throw Error(JSON.stringify(candidates));
    const position = candidates.candidates[0]!;
    expect(position.from).toEqual({ seaId: option.seaId, point: { x: hull.assessment.x, y: hull.assessment.y } });
    expect(position.preconditions).toContainEqual(goalFact({ kind: 'transport-in', seaId: option.seaId,
      capacity: hull.capacity, byTick: f.context.planThroughTick! }));
    if (position.duration.state !== 'met' || position.duration.value) expect(f.seaTicks).toHaveBeenCalledWith(hull.assessment,
      { x: hull.assessment.x, y: hull.assessment.y }, option.departure.water, true);
    const forbidden = vi.fn(() => { throw Error('exact future ship must await actual binding'); });
    const exact = createGoalNavalCombatGrounding({ ...f.context, precision: 'exact' }, {
      resolveCohort: forbidden, arrival: forbidden, landRoute: forbidden });
    expect(exact.combatOptions!(option.approach)).toMatchObject({ state: 'pending', reason: { code: 'combat-actual-transport-binding-pending' } });
    expect(forbidden).not.toHaveBeenCalled();
  }));

  it('preserves missing metadata and rejects foreign, overloaded or falsely existing future assessments', () => fixture(f => {
    const option = f.crossing(fighters), hull = f.hulls.find(hull => goalValueKey(hull.reference) === goalValueKey(option.transport))!;
    const missing = createGoalCoarseTransport(f.context, f.regions, f.resolveCohort);
    expect(missing(from, to, 0, { cohort: fighters })).toMatchObject({ state: 'pending',
      reason: { code: 'coarse-existing-hull-or-contact-missing' } });
    const pending = createGoalCoarseTransport(f.context, f.regions, f.resolveCohort, undefined, f.seaTicks,
      () => ({ state: 'pending', requestIds: ['native-producer-exit-unpublished'], reason: {
        code: 'producer-exit-unpublished', factIds: ['native-producer'], values: {} } }));
    expect(pending(from, to, 0, { cohort: fighters })).toMatchObject({ state: 'pending',
      requestIds: ['native-producer-exit-unpublished'], reason: { code: 'coarse-future-hull-metadata-pending' } });
    const invalid: GoalHullCandidate[] = [
      { ...hull, reference: ref(hull.assessment.id) },
      { ...hull, seaId: 'sea:999' },
      { ...hull, assessment: { ...hull.assessment, owner: 'pressure' } },
      { ...hull, assessment: { ...hull.assessment, hp: 0 } },
      { ...hull, assessment: { ...hull.assessment, id: f.context.snapshot.units[0]!.id } },
      { ...hull, capacity: 1 }, { ...hull, cargoUnitIds: ['unpriced-cargo'] },
    ];
    for (const bad of invalid) {
      const read = createGoalCoarseTransport(f.context, f.regions, f.resolveCohort, undefined, f.seaTicks,
        () => ({ state: 'met', candidates: [bad], factIds: [] }));
      expect(read(from, to, 0, { cohort: fighters }).state).toBe('pending');
    }
  }));

  it('retains an actual usable hull byte-for-byte and offers replacement only after it is lost', () => {
    const snapshot: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url))).toString());
    const before = JSON.stringify(snapshot);
    const check = (lost: boolean) => strict(() => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight',
      memory: createAiPolicyMemory(), precision: 'coarse', goals: [] }, input => {
      const f = compose(input.context), reference = createGoalCoarseTransport(f.context, f.regions, f.resolveCohort, undefined, f.seaTicks);
      const result = f.transportOptions(from, to, 0, { cohort: fighters });
      expect(result.state).toBe('met'); if (result.state !== 'met') throw Error('no transport');
      if (!lost) {
        expect(result).toEqual(reference(from, to, 0, { cohort: fighters }));
        expect(f.futureHulls).not.toHaveBeenCalled();
        expect(result.candidates.every(option => option.transport.kind === 'existing')).toBe(true);
      } else {
        expect(f.futureHulls).toHaveBeenCalled();
        expect(result.candidates.every(option => option.transport.kind === 'binding')).toBe(true);
      }
      expect(input.work.receipt.used).toBe(0);
    }));
    check(false); expect(JSON.stringify(snapshot)).toBe(before);
    // Explicit unit-test counterfactual, not a new public puzzle result: the
    // same regional rule supplies a replacement after the actual hull dies.
    const ship = snapshot.units.find(unit => unit.kind === 'transport' && unit.owner === 'planner')!;
    ship.hp = 0; check(true);
  });
});
