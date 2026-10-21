import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createUnit } from '../../shared/map';
import { snapshotGame } from '../../shared/sim';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import type { AiPolicyMemory } from '../memory';
import type { GameSnapshot } from '../../shared/types';
import type { AssemblyFactsRequest } from './assembly-facts';
import { prepareAssemblyConquestContinuation, settlePreparedAssemblyConquestContinuation } from './assembly-conquest-continuation';
import { conquestMethodProvider } from './conquest-methods';
import { valueConquestContinuation } from './conquest-value';
import { buildStrategyDecision } from './decision';
import { landIdAt, regionIndex } from './regions';
import { unitArrival } from './unit-arrivals';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import type { AssemblyAssessmentCohort } from './assembly-supply-reader';
import { valuationWindow } from './utility';
import type { VoyageRiskStages } from './voyage-risk';
import { createAssemblyFactsTransaction } from './assembly-facts-transaction';
import type { PreparedAssemblyConquestContinuation } from './assembly-conquest-continuation';

/** Quotes from native scene geometry and unit attributes; the injected route
 * facts below are port tests, not natural grants or a navigation measurement. */
function fixture(enemy = false) {
  let scene = sketchScene('assembly-conquest-path-preparation').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 2000 })
    .townHall('us', 400, 400).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 700, 600, { id: 'producer' })
    .goldMine('new', 1400, 1400, 10000).worker('us', 1450, 1400, { id: 'engineer' })
    .unit('us', 'emberRavager', 800, 1000, { id: 'ungranted' })
    .unit('neutral', 'ogreWarrior', 1400, 1400, { id: 'guard' });
  for (let i = 0; i < 6; i++) scene = scene.unit('us', 'emberRavager', 950, 950 + i * 10, { id: `member-${i}` });
  if (enemy) scene = scene.unit('foe', 'footman', 2200, 1400, { id: 'foe-member' });
  const snapshot = snapshotGame(scene.build().createGame());
  snapshot.players.us!.supplyCap = 100;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  snapshot.buildings.find(building => building.id === 'producer')!.queue = [
    { id: 'consumed', unitKind: 'footman', remaining: 100 }, { id: 'remaining', unitKind: 'footman', remaining: 500 }];
  const situation = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity).situation;
  const target = { entityId: 'new', point: { x: 1400, y: 1400 }, landId: landIdAt(snapshot.map, { x: 1400, y: 1400 })! };
  const objective: AssemblyFactsRequest['objective'] = { id: 'conquest', kind: 'ConquerIsland', owner: 'us', target,
    effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: 0, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  const skeleton = conquestMethodProvider.buildMethods({ snapshot, situation, objective, previous: null, executions: [], blocked: [] })[0]!;
  const unitIds = snapshot.units.filter(unit => unit.id.startsWith('member-')).map(unit => unit.id);
  const post = { id: 'home', target: { point: { x: 1000, y: 1000 }, landId: target.landId }, unitIds };
  const request: AssemblyFactsRequest = { objective, methodId: skeleton.id, campTarget: target, requiredForce: 1,
    posts: [post], unitIds, responseEligibleUnitIds: ['engineer'], valuation: { phase: 'gross', window: valuationWindow(2000) } };
  const units = snapshot.units.filter(unit => unitIds.includes(unit.id)).map(unit => ({ ...unit, x: 1000, y: 1000 }));
  const prototype = { ...createUnit('assembly-assessment:paid:producer:consumed', 'us', 'footman', 1000, 1000), hp: 30 };
  const cohort: AssemblyAssessmentCohort = { pathId: 'path-one', readyTick: snapshot.tick + 200,
    units: [...units, prototype], realUnitIds: unitIds, sourceFactIds: [...unitIds, 'producer', 'consumed'], missing: [] };
  const arrival = vi.fn<AllocationArrivalReader>(unit => ({ status: 'reachable',
    ticks: unit.owner === 'foe' ? 300 : unit.kind === 'worker' ? 20 : 100,
    landTicks: unit.owner === 'foe' ? 300 : unit.kind === 'worker' ? 20 : 100, crossings: [] }));
  return { snapshot, situation, request, cohort, skeleton, arrival, budgets: [], executions: [] };
}

