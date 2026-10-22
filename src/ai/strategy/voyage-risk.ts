import { unitRules } from '../../shared/catalog';
import { combatWeapons } from '../../shared/combat-capabilities';
import { strikeGap } from '../../shared/combat-geometry';
import { resolveUnitDamage } from '../../shared/damage';
import { attackDamageProfile } from '../../shared/damage-types';
import { shipProfile, shareShipProfile } from '../../shared/ship-geometry';
import { shipMotionLimits } from '../../shared/ship-handling';
import { shipLaunchPose, shipLaunchPrototype } from '../../shared/ship-launch';
import { advanceShipPlanningJob, beginShipPlanningJob } from '../../shared/ship-planning-job';
import { fnv1a } from '../../shared/sim/checksum';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import { shipPoseAt, headingDifference, type ShipPose } from '../../shared/ship-navigation';
import { coursePerformance } from '../../shared/ship-wind';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isRangedUnit } from '../../shared/unit-weapon-class';
import { weaponDamage } from '../../shared/weapons';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { strategyIsOpponent } from './ownership';
import { regionIndex, seaIdAt } from './regions';
import type { Point, SeaId } from './types';
import { observationJsonBytes } from './observation-json-bytes';
import { currentFactWork } from './fact-work';
import { pointRoute } from './point-routes';
import type { StrategyObservationMemory } from './observation-memory';

export const VOYAGE_RISK_SAMPLE_SPACING = 32;
export const VOYAGE_RISK_SAMPLES_PER_THINK = 256;
export const VOYAGE_RISK_ROUTE_PLANS_PER_THINK = 2;
export const VOYAGE_RISK_MEMORY_BYTES = 16 * 1024;
const ENTRY_LIMIT = 16, COAST_BUCKET = 256;
export type VoyageRiskRequest = Readonly<{
  id: string; seaId: SeaId; destination: Point;
  shipId?: string; productionBuildingId?: string;
  /** Native end pose of the preceding leg, conditional on that leg succeeding. */
  start?: ShipPose;
  /** Start from the exact native endpoint of this earlier request in the same
   * batch. A deferred/partial previous route cannot become a straight segment. */
  previousLegId?: string;
  /** A point list from the native helm/planner, never a straight-line substitute. */
  route?: Readonly<{ points: readonly ShipPose[]; partial: boolean }>;
}>;
type Progress = { id: string; key: string; cursor: number; total: number; damage: number; boundarySeconds: number; computedTick: number };
type NativeRouteProgress = { id: string; inputs: string; job: string; ready: boolean };
export type VoyageRiskMemory = { version: 1; owner: PlayerId; tick: number; thinkSequence?: number; routeIds: string[]; entries: Progress[];
  nativeRoutes?: NativeRouteProgress[] };
export type VoyageRisk = Readonly<
  { status: 'known'; survivalProbability: number; expectedDamage: number; expectedHpLoss: number;
    damageErrorBound: number; samples: number; totalSamples: number; computedTick: number;
    basis: 'no-capable-basin-enemy' | 'native-route-exposure' | 'completed-before-evaluation'; threatIds: readonly string[] }
  | { status: 'unknown'; reasonCode: string; samples: number; totalSamples: number; threatIds: readonly string[] }
>;
type Weapon = Readonly<{ range: number; minRange: number; dps: number }>;
type Threat = Readonly<{ id: string; x: number; y: number; seaId?: SeaId; ranged: boolean; weapons: readonly Weapon[] }>;
type Coast = Map<string, readonly Point[]>;
const terrainVersions = new WeakMap<object, { cells: string; key: string }>();
function terrainVersion(snapshot: GameSnapshot) {
  const terrain = snapshot.map.terrain;
  if (!terrain) return `open:${snapshot.map.width}:${snapshot.map.height}`;
  let saved = terrainVersions.get(terrain);
  if (!saved || saved.cells !== terrain.cells) { saved = { cells: terrain.cells, key: `${terrain.cols}:${terrain.rows}:${terrain.cell}:${fnv1a(terrain.cells)}` }; terrainVersions.set(terrain, saved); }
  return saved.key;
}
const coastIndices = new WeakMap<object, { cells: string; index: Coast }>();
const keyOf = (x: number, y: number) => `${Math.floor(x / COAST_BUCKET)}:${Math.floor(y / COAST_BUCKET)}`;

