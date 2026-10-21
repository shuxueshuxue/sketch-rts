import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { createBuilding } from '../../shared/map';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame, stepGame, tryPlayerCommand } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { withAllocationArrivalQuery } from './allocation-arrival-query';
import { declareGoalBuilding } from './goal-economy-actions';
import { createGoalEconomicGrounding, goalBuildPointRequest } from './goal-economy-grounding';
import { FactWorkQueue, withFactWork } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory, GoalGeometryReader } from './goal-grounding-ports';
import type { GoalCandidates, GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import type { Situation, Target } from './types';

function scene(coast = false) {
  const game = sketchScene('economic-grounding-native').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 3000 })
    .townHall('us', 192, 192, { id: 'hall' }).townHall('foe', 1152, 192)
    .worker('us', 400, 500, { id: 'worker' }).build().createGame();
  Object.assign(game.map, { width: 1280, height: 1280, terrain: { cell: 32, cols: 40, rows: 40,
    cells: Array.from({ length: 40 }, () => coast ? '.'.repeat(20) + '~'.repeat(20) : '.'.repeat(40)).join('') } });
  game.scriptedVictory = true;
  regionIndex(game.map); // native warmup belongs before planning, not to a domain scan
  return game;
}
function context(snapshot: GameSnapshot, readFact: GoalPlanningContext['readFact'] = () => { throw Error('Unexpected route read'); }): GoalPlanningContext {
  const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, lands: [], seas: [], assets: [], units: [],
    opportunities: [], economy: { cashGold: snapshot.players.us!.gold, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] }, limitations: [] };
  return { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner', readFact: fact => {
    if (fact.predicate.kind !== 'worker-at') return readFact(fact);
    const p = fact.predicate, units = snapshot.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker' && unit.hp > 0
      && !unit.deck && !unit.cabin && landIdAt(snapshot.map, unit) === p.at.landId);
    return { fact, state: units.length >= p.count ? 'met' : 'unmet', observedTick: snapshot.tick, revision: fact.id,
      evidence: [], entityIds: units.map(unit => unit.id), quantity: units.length,
      reason: { code: 'native-worker-pool-fixture', factIds: [fact.id], values: {} } };
  } };
}
function ports(snapshot: GameSnapshot, geometry: GoalGeometryReader, revision = 'bodies-1') {
  return { geometry, geometryRevision: revision,
    regionAt: (point: Target['point'], mover: 'land' | 'sea') => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point) };
}
function anchor(snapshot: GameSnapshot, x = 800, y = 800): Target {
  return { landId: landIdAt(snapshot.map, { x, y })!, point: { x, y } };
}
const memory = (): GoalGeometryMemory => ({ version: 1, entries: [] });
const forbidRouting = <T>(run: () => T) => withNavigationAudit(event => { throw Error(`Unexpected native route: ${event.operation}`); },
  () => withNavigationPhase('strategy-planning', run));

