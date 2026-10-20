import { snapshotUnitIndex } from './world-index';
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { walkableGoal } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import { shipMotionLimits } from '../../shared/ship-handling';
import { windAt } from '../../shared/ship-wind';
import { fnv1a } from '../../shared/sim/checksum';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import { createPlanningDistanceQuery } from './distance-fields';
import { createSeaTravelQuery } from './sea-travel';
import { landIdAt, regionIndex, seaIdAt, type RegionIndex, type Shore } from './regions';
import type { Arrival, CrossingEta, Evidence, Point, Reason, Target, LandId, SeaId } from './types';
import { capturesExplanations, deferredRecord, explanationForMemory, explanationRecipe, projectedProperty, projectedValueReader } from './explanations';
import type { StrategyObservationMemory } from './observation-memory';

const evidence = (tick: number, source: string, detail: string): Evidence => ({ tick, source, detail, certainty: 'inferred' });
const nonArrivals = { unknown: new Map<string, Arrival>(), unreachable: new Map<string, Arrival>() };
function nonArrival(status: 'unknown' | 'unreachable', code: string): Arrival {
  let value = nonArrivals[status].get(code);
  if (!value) nonArrivals[status].set(code, value = Object.freeze({ status, reason: Object.freeze({ code }) }) as Arrival);
  return value;
}
const unavailable = (code: string, detail: string): Arrival => capturesExplanations()
  ? { status: 'unreachable', reason: deferredRecord({ code, detail, evidence: [] }) } : nonArrival('unreachable', code);
const landArrivals = new Map<number, Arrival>();
const noCrossings = Object.freeze([]);
function walkingArrival(ticks: number, explain: () => readonly Evidence[]): Arrival {
  if (capturesExplanations()) return projectedProperty({ status: 'reachable' as const, ticks, landTicks: ticks, crossings: [] }, 'evidence', explain);
  let value = landArrivals.get(ticks);
  if (!value) {
    if (landArrivals.size >= 4096) landArrivals.delete(landArrivals.keys().next().value!);
    landArrivals.set(ticks, value = Object.freeze(projectedProperty({ status: 'reachable' as const, ticks, landTicks: ticks,
      crossings: noCrossings }, 'evidence', explain)));
  }
  return value;
}
type CrossingChoice = { from: Shore; to: Shore; afterCost: number; readyTicks: number;
  crossing: Omit<CrossingEta, 'waitTicks'>; unmet: readonly Reason[] };
const arrivalDescriptions = {
  passenger: (tick: number) => [evidence(tick, 'strategy.arrivals', 'Live passenger; terrain sea route, hull/wind rates, gangway setup and native inland steering; congestion is not forecast')],
  land: (tick: number) => [evidence(tick, 'terrain.groundDistanceField', 'Shared building-aware goal seeds and weighted grid; excludes smoothing, subcell rounding, combat and body delays')],
  ferry: (tick: number) => [evidence(tick, 'memory.naval.ferries', 'Existing crew follows its actual embarkation and landing points, not a new hypothetical voyage')],
  crossing: (tick: number) => [evidence(tick, 'strategy.crossingTable', 'Cohort departure/factory approach and sea table shared; individual walking overlaps ship preparation, followed by boarding, sailing, unload and inland walking')],
};
function arrivalProvenance({ base, fieldTicks, quoteTicks, tick }: { base: () => readonly Evidence[]; fieldTicks: readonly number[]; quoteTicks: readonly number[]; tick: number }) {
  return [...base(), ...fieldTicks.map(built => evidence(built, 'terrain.goalField.built', `Geometry computed at tick ${built}; actors and arrival speeds sampled at ${tick}`)),
    ...quoteTicks.map(quoted => evidence(quoted, 'strategy.seaQuote.computed', `Motion/wind quote computed at tick ${quoted}; cached quotes require identical computational inputs`))];
}
function storedChoices(choices: readonly CrossingChoice[]): CrossingChoice[] {
  return choices.map(choice => ({ ...choice, unmet: choice.unmet.map(explanationForMemory) }));
}
export const EXACT_CROSSING_CANDIDATES = 2;
const retainedTables = new WeakMap<StrategyObservationMemory, Map<string, CrossingChoice[]>>();
export function crossingCandidateId(snapshot: GameSnapshot, unit: Unit, target: Target): string | undefined {
  const destination = target.landId ?? landIdAt(snapshot.map, target.point);
  const boat = unit.deck?.shipId ?? unit.cabin?.shipId;
  const source = boat ? `aboard:${boat}` : landIdAt(snapshot.map, unit);
  return destination && source && source !== destination ? `${source}:${destination}:${target.point.x}:${target.point.y}` : undefined;
}