function coastIndex(snapshot: GameSnapshot): Coast {
  const terrain = snapshot.map.terrain;
  if (!terrain) return new Map();
  const old = coastIndices.get(terrain);
  if (old?.cells === terrain.cells) return old.index;
  const index = new Map<string, Point[]>();
  for (const shore of regionIndex(snapshot.map).shores) {
    const key = `${shore.seaId}:${keyOf(shore.water.x, shore.water.y)}`;
    let points = index.get(key); if (!points) index.set(key, points = []);
    points.push(shore.water);
  }
  coastIndices.set(terrain, { cells: terrain.cells, index }); return index;
}
function canReachBasin(snapshot: GameSnapshot, coast: Coast, threat: Threat, sea: SeaId, hullRadius: number) {
  if (threat.seaId) return threat.seaId === sea;
  if (!threat.ranged) return false;
  if (!snapshot.map.terrain) return sea === 'sea:1';
  // A coastal cell's entire square is covered by this conservative halo.
  // The exact range check still uses the hull surface at each sample.
  const reach = Math.max(...threat.weapons.map(weapon => weapon.range)) + hullRadius + snapshot.map.terrain.cell * Math.SQRT2;
  for (let y = Math.floor((threat.y - reach) / COAST_BUCKET); y <= Math.floor((threat.y + reach) / COAST_BUCKET); y++)
    for (let x = Math.floor((threat.x - reach) / COAST_BUCKET); x <= Math.floor((threat.x + reach) / COAST_BUCKET); x++)
      if (coast.get(`${sea}:${x}:${y}`)?.some(point => Math.hypot(point.x - threat.x, point.y - threat.y) <= reach)) return true;
  return false;
}
function hullFor(snapshot: GameSnapshot, owner: PlayerId, request: VoyageRiskRequest): Unit | undefined {
  if (request.shipId) {
    const ship = snapshot.units.find(unit => unit.id === request.shipId && unit.owner === owner && unit.hp > 0 && shipProfile(unit));
    return ship && seaIdAt(snapshot.map, ship) === request.seaId ? ship : undefined;
  }
  const yard = snapshot.buildings.find(building => building.id === request.productionBuildingId && building.kind === 'shipyard'
    && building.owner === owner && building.hp > 0 && building.complete);
  if (!yard) return undefined;
  const prototype = shipLaunchPrototype(yard, 'transport'), pose = shipLaunchPose(currentFactWork() ? { ...snapshot, units: [] } : snapshot, yard, prototype);
  if (!pose || seaIdAt(snapshot.map, pose) !== request.seaId) return undefined;
  const ship = { ...prototype, ...(currentFactWork() ? { id: `route-prototype:${yard.id}` } : {}), x: pose.x, y: pose.y,
    sailing: { heading: pose.heading, speed: 0, load: 0, balance: 0 } };
  shareShipProfile(prototype, ship); return ship;
}
function threatActors(snapshot: GameSnapshot, owner: PlayerId) {
  const threats: { body: Unit | Building; seaId?: SeaId; ranged: boolean; weapons: ReturnType<typeof combatWeapons> }[] = [];
  // One entity pass. Neutral ranged weapons are also real hull hazards; this
  // does not regroup camps or replace the shared camp response facts.
  for (const body of [...snapshot.units, ...snapshot.buildings] as (Unit | Building)[]) {
    if (body.hp <= 0 || !(body.owner === 'neutral' || strategyIsOpponent(snapshot, owner, body.owner)) || 'complete' in body && !body.complete
      || 'order' in body && body.cabin) continue;
    const hull = 'order' in body && shipProfile(body);
    const ranged = !('order' in body) || isRangedUnit(body);
    if (!hull && !ranged) continue;
    const weapons = combatWeapons(snapshot, body).filter(weapon => weapon.damage > 0 && weapon.range > 0);
    const seaId = seaIdAt(snapshot.map, body);
    if (weapons.length) threats.push({ body, ranged, ...(seaId ? { seaId } : {}), weapons });
  }
  return threats.sort((a, b) => a.body.id < b.body.id ? -1 : a.body.id > b.body.id ? 1 : 0);
}
function threatsFor(snapshot: GameSnapshot, actors: ReturnType<typeof threatActors>, ship: Unit): Threat[] {
  return actors.map(({ body, seaId, ranged, weapons }) => ({ id: body.id, x: body.x, y: body.y, ranged,
    ...(seaId ? { seaId } : {}), weapons: weapons.map(weapon => {
      const raw = weapon.weapon ? weaponDamage(weapon.weapon, weapon.damage, false, true) : weapon.damage;
      const damage = resolveUnitDamage(snapshot, ship, raw, attackDamageProfile(body.kind, weapon.weapon)).damage;
      return { range: weapon.range, minRange: weapon.weapon?.minRange ?? 0,
        dps: damage * SIM_TICKS_PER_SECOND / Math.max(1, weapon.cooldown) };
    }).filter(weapon => weapon.dps > 0),
  })).filter(threat => threat.weapons.length > 0);
}
const nativeRouteHolders = new WeakMap<NativeRouteProgress, Unit>();
function nativeRouteHolder(entry: NativeRouteProgress): Unit {
  let holder = nativeRouteHolders.get(entry);
  if (!holder) {
    // The native job already contains its minimal frozen navigation-only unit.
    holder = JSON.parse(entry.job).ship as Unit;
    holder.sailing!.planningJob = entry.job;
    nativeRouteHolders.set(entry, holder);
  }
  return holder;
}
type Leg = { from: ShipPose; to: ShipPose; length: number; samples: number; offset: number };
function routeLegs(ship: Unit, points: readonly ShipPose[]) {
  let from = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 }, offset = 0;
  const legs: Leg[] = [];
  for (const to of points) {
    if (![to.x, to.y, to.heading].every(Number.isFinite)) throw new Error('Non-finite native voyage pose');
    const curved = to.curvature && Math.abs(to.curvature) > 1e-9
      && Math.hypot(shipPoseAt(from, to, 1).x - to.x, shipPoseAt(from, to, 1).y - to.y) < 1e-5;
    const length = curved ? Math.abs(headingDifference(from.heading, to.heading) / to.curvature!) : Math.hypot(to.x - from.x, to.y - from.y);
    const samples = Math.ceil(length / VOYAGE_RISK_SAMPLE_SPACING);
    if (samples) { legs.push({ from, to, length, samples, offset }); offset += samples; }
    from = to;
  }
  return { legs, samples: offset };
}
const unknown = (reasonCode: string, threats: readonly Threat[] = [], samples = 0, totalSamples = 0): VoyageRisk =>
  ({ status: 'unknown', reasonCode, samples, totalSamples, threatIds: threats.map(threat => threat.id) });
