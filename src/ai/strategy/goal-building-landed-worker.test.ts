import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS } from '../../shared/catalog';
import { boardUnit } from '../../shared/decks';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { declareGoalBuilding } from './goal-economy-actions';
import { createGoalEconomicGrounding, type GoalEconomicGroundingPorts } from './goal-economy-grounding';
import { goalFact } from './goal-facts';
import { goalPoolMemberCandidates } from './goal-pool-members';
import type { GoalCohortOption, GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import type { Target } from './types';

// Domain port tests: landings/route quotes below stand for already published
// common-source results. They do not run or replace the public puzzle source.
function frame(aboard = false) {
  const game = sketchScene('building-with-landed-worker').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 400 })
    .townHall('us', 192, 192, { id: 'home' }).worker('us', 400, 500, { id: 'worker' }).build().createGame();
  Object.assign(game.map, { width: 1280, height: 1280, terrain: { cell: 32, cols: 40, rows: 40,
    cells: Array.from({ length: 40 }, () => '.'.repeat(15) + '~'.repeat(5) + '.'.repeat(20)).join('') } });
  regionIndex(game.map);
  if (aboard) {
    const hull = game.spawnUnit('us', 'transport', 560, 600);
    expect(boardUnit(hull, game.units.find(unit => unit.id === 'worker')!, game.units)).toBe(true);
  }
  const snapshot = snapshotGame(game), at: Target = { landId: landIdAt(game.map, { x: 960, y: 896 })!, point: { x: 960, y: 896 } };
  const context: GoalPlanningContext = { snapshot, tick: snapshot.tick, owner: 'us', version: 'v9_knight',
    situation: { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, lands: [], seas: [], assets: [], units: [],
      opportunities: [], economy: { cashGold: 400, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] }, limitations: [] },
    readFact: fact => {
      if (fact.predicate.kind === 'worker-at') return { fact, state: 'unmet', observedTick: snapshot.tick, revision: fact.id,
        evidence: [], entityIds: [], quantity: 0, reason: { code: 'actual-island-worker-pool-empty', factIds: [fact.id], values: {} } };
      if (fact.predicate.kind !== 'route') throw Error('No hidden world/selector reads');
      const from = fact.predicate.from.point;
      return { fact, state: 'met', observedTick: snapshot.tick, revision: fact.id, evidence: [],
        reason: { code: 'published-route-port', factIds: [fact.id], values: {} },
        route: { distance: 120, ticks: from.y === 736 ? 15 : 30, points: [from, fact.predicate.to.point] } };
    } };
  const ports: GoalEconomicGroundingPorts = {
    geometry: request => {
      const result = request.advance(request.initialState, 128);
      if (!result.done || result.value === undefined) throw Error('Native site fixture did not finish its finite slice');
      return { state: 'met', value: result.value, factIds: [request.key] };
    },
    geometryRevision: 'native-site-1', regionAt: (p, mover) => mover === 'land' ? landIdAt(snapshot.map, p) : seaIdAt(snapshot.map, p),
  };
  expect(isBuildPlacementClear(snapshot, 'townHall', at.point)).toBe(true);
  return { context, ports, at };
}
const strict = <T>(run: () => T) => withNavigationAudit(event => { throw Error(`Unbudgeted route ${event.operation}`); },
  () => withNavigationPhase('strategy-planning', run));

function landingOption(context: GoalPlanningContext, at: Target, y: number): GoalCohortOption {
  const actual = context.snapshot.units.find(unit => unit.id === 'worker')!, from: Target = { landId: at.landId!, point: { x: 704, y } };
  const reference = { kind: 'existing' as const, entityId: actual.id };
  return { id: `published-landing-${y}`, from, members: [{ reference, assessment: { ...actual, ...from.point } }],
    preconditions: [goalFact({ kind: 'worker-at', worker: reference, at: from, count: 1, byTick: 2400 })],
    availableTick: null, factIds: [`published-shore-${y}`] };
}