function crossingFixture() {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const { snapshot, owner } = frame;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const regions = regionIndex(snapshot.map), shore = regions.shores.find(shore => shore.water.x === 1648 && shore.water.y === 2480)!;
  const actual = snapshot.units.find(unit => unit.owner === owner && unit.id.endsWith('-1151'))!;
  const hull = { ...actual, id: 'assessment-test-hull' }, otherHull = { ...actual, id: 'assessment-test-other-hull' };
  const passenger = snapshot.units.find(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck && !unit.cabin
    && landIdAt(snapshot.map, unit) === shore.landId)!;
  const decision = buildStrategyDecision(snapshot, owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(goal => goal.kind === 'ConquerIsland' && goal.target.entityId === 'gold-satellite-3')!;
  const landing = regions.shores.find(candidate => candidate.landId === objective.target.landId && candidate.seaId === shore.seaId)!;
  const members = Array.from({ length: 5 }, (_, i) => createUnit(`assessment-test-member-${i}`, owner, 'emberRavager', passenger.x, passenger.y));
  const engineer = createUnit('assessment-test-engineer', owner, 'worker', objective.target.point.x, objective.target.point.y);
  snapshot.units.push(...members, hull, otherHull, engineer); snapshot.players[owner]!.gold = 5000;
  const situation = buildStrategyDecision(snapshot, owner, { memory: frame.memory }, undefined, undefined, Infinity).situation;
  const skeleton = conquestMethodProvider.buildMethods({ snapshot, situation, objective, previous: null, executions: [], blocked: [] })[0]!;
  const crossing = { seaId: shore.seaId, shipId: hull.id, requiresNewShip: false as const,
    departure: { x: 1584, y: 2448 }, departureGround: { x: 1584, y: 2448 },
    landing: landing.water, landingGround: landing.ground, waitTicks: 0, boardingTicks: 20, sailingTicks: 100, unloadingTicks: 20 };
  const request: AssemblyFactsRequest = { objective, methodId: skeleton.id, campTarget: objective.target, requiredForce: 1,
    posts: [{ id: 'home', target: { point: { x: passenger.x, y: passenger.y }, landId: shore.landId }, unitIds: members.map(unit => unit.id) }],
    unitIds: members.map(unit => unit.id), responseEligibleUnitIds: [engineer.id, hull.id, otherHull.id],
    valuation: { phase: 'gross', window: valuationWindow(3000) } };
  const cohort: AssemblyAssessmentCohort = { pathId: 'empirical-path-with-a-long-identity-that-must-not-enter-a-native-request',
    readyTick: snapshot.tick + 100, units: members, realUnitIds: members.map(unit => unit.id), sourceFactIds: members.map(unit => unit.id), missing: [] };
  const arrival = vi.fn<AllocationArrivalReader>(unit => ({ status: 'reachable',
    ticks: unit.owner !== owner ? 20000 : unit.kind === 'worker' ? 0 : 200,
    landTicks: unit.owner !== owner ? 20000 : unit.kind === 'worker' ? 0 : 60,
    crossings: unit.owner === owner && unit.kind !== 'worker' ? [crossing] : [] }));
  return { snapshot, situation, request, cohort, skeleton, arrival, budgets: [], executions: [], crossing, hull, otherHull };
}

function engineeringAlternatives() {
  const input = crossingFixture(), engineerA = input.snapshot.units.find(unit => unit.id === 'assessment-test-engineer')!;
  const engineerB = createUnit('assessment-test-engineer-b', input.situation.owner, 'worker', input.cohort.units[0]!.x, input.cohort.units[0]!.y);
  input.snapshot.units.push(engineerB);
  const arrival: AllocationArrivalReader = (unit, target) => unit.id === engineerB.id
    ? { status: 'reachable', ticks: 200, landTicks: 60, crossings: [input.crossing] } : input.arrival(unit, target);
  const request = { ...input.request, responseEligibleUnitIds: [engineerA.id, engineerB.id, input.hull.id, input.otherHull.id] };
  const withA = request, withB = { ...request, valuation: { ...request.valuation!, unavailableUnitIds: [engineerA.id] } };
  return { ...input, arrival, engineerA, engineerB, withA, withB };
}

describe('one-path conquest continuation preparation', () => {
  it('uses assessment copies, consumes paid work once, and settles raw cash flows back in the original window', () => {
    const input = fixture(), before = JSON.stringify(input), prepared = prepareAssemblyConquestContinuation(input);
    expect(prepared.missing).toEqual([]); expect(prepared.settlement).not.toBeNull();
    const projected = prepared.materializedInput!;
    expect(projected.snapshot.tick).toBe(input.cohort.readyTick); expect(projected.situation.tick).toBe(input.cohort.readyTick);
    expect(projected.snapshot.buildings.find(building => building.id === 'producer')!.queue)
      .toEqual([{ id: 'remaining', unitKind: 'footman', remaining: 400 }]);
    expect(projected.snapshot.units.find(unit => unit.id === 'member-0')).toMatchObject({ x: 1000, y: 1000 });
    expect(projected.snapshot.units.find(unit => unit.id === 'ungranted')).toEqual(input.snapshot.units.find(unit => unit.id === 'ungranted'));
    expect(projected.unitIds).not.toContain('ungranted');
    expect(prepared.settlement).toMatchObject({ coverage: 'known-effects', delayTicks: 200, window: input.request.valuation!.window });
    expect(prepared.settlement!.realUnitIds).not.toContain(input.cohort.units.at(-1)!.id);
    const value = valueConquestContinuation(prepared.settlement!);
    const undelayed = valueConquestContinuation({ ...prepared.settlement!, delayTicks: 0 });
    expect(value.utility.benefit[0]!.value).toBeLessThan(undelayed.utility.benefit[0]!.value);
    expect([...value.utility.benefit, ...value.utility.cost].flatMap(term => term.catalogUnitValues ?? [])
      .every(entry => prepared.realUnitIds.includes(entry.unitId))).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps distinct ready epochs and shifts each enemy ETA exactly once, preserving unresolved routes', () => {
    const input = fixture(true);
    const early = prepareAssemblyConquestContinuation({ ...input, cohort: { ...input.cohort, readyTick: 50 } });
    const late = prepareAssemblyConquestContinuation({ ...input, cohort: { ...input.cohort, pathId: 'later', readyTick: 250 } });
    const eta = (prepared: typeof early) => unitArrival(prepared.materializedInput!.situation.units.find(unit => unit.id === 'foe-member')!, 'new');
    expect(eta(early)).toMatchObject({ ticks: 250 }); expect(eta(late)).toMatchObject({ ticks: 50 });
    expect(early.method!.id).not.toBe(late.method!.id);
    const calls = vi.mocked(input.arrival).mock.calls.length;
    const settled = settlePreparedAssemblyConquestContinuation(late, new Map());
    expect(eta(settled)).toMatchObject({ ticks: 50 }); expect(vi.mocked(input.arrival).mock.calls.length).toBe(calls);
    const unknown = prepareAssemblyConquestContinuation({ ...input, arrival: (unit, target) => unit.owner === 'foe'
      ? { status: 'unknown', reason: { code: 'enemy-shared-fact-pending' } } : input.arrival(unit, target) });
    expect(eta(unknown)).toMatchObject({ status: 'unknown', reason: { code: 'enemy-shared-fact-pending' } });
    expect(unknown.settlement).toBeNull();
    expect(unknown.missing.some(fact => fact.reason.code === 'battle-enemy-arrival-unknown')).toBe(true);
  });

  it('cannot adopt an ungranted live fighter or an unavailable engineer into a continuation', () => {
    const input = fixture();
    const excluded = prepareAssemblyConquestContinuation({ ...input, request: { ...input.request,
      valuation: { ...input.request.valuation!, unavailableUnitIds: ['engineer'] } } });
    expect(excluded.settlement).toBeNull();
    expect(excluded.missing.some(fact => fact.reason.code === 'assembly-construction-worker-unavailable' && fact.status === 'unmet')).toBe(true);
    expect(excluded.materializedInput!.unitIds).not.toContain('engineer');
    const outsider = input.snapshot.units.find(unit => unit.id === 'ungranted')!;
    const hidden = prepareAssemblyConquestContinuation({ ...input, cohort: { ...input.cohort,
      realUnitIds: [...input.cohort.realUnitIds, outsider.id], units: [...input.cohort.units, outsider] } });
    expect(hidden.missing.some(fact => fact.reason.code === 'assembly-continuation-cohort-source-invalid' && fact.reason.factIds.includes(outsider.id))).toBe(true);
    expect(hidden.materializedInput!.unitIds).not.toContain(outsider.id); expect(hidden.settlement).toBeNull();
    const { responseEligibleUnitIds: _pool, ...withoutPool } = input.request;
    const missingPool = prepareAssemblyConquestContinuation({ ...input, request: withoutPool });
    expect(missingPool.missing.some(fact => fact.reason.code === 'assembly-support-pool-unquoted')).toBe(true);
    expect(missingPool.settlement).toBeNull();
  });

  it('reuses an explicit same comparison window and refuses readiness outside it', () => {
    const input = fixture();
    const prepared = prepareAssemblyConquestContinuation(input), window = prepared.window!;
    expect(prepared.materializedInput!.valuation!.window!.horizonTicks).toBe(window.horizonTicks - 200);
    expect(settlePreparedAssemblyConquestContinuation(prepared).window).toEqual(window);
    const beyond = prepareAssemblyConquestContinuation({ ...input, cohort: { ...input.cohort, readyTick: window.horizonTicks } });
    expect(beyond.method).toBeNull(); expect(beyond.settlement).toBeNull();
    expect(beyond.missing).toMatchObject([{ status: 'unmet', reason: { code: 'assembly-ready-outside-valuation-window' } }]);
  });

  it('keeps a staffed partial mining curve as known effects without invoking the group opportunity oracle', () => {
    const input = fixture(); input.snapshot.players.us!.supplyCap = 0;
    const opportunity = vi.fn(() => { throw new Error('preparation must not price opportunity'); });
    const prepared = prepareAssemblyConquestContinuation({ ...input, request: { ...input.request,
      valuation: { ...input.request.valuation!, phase: 'net', opportunity } } });
    expect(opportunity).not.toHaveBeenCalled();
    expect(prepared.settlement).not.toBeNull(); expect(prepared.settlement!.coverage).toBe('known-effects');
    expect(prepared.assumptions.some(fact => fact.code === 'worker-supply-required')).toBe(true);
    expect(prepared.settlement!.facts.forecast.workers.length).toBeGreaterThan(0);
    expect(prepared.settlement!.facts.forecast.workers.length).toBeLessThan(5);
  });

  it('rebuilds dynamic assumptions from current facts while keeping the static preparation baseline', () => {
    const input = fixture(); input.snapshot.players.us!.supplyCap = 0;
    const prepared = prepareAssemblyConquestContinuation(input), physicalBefore = JSON.stringify(prepared.materializedInput);
    // A stale presentation is not a new physical input or a native event.
    // This checks the pure settle boundary, not a measured forecast change
    // caused by publishing route risk (the workforce forecast reads no risk).
    const stale = { ...prepared, assumptions: [...prepared.assumptions,
      { code: 'earlier-forecast-view', factIds: ['producer'], values: {} }] };
    const settled = settlePreparedAssemblyConquestContinuation(stale, new Map());
    expect(settled.assumptions.some(fact => fact.code === 'earlier-forecast-view')).toBe(false);
    expect(settled.assumptions.some(fact => fact.code === 'worker-supply-required')).toBe(true);
    for (const assumption of prepared.preparationAssumptions) expect(settled.assumptions).toContainEqual(assumption);
    expect(JSON.stringify(prepared.materializedInput)).toBe(physicalBefore);
    expect(settlePreparedAssemblyConquestContinuation(settled, new Map()).assumptions).toEqual(settled.assumptions);
  });

  it('prepares physical voyages before risk publication and purely settles the same paths after the external batch', () => {
    const input = crossingFixture(), before = JSON.stringify(input), prepared = prepareAssemblyConquestContinuation(input);
    expect(prepared.method!.voyagePlans!.length).toBeGreaterThan(0);
    expect(prepared.method!.voyagePlans!.every(voyage => !voyage.id.includes(input.cohort.pathId))).toBe(true);
    expect(prepared.missing.some(fact => fact.reason.code === 'voyage-stage-risk-unpublished')).toBe(true);
    expect(prepared.settlement).toBeNull();
    const safe = { status: 'known' as const, survivalProbability: .8, expectedDamage: 1, expectedHpLoss: 1,
      damageErrorBound: 0, samples: 1, totalSamples: 1, computedTick: input.snapshot.tick, basis: 'native-route-exposure' as const, threatIds: [] };
    const risks = new Map<string, VoyageRiskStages>(prepared.method!.voyagePlans!.map(voyage => [voyage.id, { approach: safe, loaded: safe }]));
    const calls = vi.mocked(input.arrival).mock.calls.length;
    const settled = settlePreparedAssemblyConquestContinuation(prepared, risks);
    expect(settled.method).toBe(prepared.method); expect(settled.window).toEqual(input.request.valuation!.window);
    expect(settled.missing.filter(fact => fact.reason.code.includes('voyage-stage-risk'))).toEqual([]);
    expect(vi.mocked(input.arrival).mock.calls.length).toBe(calls);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('excludes a named hull outside the current response pool and gives different physical hulls different risk identities', () => {
    const input = crossingFixture(), first = prepareAssemblyConquestContinuation(input);
    const blocked = prepareAssemblyConquestContinuation({ ...input, request: { ...input.request,
      valuation: { ...input.request.valuation!, unavailableUnitIds: [input.hull.id] } } });
    expect(blocked.missing.some(fact => fact.reason.code === 'assembly-continuation-hull-unavailable')).toBe(true);
    expect(blocked.materializedInput!.unitIds).not.toContain(input.hull.id); expect(blocked.settlement).toBeNull();
    const changed = prepareAssemblyConquestContinuation({ ...input, arrival: (unit, target) => {
      const arrival = input.arrival(unit, target);
      if (arrival.status === 'reachable') return { ...arrival, crossings: arrival.crossings.map(crossing => ({ ...crossing, shipId: input.otherHull.id })) };
      if (arrival.status === 'conditional') return { ...arrival, crossings: arrival.crossings.map(crossing => ({ ...crossing, shipId: input.otherHull.id })) };
      return arrival;
    } });
    expect(first.method!.voyagePlans![0]!.departure).toEqual(changed.method!.voyagePlans![0]!.departure);
    expect(first.method!.voyagePlans![0]!.id).not.toBe(changed.method!.voyagePlans![0]!.id);
    expect(first.method!.id).toContain(input.hull.id); expect(changed.method!.id).toContain(input.otherHull.id);
  });

  it('requires a concrete eligible ship producer and preserves an excluded training lane', () => {
    const input = crossingFixture(), yard = input.snapshot.buildings.find(building => building.owner === input.situation.owner && building.kind === 'shipyard')!;
    const prepared = prepareAssemblyConquestContinuation({ ...input, request: { ...input.request,
      valuation: { ...input.request.valuation!, allowedProduction: [] } }, arrival: (unit, target) => {
      const actual = input.arrival(unit, target);
      return actual.status === 'reachable' && actual.crossings.length ? { ...actual, status: 'conditional', unmet: [{ code: 'needs-quoted-hull' }],
        crossings: actual.crossings.map(crossing => ({ ...crossing, shipId: null, productionBuildingId: yard.id, requiresNewShip: true })) } : actual;
    } });
    expect(prepared.settlement).toBeNull();
    expect(prepared.missing).toContainEqual(expect.objectContaining({ kind: 'production', status: 'unmet',
      reason: expect.objectContaining({ code: 'assembly-continuation-ship-producer-unavailable', factIds: [yard.id] }) }));
  });

  it('binds assessment identity to the chosen engineer and its full route semantics', () => {
    const input = engineeringAlternatives(), before = JSON.stringify(input);
    const a = prepareAssemblyConquestContinuation({ ...input, request: input.withA });
    const b = prepareAssemblyConquestContinuation({ ...input, request: input.withB });
    expect(a.method!.voyagePlans).toHaveLength(1); expect(b.method!.voyagePlans).toHaveLength(2);
    expect(a.method!.id).not.toBe(b.method!.id);
    const changed = prepareAssemblyConquestContinuation({ ...input, request: input.withB, arrival: (unit, target) => {
      const arrival = input.arrival(unit, target);
      return unit.id === input.engineerB.id && 'ticks' in arrival ? { ...arrival, ticks: arrival.ticks + 50 } : arrival;
    } });
    expect(changed.method!.id).not.toBe(b.method!.id);
    const clone = { ...input, request: JSON.parse(JSON.stringify(input.withB)), cohort: JSON.parse(JSON.stringify(input.cohort)) };
    expect(prepareAssemblyConquestContinuation(clone).method).toEqual(b.method);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps all engineer-specific voyages in the unique risk batch in either quote order', () => {
    const input = engineeringAlternatives();
    const run = (requests: readonly AssemblyFactsRequest[]) => {
      const paths: PreparedAssemblyConquestContinuation[] = [];
      const transaction = createAssemblyFactsTransaction({ ...input, version: 'v9_archer', committedRequest: () => null,
        prepare: (request, cohort) => {
          const value = prepareAssemblyConquestContinuation({ ...input, request, cohort }); paths.push(value); return value;
        }, settle: settlePreparedAssemblyConquestContinuation });
      for (const request of requests) transaction.read(request);
      const wanted = [...new Set(paths.flatMap(path => path.method?.voyagePlans?.map(voyage => voyage.id) ?? []))].sort();
      const batch = [...new Set(transaction.riskMethods().flatMap(method => method.voyagePlans?.map(voyage => voyage.id) ?? []))].sort();
      expect(batch).toEqual(wanted); expect(batch.some(id => id.includes('/deliver-workers/'))).toBe(true);
      return batch;
    };
    expect(run([input.withB, input.withA])).toEqual(run([input.withA, input.withB]));
  });
});