/** One think's reusable route queries. Durations are forecasts of stated routes,
 * not promises that body avoidance, combat or a future build will finish on time. */
export function createArrivalQuery(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  distances = createPlanningDistanceQuery(snapshot), seaBuildBudget = Infinity, regions: RegionIndex = regionIndex(snapshot.map), preparation?: StrategyObservationMemory,
  memoize = true) {
  const tick = snapshot.tick;
  const descriptions = {
    passenger: explanationRecipe(arrivalDescriptions.passenger, tick), land: explanationRecipe(arrivalDescriptions.land, tick),
    ferry: explanationRecipe(arrivalDescriptions.ferry, tick), crossing: explanationRecipe(arrivalDescriptions.crossing, tick),
  };
  const explained = new Map<() => readonly Evidence[], Map<string, () => readonly Evidence[]>>();
  const byId = snapshotUnitIndex(snapshot).all;
  const answers = new Map<number, Map<string, Arrival>>();
  type LandTime = { x: number; y: number; speed: number; ticks: number | undefined; pending: boolean; builtTick: number | undefined };
  const landTimes = new Map<number, Map<string, LandTime>>();
  const points = new Map<number, Map<number, number>>(); let nextPoint = 0;
  function pointKey(point: Point): number {
    let row = points.get(point.y); if (!row) points.set(point.y, row = new Map());
    let value = row.get(point.x); if (value === undefined) row.set(point.x, value = nextPoint++); return value;
  }
  const ferries = memory.naval?.ferries ?? {};
  const shoresByLand = regions.shoresByLand;
  const nearestCache = new WeakMap<readonly Shore[], Map<number, readonly Shore[]>>();
  const departuresByRegion = new Map<string, readonly Shore[]>();
  const seaTravel = createSeaTravelQuery(snapshot, seaBuildBudget, 'reuse', preparation);
  const crossingTables = new Map<string, { choices: CrossingChoice[]; pending: boolean; ages: number[]; quoteAges: number[] }>();
  let pendingGeometry = false;
  const usedFieldTicks = new Set<number>(), usedQuoteTicks = new Set<number>();
  const reasons = new Map<string, Reason>();
  const reason = (code: string, detail: string): Reason => {
    const key = `${code}:${detail}`; let value = reasons.get(key);
    if (!value) reasons.set(key, value = deferredRecord({ code, detail, evidence: [evidence(snapshot.tick, 'strategy.arrivals', detail)] }, true));
    return value;
  };

  const unknown = (code: string, detail: string): Arrival => capturesExplanations()
    ? { status: 'unknown', reason: reason(code, detail) } : nonArrival('unknown', code);

  function landTime(unit: Unit, point: Point, from: Point = unit, retain = true): number | undefined {
    // A direct unit/goal row is consumed once by the evaluator and already
    // owned by its compact result table. Only shared embarkation legs need a
    // second numerical memo here.
    let times: Map<string, LandTime> | undefined;
    if (retain) {
      const key = pointKey(point);
      times = landTimes.get(key); if (!times) landTimes.set(key, times = new Map());
    }
    const known = times?.get(unit.id);
    if (known && known.x === from.x && known.y === from.y && known.speed === unit.speed) {
      if (known.pending) pendingGeometry = true;
      if (known.builtTick !== undefined) usedFieldTicks.add(known.builtTick);
      return known.ticks;
    }
    if (!Number.isFinite(unit.speed) || unit.speed <= 0) throw new Error(`Invalid strategy walking speed ${unit.id}: ${unit.speed}`);
    const field = distances.field(point);
    if (!field) pendingGeometry = true;
    else usedFieldTicks.add(field.builtTick);
    const cost = field?.field.cost(from);
    const ticks = cost === undefined ? undefined : Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
    times?.set(unit.id, { x: from.x, y: from.y, speed: unit.speed, ticks, pending: !field, builtTick: field?.builtTick });
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
    const key = pointKey(point), known = points.get(key);
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
  const shortlist = new Set<string>();
  let shortlisted = false;
  const stats = { crossingBuilds: 0, passengerBuilds: 0, persistentHits: 0, reconstructions: 0 };
  let version: string | undefined;
  function logisticsVersion() {
    if (version !== undefined) return version;
    const boats = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && isTransportKind(unit.kind));
    const yards = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'shipyard' && building.hp > 0);
    const missions = Object.entries(ferries).map(([id, task]) => [id, task.phase, task.purpose, task.targetId, task.from, task.to,
      task.crewIds.map(id => { const crew = byId.get(id); return crew && [id, crew.x, crew.y, crew.speed, crew.deck?.shipId, crew.cabin?.shipId]; })]);
    version = fnv1a(JSON.stringify([preparation?.terrain, preparation?.landBodies, windAt(snapshot.map, { x: 0, y: 0 }).key,
      boats.map(ship => [ship.id, ship.kind, ship.x, ship.y, shipMotionLimits(ship), ship.sailing?.heading ?? 0]),
      yards.map(yard => [yard.id, yard.x, yard.y, yard.complete, yard.buildTime, yard.buildProgress, yard.queue]), missions]));
    return version;
  }
  const persistent = preparation && (retainedTables.get(preparation) ?? new Map<string, CrossingChoice[]>());
  if (preparation && persistent) retainedTables.set(preparation, persistent);
  const publishedKey = (candidate: string) => `${candidate}:${logisticsVersion()}`;
  function isPublished(candidate: string) { return preparation?.crossings.some(entry => entry.key === publishedKey(candidate)) ?? false; }
  function crossingTable(unit: Unit, source: LandId, destination: LandId, target: Target): CrossingChoice[] {
    const key = `${unit.owner}:${source}:${destination}:${target.point.x}:${target.point.y}`;
    const known = crossingTables.get(key);
    if (known) {
      if (known.pending) pendingGeometry = true;
      for (const tick of known.ages) usedFieldTicks.add(tick);
      for (const tick of known.quoteAges) usedQuoteTicks.add(tick);
      return known.choices;
    }
    const publicationKey = preparation && publishedKey(crossingCandidateId(snapshot, unit, target)!);
    const publication = preparation?.crossings.find(entry => entry.key === publicationKey);
    if (publication && publicationKey) {
      let choices = persistent!.get(publicationKey);
      if (!choices) {
        // A saved publication is authoritative. A cold process reconstructs its
        // pure numeric table from identical facts, without changing admission.
        stats.reconstructions++;
        const complete = createArrivalQuery(snapshot, owner, memory, undefined, Infinity, regions);
        choices = complete.crossingChoices(unit, source, destination, target).map(choice => ({ ...choice,
          unmet: choice.unmet.map(value => { const reason = explanationForMemory(value); return { ...reason, evidence: reason.evidence.map(item => ({ ...item, tick: publication.quotedTick })) }; }) }));
        if (persistent!.size >= 32) persistent!.delete(persistent!.keys().next().value!);
        persistent!.set(publicationKey, storedChoices(choices));
      } else stats.persistentHits++;
      choices = choices.map(choice => ({ ...choice, unmet: choice.unmet.map(value => deferredRecord({ ...value }, true)) }));
      for (const tick of publication.fieldTicks) usedFieldTicks.add(tick);
      usedQuoteTicks.add(snapshot.tick);
      crossingTables.set(key, { choices, pending: false, ages: publication.fieldTicks, quoteAges: [snapshot.tick] });
      return choices;
    }
    const choices: CrossingChoice[] = [], targetField = distances.field(target.point);
    stats.crossingBuilds++;
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
              crossing: { seaId: sea, shipId: requiresNewShip ? null : ship.id, departure: { ...from.water }, landing: { ...to.water }, landingGround: { ...to.ground },
                boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks, unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip } });
          }
        }
      }
    }
    if (regions.scannedRows < regions.totalRows && !choices.length) pendingGeometry = true;
    const finished = !pendingGeometry, result = preparation && !finished ? [] : choices;
    crossingTables.set(key, { choices: result, pending: pendingGeometry, ages: [...usedFieldTicks], quoteAges: [...usedQuoteTicks] });
    if (preparation && publicationKey && finished) {
      if (preparation.crossings.length >= 32) {
        const old = preparation.crossings.shift()!; persistent!.delete(old.key);
      }
      preparation.crossings.push({ key: publicationKey, fieldTicks: [...usedFieldTicks].sort((a, b) => a - b), quotedTick: snapshot.tick });
      if (persistent!.size >= 32) persistent!.delete(persistent!.keys().next().value!);
      persistent!.set(publicationKey, storedChoices(choices));
    }
    return result;
  }

  type PassengerGeometry = { ship: Unit; sea: SeaId; landing: Shore; sailingTicks: number; direct: boolean; redirectTarget: string | undefined;
    fieldTicks: number[]; quoteTicks: number[] }
    | { failure: Arrival; pending: boolean };
  const passengerTables = new Map<string, PassengerGeometry>();
  const voyages = new Map<string, ReturnType<typeof inspectVoyage>>();
  function inspectVoyage(support: string) {
    const ship = byId.get(support), sea = ship && seaIdAt(snapshot.map, ship);
    const mission = ship?.owner === owner ? ferries[support] : undefined;
    const missionGround = mission && walkableGoal(snapshot.map, mission.to.x, mission.to.y);
    const missionTarget = mission && (snapshot.resources.find(mine => mine.id === mission.targetId)
      ?? snapshot.buildings.find(building => building.id === mission.targetId) ?? missionGround);
    const missionLand = missionTarget && landIdAt(snapshot.map, missionTarget);
    const unload = ship?.order.type === 'unload' ? ship.order : undefined;
    const observedGround = unload && walkableGoal(snapshot.map, unload.x, unload.y);
    const observedLand = observedGround && landIdAt(snapshot.map, observedGround);
    const observedSea = unload && seaIdAt(snapshot.map, unload);
    return { ship, sea, mission, missionGround, missionLand, unload, observedGround, observedLand, observedSea };
  }
  function passengerGeometry(unit: Unit, target: Target, destination: LandId, support: string): PassengerGeometry {
    let voyage = voyages.get(support);
    if (!voyage) voyages.set(support, voyage = inspectVoyage(support));
    const { ship, sea, mission, missionGround, missionLand, unload, observedGround, observedLand, observedSea } = voyage;
    const followsMission = Boolean(missionLand === destination);
    const observedLanding = Boolean(unload && observedLand === destination && observedSea === sea);
    const actualLanding = followsMission || observedLanding;
    const key = `${unit.owner}:${support}:${destination}:${actualLanding ? 'observed' : `${target.point.x}:${target.point.y}`}`;
    const known = passengerTables.get(key);
    if (known) {
      if ('pending' in known && known.pending) pendingGeometry = true;
      if ('fieldTicks' in known) { for (const tick of known.fieldTicks) usedFieldTicks.add(tick); for (const tick of known.quoteTicks) usedQuoteTicks.add(tick); }
      return known;
    }
    const fail = (code: string, detail: string): PassengerGeometry => {
      const failure = { failure: unavailable(code, detail), pending: pendingGeometry };
      passengerTables.set(key, failure); return failure;
    };
    if (!ship || !sea) return fail('passenger-support-unknown', `Supporting ship ${support} is absent or off navigable water`);
    if (unit.owner !== owner && !observedLanding) {
      const failure: PassengerGeometry = { failure: unknown('opponent-voyage-unobserved',
        `No observed unload into ${destination}; do not invent ${ship.id}'s intended landing or release schedule`), pending: false };
      passengerTables.set(key, failure); return failure;
    }
    stats.passengerBuilds++;
    const shores = shoresByLand.get(destination)?.get(sea) ?? [];
    const landing = mission && missionGround && followsMission && seaIdAt(snapshot.map, mission.to) === sea
      ? { ground: missionGround, water: mission.to, landId: destination, seaId: sea }
      : observedLanding ? { ground: observedGround!, water: unload!, landId: destination, seaId: sea } : nearest(shores, target.point)[0];
    if (!landing) return fail('no-shared-shore', `No landing in ${sea} reaches ${destination}`);
    const sailingTicks = seaTime(ship, ship, landing.water);
    if (sailingTicks === undefined) return fail('landing-road-blocked', 'The sailing leg is not available');
    const result = { ship, sea, landing, sailingTicks,
      direct: unit.owner === owner && (!mission || followsMission) || observedLanding, redirectTarget: mission?.targetId,
      fieldTicks: [...usedFieldTicks], quoteTicks: [...usedQuoteTicks] };
    passengerTables.set(key, result); return result;
  }

  function compute(unit: Unit, target: Target): Arrival {
    const destination = target.landId ?? landIdAt(snapshot.map, target.point);
    if (!destination) return unavailable('destination-ground-unknown', 'The destination has no land connectivity label');
    const support = unit.deck?.shipId ?? unit.cabin?.shipId;
    if (support) {
      const geometry = passengerGeometry(unit, target, destination, support);
      if ('failure' in geometry) return geometry.failure;
      const { ship, sea, landing, sailingTicks, direct, redirectTarget } = geometry;
      const landTicks = landTime(unit, target.point, landing.ground);
      if (sailingTicks === undefined || landTicks === undefined) return unavailable('landing-road-blocked', 'The landing or its inland road is blocked');
      const crossing: CrossingEta & { requiresNewShip: false } = { seaId: sea, shipId: ship.id,
        departure: { x: ship.x, y: ship.y }, landing: { ...landing.water }, landingGround: { ...landing.ground }, waitTicks: 0, boardingTicks: 0,
        sailingTicks, unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip: false };
      const answer = projectedProperty({ status: direct ? 'reachable' as const : 'conditional' as const,
        ticks: sailingTicks + crossing.unloadingTicks + landTicks, landTicks, crossings: [crossing] }, 'evidence', descriptions.passenger);
      if (direct) return answer as Extract<Arrival, { status: 'reachable' }>;
      return Object.assign(answer, { unmet: [unit.owner === owner ? reason('redirect-voyage', `Redirect ${ship.id} from its recorded destination ${redirectTarget}`)
        : reason('opponent-voyage-unobserved', `Physical crossing forecast only; ${ship.id}'s intended landing and release schedule are unknown`)] }) as Extract<Arrival, { status: 'conditional' }>;
    }
    if (unitMover(unit.kind) !== 'land') return unavailable('not-land-force', 'This hull does not itself become a land defender');
    const source = landIdAt(snapshot.map, unit);
    if (!source) return unavailable('origin-ground-unknown', 'The unit has no traversable land label');
    if (source === destination) {
      const ticks = landTime(unit, target.point, unit, memoize);
      return ticks === undefined ? unavailable('native-road-unreachable', 'Native building-aware steering cannot reach the requested site')
        : walkingArrival(ticks, descriptions.land);
    }
    if (unit.owner !== owner) return unknown('opponent-transport-plan-unobserved',
      'No retained foreign ferry schedule is observable; do not assume its boat is free or invent a foreign build order');
    const assigned = Object.entries(ferries).find(([, mission]) => mission.phase !== 'return' && mission.crewIds.includes(unit.id)
      && landIdAt(snapshot.map, snapshot.resources.find(mine => mine.id === mission.targetId)
        ?? snapshot.buildings.find(building => building.id === mission.targetId) ?? walkableGoal(snapshot.map, mission.to.x, mission.to.y)) === destination);
    if (assigned) {
      const [shipId, mission] = assigned, ship = byId.get(shipId), sea = ship && seaIdAt(snapshot.map, ship);
      const ground = walkableGoal(snapshot.map, mission.from.x, mission.from.y), landing = walkableGoal(snapshot.map, mission.to.x, mission.to.y);
      const walk = landTime(unit, ground), after = landTime(unit, target.point, landing);
      const approach = ship && seaTime(ship, ship, mission.from), sail = ship && seaTime(ship, mission.from, mission.to, true);
      if (sea && walk !== undefined && after !== undefined && approach !== undefined && sail !== undefined) {
        const crossing: CrossingEta & { requiresNewShip: false } = { seaId: sea, shipId, departure: { ...mission.from }, landing: { ...mission.to }, landingGround: { ...landing },
          waitTicks: Math.max(0, approach - walk), boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks: sail,
          unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip: false };
        return projectedProperty({ status: 'reachable' as const, ticks: walk + crossing.waitTicks + crossing.boardingTicks + sail + crossing.unloadingTicks + after,
          landTicks: walk + after, crossings: [crossing] }, 'evidence', descriptions.ferry);
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
    if (!best) return unknown('no-direct-crossing', `No direct evaluated sea crossing from ${source} to ${destination}; a multi-hop plan is not evaluated`);
    const crossing = { ...best.choice.crossing, waitTicks: best.wait };
    const conditional = best.choice.unmet.length > 0 || crossing.requiresNewShip;
    const answer = projectedProperty({ status: conditional ? 'conditional' as const : 'reachable' as const, ticks: best.ticks, landTicks: best.walk + best.after }, 'evidence', descriptions.crossing);
    return conditional ? Object.assign(answer, { crossings: [crossing], unmet: best.choice.unmet }) as Extract<Arrival, { status: 'conditional' }>
      : Object.assign(answer, { crossings: [crossing as CrossingEta & { requiresNewShip: false }] }) as Extract<Arrival, { status: 'reachable' }>;
  }

  function calculate(unit: Unit, target: Target): Arrival {
    pendingGeometry = false; usedFieldTicks.clear(); usedQuoteTicks.clear();
    const candidate = shortlisted && unit.owner === owner ? crossingCandidateId(snapshot, unit, target) : undefined;
    let answer: Arrival = candidate && !shortlist.has(candidate) && !isPublished(candidate)
      ? unknown('crossing-candidate-not-shortlisted',
        `Outside the top ${EXACT_CROSSING_CANDIDATES} coarse crossing candidates; not zero ETA or proof of unreachability`)
      : compute(unit, target);
    if (pendingGeometry && !('ticks' in answer)) answer = unknown('geometry-refresh-pending',
      'The deterministic per-think field rebuild budget is exhausted; this route is not zero ETA or proven unreachable');
    if ('ticks' in answer && capturesExplanations()) {
      const base = projectedValueReader(answer, 'evidence');
      let projections = explained.get(base);
      if (!projections) explained.set(base, projections = new Map());
      const fieldTicks = [...usedFieldTicks].sort((a, b) => a - b), quoteTicks = [...usedQuoteTicks].sort((a, b) => a - b);
      const provenance = `${fieldTicks.join(',')}/${quoteTicks.join(',')}`;
      let read = projections.get(provenance);
      if (!read) {
        read = explanationRecipe(arrivalProvenance, { base, fieldTicks, quoteTicks, tick });
        projections.set(provenance, read);
      }
      answer = projectedProperty(answer, 'evidence', read);
    }
    return answer;
  }
  return {
    crossingChoices: crossingTable,
    stats,
    setCrossingShortlist(ids: readonly string[]) { shortlisted = true; for (const id of ids) shortlist.add(id); },
    arrival(unit: Unit, target: Target): Arrival {
      let answer: Arrival;
      if (memoize) {
        const key = pointKey(target.point);
        let unitAnswers = answers.get(key); if (!unitAnswers) answers.set(key, unitAnswers = new Map());
        answer = unitAnswers.get(unit.id) ?? calculate(unit, target);
        unitAnswers.set(unit.id, answer);
      } else answer = calculate(unit, target);
      return unit.expiresTick !== undefined && 'ticks' in answer && unit.expiresTick <= snapshot.tick + answer.ticks
        ? unavailable('expires-before-arrival', `${unit.id} expires before reaching this effect`) : answer;
    },
    freeInTicks(ship: Unit): number | null { return freeShip(ship)?.ticks ?? null; },
    get deferredSeaQueries() { return seaTravel.deferredFields; },
  };
}
