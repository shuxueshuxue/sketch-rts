import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { shipMotionLimits } from '../../shared/ship-handling';
import { shareShipProfile } from '../../shared/ship-geometry';
import { coursePerformance } from '../../shared/ship-wind';
import { groundSteeringRoute } from '../../shared/route-selection';
import { steerPoint, walkableGoal, walkingDistance, type Terrain } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import { createPlanningDistanceQuery } from './distance-fields';
import { landIdAt, regionIndex, seaIdAt, type RegionIndex, type Shore } from './regions';
import type { Arrival, CrossingEta, Evidence, Point, Reason, Target } from './types';

const evidence = (tick: number, source: string, detail: string): Evidence => ({ tick, source, detail, certainty: 'inferred' });
const unavailable = (code: string, detail: string): Arrival => ({ status: 'unreachable', reason: { code, detail, evidence: [] } });
const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const seaGeometry = new WeakMap<Terrain, Map<string, readonly Point[] | undefined>>();
const futureVoyages = new WeakMap<Terrain, Map<string, number>>();

/** One think's reusable route queries. Durations are forecasts of stated routes,
 * not promises that body avoidance, combat or a future build will finish on time. */
export function createArrivalQuery(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  distances = createPlanningDistanceQuery(snapshot), seaBuildBudget = Infinity, regions: RegionIndex = regionIndex(snapshot.map)) {
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const answers = new Map<string, Arrival>(), seaTimes = new Map<string, number | undefined>();
  const landTimes = new Map<string, number | undefined>();
  const landAges = new Map<string, number>(), pendingLand = new Set<string>();
  const ferries = memory.naval?.ferries ?? {};
  const shoresByLand = new Map<string, Map<string, Shore[]>>();
  const nearestCache = new WeakMap<readonly Shore[], Map<string, readonly Shore[]>>();
  const departuresByRegion = new Map<string, readonly Shore[]>();
  let pendingGeometry = false;
  let builtSeaTables = 0;
  const usedFieldTicks = new Set<number>();
  for (const shore of regions.shores) {
    let seas = shoresByLand.get(shore.landId);
    if (!seas) shoresByLand.set(shore.landId, seas = new Map());
    const entries = seas.get(shore.seaId) ?? [];
    if (!seas.has(shore.seaId)) seas.set(shore.seaId, entries);
    entries.push(shore);
  }
  const reason = (code: string, detail: string): Reason => ({ code, detail,
    evidence: [evidence(snapshot.tick, 'strategy.arrivals', detail)] });

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
    if (distance(from, to) <= 1e-7) return 0;
    const key = `${ship.id}:${from.x}:${from.y}:${to.x}:${to.y}:${future}`;
    if (seaTimes.has(key)) return seaTimes.get(key);
    const limits = shipMotionLimits(ship);
    if (!(limits.speed > 0) || !(limits.turnRate > 0)) { seaTimes.set(key, undefined); return; }
    const fixedOrigin = future || from.x !== ship.x || from.y !== ship.y;
    const pose = { ...ship };
    shareShipProfile(ship, pose);
    const speedFor = (course: number) => {
      const wind = coursePerformance(pose, snapshot.map, course, { assumeTrimmed: true });
      return wind.noGo ? Math.max(wind.auxiliarySpeed,
        coursePerformance(pose, snapshot.map, course + wind.beatAngle, { assumeTrimmed: true }).targetSpeed * Math.cos(wind.beatAngle),
        coursePerformance(pose, snapshot.map, course - wind.beatAngle, { assumeTrimmed: true }).targetSpeed * Math.cos(wind.beatAngle))
        : Math.max(wind.auxiliarySpeed, wind.targetSpeed);
    };
    if (!fixedOrigin) {
      // A live hull queries one destination field. Do not trace its whole road
      // for each candidate passenger. The initial course samples the hull polar;
      // future dock-to-dock legs below retain their full course table.
      const length = walkingDistance(snapshot.map, from, to, 'sea');
      if (length === undefined) { seaTimes.set(key, undefined); return; }
      const next = steerPoint(snapshot.map, from, to, 'sea'), course = Math.atan2(next.y - from.y, next.x - from.x);
      const ticks = Math.ceil((length / speedFor(course) + angleGap(ship.sailing?.heading ?? 0, course) / limits.turnRate
        + limits.speed / Math.max(1, limits.acceleration)) * SIM_TICKS_PER_SECOND);
      if (!Number.isFinite(ticks)) throw new Error(`Non-finite strategy sailing ETA for ${ship.id}`);
      seaTimes.set(key, ticks); return ticks;
    }
    const terrain = snapshot.map.terrain;
    let geometry = terrain ? seaGeometry.get(terrain) : undefined;
    if (terrain && !geometry) seaGeometry.set(terrain, geometry = new Map());
    const geometryKey = `${from.x}:${from.y}:${to.x}:${to.y}`;
    let route: readonly Point[] | undefined;
    if (fixedOrigin && geometry?.has(geometryKey)) route = geometry.get(geometryKey);
    else {
      if (builtSeaTables >= seaBuildBudget) { pendingGeometry = true; return; }
      builtSeaTables++;
      route = walkingDistance(snapshot.map, from, to, 'sea') === undefined ? undefined : groundSteeringRoute(snapshot.map, from, to, 'sea');
      if (route && distance(route.at(-1)!, to) > 240) route = undefined;
      if (fixedOrigin && geometry) {
        if (geometry.size >= 512) geometry.clear();
        geometry.set(geometryKey, route);
      }
    }
    if (!route) { seaTimes.set(key, undefined); return; }
    // Future dock-to-dock legs do not know their departure helm orientation.
    // Align the first course and retain turn costs at all subsequent corners;
    // live approaches still start at the actual recorded heading.
    const first = route[1] ?? to;
    let previous = from, heading = fixedOrigin ? Math.atan2(first.y - from.y, first.x - from.x) : ship.sailing?.heading ?? 0, seconds = 0;
    const wind = snapshot.map.wind;
    const signature = `${geometryKey}:${ship.kind}:${ship.deckScale ?? 0}:${limits.speed}:${limits.acceleration}:${limits.turnRate}:${wind?.direction}:${wind?.speed}:${wind?.changedAtTick}`;
    let voyages = terrain ? futureVoyages.get(terrain) : undefined;
    if (terrain && !voyages) futureVoyages.set(terrain, voyages = new Map());
    const cached = fixedOrigin ? voyages?.get(signature) : undefined;
    if (cached !== undefined) { seaTimes.set(key, cached); return cached; }
    for (const point of route.slice(1)) {
      const length = distance(previous, point);
      if (!length) continue;
      const course = Math.atan2(point.y - previous.y, point.x - previous.x);
      pose.x = previous.x; pose.y = previous.y;
      // Positive upwind VMG is supplied by the same hull polar used by movement.
      const speed = speedFor(course);
      seconds += length / speed + angleGap(heading, course) / limits.turnRate;
      heading = course; previous = point;
    }
    seconds += limits.speed / Math.max(1, limits.acceleration);
    const ticks = Math.ceil(seconds * SIM_TICKS_PER_SECOND);
    if (!Number.isFinite(ticks)) throw new Error(`Non-finite strategy sailing ETA for ${ship.id}`);
    if (fixedOrigin && voyages) { if (voyages.size >= 1024) voyages.clear(); voyages.set(signature, ticks); }
    seaTimes.set(key, ticks);
    return ticks;
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
        const shore = shoresByLand.get(landIdAt(snapshot.map, unit) ?? '')?.get(seaIdAt(snapshot.map, ship) ?? '') ?? [];
        const ground = nearest(shore, mission.from)[0]?.ground;
        const time = ground && landTime(unit, ground);
        return time === undefined ? [] : [time];
      });
      ticks += times.length ? Math.max(...times) : 0;
    }
    const free = { point, ticks, unmet: [reason('borrow-transport', `Release ${ship.id} from ${mission.purpose}:${mission.targetId} after its current voyage`)] };
    freeTimes.set(ship.id, free); return free;
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
    const sourceShores = shoresByLand.get(source);
    const possible: Arrival[] = [];
    for (const [seaKey, shores] of sourceShores ?? []) {
      const sea = shores[0]!.seaId;
      const departureKey = `${unit.owner}:${source}:${sea}`;
      if (!departuresByRegion.has(departureKey)) {
        // A voyage gathers a cohort at one shared embarkation point. Choosing a
        // different coastline for every soldier both invents extra boat trips
        // and repeats the same geometry hundreds of times.
        const anchor = snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'shipyard'
          && landIdAt(snapshot.map, building) === source && seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) === sea)
          ?? snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'townHall' && landIdAt(snapshot.map, building) === source)
          ?? snapshot.units.find(candidate => candidate.owner === unit.owner && !candidate.deck && !candidate.cabin && landIdAt(snapshot.map, candidate) === source)!;
        departuresByRegion.set(departureKey, nearest(shores, anchor));
      }
      const departures = departuresByRegion.get(departureKey)!;
      const landings = nearest(shoresByLand.get(destination)?.get(seaKey) ?? [], target.point);
      if (!landings.length) continue;
      const actual = snapshot.units.filter(ship => ship.owner === unit.owner && ship.hp > 0 && isTransportKind(ship.kind)
        && seaIdAt(snapshot.map, ship) === sea);
      for (const from of departures) for (const to of landings) {
        const walk = landTime(unit, from.ground), after = landTime({ ...unit, ...to.ground }, target.point);
        if (walk === undefined || after === undefined) continue;
        const prototype: Unit = { ...unit, id: `proposed-transport:${unit.owner}:${source}:${sea}`,
          kind: 'transport' as const, ...from.water, speed: UNIT_DEFS.transport.speed, radius: UNIT_DEFS.transport.radius,
          hp: UNIT_DEFS.transport.hp, maxHp: UNIT_DEFS.transport.hp, shipParts: undefined,
          sailing: { heading: 0, speed: 0, load: 0, balance: 0 } };
        delete prototype.deckScale; delete prototype.cargoCapacity; delete prototype.fittings;
        delete prototype.variant; delete prototype.bodyRadius;
        const prototypes = [...actual, prototype];
        for (const ship of prototypes) {
          const requiresNewShip = ship === prototype;
          const free = requiresNewShip ? { point: from.water, ticks: UNIT_DEFS.transport.trainTime,
            unmet: [reason('obtain-transport', `Build a transport in ${sea}`)] } : freeShip(ship);
          if (!free) continue;
          const yard = snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'shipyard'
            && seaIdAt(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, 'sea')) === sea);
          if (requiresNewShip && !yard) {
            free.ticks += BUILDING_DEFS.shipyard.buildTime;
            free.unmet.push(reason('build-shipyard', `Establish production in ${sea}; worker access and funding remain prerequisites`));
          } else if (requiresNewShip && yard) {
            free.ticks += Math.max(0, yard.complete ? 0 : yard.buildTime - yard.buildProgress)
              + yard.queue.reduce((sum, job) => sum + job.remaining, 0);
          }
          const approach = seaTime(ship, free.point, from.water), sailingTicks = seaTime(ship, from.water, to.water, true);
          if (approach === undefined || sailingTicks === undefined) continue;
          const waitTicks = Math.max(0, free.ticks + approach - walk);
          const crossing: CrossingEta = { seaId: sea, shipId: requiresNewShip ? null : ship.id,
            departure: { ...from.water }, landing: { ...to.water }, waitTicks,
            boardingTicks: GANGWAY_SETUP_TICKS, sailingTicks, unloadingTicks: GANGWAY_SETUP_TICKS, requiresNewShip };
          const ticks = walk + waitTicks + crossing.boardingTicks + sailingTicks + crossing.unloadingTicks + after;
          const common = { ticks, landTicks: walk + after, crossings: [crossing],
            evidence: [evidence(snapshot.tick, 'strategy.arrivals', 'Wait after simultaneous walking/boat approach, gangway setup, terrain sea route with hull/wind rates, unload and inland steering; no congestion prediction')] };
          possible.push(free.unmet.length || requiresNewShip ? { status: 'conditional', ...common, unmet: free.unmet }
            : { status: 'reachable', ...common, crossings: [crossing as CrossingEta & { requiresNewShip: false }] });
        }
      }
    }
    return possible.sort((a, b) => ('ticks' in a ? a.ticks : Infinity) - ('ticks' in b ? b.ticks : Infinity))[0]
      ?? { status: 'unknown', reason: reason('no-direct-crossing', `No direct evaluated sea crossing from ${source} to ${destination}; a multi-hop plan is not evaluated`) };
  }

  return {
    arrival(unit: Unit, target: Target): Arrival {
      const key = `${unit.id}:${target.point.x}:${target.point.y}`;
      if (!answers.has(key)) {
        pendingGeometry = false; usedFieldTicks.clear();
        let answer = compute(unit, target);
        if (pendingGeometry && !('ticks' in answer)) answer = { status: 'unknown', reason: reason('geometry-refresh-pending',
          'The deterministic per-think field rebuild budget is exhausted; this route is not zero ETA or proven unreachable') };
        if ('ticks' in answer) answer = { ...answer, evidence: [...answer.evidence, ...[...usedFieldTicks].sort((a, b) => a - b)
          .map(tick => evidence(tick, 'terrain.groundDistanceField.built', `Geometry computed at tick ${tick}; actors and arrival speeds sampled at ${snapshot.tick}`))] };
        answers.set(key, answer);
      }
      const answer = answers.get(key)!;
      return unit.expiresTick !== undefined && 'ticks' in answer && unit.expiresTick <= snapshot.tick + answer.ticks
        ? unavailable('expires-before-arrival', `${unit.id} expires before reaching this effect`) : answer;
    },
    freeInTicks(ship: Unit): number | null { return freeShip(ship)?.ticks ?? null; },
  };
}