function known(progress: Progress | undefined, ship: Unit, threats: readonly Threat[], tick: number): VoyageRisk {
  const damage = progress?.damage ?? 0;
  const maximumDps = threats.reduce((sum, threat) => sum + threat.weapons.reduce((part, weapon) => part + weapon.dps, 0), 0);
  return { status: 'known', survivalProbability: Math.max(0, 1 - damage / ship.hp), expectedDamage: damage,
    expectedHpLoss: Math.min(ship.hp, damage), damageErrorBound: maximumDps * (progress?.boundarySeconds ?? 0),
    samples: progress?.cursor ?? 0, totalSamples: progress?.total ?? 0, computedTick: progress?.computedTick ?? tick,
    basis: threats.length ? 'native-route-exposure' : 'no-capable-basin-enemy', threatIds: threats.map(threat => threat.id) };
}

/** Batch once per think, in stable ID order. Only serialized progress decides
 * publication. Repeated gross/net queries in this tick cannot spend more work;
 * terrain/weapon caches merely accelerate the same answer. */
export function assessVoyageRisks(snapshot: GameSnapshot, owner: PlayerId, requests: readonly VoyageRiskRequest[], memory: VoyageRiskMemory,
  observation?: StrategyObservationMemory, options?: Readonly<{ advance?: boolean; sampleAllowance?: number }>) {
  if (memory.version !== 1 || memory.owner !== owner) throw new Error('Voyage risk memory owner/version mismatch');
  const sequence = currentFactWork()?.receipt.thinkSequence;
  const advance = options?.advance !== false && (sequence === undefined ? memory.tick !== snapshot.tick : memory.thinkSequence !== sequence);
  const sampleAllowance = Math.min(VOYAGE_RISK_SAMPLES_PER_THINK, options?.sampleAllowance ?? VOYAGE_RISK_SAMPLES_PER_THINK);
  if (!Number.isSafeInteger(sampleAllowance) || sampleAllowance < 0) throw Error('Invalid voyage sample allowance');
  if (advance) { memory.tick = snapshot.tick; if (sequence !== undefined) memory.thinkSequence = sequence; else delete memory.thinkSequence; memory.routeIds = []; }
  memory.nativeRoutes ??= [];
  const bodies = standingBodies(snapshot);
  setBuildingBodies(snapshot.map, bodies);
  const bodyTuples = bodies.map(body => [body.x, body.y, body.radius]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  const geometryVersion = `${terrainVersion(snapshot)}:${bodyTuples.length}:${fnv1a(JSON.stringify(bodyTuples))}`;
  let samplesUsed = 0, routePlans = 0;
  const results = new Map<string, VoyageRisk>(), endpoints = new Map<string, ShipPose>();
  const coast = coastIndex(snapshot), actors = threatActors(snapshot, owner);
  const ordered = [...requests].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(ordered.map(request => request.id)).size !== ordered.length) throw new Error('Duplicate voyage risk request ID');
  const live = new Set(ordered.map(request => request.id));
  memory.entries = memory.entries.filter(entry => live.has(entry.id));
  memory.nativeRoutes = memory.nativeRoutes.filter(entry => live.has(entry.id));
  for (const request of ordered) {
    if (request.id.length > 256) throw new Error('Voyage risk request identity exceeds 256 characters');
    const origin = hullFor(snapshot, owner, request);
    const start = request.previousLegId ? endpoints.get(request.previousLegId) : request.start;
    const ship = origin && start ? { ...origin, x: start.x, y: start.y,
      sailing: { ...origin.sailing!, heading: start.heading } } : origin;
    if (origin && ship !== origin) shareShipProfile(origin, ship!);
    const profile = ship && shipProfile(ship);
    if (!ship || !profile || seaIdAt(snapshot.map, request.destination) !== request.seaId) {
      results.set(request.id, unknown('voyage-hull-producer-or-basin-unknown')); continue;
    }
    const radius = Math.max(...profile.hull.map(point => Math.hypot(point.x, point.y)));
    const threats = threatsFor(snapshot, actors, ship).filter(threat => canReachBasin(snapshot, coast, threat, request.seaId, radius));
    if (!threats.length) {
      memory.entries = memory.entries.filter(entry => entry.id !== request.id);
      results.set(request.id, known(undefined, ship, [], snapshot.tick)); continue;
    }
    if (request.previousLegId && !start) {
      results.set(request.id, unknown('voyage-previous-native-leg-deferred', threats)); continue;
    }
    let route = request.route, arrivalTolerance = 1e-5;
    const helm = ship.sailing?.route;
    if (!route && helm?.goalX === request.destination.x && helm.goalY === request.destination.y)
      route = { points: helm.points, partial: helm.partial ?? false };
    if (!route && currentFactWork() && observation) {
      const fact = pointRoute(snapshot, observation, ship, ship, request.destination,
        !!request.productionBuildingId || !!request.previousLegId);
      if (fact.status !== 'complete') {
        results.set(request.id, unknown(fact.reasonCode ?? 'voyage-native-point-route-pending', threats)); continue;
      }
      route = fact.route;
      arrivalTolerance = ship.radius;
    }
    if (!route) {
      const inputs = JSON.stringify([ship.x, ship.y, ship.sailing?.heading ?? 0, shipMotionLimits(ship), profile.hull,
        ship.order, ship.orderQueue ?? [], snapshot.map.wind ?? null, request.destination, geometryVersion]);
      let entry: NativeRouteProgress | undefined = memory.nativeRoutes.find(entry => entry.id === request.id);
      if (entry?.inputs !== inputs) {
        memory.nativeRoutes = memory.nativeRoutes.filter(entry => entry.id !== request.id);
        if (!advance || memory.routeIds.length >= VOYAGE_RISK_ROUTE_PLANS_PER_THINK) {
          results.set(request.id, unknown('voyage-native-route-deferred', threats)); continue;
        }
        const planner = { ...ship, sailing: { ...ship.sailing! } };
        beginShipPlanningJob(planner, request.destination, snapshot.map, snapshot.units);
        entry = { id: request.id, inputs, job: planner.sailing.planningJob!, ready: false };
        if (memory.nativeRoutes.length >= ENTRY_LIMIT || observationJsonBytes(memory) + observationJsonBytes(entry) > VOYAGE_RISK_MEMORY_BYTES - 256) {
          results.set(request.id, unknown('voyage-risk-memory-budget-exceeded', threats)); continue;
        }
        memory.nativeRoutes.push(entry);
      }
      const planner = nativeRouteHolder(entry);
      if (!entry.ready && (!advance || memory.routeIds.includes(request.id) || memory.routeIds.length >= VOYAGE_RISK_ROUTE_PLANS_PER_THINK)) {
        results.set(request.id, unknown('voyage-native-route-deferred', threats)); continue;
      }
      const planned = advanceShipPlanningJob(planner, snapshot.map);
      if (!entry.ready) { memory.routeIds.push(request.id); routePlans++; }
      entry.job = planner.sailing!.planningJob ?? '';
      entry.ready = Boolean(planned);
      if (observationJsonBytes(memory) > VOYAGE_RISK_MEMORY_BYTES - 256) {
        memory.nativeRoutes = memory.nativeRoutes.filter(item => item !== entry);
        results.set(request.id, unknown('voyage-risk-memory-budget-exceeded', threats)); continue;
      }
      if (!planned) { results.set(request.id, unknown('voyage-native-route-deferred', threats)); continue; }
      route = planned;
    }
    if (route.partial || Math.hypot((route.points.at(-1)?.x ?? ship.x) - request.destination.x,
      (route.points.at(-1)?.y ?? ship.y) - request.destination.y) > arrivalTolerance) {
      results.set(request.id, unknown('voyage-native-route-incomplete', threats)); continue;
    }
    endpoints.set(request.id, route.points.at(-1) ?? { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 });
    const { legs, samples } = routeLegs(ship, route.points);
    const key = JSON.stringify([request.seaId, ship.kind, ship.hp, ship.x, ship.y, ship.sailing?.heading ?? 0,
      profile.hull, shipMotionLimits(ship), ship.sailing?.speed ?? 0, ship.sailing?.velocityX ?? null, ship.sailing?.velocityY ?? null, snapshot.map.wind ?? null, route.points, threats]);
    let progress = memory.entries.find(entry => entry.id === request.id);
    if (progress?.key !== key) {
      memory.entries = memory.entries.filter(entry => entry.id !== request.id);
      const next = { id: request.id, key, cursor: 0, total: samples, damage: 0, boundarySeconds: 0, computedTick: snapshot.tick };
      if (memory.entries.length >= ENTRY_LIMIT || observationJsonBytes({ ...memory, entries: [...memory.entries, next] }) > VOYAGE_RISK_MEMORY_BYTES - 256) {
        results.set(request.id, unknown('voyage-risk-memory-budget-exceeded', threats, 0, samples)); continue;
      }
      memory.entries.push(next); progress = next;
    }
    if (advance && progress.cursor < samples) {
      const pose: Unit = { ...ship, sailing: { ...ship.sailing!, route: undefined } }; shareShipProfile(ship, pose);
      while (progress.cursor < samples && samplesUsed < sampleAllowance) {
        const leg = legs.find(part => part.offset + part.samples > progress!.cursor)!;
        const index = progress.cursor - leg.offset, point = shipPoseAt(leg.from, leg.to, (index + .5) / leg.samples);
        pose.x = point.x; pose.y = point.y; pose.sailing!.heading = point.heading;
        const performance = coursePerformance(pose, snapshot.map, point.heading, { assumeTrimmed: true });
        const speed = Math.min(Math.max(performance.targetSpeed, performance.auxiliarySpeed), leg.to.speedLimit ?? Number.MAX_VALUE);
        if (!(speed > 0) || !Number.isFinite(speed)) throw new Error('Invalid native voyage exposure speed');
        const seconds = leg.length / leg.samples / speed;
        let dps = 0, boundary = false;
        for (const threat of threats) {
          const reach = Math.max(...threat.weapons.map(weapon => weapon.range)) + radius;
          // Segment AABB rejects far weapons before native hull-surface geometry.
          if (Math.abs(threat.x - point.x) > reach || Math.abs(threat.y - point.y) > reach) continue;
          const gap = strikeGap(threat, pose);
          for (const weapon of threat.weapons) {
            if (gap >= weapon.minRange && gap <= weapon.range) dps += weapon.dps;
            const sweep = leg.length / leg.samples + radius * Math.abs(headingDifference(leg.from.heading, leg.to.heading)) / leg.samples;
            if (Math.abs(gap - weapon.range) <= sweep || weapon.minRange > 0 && Math.abs(gap - weapon.minRange) <= sweep) boundary = true;
          }
        }
        progress.damage += dps * seconds;
        if (boundary) progress.boundarySeconds += seconds;
        progress.cursor++; samplesUsed++;
      }
      if (progress.cursor === samples) progress.computedTick = snapshot.tick;
    }
    results.set(request.id, progress.cursor === samples ? known(progress, ship, threats, snapshot.tick)
      : unknown('voyage-risk-sampling-deferred', threats, progress.cursor, samples));
  }
  memory.entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (observationJsonBytes(memory) > VOYAGE_RISK_MEMORY_BYTES) throw new Error('Voyage risk publication memory exceeds its hard limit');
  return { results, samplesUsed, routePlans };
}