describe('shared-budget economic grounding with native placements', () => {
  it('does no zero-budget geometry, resumes a bounded native scan after JSON, and publishes on the next think', () => {
    const snapshot = snapshotGame(scene()), original = JSON.stringify(snapshot), near = anchor(snapshot);
    let retained = memory(), at = 0, lastWork = 0;
    const request = goalBuildPointRequest(context(snapshot), 'farm', near, ports(snapshot, () => { throw Error('No nested geometry'); }));
    const zero = new FactWorkQueue(0, 0), cold = createGoalGeometryReader({ tick: 0, work: zero, memory: retained });
    expect(forbidRouting(() => cold(request)).state).toBe('pending');
    forbidRouting(() => zero.flush()); expect(retained.entries[0]!.work).toBe(0);
    for (at = 15; at < 2000 && retained.entries[0]!.readyTick === null; at += 15) {
      const work = new FactWorkQueue(at, 2), read = createGoalGeometryReader({ tick: at, work, memory: retained });
      forbidRouting(() => { expect(read(request).state).toBe('pending'); work.flush(); expect(read(request).state).toBe('pending'); });
      expect(work.receipt.used).toBeLessThanOrEqual(2);
      expect(retained.entries[0]!.work - lastWork).toBeLessThanOrEqual(2);
      lastWork = retained.entries[0]!.work; retained = JSON.parse(JSON.stringify(retained));
    }
    const published = forbidRouting(() => createGoalGeometryReader({ tick: at, work: new FactWorkQueue(at, 0), memory: retained })(request));
    expect(published.state).toBe('met');
    if (published.state !== 'met') throw Error('Scan did not finish');
    expect(published.value).toHaveLength(8);
    for (const site of published.value) expect(isBuildPlacementClear(snapshot, 'farm', site.at.point)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(original);
    const changed = createGoalGeometryReader({ tick: at + 15, work: new FactWorkQueue(at + 15, 0), memory: retained });
    expect(changed({ ...request, revision: 'changed-buildings' }).state).toBe('pending');
    expect(retained.entries[0]!.work).toBe(0);
  });

  it('keeps a usable real producer while retaining the optional pending construction alternative', () => {
    const snapshot = snapshotGame(scene());
    snapshot.buildings.push(createBuilding('producer', 'us', 'barracks', 650, 350, true));
    const work = new FactWorkQueue(0, 0), retained = memory(), geometry = createGoalGeometryReader({ tick: 0, work, memory: retained });
    const result = forbidRouting(() => createGoalEconomicGrounding(context(snapshot), ports(snapshot, geometry)).productionOptions('footman', anchor(snapshot)));
    expect(result.state).toBe('met');
    if (result.state !== 'met') throw Error('Existing producer was blocked by optional geometry');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ producer: { kind: 'existing', entityId: 'producer' }, availableTick: 0 });
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred![0]!.requestIds).toEqual(result.deferred![0]!.reason.factIds);
    snapshot.buildings.at(-1)!.queue.push({ id: 'paid', unitKind: 'footman', remaining: 20 });
    const occupied = createGoalEconomicGrounding(context(snapshot), ports(snapshot, geometry)).productionOptions('footman', anchor(snapshot));
    expect(occupied.state === 'met' && occupied.candidates[0]!.availableTick).toBe(null);
    expect(createGoalEconomicGrounding(context(snapshot), ports(snapshot, geometry)).productionOptions('emberRavager', anchor(snapshot)).state).toBe('unmet');
  });

  it('never measures a missing future worker from a made-up current position', () => {
    const snapshot = snapshotGame(scene()); snapshot.units = [];
    const near = anchor(snapshot), retained = memory();
    for (const tick of [0, 15]) {
      const work = new FactWorkQueue(tick, 6144), geometry = createGoalGeometryReader({ tick, work, memory: retained });
      const result = forbidRouting(() => createGoalEconomicGrounding(context(snapshot), ports(snapshot, geometry)).buildSites('farm', near));
      forbidRouting(() => work.flush());
      if (tick === 15) {
        expect(result.state).toBe('met');
        if (result.state !== 'met') throw Error('No pending build alternatives');
        expect(result.candidates[0]).toMatchObject({ worker: { kind: 'pool-member' }, route: null, walkTicks: { state: 'pending' } });
        expect(JSON.stringify(result)).not.toContain('worker:land:');
      }
    }
  });

  it('preserves paid native foundations and their remaining work without requiring a second clear site or payment', () => {
    const snapshot = snapshotGame(scene()), foundation = createBuilding('paid-farm', 'us', 'farm', 800, 800, false);
    foundation.buildProgress = 40; snapshot.buildings.push(foundation);
    const retained = memory(), near = anchor(snapshot);
    let result: ReturnType<ReturnType<typeof createGoalEconomicGrounding>['buildSites']> | undefined;
    const readFact: GoalPlanningContext['readFact'] = fact => ({ fact, state: 'pending', observedTick: 0, revision: 'unpublished',
      requestId: fact.id, requestedTick: 0, reason: { code: 'route-pending', factIds: [fact.id], values: {} }, evidence: [] });
    for (const tick of [0, 15]) {
      const work = new FactWorkQueue(tick, 6144), geometry = createGoalGeometryReader({ tick, work, memory: retained });
      result = createGoalEconomicGrounding(context(snapshot, readFact), ports(snapshot, geometry)).buildSites('farm', near); work.flush();
    }
    if (!result || result.state !== 'met') throw Error('No published sites');
    const site = result.candidates.find(site => site.at.entityId === foundation.id)!;
    expect(site).toBeDefined(); expect(site.preconditions.some(fact => fact.predicate.kind === 'build-site')).toBe(false);
    const action = declareGoalBuilding({ buildingKind: 'farm', at: site.at, worker: { ref: site.worker, from: anchor(snapshot, 400, 500) },
      siteBinding: site, byTick: 2400 }, context(snapshot, readFact))!;
    expect(action.flows.find(flow => flow.resource.kind === 'gold')!.delta).toBe(0);
    expect(action.executor.parameters).toMatchObject({ foundationId: 'paid-farm' });
    expect(action.preconditions.some(fact => fact.predicate.kind === 'build-site')).toBe(false);
    const noClock: GoalPlanningContext['readFact'] = fact => ({ fact, state: 'met', observedTick: 15, revision: 'route-without-clock',
      reason: { code: 'distance-only', factIds: [fact.id], values: {} }, evidence: [], route: { distance: 100, ticks: null, points: [] } });
    const geometry = createGoalGeometryReader({ tick: 30, work: new FactWorkQueue(30, 0), memory: retained });
    const missingTime = createGoalEconomicGrounding(context(snapshot, noClock), ports(snapshot, geometry)).buildSites('farm', near);
    expect(missingTime.state === 'met' && missingTime.candidates[0]!.walkTicks.state).toBe('pending');
  });

  it('uses the same budgeted native Arrival for a water-centred yard approach and completes the public move/build chain', () => {
    const game = scene(true), snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
    const near: Target = { ...anchor(snapshot, 656, 800), landId: landIdAt(snapshot.map, { x: 624, y: 800 })!,
      seaId: seaIdAt(snapshot.map, { x: 656, y: 800 })! };
    let retained = memory(), aiMemory = createAiPolicyMemory(), found: Extract<GoalCandidates<import('./goal-planner-types').GoalBuildSite>, { state: 'met' }> | undefined;
    for (let tick = 0; tick < 1500 && !found; tick += 15) {
      snapshot.tick = tick;
      const work = new FactWorkQueue(tick, 6144), geometry = createGoalGeometryReader({ tick, work, memory: retained });
      withNavigationAudit(event => {
        if (event.phase === 'strategy-planning' && !event.authorization) throw Error(`Unbudgeted route ${event.operation}`);
      }, () => withNavigationPhase('strategy-planning', () => withFactWork(work, () => withAllocationArrivalQuery(snapshot, 'us', aiMemory, (_fixed, _loading, arrival, landRoute) => {
        const read: GoalPlanningContext['readFact'] = fact => {
          if (fact.predicate.kind !== 'route' || fact.predicate.actor?.kind !== 'existing') throw Error('Unexpected route actor');
          const actor = snapshot.units.find(unit => unit.id === (fact.predicate.kind === 'route' && fact.predicate.actor?.kind === 'existing' ? fact.predicate.actor.entityId : ''))!;
          const result = arrival(actor, fact.predicate.to), road = landRoute(actor, fact.predicate.to.point);
          const base = { fact, observedTick: tick, revision: `route-${tick}`, evidence: [] };
          if (result.status === 'unreachable' || road.status === 'unreachable') return { ...base, state: 'unmet', reason: { code: 'native-arrival-unreachable', factIds: [fact.id], values: {} } };
          if (result.status !== 'reachable' || road.status !== 'known') return { ...base, state: 'pending', requestId: fact.id, requestedTick: tick,
            reason: { code: 'native-arrival-pending', factIds: [fact.id], values: {} } };
          return { ...base, state: 'met', route: { distance: road.distance,
            ticks: result.ticks, points: road.points }, reason: { code: 'native-arrival', factIds: [fact.id], values: {} } };
        };
        const result = createGoalEconomicGrounding(context(snapshot, read), ports(snapshot, geometry)).buildSites('shipyard', near);
        if (result.state === 'met' && result.candidates.some(site => site.walkTicks.state === 'met' && !landIdAt(snapshot.map, site.at.point))) found = result;
        work.flush();
      }))));
      expect(work.receipt.used).toBeLessThanOrEqual(6144);
      retained = JSON.parse(JSON.stringify(retained)); aiMemory = JSON.parse(JSON.stringify(aiMemory));
    }
    expect(found).toBeDefined();
    const site = found!.candidates.find(site => site.walkTicks.state === 'met' && !landIdAt(snapshot.map, site.at.point))!;
    if (!site.route) throw Error('Known native site lost its route');
    expect(site.route.predicate.kind).toBe('route');
    if (site.route.predicate.kind !== 'route') throw Error('Not a route');
    const approach = site.route.predicate.to;
    expect(landIdAt(snapshot.map, approach.point)).toBe(near.landId);
    expect(isBuildPlacementClear(snapshot, 'shipyard', site.at.point)).toBe(true);
    const action = declareGoalBuilding({ buildingKind: 'shipyard', at: site.at, worker: { ref: site.worker, from: anchor(snapshot, 400, 500) },
      siteBinding: site, byTick: 5000 }, context(snapshot))!;
    expect(action.duration.state).toBe('met'); expect(action.executor.parameters).toMatchObject({ approach });
    const worker = game.units.find(unit => unit.id === 'worker')!;
    expect(tryPlayerCommand(game, 'us', { type: 'move', unitIds: [worker.id], ...approach.point }).ok).toBe(true);
    for (let tick = 0; tick < 1500 && worker.order.type === 'move'; tick++) stepGame(game);
    expect(worker.order.type).toBe('idle');
    expect(Math.hypot(worker.x - approach.point.x, worker.y - approach.point.y)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
    expect(tryPlayerCommand(game, 'us', { type: 'build', unitId: worker.id, buildingKind: 'shipyard', ...site.at.point }).ok).toBe(true);
    for (let tick = 0; tick < BUILDING_DEFS.shipyard.buildTime + 30 && !game.buildings.some(building => building.kind === 'shipyard' && building.complete); tick++) stepGame(game);
    expect(game.buildings.find(building => building.kind === 'shipyard')).toMatchObject({ complete: true, x: site.at.point.x, y: site.at.point.y });
    snapshot.tick = 0; expect(JSON.stringify(snapshot)).toBe(original);
  });
});