describe('build grounding from common landed-worker alternatives', () => {
  for (const aboard of [false, true]) it(`retains exact real worker and distinct published landings (${aboard ? 'aboard' : 'mainland'})`, () => {
    const { context, ports, at } = frame(aboard), before = JSON.stringify(context.snapshot);
    const options = [landingOption(context, at, 736), landingOption(context, at, 992)], optionBytes = JSON.stringify(options);
    const requested: string[] = [];
    const result = strict(() => createGoalEconomicGrounding(context, { ...ports, cohortOptions: effect => {
      expect(effect.predicate).toMatchObject({ kind: 'worker-at', at: { landId: at.landId }, count: 1 });
      requested.push(effect.id); return { state: 'met', candidates: options, factIds: ['landing-pool-options'] };
    } }).buildSites('townHall', at));
    expect(requested.length).toBeGreaterThan(0); expect(result.state).toBe('met');
    if (result.state !== 'met') throw Error('Published landing worker lost');
    expect(result.candidates).toHaveLength(requested.length * 2);
    expect(new Set(result.candidates.map(site => site.id)).size).toBe(result.candidates.length);
    for (const [index, site] of result.candidates.entries()) {
      const optionIndex = index % 2;
      expect(site.worker).toMatchObject({ kind: 'pool-member', unitKind: 'worker', at: { landId: at.landId } });
      if (!site.route) throw Error('Published landing lost its route');
      expect(site.route.predicate).toMatchObject({ kind: 'route', from: options[optionIndex]!.from, to: { landId: at.landId }, actor: site.worker });
      expect(site.preconditions.some(f => f.predicate.kind === 'worker-at' && f.predicate.worker === undefined)).toBe(true);
      const from = site.route.predicate.kind === 'route' ? site.route.predicate.from : undefined;
      expect(from).toBeDefined();
      const action = strict(() => declareGoalBuilding({ buildingKind: 'townHall', at: site.at, byTick: 2400,
        worker: { ref: site.worker, from: from! }, siteBinding: site }, context));
      expect(action).not.toBeNull();
      expect(action!.duration).toMatchObject({ state: 'met', value: BUILDING_DEFS.townHall.buildTime + (optionIndex ? 30 : 15) });
      expect(action!.preconditions.some(f => f.predicate.kind === 'worker-at' && f.predicate.worker === undefined)).toBe(true);
      expect(action!.executor.parameters.worker).toEqual(site.worker);
      if (site.worker.kind !== 'pool-member') throw Error('Not a pool slot');
      expect(goalPoolMemberCandidates({ snapshot: context.snapshot, owner: context.owner, reference: site.worker })).toEqual([]);
    }
    expect(JSON.stringify(context.snapshot)).toBe(before); expect(JSON.stringify(options)).toBe(optionBytes);
  });

  it('keeps missing landing requests pending without inventing a worker identity or route', () => {
    const { context, ports, at } = frame(); let reads = 0;
    const result = strict(() => createGoalEconomicGrounding({ ...context, readFact: fact => { if (fact.predicate.kind === 'route') { reads++; throw Error('No known landing'); } return context.readFact(fact); } },
      { ...ports, cohortOptions: () => ({ state: 'pending', requestIds: ['actual-landing-not-published'],
        reason: { code: 'transport-landing-pending', factIds: ['actual-hull'], values: {} } }) }).buildSites('townHall', at));
    expect(result.state).toBe('met');
    if (result.state !== 'met') throw Error('No pending build declaration');
    expect(result.candidates.every(site => site.route === null && site.walkTicks.state === 'pending')).toBe(true);
    expect(result.deferred?.some(item => item.requestIds.includes('actual-landing-not-published'))).toBe(true);
    expect(reads).toBe(0); expect(JSON.stringify(result)).not.toContain('worker:land:');
  });

  it('keeps known landings usable while preserving an unresolved alternative', () => {
    const { context, ports, at } = frame(), option = landingOption(context, at, 736);
    const deferred = { id: 'other-landing', requestIds: ['shore-not-published'],
      reason: { code: 'shore-pending', factIds: ['actual-hull'], values: {} } };
    const result = strict(() => createGoalEconomicGrounding(context, { ...ports,
      cohortOptions: () => ({ state: 'met', candidates: [option], factIds: ['known-landing'], deferred: [deferred] }) }).buildSites('townHall', at));
    expect(result.state).toBe('met'); if (result.state !== 'met') throw Error('Known landing blocked');
    expect(result.candidates.length).toBeGreaterThan(0); expect(result.deferred).toContainEqual(deferred);
  });

  it('keeps an unproven future quantity as a pending build candidate without inventing an actor or origin', () => {
    const { context, ports, at } = frame();
    const reason = { code: 'no-reachable-worker-origin', factIds: ['actual-worker'], values: {} };
    const result = strict(() => createGoalEconomicGrounding(context, { ...ports,
      cohortOptions: () => ({ state: 'unmet', reason }) }).buildSites('townHall', at));
    expect(result.state).toBe('met'); if (result.state !== 'met') throw Error('Missing build alternatives');
    expect(result.candidates.every(site => site.worker.kind === 'pool-member' && site.route === null && site.walkTicks.state === 'pending')).toBe(true);
  });
});