/** The residual is the hull value before this voyage's risk, not its already
 * probability-weighted residual. Planned manifest and real deck/cabin occupants
 * are one set; a sinking does not become cheap by omitting an actual passenger. */
export function voyageExpectedLoss(input: Readonly<{
  snapshot: GameSnapshot; shipId?: string; passengerIds: readonly string[];
  shipResidualGold: number; survivalProbability: number;
}>) {
  const { snapshot, shipResidualGold, survivalProbability } = input;
  if (!Number.isFinite(shipResidualGold) || shipResidualGold < 0 || !Number.isFinite(survivalProbability)
    || survivalProbability < 0 || survivalProbability > 1) throw new Error('Invalid voyage asset risk valuation');
  const ids = [...new Set([...input.passengerIds, ...snapshot.units.filter(unit => unit.hp > 0 && input.shipId
    && (unit.deck?.shipId === input.shipId || unit.cabin?.shipId === input.shipId)).map(unit => unit.id)])].sort();
  const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const unknownIds = ids.filter(id => !units.get(id) || units.get(id)!.hp <= 0 || id === input.shipId);
  if (unknownIds.length) return { status: 'unknown' as const, reasonCode: 'voyage-passenger-value-unknown', unknownIds };
  const passengers = ids.map(unitId => ({ unitId, catalogGold: unitRules(snapshot, units.get(unitId)!).cost }));
  if (passengers.some(passenger => !Number.isFinite(passenger.catalogGold) || passenger.catalogGold < 0))
    throw new Error('Invalid voyage passenger catalog value');
  const passengerGold = passengers.reduce((sum, passenger) => sum + passenger.catalogGold, 0), lossProbability = 1 - survivalProbability;
  return { status: 'known' as const, passengers, passengerGold, hullLossGold: lossProbability * shipResidualGold,
    passengerLossGold: lossProbability * passengerGold, expectedLossGold: lossProbability * (shipResidualGold + passengerGold) };
}

