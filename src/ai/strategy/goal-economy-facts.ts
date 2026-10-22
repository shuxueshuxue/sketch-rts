import { BUILDING_DEFS, RACE_DEFS, canTrainAt, trainingBuildingFor, unitMover } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { landSpawnPoint, productionRallyPoint } from '../../shared/production-spawn';
import { trainingRecruitPrototype } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import type { Building, TrainableUnitKind } from '../../shared/types';
import { goalFact, goalValueKey } from './goal-facts';
import { goalBuildingRegions, type GoalEconomicGroundingPorts } from './goal-economy-grounding';
import type { GoalFact, GoalFactObservation, GoalFlowSource, GoalPlanningContext } from './goal-planner-types';
import type { GoalSeaSpawnReader } from './goal-sea-spawn';
import type { Point, Target } from './types';

export type GoalEconomicFactPorts = GoalEconomicGroundingPorts & Readonly<{ reservedGold: number; seaSpawn?: GoalSeaSpawnReader }>;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const supported = new Set(['gold', 'production', 'supply-cap', 'population-room', 'build-site', 'spawn-exit',
  'building-complete', 'hall-complete', 'shipyard-for']);
const atPoint = (building: Building, point: Point) => building.x === point.x && building.y === point.y;

/** Domain resolver only. The owner-think reader composes this with route,
 * combat and projected-output readers; it owns queries, revisions and work. */
