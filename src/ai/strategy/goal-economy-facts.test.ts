import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { UNIT_DEFS } from '../../shared/catalog';
import { landSpawnPoint, landSpawnPrototype, productionRallyPoint } from '../../shared/production-spawn';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame, stepGame, tryPlayerCommand } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { withAllocationArrivalQuery, type AllocationLandRouteReader } from './allocation-arrival-query';
import { buildObservedStrategyDecision, projectStrategyTrace } from './decision';
import { declareGoalWaitIncome } from './goal-economy-actions';
import { readGoalEconomicFact, type GoalEconomicFactPorts } from './goal-economy-facts';
import { goalFact } from './goal-facts';
import { FactWorkQueue, withFactWork } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory } from './goal-grounding-ports';
import type { GoalFact, GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from './regions';

function nativeGame() {
  const game = sketchScene('economic-fact-native-source').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 3000 })
    .townHall('us', 400, 400, { id: 'hall' }).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 400, 700, { id: 'producer' }).worker('us', 630, 400, { id: 'worker' })
    .goldMine('mine', 640, 400, 10000).build().createGame();
  game.scriptedVictory = true;
  return game;
}
function world(snapshot: GameSnapshot, owner = 'us') {
  regionIndex(snapshot.map);
  // The actual existing observer builds the Situation; no substitute fact
  // matrix or hand-filled economy is used for these domain resolver tests.
  const situation = projectStrategyTrace(buildObservedStrategyDecision(snapshot, owner,
    { memory: createAiPolicyMemory() }, undefined, undefined, Infinity)).situation;
  let route: AllocationLandRouteReader | undefined;
  const context: GoalPlanningContext = { snapshot, situation, owner, tick: snapshot.tick, version: 'v9_summoner', readFact: fact => {
    if (fact.predicate.kind !== 'route' || !route) throw Error('No shared route source installed');
    const road = route(fact.predicate.from.point, fact.predicate.to.point);
    const common = { fact, observedTick: snapshot.tick, revision: JSON.stringify(road), evidence: [] };
    if (road.status === 'known') return { ...common, state: 'met', route: { distance: road.distance, ticks: null, points: road.points },
      reason: { code: 'shared-native-route', factIds: [fact.id], values: {} } };
    return road.status === 'unreachable' ? { ...common, state: 'unmet', reason: { code: road.reasonCode, factIds: [fact.id], values: {} } }
      : { ...common, state: 'pending', requestId: fact.id, requestedTick: snapshot.tick,
        reason: { code: road.reasonCode, factIds: [fact.id], values: {} } };
  } };
  return { context, setRoute: (reader: AllocationLandRouteReader) => { route = reader; } };
}
function ports(context: GoalPlanningContext, work = new FactWorkQueue(context.tick, 0), memory: GoalGeometryMemory = { version: 1, entries: [] }): GoalEconomicFactPorts {
  return { geometry: createGoalGeometryReader({ tick: context.tick, work, memory }), geometryRevision: 'original-bodies', reservedGold: 0,
    regionAt: (point, mover) => mover === 'land' ? landIdAt(context.snapshot.map, point) : seaIdAt(context.snapshot.map, point) };
}
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(`Unbudgeted native ${event.operation}`);
}, () => withNavigationPhase('strategy-planning', run));