export type VoyageRiskStages = Readonly<{ approach: VoyageRisk; loaded: VoyageRisk }>;
/** An empty approach cannot sink people still waiting on the beach. Actual
 * initial passengers, however, are exposed in both legs. Leg probabilities
 * are conditional static-exposure proxies; later combat is another branch. */
export function transportExpectedLoss(input: Readonly<{
  snapshot: GameSnapshot; shipId?: string; boardingPassengerIds: readonly string[];
  shipResidualGold: number; stages: VoyageRiskStages;
}>) {
  const { approach, loaded } = input.stages;
  if (approach.status !== 'known' || loaded.status !== 'known') return {
    status: 'unknown' as const, reasonCode: 'voyage-stage-risk-unknown',
    unknownLegs: [approach.status !== 'known' ? 'approach' : null, loaded.status !== 'known' ? 'loaded' : null].filter(value => value !== null),
  };
  const initial = new Set(input.snapshot.units.filter(unit => input.shipId && unit.hp > 0
    && (unit.deck?.shipId === input.shipId || unit.cabin?.shipId === input.shipId)).map(unit => unit.id));
  const valuation = voyageExpectedLoss({ snapshot: input.snapshot, ...(input.shipId ? { shipId: input.shipId } : {}),
    passengerIds: input.boardingPassengerIds, shipResidualGold: input.shipResidualGold, survivalProbability: 1 });
  if (valuation.status !== 'known') return valuation;
  const successProbability = approach.survivalProbability * loaded.survivalProbability;
  const waitingSinkingProbability = approach.survivalProbability * (1 - loaded.survivalProbability);
  const initialPassengerGold = valuation.passengers.filter(passenger => initial.has(passenger.unitId)).reduce((sum, passenger) => sum + passenger.catalogGold, 0);
  const waitingPassengerGold = valuation.passengerGold - initialPassengerGold;
  const hullLossGold = (1 - successProbability) * input.shipResidualGold;
  const passengerLossGold = (1 - successProbability) * initialPassengerGold + waitingSinkingProbability * waitingPassengerGold;
  const passengerLosses = valuation.passengers.map(passenger => ({ unitId: passenger.unitId,
    valueGold: passenger.catalogGold * (initial.has(passenger.unitId) ? 1 - successProbability : waitingSinkingProbability) }));
  return { status: 'known' as const, successProbability, waitingSinkingProbability, initialPassengerGold, waitingPassengerGold,
    hullLossGold, passengerLossGold, passengerLosses, expectedLossGold: hullLossGold + passengerLossGold };
}
