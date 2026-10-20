import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { walkableGoal } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import { createPlanningDistanceQuery } from './distance-fields';
import { createSeaTravelQuery } from './sea-travel';
import { landIdAt, regionIndex, seaIdAt, type RegionIndex, type Shore } from './regions';
import type { Arrival, CrossingEta, Evidence, Point, Reason, Target, LandId, SeaId } from './types';

const evidence = (tick: number, source: string, detail: string): Evidence => ({ tick, source, detail, certainty: 'inferred' });
const unavailable = (code: string, detail: string): Arrival => ({ status: 'unreachable', reason: { code, detail, evidence: [] } });
type CrossingChoice = { from: Shore; to: Shore; afterCost: number; readyTicks: number;
  crossing: Omit<CrossingEta, 'waitTicks'>; unmet: readonly Reason[] };

/** One think's reusable route queries. Durations are forecasts of stated routes,
 * not promises that body avoidance, combat or a future build will finish on time. */
export function createArrivalQuery(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  distances = createPlanningDistanceQuery(snapshot), seaBuildBudget = Infinity, regions: RegionIndex = regionIndex(snapshot.map)) {
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const answers = new Map<string, Arrival>();
  const landTimes = new Map<string, number | undefined>();
  const landAges = new Map<string, number>(), pendingLand = new Set<string>();
  const ferries = memory.naval?.ferries ?? {};
  const shoresByLand = regions.shoresByLand;
  const nearestCache = new WeakMap<readonly Shore[], Map<string, readonly Shore[]>>();
  const departuresByRegion = new Map<string, readonly Shore[]>();
  const seaTravel = createSeaTravelQuery(snapshot, seaBuildBudget);
  const crossingTables = new Map<string, { choices: CrossingChoice[]; pending: boolean; ages: number[]; quoteAges: number[] }>();
  let pendingGeometry = false;
  const usedFieldTicks = new Set<number>(), usedQuoteTicks = new Set<number>();
  const reasons = new Map<string, Reason>();
  const reason = (code: string, detail: string): Reason => {
    const key = `${code}:${detail}`; let value = reasons.get(key);
    if (!value) reasons.set(key, value = { code, detail, evidence: [evidence(snapshot.tick, 'strategy.arrivals', detail)] });
    return value;
  };

  function landTime(unit: Unit, point: Point): number | undefined {
    const key = `${unit.id}:${unit.x}:${unit.y}:${unit.speed}:${point.x}:${point.y}`;
    if (landTimes.has(key)) {
      if (pendingLand.has(key)) pendingGeometry = true;
      const age = landAges.get(key); if (age !== undefined) usedFieldTicks.add(age);
      return landTimes.get(key);
    }
    if (!Number.isFinite(unit.speed) || unit.speed <= 0) throw new Error(`Invalid strategy walking speed ${unit.id}: ${unit.speed}`);
    const field = distances.field(point);
    if (!field) { pendingGeometry = true; pendingLand.add(key); }
    if (field) { usedFieldTicks.add(field.builtTick); landAges.set(key, field.builtTick); }
    const cost = field?.field.cost(unit);
    const ticks = cost === undefined ? undefined : Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
    landTimes.set(key, ticks);
    return ticks;
  }

  function seaTime(ship: Unit, from: Point, to: Point, future = false): number | undefined {
    const result = seaTravel.travel(ship, from, to, future);
    if (result.status === 'pending') pendingGeometry = true;
    if (result.status !== 'known') return undefined;
    if (result.geometryTick !== null) usedFieldTicks.add(result.geometryTick);
    usedQuoteTicks.add(result.computedTick); return result.ticks;
  }

  function nearest(shores: readonly Shore[], point: Point): readonly Shore[] {
    let points = nearestCache.get(shores);
    if (!points) nearestCache.set(shores, points = new Map());
    const key = `${point.x}:${point.y}`, known = points.get(key);
    if (known) return known;
    let first: Shore | undefined, second: Shore | undefined, best = Infinity, next = Infinity;
    // Terrain shores are already in stable row/column order. Keep two minima,
    // instead of sorting the entire coastline for every unit/target pair.
    for (const shore of shores) {
      const gap = (shore.ground.x - point.x) ** 2 + (shore.ground.y - point.y) ** 2;
      if (gap < best) { second = first; next = best; first = shore; best = gap; }
      else if (gap < next) { second = shore; next = gap; }
    }
    const result = first ? second ? [first, second] : [first] : [];
    points.set(key, result);
    return result;
  }

  const freeTimes = new Map<string, { point: Point; ticks: number; unmet: Reason[] } | undefined>();
  function freeShip(ship: Unit) {
    if (freeTimes.has(ship.id)) return freeTimes.get(ship.id);
    const mission = ferries[ship.id];
    if (!mission) {
      const free = { point: ship as Point, ticks: 0, unmet: [] as Reason[] };
      freeTimes.set(ship.id, free); return free;
    }
    const point = mission.phase === 'return' ? mission.from : mission.to;
    const travel = seaTime(ship, ship, point);
    if (travel === undefined) { freeTimes.set(ship.id, undefined); return undefined; }
    // Active ferry streams own their boat even after this load lands. Borrowing
    // it is an explicit prerequisite, never fictitious currently free capacity.
    let ticks = travel + GANGWAY_SETUP_TICKS;
    if (mission.phase === 'loading') {
      const times = mission.crewIds.flatMap(id => {
        const unit = byId.get(id);
        if (!unit || unit.deck || unit.cabin) return [];
        const land = landIdAt(snapshot.map, unit), sea = seaIdAt(snapshot.map, ship);
        const shore = land && sea ? shoresByLand.get(land)?.get(sea) ?? [] : [];
        const ground = nearest(shore, mission.from)[0]?.ground;
        const time = ground && landTime(unit, ground);
        return time === undefined ? [] : [time];
      });
      ticks += times.length ? Math.max(...times) : 0;
    }
    const free = { point, ticks, unmet: [reason('borrow-transport', `Release ${ship.id} from ${mission.purpose}:${mission.targetId} after its current voyage`)] };
    freeTimes.set(ship.id, free); return free;
  }

  const prototypes = new Map<string, Unit>();
  function crossingTable(unit: Unit, source: LandId, destination: LandId, target: Target) {
    const key = `${unit.owner}:${source}:${destination}:${target.point.x}:${target.point.y}`;
    const known = crossingTables.get(key);
    if (known) {
      if (known.pending) pendingGeometry = true;
      for (const tick of known.ages) usedFieldTicks.add(tick);
      for (const tick of known.quoteAges) usedQuoteTicks.add(tick);
      return known.choices;
    }
    const choices: CrossingChoice[] = [], targetField = distances.field(target.point);
    if (!targetField) pendingGeometry = true;
    else {
      usedFieldTicks.add(targetField.builtTick);
      for (const [seaKey, shores] of shoresByLand.get(source) ?? []) {
        const sea = shores[0]!.seaId, departureKey = `${unit.owner}:${source}:${sea}`;
        if (!departuresByRegion.has(departureKey)) {
          const anchor = snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'shipyard'
            && landIdAt(snapshot.map, building) === source && seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) === sea)
            ?? snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'townHall' && landIdAt(snapshot.map, building) === source)
            ?? unit;
          departuresByRegion.set(departureKey, nearest(shores, anchor));
        }
        const landings = nearest(shoresByLand.get(destination)?.get(seaKey) ?? [], target.point);
        if (!landings.length) continue;
        const actual = snapshot.units.filter(ship => ship.owner === unit.owner && ship.hp > 0 && isTransportKind(ship.kind) && seaIdAt(snapshot.map, ship) === sea);
        for (const from of departuresByRegion.get(departureKey)!) for (const to of landings) {
          const afterCost = targetField.field.cost(to.ground);
          if (afterCost === undefined) continue;
          const yard = snapshot.buildings.filter(building => building.owner === unit.owner && building.kind === 'shipyard' && building.hp > 0
            && seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) === sea)
            .sort((a, b) => Number(landIdAt(snapshot.map, b) === source) - Number(landIdAt(snapshot.map, a) === source)
              || distance(a, from.water) - distance(b, from.water) || a.id.localeCompare(b.id))[0];
          const factoryPoint = yard ? walkableGoal(snapshot.map, yard.x, yard.y, 'sea') : from.water;
          const prototypeKey = `${unit.owner}:${sea}:${factoryPoint.x}:${factoryPoint.y}`;
          let prototype = prototypes.get(prototypeKey);
          if (!prototype) { prototype = { ...unit, id: `proposed-transport:${unit.owner}:${source}:${sea}`, kind: 'transport', ...factoryPoint,
            speed: UNIT_DEFS.transport.speed, radius: UNIT_DEFS.transport.radius, hp: UNIT_DEFS.transport.hp, maxHp: UNIT_DEFS.transport.hp,
            shipParts: undefined, sailing: { heading: 0, speed: 0, load: 0, balance: 0 } };
          delete prototype.deckScale; delete prototype.cargoCapacity; delete prototype.fittings;
          delete prototype.variant; delete prototype.bodyRadius;
          prototypes.set(prototypeKey, prototype); }
          for (const ship of [...actual, prototype]) {
            const requiresNewShip = ship === prototype;
            const free = requiresNewShip ? { point: factoryPoint, ticks: UNIT_DEFS.transport.trainTime,
              unmet: [reason('obtain-transport', `Build a transport in ${sea}; launch congestion remains an execution prerequisite`)] } : freeShip(ship);
            if (!free) continue;
            if (requiresNewShip && !yard) { free.ticks += BUILDING_DEFS.shipyard.buildTime;
              free.unmet.push(reason('build-shipyard', `Establish production in ${sea}; worker access and funding remain prerequisites`));
            } else if (requiresNewShip && yard) free.ticks += Math.max(0, yard.complete ? 0 : yard.buildTime - yard.buildProgress)
              + yard.queue.reduce((sum, job) => sum + job.remaining, 0);
            const approach = seaTime(ship, free.point, from.water, requiresNewShip), sailingTicks = seaTime(ship, from.water, to.water, true);
            if (approach === undefined || sailingTicks === undefined) continue;
            choices.push({ from, to, afterCost, readyTicks: free.ticks + approach, unmet: free.unmet,
              crossing: { seaId: sea, shipId: requiresNewShip ? null : ship.id, departure: { ...from.water }, landing: { ...to.water },
                boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks, unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip } });
          }
        }
      }
    }
    if (regions.scannedRows < regions.totalRows && !choices.length) pendingGeometry = true;
    crossingTables.set(key, { choices, pending: pendingGeometry, ages: [...usedFieldTicks], quoteAges: [...usedQuoteTicks] });
    return choices;
  }

  function compute(unit: Unit, target: Target): Arrival {
    const destination = target.landId ?? landIdAt(snapshot.map, target.point);
    if (!destination) return unavailable('destination-ground-unknown', 'The destination has no land connectivity label');
    const support = unit.deck?.shipId ?? unit.cabin?.shipId;
    if (support) {
      const ship = byId.get(support), sea = ship && seaIdAt(snapshot.map, ship);
      if (!ship || !sea) return unavailable('passenger-support-unknown', `Supporting ship ${support} is absent or off navigable water`);
      const mission = ferries[support];
      const unload = ship.order.type === 'unload' ? ship.order : undefined;
      const shores = shoresByLand.get(destination)?.get(sea) ?? [];
      const missionGround = mission && walkableGoal(snapshot.map, mission.to.x, mission.to.y);
      const missionTarget = mission && (snapshot.resources.find(mine => mine.id === mission.targetId)
        ?? snapshot.buildings.find(building => building.id === mission.targetId) ?? missionGround);
      const followsMission = missionTarget && landIdAt(snapshot.map, missionTarget) === destination;
      const observedGround = unload && walkableGoal(snapshot.map, unload.x, unload.y);
      const observedLanding = unload && observedGround && landIdAt(snapshot.map, observedGround) === destination && seaIdAt(snapshot.map, unload) === sea;
      const landing = mission && missionGround && followsMission && seaIdAt(snapshot.map, mission.to) === sea
        ? { ground: missionGround, water: mission.to, landId: destination, seaId: sea }
        : observedLanding ? { ground: observedGround, water: unload, landId: destination, seaId: sea } : nearest(shores, target.point)[0];
      if (!landing) return unavailable('no-shared-shore', `No landing in ${sea} reaches ${destination}`);
      const sailingTicks = seaTime(ship, ship, landing.water);
      const walker = { ...unit, ...landing.ground, deck: undefined, cabin: undefined };
      const landTicks = landTime(walker, target.point);
      if (sailingTicks === undefined || landTicks === undefined) return unavailable('landing-road-blocked', 'The landing or its inland road is blocked');
      const crossing: CrossingEta & { requiresNewShip: false } = { seaId: sea, shipId: ship.id,
        departure: { x: ship.x, y: ship.y }, landing: { ...landing.water }, waitTicks: 0, boardingTicks: 0,
        sailingTicks, unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip: false };
      const direct = unit.owner === owner && (!mission || followsMission) || Boolean(observedLanding);
      const common = { ticks: sailingTicks + crossing.unloadingTicks + landTicks, landTicks, crossings: [crossing],
        evidence: [evidence(snapshot.tick, 'strategy.arrivals', 'Live passenger; terrain sea route, hull/wind rates, gangway setup and native inland steering; congestion is not forecast')] };
      return direct ? { status: 'reachable', ...common } : { status: 'conditional', ...common,
        unmet: [unit.owner === owner ? reason('redirect-voyage', `Redirect ${ship.id} from its recorded destination ${mission!.targetId}`)
          : reason('opponent-voyage-unobserved', `Physical crossing forecast only; ${ship.id}'s intended landing and release schedule are unknown`)] };
    }
    if (unitMover(unit.kind) !== 'land') return unavailable('not-land-force', 'This hull does not itself become a land defender');
    const source = landIdAt(snapshot.map, unit);
    if (!source) return unavailable('origin-ground-unknown', 'The unit has no traversable land label');
    if (source === destination) {
      const ticks = landTime(unit, target.point);
      return ticks === undefined ? unavailable('native-road-unreachable', 'Native building-aware steering cannot reach the requested site')
        : { status: 'reachable', ticks, landTicks: ticks, crossings: [],
          evidence: [evidence(snapshot.tick, 'terrain.groundDistanceField', 'Shared building-aware goal seeds and weighted grid; excludes smoothing, subcell rounding, combat and body delays')] };
    }
    if (unit.owner !== owner) return { status: 'unknown', reason: reason('opponent-transport-plan-unobserved',
      'No retained foreign ferry schedule is observable; do not assume its boat is free or invent a foreign build order') };
    const assigned = Object.entries(ferries).find(([, mission]) => mission.phase !== 'return' && mission.crewIds.includes(unit.id)
      && landIdAt(snapshot.map, snapshot.resources.find(mine => mine.id === mission.targetId)
        ?? snapshot.buildings.find(building => building.id === mission.targetId) ?? walkableGoal(snapshot.map, mission.to.x, mission.to.y)) === destination);
    if (assigned) {
      const [shipId, mission] = assigned, ship = byId.get(shipId), sea = ship && seaIdAt(snapshot.map, ship);
      const ground = walkableGoal(snapshot.map, mission.from.x, mission.from.y), landing = walkableGoal(snapshot.map, mission.to.x, mission.to.y);
      const walk = landTime(unit, ground), after = landTime({ ...unit, ...landing }, target.point);
      const approach = ship && seaTime(ship, ship, mission.from), sail = ship && seaTime(ship, mission.from, mission.to, true);
      if (sea && walk !== undefined && after !== undefined && approach !== undefined && sail !== undefined) {
        const crossing: CrossingEta & { requiresNewShip: false } = { seaId: sea, shipId, departure: { ...mission.from }, landing: { ...mission.to },
          waitTicks: Math.max(0, approach - walk), boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks: sail,
          unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip: false };
        return { status: 'reachable', ticks: walk + crossing.waitTicks + crossing.boardingTicks + sail + crossing.unloadingTicks + after,
          landTicks: walk + after, crossings: [crossing], evidence: [evidence(snapshot.tick, 'memory.naval.ferries', 'Existing crew follows its actual embarkation and landing points, not a new hypothetical voyage')] };
      }
    }
    let best: { choice: CrossingChoice; walk: number; after: number; wait: number; ticks: number } | undefined;
    for (const choice of crossingTable(unit, source, destination, target)) {
      const walk = landTime(unit, choice.from.ground);
      if (walk === undefined) continue;
      const after = Math.ceil(choice.afterCost / unit.speed * SIM_TICKS_PER_SECOND), wait = Math.max(0, choice.readyTicks - walk);
      const ticks = walk + wait + choice.crossing.boardingTicks + choice.crossing.sailingTicks + choice.crossing.unloadingTicks + after;
      if (!best || ticks < best.ticks) best = { choice, walk, after, wait, ticks };
    }
    if (!best) return { status: 'unknown', reason: reason('no-direct-crossing', `No direct evaluated sea crossing from ${source} to ${destination}; a multi-hop plan is not evaluated`) };
    const crossing = { ...best.choice.crossing, waitTicks: best.wait };
    const common = { ticks: best.ticks, landTicks: best.walk + best.after, evidence: [evidence(snapshot.tick, 'strategy.crossingTable',
      'Cohort departure/factory approach and sea table shared; individual walking overlaps ship preparation, followed by boarding, sailing, unload and inland walking')] };
    return best.choice.unmet.length || crossing.requiresNewShip ? { status: 'conditional', ...common, crossings: [crossing], unmet: best.choice.unmet }
      : { status: 'reachable', ...common, crossings: [crossing as CrossingEta & { requiresNewShip: false }] };
  }

  return {
    arrival(unit: Unit, target: Target): Arrival {
      const key = `${unit.id}:${target.point.x}:${target.point.y}`;
      if (!answers.has(key)) {
        pendingGeometry = false; usedFieldTicks.clear(); usedQuoteTicks.clear();
        let answer = compute(unit, target);
        if (pendingGeometry && !('ticks' in answer)) answer = { status: 'unknown', reason: reason('geometry-refresh-pending',
          'The deterministic per-think field rebuild budget is exhausted; this route is not zero ETA or proven unreachable') };
        if ('ticks' in answer) answer = { ...answer, evidence: [...answer.evidence, ...[...usedFieldTicks].sort((a, b) => a - b)
          .map(tick => evidence(tick, 'terrain.goalField.built', `Geometry computed at tick ${tick}; actors and arrival speeds sampled at ${snapshot.tick}`)),
          ...[...usedQuoteTicks].sort((a, b) => a - b).map(tick => evidence(tick, 'strategy.seaQuote.computed',
            `Motion/wind quote computed at tick ${tick}; cached quotes require identical computational inputs`))] };
        answers.set(key, answer);
      }
      const answer = answers.get(key)!;
      return unit.expiresTick !== undefined && 'ticks' in answer && unit.expiresTick <= snapshot.tick + answer.ticks
        ? unavailable('expires-before-arrival', `${unit.id} expires before reaching this effect`) : answer;
    },
    freeInTicks(ship: Unit): number | null { return freeShip(ship)?.ticks ?? null; },
    get deferredSeaQueries() { return seaTravel.deferredFields; },
  };
}