export function readGoalEconomicFact(fact: GoalFact, context: GoalPlanningContext,
  ports: GoalEconomicFactPorts): GoalFactObservation | null {
  const p = fact.predicate, { snapshot, owner, tick, situation } = context;
  if (!supported.has(p.kind)) return null;
  const race = snapshot.players[owner]?.race;
  const answer = (met: boolean, code: string, dependencies: unknown,
    extra: Partial<GoalFactObservation> = {}): GoalFactObservation => ({ fact, state: met ? 'met' : 'unmet', observedTick: tick,
    revision: goalValueKey([fact.id, dependencies]), evidence: [], reason: { code, factIds: [fact.id], values: {} }, ...extra } as GoalFactObservation);
  const pending = (code: string, dependencies: unknown, requestIds: readonly string[] = [fact.id], requestedTick = tick): GoalFactObservation => ({
    fact, state: 'pending', observedTick: tick, requestedTick,
    requestId: `economic:${goalValueKey([fact.id, requestIds])}`, revision: goalValueKey([fact.id, code, dependencies]),
    reason: { code, factIds: requestIds, values: {} }, evidence: [],
  });
  if (!race) return answer(false, 'economic-owner-missing', owner);
  const buildings = snapshot.buildings.filter(building => building.owner === owner && building.hp > 0)
    .sort((a, b) => order(a.id, b.id));
  const buildingRevision = (building: Building) => [building.id, building.kind, building.x, building.y, building.complete,
    building.buildProgress, building.buildTime, building.queue, building.researchQueue,
    productionRallyPoint(snapshot, building), snapshot.players[owner]!.upgrades];

  if (p.kind === 'gold') {
    const cash = snapshot.players[owner]!.gold;
    if (!Number.isFinite(ports.reservedGold) || ports.reservedGold < 0 || !Number.isFinite(cash))
      return pending('economic-reservation-invalid', [cash, ports.reservedGold]);
    const free = Math.max(0, cash - ports.reservedGold);
    if (situation.tick !== tick || snapshot.tick !== tick)
      return pending('economic-income-epoch-pending', [tick, snapshot.tick, situation.tick]);
    // Preserve the existing per-mine staffed forecast, not an average inferred
    // from predictedIncomeGold. Each rate stops at depletion or its horizon.
    const mines = situation.assets.filter(asset => asset.owner === owner && asset.kind === 'mine' && asset.complete
      && asset.remainingGold > 0 && asset.incomeGoldPerTick > 0).sort((a, b) => order(a.id, b.id));
    const end = tick + Math.max(0, situation.economy.horizonTicks);
    const curves = mines.map(mine => ({ id: mine.id, rate: mine.incomeGoldPerTick,
      end: Math.min(end, tick + mine.remainingGold / mine.incomeGoldPerTick) }));
    if (curves.some(curve => !Number.isFinite(curve.rate) || !Number.isFinite(curve.end)))
      return pending('economic-income-invalid', curves);
    const boundaries = [...new Set([tick, ...curves.map(curve => curve.end)])].sort((a, b) => a - b);
    const segments: Extract<GoalFlowSource, { kind: 'income' }>['segments'][number][] = [];
    for (let index = 1; index < boundaries.length; index++) {
      const fromTick = boundaries[index - 1]!, throughTick = boundaries[index]!;
      const ratePerTick = curves.filter(curve => curve.end > fromTick).reduce((sum, curve) => sum + curve.rate, 0);
      if (throughTick > fromTick && ratePerTick > 0) segments.push({ fromTick, throughTick, ratePerTick });
    }
    let income = 0, missing = Math.max(0, p.minimum - free), earliestTick: number | null = missing === 0 ? tick : null;
    for (const segment of segments) {
      const through = Math.min(p.byTick, segment.throughTick);
      const amount = Math.max(0, through - segment.fromTick) * segment.ratePerTick;
      income += amount;
      if (earliestTick === null && amount >= missing) earliestTick = Math.ceil(segment.fromTick + missing / segment.ratePerTick);
      missing = Math.max(0, missing - amount);
    }
    const forecast = { epoch: tick, currentFreeGold: free, goldAtDeadline: free + income, earliestTick,
      incomeGoldPerTick: curves.reduce((sum, curve) => sum + curve.rate, 0), factIds: mines.map(mine => mine.id),
      source: { kind: 'income' as const, id: `observed-staffed-income:${owner}`, segments } };
    return answer(free >= p.minimum && p.byTick >= tick, free >= p.minimum ? 'gold-free-now' : 'gold-needs-positive-flow',
      [cash, ports.reservedGold, forecast], { quantity: free, goldForecast: forecast,
        ...(earliestTick === null ? {} : { availableTick: earliestTick }) });
  }
  if (p.kind === 'supply-cap' || p.kind === 'population-room') {
    // Native snapshots already include paid queued units in supplyUsed.
    const player = snapshot.players[owner]!, quantity = p.kind === 'supply-cap' ? player.supplyCap : Math.max(0, player.supplyCap - player.supplyUsed);
    return answer(quantity >= p.minimum, p.kind === 'supply-cap' ? 'native-population-tier' : 'native-free-population',
      [player.supplyCap, player.supplyUsed], { quantity, availableTick: tick });
  }
  if (p.kind === 'production') {
    if (p.producer && p.producer.kind !== 'existing') return answer(false, 'producer-output-not-born', p.producer);
    const candidates = buildings.filter(building => (!p.producer || p.producer.kind === 'existing' && building.id === p.producer.entityId)
      && canTrainAt(race, building.kind, p.unitKind)).filter(building => {
      if (!p.at) return true;
      const regions = goalBuildingRegions(context, building.kind, building, ports);
      return unitMover(p.unitKind) === 'land' ? !p.at.landId || regions.lands.some(land => land.id === p.at!.landId)
        : !p.at.seaId || regions.seas.includes(p.at.seaId);
    });
    const free = candidates.filter(building => building.complete && building.queue.length === 0);
    return answer(free.length > 0 && p.byTick >= tick, free.length ? 'native-production-lane-free'
      : candidates.some(building => building.complete) ? 'native-production-lane-occupied' : 'native-producer-unbuilt',
    [race, candidates.map(buildingRevision)], { entityIds: free.map(building => building.id), ...(free.length ? { availableTick: tick } : {}) });
  }
  if (p.kind === 'building-complete') {
    if (p.building && p.building.kind !== 'existing') return answer(false, 'building-output-not-born', p.building);
    const matching = buildings.filter(building => building.kind === p.buildingKind && atPoint(building, p.at.point)
      && (!p.building || p.building.kind === 'existing' && building.id === p.building.entityId));
    const complete = matching.filter(building => building.complete);
    return answer(complete.length > 0, complete.length ? 'native-building-complete' : 'native-building-not-complete',
      matching.map(buildingRevision), { entityIds: complete.map(building => building.id),
        ...(complete[0] ? { availableTick: tick, site: { logicalTarget: p.at, buildPoint: p.at.point, buildingId: complete[0].id } } : {}) });
  }
  if (p.kind === 'hall-complete') {
    const mine = snapshot.resources.find(mine => mine.id === p.mineId);
    const land = mine && ports.regionAt(mine, 'land');
    const hall = mine && buildings.find(building => building.kind === 'townHall' && building.complete
      && Math.hypot(building.x - mine.x, building.y - mine.y) <= GOLD_MINE_RULES.baseRange
      && land?.startsWith('land:') && ports.regionAt(building, 'land') === land);
    return answer(!!hall, hall ? 'native-mine-hall-complete' : 'native-mine-hall-missing', [mine?.id, buildings.filter(building => building.kind === 'townHall').map(buildingRevision)],
      { entityIds: hall ? [hall.id] : [], ...(hall ? { availableTick: tick,
        site: { logicalTarget: p.at, buildPoint: { x: hall.x, y: hall.y }, buildingId: hall.id } } : {}) });
  }
  if (p.kind === 'shipyard-for') {
    const yards = buildings.filter(building => building.kind === 'shipyard' && building.complete
      && goalBuildingRegions(context, building.kind, building, ports).seas.includes(p.seaId));
    return answer(yards.length > 0, yards.length ? 'native-shipyard-complete' : 'native-shipyard-missing',
      yards.map(buildingRevision), { entityIds: yards.map(building => building.id), ...(yards.length ? { availableTick: tick } : {}) });
  }
  if (p.kind === 'build-site') {
    if (!RACE_DEFS[race].buildableBuildings.includes(p.buildingKind)) return answer(false, 'native-building-race-forbidden', race);
    const rules = BUILDING_DEFS[p.buildingKind], snapped = snapToFootprint(snapshot.map, rules.radius, p.at.point);
    if (snapped.x !== p.at.point.x || snapped.y !== p.at.point.y) return answer(false, 'build-site-not-native-point', p.at);
    const result = ports.geometry({ key: `exact-build-site:${fact.id}`, revision: ports.geometryRevision, initialState: null,
      advance: (state, allowance) => {
        if (!allowance) return { state, work: 0, done: false };
        const regions = goalBuildingRegions(context, p.buildingKind, p.at.point, ports);
        const within = p.at.point.x >= rules.radius && p.at.point.y >= rules.radius
          && p.at.point.x + rules.radius <= snapshot.map.width && p.at.point.y + rules.radius <= snapshot.map.height;
        const matchingLand = regions.lands.some(land => !p.at.landId || land.id === p.at.landId);
        const matchingSea = !p.at.seaId || regions.seas.includes(p.at.seaId);
        return { state, work: 1, done: true, value: within && matchingLand && matchingSea && isBuildPlacementClear(snapshot, p.buildingKind, p.at.point) };
      } });
    return result.state === 'met' ? answer(result.value, result.value ? 'native-build-site-clear' : 'native-build-site-occupied',
      [ports.geometryRevision, result.factIds, result.value]) : pending(result.reason.code, ports.geometryRevision,
      result.state === 'pending' ? result.requestIds : result.reason.factIds,
      typeof result.reason.values.requestedTick === 'number' ? result.reason.values.requestedTick : tick);
  }
  if (p.kind === 'spawn-exit') {
    if (p.producer.kind !== 'existing') return answer(false, 'spawn-producer-output-not-born', p.producer);
    const producer = buildings.find(building => p.producer.kind === 'existing' && building.id === p.producer.entityId);
    if (!producer || !producer.complete || !trainingBuildingFor(race, p.unitKind) || !canTrainAt(race, producer.kind, p.unitKind))
      return answer(false, 'native-spawn-producer-unavailable', [p.producer, producer && buildingRevision(producer)]);
    const rally = productionRallyPoint(snapshot, producer);
    if (unitMover(p.unitKind) === 'sea') {
      if (!ports.seaSpawn) return pending('native-sea-spawn-port-required', buildingRevision(producer));
      const recruit = trainingRecruitPrototype(snapshot, producer, { unitKind: p.unitKind as TrainableUnitKind, remaining: 0 });
      const spawn = ports.seaSpawn(producer, recruit);
      const dependencies = [buildingRevision(producer), recruit.kind, spawn];
      if (spawn.state === 'pending') return pending(spawn.reason.code, dependencies, spawn.requestIds);
      if (spawn.state !== 'met') return answer(false, spawn.reason.code, dependencies);
      const options = spawn.value.options;
      if (options.length === 1) {
        const selected = options[0]!.seaId;
        return answer(!p.toward.seaId || p.toward.seaId === selected,
          !p.toward.seaId || p.toward.seaId === selected ? 'native-sea-spawn-single-component' : 'native-sea-spawn-component-mismatch',
          dependencies, { availableTick: tick });
      }
      const selected = ports.regionAt(rally, 'sea');
      if (!selected || !options.some(option => option.seaId === selected))
        return pending('native-sea-spawn-rally-component-pending', dependencies, spawn.factIds);
      const requested = p.toward.seaId ?? ports.regionAt(p.toward.point, 'sea');
      return answer(!requested || requested === selected,
        !requested || requested === selected ? 'native-sea-spawn-rally-component' : 'native-sea-spawn-rally-component-mismatch',
        dependencies, { availableTick: tick });
    }
    if (rally.x !== p.toward.point.x || rally.y !== p.toward.point.y)
      return answer(false, 'native-spawn-rally-binding-changed', [buildingRevision(producer), p.toward]);
    const recruit = trainingRecruitPrototype(snapshot, producer, { unitKind: p.unitKind as TrainableUnitKind, remaining: 0 });
    const routes: GoalFactObservation[] = [];
    const point = landSpawnPoint(snapshot, producer, recruit, (from, goal) => {
      const a = ports.regionAt(from, 'land'), b = ports.regionAt(goal, 'land');
      const target = (point: Point, land: typeof a): Target => ({ point, ...(land?.startsWith('land:') ? { landId: land as `land:${number}` } : {}) });
      const route = context.readFact(goalFact({ kind: 'route', mover: 'land', from: target(from, a), to: target(goal, b) }));
      routes.push(route);
      return route.state === 'pending' ? undefined : route.state === 'met';
    });
    const dependencies = [buildingRevision(producer), [recruit.kind, recruit.radius, recruit.speed, recruit.maxHp],
      point, routes.map(route => [route.fact.id, route.revision, route.state])];
    const unready = routes.filter(route => route.state === 'pending');
    if (!point && unready.length) return pending('native-spawn-route-pending', dependencies,
      unready.flatMap(route => route.state === 'pending' ? [route.requestId] : []),
      Math.min(...unready.flatMap(route => route.state === 'pending' ? [route.requestedTick] : [])));
    return answer(!!point, point ? 'native-land-spawn-clear' : 'native-land-spawn-blocked', dependencies,
      point ? { site: { logicalTarget: p.toward, buildPoint: point }, availableTick: tick } : {});
  }
  return null;
}