describe('economic facts from native snapshots and the actual Situation', () => {
  it('deducts reservations once and preserves finite per-mine staffed income without extrapolating the scalar total', () => {
    const game = nativeGame();
    expect(tryPlayerCommand(game, 'us', { type: 'mine', unitIds: ['worker'], resourceId: 'mine' }).ok).toBe(true);
    for (let tick = 0; tick < 800; tick++) stepGame(game);
    const snapshot = snapshotGame(game), { context } = world(snapshot), input = { ...ports(context), reservedGold: 125 };
    const mine = context.situation.assets.find(asset => asset.id === 'mine')!;
    expect(mine.incomeGoldPerTick).toBeGreaterThan(0);
    const free = snapshot.players.us!.gold - 125, byTick = context.tick + context.situation.economy.horizonTicks;
    const fact = goalFact({ kind: 'gold', minimum: free + 1, byTick });
    const before = JSON.stringify(snapshot), result = strict(() => readGoalEconomicFact(fact, context, input))!;
    expect(result.state).toBe('unmet'); expect(result.quantity).toBe(free);
    expect(result.goldForecast!.currentFreeGold).toBe(free);
    expect(result.goldForecast!.goldAtDeadline - free).toBeCloseTo(context.situation.economy.predictedIncomeGold, 10);
    expect(result.goldForecast!.source!.segments[0]!.fromTick).toBe(context.tick);
    expect(result.goldForecast!.source!.segments.at(-1)!.throughTick).toBeLessThanOrEqual(byTick);
    const long = readGoalEconomicFact(goalFact({ kind: 'gold', minimum: free + mine.remainingGold * 2, byTick: byTick + 10000 }), context, input)!;
    expect(long.goldForecast!.goldAtDeadline).toBe(result.goldForecast!.goldAtDeadline);
    expect(long.goldForecast!.earliestTick).toBe(null);
    const action = declareGoalWaitIncome(fact, { ...context, readFact: requested => readGoalEconomicFact(requested, context, input)! })!;
    expect(action.flows[0]!.delta).toBeCloseTo(1);
    expect(action.flows[0]!.source!.id).toBe(result.goldForecast!.source!.id);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('reads native paid population and queue occupancy, including a changed dynamic rally revision', () => {
    const game = nativeGame(), snapshot = snapshotGame(game), first = world(snapshot).context;
    const at = { landId: landIdAt(snapshot.map, { x: 400, y: 700 })!, point: { x: 400, y: 700 } };
    const fact = goalFact({ kind: 'production', unitKind: 'footman', producer: { kind: 'existing', entityId: 'producer' }, at, byTick: 5000 });
    const available = readGoalEconomicFact(fact, first, ports(first))!;
    expect(available).toMatchObject({ state: 'met', entityIds: ['producer'], availableTick: snapshot.tick });
    expect(tryPlayerCommand(game, 'us', { type: 'train', buildingId: 'producer', unitKind: 'footman' }).ok).toBe(true);
    const queued = world(snapshotGame(game)).context, occupied = readGoalEconomicFact(fact, queued, ports(queued))!;
    expect(occupied).toMatchObject({ state: 'unmet', entityIds: [], reason: { code: 'native-production-lane-occupied' } });
    expect(occupied.availableTick).toBeUndefined(); expect(occupied.revision).not.toBe(available.revision);
    const population = readGoalEconomicFact(goalFact({ kind: 'population-room', minimum: 100, byTick: 5000 }), queued, ports(queued))!;
    expect(population.quantity).toBe(game.players.us!.supplyCap - game.players.us!.supplyUsed);
    expect(game.players.us!.supplyUsed - snapshot.players.us!.supplyUsed).toBe(UNIT_DEFS.footman.supplyUsed);
    expect(tryPlayerCommand(game, 'us', { type: 'setRally', buildingIds: ['producer'], x: 630, y: 400,
      target: { type: 'unit', unitId: 'worker' } }).ok).toBe(true);
    const moved = world(snapshotGame(game)).context;
    expect(readGoalEconomicFact(fact, moved, ports(moved))!.revision).not.toBe(occupied.revision);
  });

  it('does not grant world existence to future producers and leaves other domains to the common reader', () => {
    const { context } = world(snapshotGame(nativeGame())), input = ports(context);
    const at = { landId: landIdAt(context.snapshot.map, { x: 400, y: 700 })!, point: { x: 400, y: 700 } };
    const future = { kind: 'output', actionId: 'build-later', output: 'building' } as const;
    for (const fact of [goalFact({ kind: 'production', unitKind: 'footman', producer: future, at, byTick: 5000 }),
      goalFact({ kind: 'building-complete', buildingKind: 'barracks', at, building: future }),
      goalFact({ kind: 'spawn-exit', producer: future, unitKind: 'footman', toward: at })]) {
      const result = readGoalEconomicFact(fact, context, input)!;
      expect(result.state).toBe('unmet'); expect(result.entityIds ?? []).toEqual([]);
    }
    expect(readGoalEconomicFact(goalFact({ kind: 'site-safe', site: at, throughTick: 1000 }), context, input)).toBeNull();
    expect(readGoalEconomicFact(goalFact({ kind: 'hall-complete', mineId: 'mine', at: { ...at, entityId: 'mine', point: { x: 640, y: 400 } } }), context, input))
      .toMatchObject({ state: 'met', entityIds: ['hall'], site: { buildingId: 'hall', buildPoint: { x: 400, y: 400 } } });
  });

  it('publishes an exact native site only after budgeted work and reads actual construction completion', () => {
    const game = nativeGame(), original = snapshotGame(game), source = world(original).context, memory: GoalGeometryMemory = { version: 1, entries: [] };
    const at = { landId: landIdAt(original.map, { x: 1000, y: 1000 })!, point: { x: 1000, y: 1000 } };
    const fact = goalFact({ kind: 'build-site', buildingKind: 'farm', at });
    const zero = new FactWorkQueue(source.tick, 0);
    expect(strict(() => readGoalEconomicFact(fact, source, ports(source, zero, memory)))!.state).toBe('pending');
    strict(() => zero.flush()); expect(memory.entries[0]!.work).toBe(0);
    const work = new FactWorkQueue(source.tick + 15, 1), next = { ...source, tick: source.tick + 15 };
    expect(strict(() => readGoalEconomicFact(fact, next, ports(next, work, memory)))!.state).toBe('pending');
    strict(() => work.flush()); expect(work.receipt.used).toBe(1);
    const published = { ...source, tick: source.tick + 30 };
    expect(strict(() => readGoalEconomicFact(fact, published, ports(published, new FactWorkQueue(published.tick, 0), memory))))
      .toMatchObject({ state: 'met', reason: { code: 'native-build-site-clear' } });
    expect(tryPlayerCommand(game, 'us', { type: 'build', unitId: 'worker', buildingKind: 'farm', ...at.point }).ok).toBe(true);
    for (let tick = 0; tick < 1500 && !game.buildings.some(building => building.kind === 'farm'); tick++) stepGame(game);
    const foundation = game.buildings.find(building => building.kind === 'farm')!;
    const complete = goalFact({ kind: 'building-complete', buildingKind: 'farm', at,
      building: { kind: 'existing', entityId: foundation.id } });
    let frame = world(snapshotGame(game)).context;
    expect(readGoalEconomicFact(complete, frame, ports(frame))!.state).toBe('unmet');
    for (let tick = 0; tick < 200 && !foundation.complete; tick++) stepGame(game);
    frame = world(snapshotGame(game)).context;
    expect(readGoalEconomicFact(complete, frame, ports(frame))).toMatchObject({ state: 'met', entityIds: [foundation.id] });
  });

  it('does not reuse warm native exit routing and eventually consumes the same shared finite route publication', () => {
    const game = nativeGame(), memory = createAiPolicyMemory();
    let frame = world(snapshotGame(game)), published = false, cold = true;
    const nativeProducer = frame.context.snapshot.buildings.find(building => building.id === 'producer')!;
    expect(landSpawnPoint(frame.context.snapshot, nativeProducer, landSpawnPrototype(nativeProducer, 'footman'))).toBeDefined();
    for (let think = 0; think < 100 && !published; think++) {
      if (think) { for (let tick = 0; tick < 15; tick++) stepGame(game); frame = world(snapshotGame(game)); }
      const work = new FactWorkQueue(frame.context.tick, cold ? 0 : 6144), input = ports(frame.context, work);
      strict(() => withFactWork(work, () => withAllocationArrivalQuery(frame.context.snapshot, 'us', memory, (_f, _l, _a, road) => {
        frame.setRoute(road);
        const producer = frame.context.snapshot.buildings.find(building => building.id === 'producer')!;
        const fact = goalFact({ kind: 'spawn-exit', producer: { kind: 'existing', entityId: 'producer' }, unitKind: 'footman',
          toward: { point: productionRallyPoint(frame.context.snapshot, producer) } });
        const result = readGoalEconomicFact(fact, frame.context, input)!;
        if (cold) expect(result).toMatchObject({ state: 'pending', reason: { code: 'native-spawn-route-pending' } });
        else published = result.state === 'met';
        work.flush();
      })));
      expect(work.receipt.used).toBeLessThanOrEqual(cold ? 0 : 6144); cold = false;
    }
    expect(published).toBe(true);
  });

  it('keeps the real 4180 ship launch unresolved rather than calling native sea steering outside the budget', () => {
    const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
    const { context } = world(frame.snapshot, frame.owner), producer = context.snapshot.buildings.find(building => building.owner === frame.owner && building.kind === 'shipyard')!;
    const fact = goalFact({ kind: 'spawn-exit', unitKind: 'transport', producer: { kind: 'existing', entityId: producer.id },
      toward: { point: productionRallyPoint(context.snapshot, producer) } });
    expect(strict(() => readGoalEconomicFact(fact, context, ports(context))))
      .toMatchObject({ state: 'pending', reason: { code: 'native-sea-spawn-port-required' } });
  });
});
