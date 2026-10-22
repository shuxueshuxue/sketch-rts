import { boundCache, readCacheMap, retainCacheMap } from './bounded-cache';
import { snapshotUnitIndex } from './world-index';
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { walkableGoal } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import { shipMotionLimits } from '../../shared/ship-handling';
import { windAt } from '../../shared/ship-wind';
import { shipLaunchPose, shipLaunchPrototype } from '../../shared/ship-launch';
import { fnv1a } from '../../shared/sim/checksum';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { ShipPose } from '../../shared/ship-navigation';
import type { GoalNativeGroundRequest } from './goal-boarding-geometry';
import type { GoalBerth, GoalPublishedValue } from './goal-grounding-ports';
import type { AiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import { createPlanningDistanceQuery } from './distance-fields';
import { createSeaTravelQuery } from './sea-travel';
import { landIdAt, regionIndex, seaIdAt, type RegionIndex, type Shore } from './regions';
import type { Arrival, CrossingEta, Evidence, Point, Reason, Target, LandId, SeaId } from './types';
import { capturesExplanations, deferredRecord, explanationForMemory, explanationRecipe, projectedProperty, projectedValueReader } from './explanations';
import type { StrategyObservationMemory } from './observation-memory';
import { currentFactWork } from './fact-work';
import { pointRoute } from './point-routes';
import { nativeVoyageBerth } from './voyage-berth';
import { shareShipProfile, shipProfile } from '../../shared/ship-geometry';

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
  let value = readCacheMap(landArrivals, ticks);
  if (!value) {
    retainCacheMap(landArrivals, ticks, value = Object.freeze(projectedProperty({ status: 'reachable' as const, ticks, landTicks: ticks,
      crossings: noCrossings }, 'evidence', explain)), 4096);
  }
  return value;
}
type CrossingChoice = { from: Shore; to: Shore; afterCost: number; readyTicks: number;
  crossing: Omit<CrossingEta, 'waitTicks'>; unmet: readonly Reason[] };
const arrivalDescriptions = {
  passenger: (tick: number) => [evidence(tick, 'strategy.arrivals', 'Live passenger; terrain sea route, hull/wind rates, gangway setup and native inland steering; congestion is not forecast')],
  land: (tick: number) => [evidence(tick, 'terrain.groundDistanceField', 'Shared building-aware goal seeds and weighted grid; excludes smoothing, subcell rounding, combat and body delays')],
  ferry: (tick: number) => [evidence(tick, 'memory.naval.ferries', 'Existing crew follows its actual embarkation and landing points, not a new hypothetical voyage')],
  fixed: (tick: number) => [evidence(tick, 'strategy.fixedVoyage', 'Current assigned hull and verified shore pair; no replacement hull, shore or stored relative ETA')],
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
/** A retained physical voyage, independent of allocation-memory types. Land
 * points must be the verified points of this crossing, not a new water projection. */
export type FixedVoyage = Readonly<{
  shipId: string; seaId: SeaId; departure: Point; landing: Point;
  departureGround: Target & Readonly<{ landId: LandId }>;
  landingGround: Target & Readonly<{ landId: LandId }>;
  phase: 'loading' | 'sailing' | 'unloading' | 'return';
}>;
export type FixedVoyageLoading =
  | Readonly<{ status: 'known'; forecastTick: number; walkTicks: number; approachTicks: number;
    boardingTicks: number; expectedLoadedTick: number }>
  | Readonly<{ status: 'already-loaded' }>
  | Readonly<{ status: 'unknown'; reasonCode: string }>;
/** The owner-think planner supplies published physical facts on its existing
 * work queue. Supplying this object forbids synchronous native fallbacks;
 * leaving it absent preserves the ordinary read-only/native evaluator. */
export type ArrivalPlanningPhysics = Readonly<{
  ground: (request: GoalNativeGroundRequest) => GoalPublishedValue<Point>;
  berth: (passenger: Unit, hull: Unit, shore: Shore) => GoalPublishedValue<GoalBerth>;
  launch?: (yard: Building, prototype: Unit) => GoalPublishedValue<ShipPose>;
}>;
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
  memoize = true, planningPhysics?: ArrivalPlanningPhysics) {
  const tick = snapshot.tick;
  const descriptions = {
    passenger: explanationRecipe(arrivalDescriptions.passenger, tick), land: explanationRecipe(arrivalDescriptions.land, tick),
    ferry: explanationRecipe(arrivalDescriptions.ferry, tick), fixed: explanationRecipe(arrivalDescriptions.fixed, tick),
    crossing: explanationRecipe(arrivalDescriptions.crossing, tick),
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
  const crossingTables = new Map<string, { choices: CrossingChoice[]; pending: boolean; ages: number[]; quoteAges: number[];
    requestIds?: readonly string[] }>();
  const pendingPhysicsIds = new Set<string>();
  const nativeBerths = new Map<string, ReturnType<typeof nativeVoyageBerth> | { status: 'pending'; requestIds: readonly string[] }>();
  function berth(unit: Unit, ship: Unit, shore: Shore) {
    const key = JSON.stringify([shipProfile(ship)?.hull, ship.sailing?.heading ?? 0, unit.radius, shore]);
    let result = nativeBerths.get(key);
    if (!result) {
      if (!planningPhysics) result = nativeVoyageBerth(snapshot, unit, ship, shore);
      else {
        const published = planningPhysics.berth(unit, ship, shore);
        result = published.state === 'met' ? { status: 'known', heading: published.value.heading,
          shore: { ...shore, ground: published.value.ground, water: published.value.water } }
          : published.state === 'unmet' ? { status: 'static-infeasible', reasonCode: published.reason.code }
          : { status: 'pending', requestIds: published.requestIds };
      }
      nativeBerths.set(key, result);
    }
    if (result.status === 'pending') {
      pendingGeometry = true;
      for (const id of result.requestIds) pendingPhysicsIds.add(id);
    }
    return result;
  }
  function ground(point: Point, mover: 'land' | 'sea' = 'land'): Point | undefined {
    if (!planningPhysics) return walkableGoal(snapshot.map, point.x, point.y, mover);
    const published = planningPhysics.ground({ kind: 'project-goal', point, mover });
    if (published.state === 'met') return published.value;
    if (published.state === 'pending') {
      pendingGeometry = true;
      for (const id of published.requestIds) pendingPhysicsIds.add(id);
    }
    return undefined;
  }
  function afterApproach(ship: Unit, from: Point, to: Point, future: boolean): Unit {
    if (!preparation || !currentFactWork()) return ship;
    const route = pointRoute(snapshot, preparation, ship, from, to, future);
    if (route.status !== 'complete') return ship;
    const heading = route.route.points.at(-1)?.heading ?? ship.sailing?.heading ?? 0;
    const end = route.route.points.at(-1) ?? from;
    const result = { ...ship, x: end.x, y: end.y, sailing: { ...ship.sailing!, heading } };
    shareShipProfile(ship, result); return result;
  }
  let pendingGeometry = false;
  const usedFieldTicks = new Set<number>(), usedQuoteTicks = new Set<number>();
  const reasons = new Map<string, Reason>();
  const reason = (code: string, detail: string): Reason => {
    const key = `${code}:${detail}`; let value = reasons.get(key);
    if (!value) reasons.set(key, value = deferredRecord({ code, detail, evidence: [evidence(snapshot.tick, 'strategy.arrivals', detail)] }, true));
    return value;
  };

  const unknown = (code: string, detail: string): Arrival => pendingPhysicsIds.size
    ? { status: 'unknown', reason: deferredRecord({ code, detail, evidence: [], factIds: [...pendingPhysicsIds].sort() }) }
    : capturesExplanations() ? { status: 'unknown', reason: reason(code, detail) } : nonArrival('unknown', code);

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
    if (preparation && currentFactWork()) {
      const result = pointRoute(snapshot, preparation, ship, from, to, future);
      if (result.status === 'pending' || result.status === 'transient-blocked') pendingGeometry = true;
      if (result.status !== 'complete') return undefined;
      usedQuoteTicks.add(result.computedTick); return result.ticks;
    }
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
  const stats = { crossingBuilds: 0, passengerBuilds: 0, persistentHits: 0, reconstructions: 0,
    foreignUnknownBuilds: 0, foreignUnknownHits: 0 };
  const foreignCrossings = new Map<PlayerId, Map<LandId, Arrival>>();
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
  function isPublished(candidate: string) { return !currentFactWork() && (preparation?.crossings.some(entry => entry.key === publishedKey(candidate)) ?? false); }
  function crossingTable(unit: Unit, source: LandId, destination: LandId, target: Target): CrossingChoice[] {
    const key = `${unit.owner}:${source}:${destination}:${target.point.x}:${target.point.y}`;
    const known = crossingTables.get(key);
    if (known) {
      if (known.pending) pendingGeometry = true;
      for (const id of known.requestIds ?? []) pendingPhysicsIds.add(id);
      for (const tick of known.ages) usedFieldTicks.add(tick);
      for (const tick of known.quoteAges) usedQuoteTicks.add(tick);
      return known.choices;
    }
    const publicationKey = preparation && publishedKey(crossingCandidateId(snapshot, unit, target)!);
    const publication = !currentFactWork() && preparation?.crossings.find(entry => entry.key === publicationKey);
    if (publication) publication.lastUsedThink = snapshot.tick;
    if (publication && publicationKey) {
      let choices = readCacheMap(persistent!, publicationKey);
      if (!choices) {
        // A saved publication is authoritative. A cold process reconstructs its
        // pure numeric table from identical facts, without changing admission.
        stats.reconstructions++;
        const complete = createArrivalQuery(snapshot, owner, memory, undefined, Infinity, regions);
        choices = complete.crossingChoices(unit, source, destination, target).map(choice => ({ ...choice,
          unmet: choice.unmet.map(value => { const reason = explanationForMemory(value); return { ...reason, evidence: reason.evidence.map(item => ({ ...item, tick: publication.quotedTick })) }; }) }));
        retainCacheMap(persistent!, publicationKey, storedChoices(choices), 32);
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
        const yards = snapshot.buildings.filter(building => building.owner === unit.owner && building.kind === 'shipyard' && building.hp > 0);
        const yardPoints = new Map<string, Point>();
        for (const yard of planningPhysics ? yards : []) {
          const point = ground(yard, 'sea');
          if (point) yardPoints.set(yard.id, point);
        }
        const yardPoint = (yard: Building) => planningPhysics ? yardPoints.get(yard.id) : ground(yard, 'sea');
        if (!departuresByRegion.has(departureKey)) {
          const anchor = snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'shipyard'
            && landIdAt(snapshot.map, building) === source && yardPoint(building) && seaIdAt(snapshot.map, yardPoint(building)!) === sea)
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
          const yard = yards.filter(building => yardPoint(building) && seaIdAt(snapshot.map, yardPoint(building)!) === sea)
            .sort((a, b) => Number(landIdAt(snapshot.map, b) === source) - Number(landIdAt(snapshot.map, a) === source)
              || distance(a, from.water) - distance(b, from.water) || a.id.localeCompare(b.id))[0];
          let factoryPoint = yard ? yardPoint(yard)! : from.water;
          const prototypeKey = `${unit.owner}:${sea}:${factoryPoint.x}:${factoryPoint.y}`;
          let prototype = prototypes.get(prototypeKey);
          if (!prototype) { prototype = (currentFactWork() || planningPhysics) && yard ? structuredClone(shipLaunchPrototype(yard, 'transport')) : { ...unit, id: `proposed-transport:${unit.owner}:${source}:${sea}`, kind: 'transport', ...factoryPoint,
            speed: UNIT_DEFS.transport.speed, radius: UNIT_DEFS.transport.radius, hp: UNIT_DEFS.transport.hp, maxHp: UNIT_DEFS.transport.hp,
            shipParts: undefined, sailing: { heading: 0, speed: 0, load: 0, balance: 0 } };
          delete prototype.deckScale; delete prototype.cargoCapacity; delete prototype.fittings;
          delete prototype.variant; delete prototype.bodyRadius;
          prototypes.set(prototypeKey, prototype); }
          let proposedAvailable = !planningPhysics || !!yard;
          if ((currentFactWork() || planningPhysics) && yard) {
            // Native production and route risk start at the same launch pose.
            // Movable hulls are not frozen at a future launch time.
            const published = planningPhysics?.launch?.(yard, prototype);
            const launch = planningPhysics ? published?.state === 'met' ? published.value : undefined
              : shipLaunchPose({ ...snapshot, units: [] }, yard, prototype);
            if (planningPhysics && (!published || published.state === 'pending')) {
              pendingGeometry = true;
              for (const id of published?.state === 'pending' ? published.requestIds : [`arrival-launch:${yard.id}:${prototype.kind}`]) pendingPhysicsIds.add(id);
            }
            if (!launch) {
              if (!planningPhysics) continue;
              // An unquoted future launch cannot suppress a real current hull.
              // Only the prototype is unavailable, not every crossing here.
              proposedAvailable = false;
            } else {
              factoryPoint = { x: launch.x, y: launch.y };
              prototype.id = `route-prototype:${yard.id}`;
              prototype.x = launch.x; prototype.y = launch.y;
              prototype.sailing = { heading: launch.heading, speed: 0, load: 0, balance: 0 };
            }
          }
          if (planningPhysics && !yard) {
            pendingGeometry = true; // Future yard location/launch has no published binding.
            pendingPhysicsIds.add(`arrival-shipyard:${unit.owner}:${sea}`);
          }
          for (const ship of [...actual, ...(proposedAvailable ? [prototype] : [])]) {
            const requiresNewShip = ship === prototype;
            const free = requiresNewShip ? { point: factoryPoint, ticks: UNIT_DEFS.transport.trainTime,
              unmet: [reason('obtain-transport', `Build a transport in ${sea}; launch congestion remains an execution prerequisite`)] } : freeShip(ship);
            if (!free) continue;
            if (requiresNewShip && !yard) { free.ticks += BUILDING_DEFS.shipyard.buildTime;
              free.unmet.push(reason('build-shipyard', `Establish production in ${sea}; worker access and funding remain prerequisites`));
            } else if (requiresNewShip && yard) free.ticks += Math.max(0, yard.complete ? 0 : yard.buildTime - yard.buildProgress)
              + yard.queue.reduce((sum, job) => sum + job.remaining, 0);
            const nativeFrom = currentFactWork() || planningPhysics ? berth(unit, ship, from) : undefined;
            const nativeTo = currentFactWork() || planningPhysics ? berth(unit, ship, to) : undefined;
            if (nativeFrom?.status === 'pending' || nativeTo?.status === 'pending') continue;
            if (nativeFrom?.status === 'static-infeasible' || nativeTo?.status === 'static-infeasible') continue;
            const departure = nativeFrom?.status === 'known' ? nativeFrom.shore : from;
            const landing = nativeTo?.status === 'known' ? nativeTo.shore : to;
            const nativeAfterCost = currentFactWork() ? targetField.field.cost(landing.ground) : afterCost;
            if (nativeAfterCost === undefined) continue;
            const future = requiresNewShip || !!currentFactWork() && free.ticks > 0;
            const approach = seaTime(ship, free.point, departure.water, future);
            const cruising = afterApproach(ship, free.point, departure.water, future);
            // The public read-only evaluator retains its exact old query
            // admission order; control defers a dependent leg until the
            // native approach endpoint/heading is actually published.
            const sailingTicks = currentFactWork() && approach === undefined ? undefined
              : seaTime(cruising, currentFactWork() ? cruising : departure.water, landing.water, true);
            if (approach === undefined || sailingTicks === undefined) continue;
            choices.push({ from: departure, to: landing, afterCost: nativeAfterCost, readyTicks: free.ticks + approach, unmet: free.unmet,
              crossing: { seaId: sea, shipId: requiresNewShip ? null : ship.id, ...(requiresNewShip && yard ? { productionBuildingId: yard.id } : {}), departure: { ...departure.water }, landing: { ...landing.water }, landingGround: { ...landing.ground },
                ...(nativeFrom?.status === 'known' ? { departureGround: { ...departure.ground }, departureHeading: cruising.sailing!.heading } : {}),
                ...(nativeTo?.status === 'known' ? { landingHeading: nativeTo.heading } : {}),
                boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks, unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip } });
          }
        }
      }
    }
    if (regions.scannedRows < regions.totalRows && !choices.length) pendingGeometry = true;
    const finished = !pendingGeometry, result = preparation && !finished && !currentFactWork() ? [] : choices;
    crossingTables.set(key, { choices: result, pending: pendingGeometry, ages: [...usedFieldTicks], quoteAges: [...usedQuoteTicks],
      ...(planningPhysics ? { requestIds: [...pendingPhysicsIds] } : {}) });
    if (preparation && publicationKey && finished && !currentFactWork()) {
      preparation.crossings.push({ key: publicationKey, fieldTicks: [...usedFieldTicks].sort((a, b) => a - b), quotedTick: snapshot.tick });
      const bounded = boundCache({ kind: 'crossing', entries: preparation.crossings, id: entry => entry.key,
        lastUsed: entry => entry.lastUsedThink ?? entry.quotedTick, plans: entry => entry.planIds ?? [],
        maxEntries: 32, thinkSequence: snapshot.tick, capacity: preparation.cacheCapacities?.crossing });
      preparation.crossings = bounded.entries;
      (preparation.cacheCapacities ??= {}).crossing = bounded.capacity;
      for (const entry of bounded.evicted) persistent!.delete(entry.key);
      const active = new Set(preparation.crossings.map(entry => entry.key));
      for (const key of persistent!.keys()) if (!active.has(key)) persistent!.delete(key);
      retainCacheMap(persistent!, publicationKey, storedChoices(choices), 32);
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
    const missionGround = mission && ground(mission.to);
    const missionTarget = mission && (snapshot.resources.find(mine => mine.id === mission.targetId)
      ?? snapshot.buildings.find(building => building.id === mission.targetId) ?? missionGround);
    const missionLand = missionTarget && landIdAt(snapshot.map, missionTarget);
    const unload = ship?.order.type === 'unload' ? ship.order : undefined;
    const observedGround = unload && ground(unload);
    const observedLand = observedGround && landIdAt(snapshot.map, observedGround);
    const observedSea = unload && seaIdAt(snapshot.map, unload);
    return { ship, sea, mission, missionGround, missionLand, unload, observedGround, observedLand, observedSea,
      pending: !!planningPhysics && (!!mission && !missionGround || !!unload && !observedGround), requestIds: [...pendingPhysicsIds] };
  }
  function passengerGeometry(unit: Unit, target: Target, destination: LandId, support: string): PassengerGeometry {
    let voyage = voyages.get(support);
    if (!voyage) voyages.set(support, voyage = inspectVoyage(support));
    if (voyage.pending) pendingGeometry = true;
    for (const id of voyage.requestIds) pendingPhysicsIds.add(id);
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
    const assigned = Object.entries(ferries).find(([, mission]) => {
      if (mission.phase === 'return' || !mission.crewIds.includes(unit.id)) return false;
      const target = snapshot.resources.find(mine => mine.id === mission.targetId)
        ?? snapshot.buildings.find(building => building.id === mission.targetId) ?? ground(mission.to);
      return !!target && landIdAt(snapshot.map, target) === destination;
    });
    if (assigned) {
      const [shipId, mission] = assigned, ship = byId.get(shipId), sea = ship && seaIdAt(snapshot.map, ship);
      const departure = ground(mission.from), landing = ground(mission.to);
      if (planningPhysics && (!departure || !landing)) return unknown('incumbent-voyage-ground-pending', 'The retained voyage ground projection is not published');
      const walk = departure && landTime(unit, departure), after = landing && landTime(unit, target.point, landing);
      const approach = ship && seaTime(ship, ship, mission.from), sail = ship && seaTime(ship, mission.from, mission.to, true);
      if (sea && walk !== undefined && after !== undefined && approach !== undefined && sail !== undefined) {
        const crossing: CrossingEta & { requiresNewShip: false } = { seaId: sea, shipId, departure: { ...mission.from }, landing: { ...mission.to }, landingGround: { ...landing! },
          waitTicks: Math.max(0, approach - walk), boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks: sail,
          ...(currentFactWork() ? { expectedLoadedTick: snapshot.tick + Math.max(walk, approach) + GANGWAY_SETUP_TICKS } : {}),
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
    const crossing = { ...best.choice.crossing, waitTicks: best.wait,
      ...(currentFactWork() ? { expectedLoadedTick: snapshot.tick + best.walk + best.wait + best.choice.crossing.boardingTicks } : {}) };
    const conditional = best.choice.unmet.length > 0 || crossing.requiresNewShip;
    const answer = projectedProperty({ status: conditional ? 'conditional' as const : 'reachable' as const, ticks: best.ticks, landTicks: best.walk + best.after }, 'evidence', descriptions.crossing);
    return conditional ? Object.assign(answer, { crossings: [crossing], unmet: best.choice.unmet }) as Extract<Arrival, { status: 'conditional' }>
      : Object.assign(answer, { crossings: [crossing as CrossingEta & { requiresNewShip: false }] }) as Extract<Arrival, { status: 'reachable' }>;
  }

  function resetGeometry() {
    pendingGeometry = false;
    pendingPhysicsIds.clear();
    if (usedFieldTicks.size) usedFieldTicks.clear();
    if (usedQuoteTicks.size) usedQuoteTicks.clear();
  }
  function fixedLoading(unit: Unit, voyage: FixedVoyage): FixedVoyageLoading {
    const ship = byId.get(voyage.shipId), source = landIdAt(snapshot.map, unit);
    if (unit.owner !== owner || unit.hp <= 0 || unitMover(unit.kind) !== 'land'
      || !ship || ship.owner !== owner || ship.hp <= 0 || !isTransportKind(ship.kind))
      return { status: 'unknown' as const, reasonCode: 'loading-member-or-hull-unavailable' };
    if (unit.deck?.shipId === ship.id || unit.cabin?.shipId === ship.id)
      return { status: 'already-loaded' as const };
    if (unit.deck || unit.cabin || voyage.phase !== 'loading' || source !== voyage.departureGround.landId
      || landIdAt(snapshot.map, voyage.departureGround.point) !== source
      || seaIdAt(snapshot.map, ship) !== voyage.seaId || seaIdAt(snapshot.map, voyage.departure) !== voyage.seaId)
      return { status: 'unknown' as const, reasonCode: 'loading-origin-or-phase-unverified' };
    const walkTicks = landTime(unit, voyage.departureGround.point), approachTicks = seaTime(ship, ship, voyage.departure);
    if (walkTicks === undefined || approachTicks === undefined)
      return { status: 'unknown' as const, reasonCode: 'loading-route-unpublished' };
    // Formal loading waits for the hull, then issues board. Existing incumbent
    // ferry predictions above retain their own concurrent move/board protocol.
    return { status: 'known' as const, forecastTick: snapshot.tick, walkTicks, approachTicks,
      boardingTicks: GANGWAY_SETUP_TICKS, expectedLoadedTick: snapshot.tick + approachTicks + walkTicks + GANGWAY_SETUP_TICKS };
  }
  function fixedVoyage(unit: Unit, target: Target, voyage: FixedVoyage): Arrival {
    const destination = target.landId ?? landIdAt(snapshot.map, target.point);
    if (unit.owner !== owner || unit.hp <= 0 || unitMover(unit.kind) !== 'land')
      return unknown('voyage-member-unavailable', 'Only a live owned land passenger can consume this voyage');
    if (!destination || destination !== voyage.landingGround.landId
      || landIdAt(snapshot.map, target.point) !== destination
      || landIdAt(snapshot.map, voyage.landingGround.point) !== destination
      || landIdAt(snapshot.map, voyage.departureGround.point) !== voyage.departureGround.landId)
      return unknown('voyage-ground-pair-mismatch', 'The retained crossing does not have the stated origin and destination ground labels');
    const support = unit.deck?.shipId ?? unit.cabin?.shipId;
    const source = !support && landIdAt(snapshot.map, unit);
    // Once actually unloaded, neither a departed/dead hull nor its former phase
    // can force the soldier back onto a speculative crossing.
    if (source === destination) {
      const ticks = landTime(unit, target.point);
      return ticks === undefined ? unavailable('native-road-unreachable', 'The remaining inland road is blocked')
        : walkingArrival(ticks, descriptions.land);
    }
    if (support && support !== voyage.shipId)
      return unknown('voyage-passenger-on-other-hull', 'The passenger is physically aboard a different hull');
    if (voyage.phase === 'return')
      return unknown('voyage-returning', 'The retained voyage is returning instead of delivering to this target');
    const ship = byId.get(voyage.shipId);
    if (!ship || ship.owner !== owner || ship.hp <= 0 || !isTransportKind(ship.kind))
      return unknown('voyage-hull-unavailable', 'The assigned physical transport is unavailable; no replacement is selected');
    if (seaIdAt(snapshot.map, ship) !== voyage.seaId || seaIdAt(snapshot.map, voyage.departure) !== voyage.seaId
      || seaIdAt(snapshot.map, voyage.landing) !== voyage.seaId)
      return unknown('voyage-sea-pair-mismatch', 'The assigned hull and both retained water points must belong to the same sea');
    if (!support && (source !== voyage.departureGround.landId || voyage.phase !== 'loading'))
      return unknown('voyage-passenger-not-at-loading', 'An unboarded passenger cannot use a departed voyage or a different origin');
    const after = landTime(unit, target.point, voyage.landingGround.point), loading = !support ? fixedLoading(unit, voyage) : undefined;
    const walk = support ? 0 : loading?.status === 'known' ? loading.walkTicks : undefined;
    const approach = support ? 0 : loading?.status === 'known' ? loading.approachTicks : undefined;
    const cruising = support || approach === undefined ? ship : afterApproach(ship, ship, voyage.departure, false);
    const sail = seaTime(cruising, support ? ship : currentFactWork() ? cruising : voyage.departure, voyage.landing, !support);
    if (walk === undefined || after === undefined || approach === undefined || sail === undefined)
      return unavailable('voyage-road-blocked', 'The fixed sailing, loading or inland leg is not available');
    const crossing: CrossingEta & { requiresNewShip: false } = {
      shipId: ship.id, seaId: voyage.seaId,
      departure: support ? { x: ship.x, y: ship.y } : { ...voyage.departure }, landing: { ...voyage.landing },
      landingGround: { ...voyage.landingGround.point }, waitTicks: approach,
      boardingTicks: support ? 0 : GANGWAY_SETUP_TICKS, sailingTicks: sail,
      ...(!support && currentFactWork() ? { expectedLoadedTick: snapshot.tick + approach + walk + GANGWAY_SETUP_TICKS } : {}),
      unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip: false,
    };
    return projectedProperty({ status: 'reachable' as const,
      ticks: walk + crossing.waitTicks + crossing.boardingTicks + sail + crossing.unloadingTicks + after,
      landTicks: walk + after, crossings: [crossing] }, 'evidence', descriptions.fixed);
  }
  function finish(answer: Arrival): Arrival {
    if (pendingGeometry && !('ticks' in answer)) {
      for (const id of answer.reason.factIds ?? []) pendingPhysicsIds.add(id);
      answer = unknown('geometry-refresh-pending',
        'The deterministic per-think field rebuild budget is exhausted; this route is not zero ETA or proven unreachable');
    }
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
  function calculate(unit: Unit, target: Target): Arrival {
    resetGeometry();
    const candidate = shortlisted && unit.owner === owner ? crossingCandidateId(snapshot, unit, target) : undefined;
    const answer: Arrival = candidate && !shortlist.has(candidate) && !isPublished(candidate)
      ? unknown('crossing-candidate-not-shortlisted',
        `Outside the top ${EXACT_CROSSING_CANDIDATES} coarse crossing candidates; not zero ETA or proof of unreachability`)
      : compute(unit, target);
    return finish(answer);
  }
  return {
    crossingChoices: crossingTable,
    stats,
    /** Coarse discovery consumes only already published basin geometry. Only
     * the selected ready frontier may enqueue a field through prepareSeaField. */
    coarseSeaTravel: (ship: Unit, from: Point, to: Point, future = false) => seaTravel.travel(ship, from, to, future, false),
    prepareSeaField: seaTravel.prepareField,
    /** Stage-only projection of the same query; never substitute final arrival
     * or a fabricated historic loading time for an unavailable forecast. */
    fixedVoyageLoading(unit: Unit, voyage: FixedVoyage) { resetGeometry(); return fixedLoading(unit, voyage); },
    setCrossingShortlist(ids: readonly string[]) { shortlisted = true; for (const id of ids) shortlist.add(id); },
    fixedVoyageArrival(unit: Unit, target: Target, voyage: FixedVoyage): Arrival {
      resetGeometry();
      const answer = finish(fixedVoyage(unit, target, voyage));
      return unit.expiresTick !== undefined && 'ticks' in answer && unit.expiresTick <= snapshot.tick + answer.ticks
        ? unavailable('expires-before-arrival', `${unit.id} expires before reaching this effect`) : answer;
    },
    arrival(unit: Unit, target: Target, origin?: LandId): Arrival {
      // Situation already resolves each actor's actual terrain component. Only
      // unmounted foreign actors on another land share this intent-only fact;
      // local walks and observed passenger voyages still use their own geometry.
      if (origin && target.landId && origin !== target.landId && unit.owner !== owner
        && !unit.deck && !unit.cabin && unitMover(unit.kind) === 'land') {
        resetGeometry();
        let targets = foreignCrossings.get(unit.owner);
        if (!targets) foreignCrossings.set(unit.owner, targets = new Map());
        const known = targets.get(target.landId);
        if (known) { stats.foreignUnknownHits++; return known; }
        const answer = unknown('opponent-transport-plan-unobserved',
          'No retained foreign ferry schedule is observable; do not assume its boat is free or invent a foreign build order');
        targets.set(target.landId, answer); stats.foreignUnknownBuilds++; return answer;
      }
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
