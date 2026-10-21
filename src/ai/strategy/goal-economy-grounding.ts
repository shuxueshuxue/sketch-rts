import { BUILDING_DEFS, RACE_DEFS, trainingBuildingFor, unitMover } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { footprintCells, snapToFootprint } from '../../shared/terrain';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { BuildingKind } from '../../shared/types';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalGeometryReader, GoalGeometryRequest } from './goal-grounding-ports';
import type { GoalBuildSite, GoalEntityReference, GoalEstimate, GoalGroundingReader,
  GoalPlanningContext, GoalProductionOption } from './goal-planner-types';
import type { LandId, Point, SeaId, Target } from './types';

export const GOAL_BUILD_SITE_LIMIT = 8;
type BuildPoint = Readonly<{ at: Target; approach: Target }>;
export type GoalBuildPointCursor = Readonly<{ foundationIndex: number; ring: number; offset: number; points: readonly BuildPoint[] }>;
export type GoalEconomicGroundingPorts = Readonly<{
  /** The central source schedules/checkpoints/publishes this work. */
  geometry: GoalGeometryReader; geometryRevision: string;
  /** A view of the already prepared native mover-region index, never a route
   * solver or a request to finish an entire shoreline scan. */
  regionAt: (point: Point, mover: 'land' | 'sea') => LandId | SeaId | undefined;
}>;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const why = (code: string, factIds: readonly string[] = []) => ({ code, factIds, values: {} });

function footprintRegions(context: GoalPlanningContext, kind: BuildingKind, point: Point, ports: Pick<GoalEconomicGroundingPorts, 'regionAt'>) {
  const cell = context.snapshot.map.terrain?.cell, footprint = cell ? footprintCells(cell, point.x, point.y, BUILDING_DEFS[kind].radius) : null;
  const cells: Point[] = [];
  if (footprint && cell) for (let y = footprint.top; y <= footprint.bottom; y++) for (let x = footprint.left; x <= footprint.right; x++)
    cells.push({ x: (x + .5) * cell, y: (y + .5) * cell });
  else cells.push(point);
  const lands = cells.map(at => ({ at, id: ports.regionAt(at, 'land') })).filter(value => value.id?.startsWith('land:'));
  const seas = [...new Set(cells.flatMap(at => { const id = ports.regionAt(at, 'sea'); return id?.startsWith('sea:') ? [id as SeaId] : []; }))].sort(order);
  return { lands, seas };
}

/** A finite geometric search. One native placement/footprint candidate is one
 * logical check; allowance=0 does no geometry. All retained state is bounded
 * JSON. Native route selection and whole-map shoreSpots/miningHallSite scans
 * are deliberately absent. */
export function goalBuildPointRequest(context: GoalPlanningContext, buildingKind: BuildingKind, near: Target,
  ports: Pick<GoalEconomicGroundingPorts, 'geometryRevision' | 'regionAt'>): GoalGeometryRequest<GoalBuildPointCursor, readonly BuildPoint[]> {
  const { snapshot, owner } = context, rules = BUILDING_DEFS[buildingKind], cell = snapshot.map.terrain?.cell ?? 16;
  const center = snapToFootprint(snapshot.map, rules.radius, near.point);
  const mine = buildingKind === 'townHall' && near.entityId
    ? snapshot.resources.find(resource => resource.id === near.entityId && resource.amount > 0) : undefined;
  const maxRing = mine ? Math.ceil(GOLD_MINE_RULES.baseRange / cell) + 1
    : Math.ceil(Math.max(center.x, snapshot.map.width - center.x, center.y, snapshot.map.height - center.y) / cell) + 1;
  const allowed = !!snapshot.players[owner] && RACE_DEFS[snapshot.players[owner]!.race].buildableBuildings.includes(buildingKind);
  const key = `geometry:build:${goalValueKey([owner, buildingKind, near])}`;
  return { key, revision: ports.geometryRevision, initialState: { foundationIndex: 0, ring: 0, offset: 0, points: [] },
    advance(previous, allowance) {
      if (!Number.isSafeInteger(allowance) || allowance < 0) throw Error('Invalid build geometry allowance');
      if (!allowed) return { state: previous, work: 0, done: true, value: [] };
      let foundationIndex = previous.foundationIndex, ring = previous.ring, offset = previous.offset, work = 0;
      const points = [...previous.points];
      while (work < allowance && ring <= maxRing && points.length < GOAL_BUILD_SITE_LIMIT) {
        // Existing paid foundations are real candidates, not fresh clear
        // footprints. Inspect one existing building per work unit as well.
        const foundation = foundationIndex < snapshot.buildings.length ? snapshot.buildings[foundationIndex++] : undefined;
        let dx = 0, dy = 0;
        if (ring) {
          if (offset < ring * 2) { dx = -ring + offset; dy = -ring; }
          else if (offset < ring * 4) { dx = ring; dy = -ring + offset - ring * 2; }
          else if (offset < ring * 6) { dx = ring - (offset - ring * 4); dy = ring; }
          else { dx = -ring; dy = ring - (offset - ring * 6); }
        }
        const point = foundation ? { x: foundation.x, y: foundation.y } : { x: center.x + dx * cell, y: center.y + dy * cell };
        work++;
        if (foundation) {
          if (foundation.owner !== owner || foundation.kind !== buildingKind || foundation.hp <= 0 || foundation.complete) continue;
        } else {
          offset++;
          if (offset >= (ring ? ring * 8 : 1)) { ring++; offset = 0; }
        }
        if (point.x - rules.radius < 0 || point.y - rules.radius < 0
          || point.x + rules.radius > snapshot.map.width || point.y + rules.radius > snapshot.map.height
          || mine && Math.hypot(point.x - mine.x, point.y - mine.y) > GOLD_MINE_RULES.baseRange
          || !foundation && !isBuildPlacementClear(snapshot, buildingKind, point)) continue;
        const regions = footprintRegions(context, buildingKind, point, ports);
        const lands = regions.lands.filter(value => !near.landId || value.id === near.landId), seas = regions.seas;
        if (!lands.length || rules.shore && (!seas.length || near.seaId && !seas.includes(near.seaId))) continue;
        lands.sort((a, b) => Math.hypot(a.at.x - point.x, a.at.y - point.y) - Math.hypot(b.at.x - point.x, b.at.y - point.y)
          || order(a.id!, b.id!) || a.at.y - b.at.y || a.at.x - b.at.x);
        const landId = lands[0]!.id as LandId, seaId = rules.shore ? near.seaId ?? [...new Set(seas)].sort(order)[0] : undefined;
        // The center of a valid yard can be water. Its worker's land and
        // walkable approach are retained separately from the native build point.
        const at: Target = { point, landId, ...(foundation ? { entityId: foundation.id } : {}), ...(seaId ? { seaId } : {}) };
        points.push({ at, approach: { landId, point: lands[0]!.at } });
      }
      const done = ring > maxRing || points.length >= GOAL_BUILD_SITE_LIMIT;
      const state = { foundationIndex, ring, offset, points };
      return { state, work, done, ...(done ? { value: points } : {}) };
    } };
}

function walkEstimate(observation: ReturnType<GoalPlanningContext['readFact']>): GoalEstimate<number> {
  if (observation.state === 'pending') return { state: 'pending', requestIds: [observation.requestId], reason: observation.reason };
  if (observation.state === 'unmet') return { state: 'unmet', reason: observation.reason };
  const ticks = observation.route?.ticks;
  return ticks !== null && ticks !== undefined && Number.isFinite(ticks) && ticks >= 0
    ? { state: 'met', value: ticks, factIds: [observation.fact.id] }
    : { state: 'unmet', reason: why('build-route-time-unavailable', [observation.fact.id]) };
}

/** Economics owns the domain rules; the one owner-think source owns all
 * geometry publication and route facts. This factory creates no query, queue,
 * private budget, evaluator world or persistent memory. */
export function createGoalEconomicGrounding(context: GoalPlanningContext, ports: GoalEconomicGroundingPorts):
  Pick<GoalGroundingReader, 'buildSites' | 'productionOptions'> {
  const { snapshot, owner } = context, byTick = context.tick + context.situation.horizonTicks;
  function points(kind: BuildingKind, near: Target) { return ports.geometry(goalBuildPointRequest(context, kind, near, ports)); }
  const buildSites: GoalGroundingReader['buildSites'] = (kind, near) => {
    const result = points(kind, near);
    if (result.state !== 'met') return result;
    const candidates: GoalBuildSite[] = [];
    for (const point of result.value) {
      const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && unit.hp > 0
        && !unit.deck && !unit.cabin && ports.regionAt(unit, 'land') === point.at.landId).sort((a, b) => order(a.id, b.id));
      const actors: { ref: GoalEntityReference; from: Target }[] = workers.map(unit => ({ ref: { kind: 'existing', entityId: unit.id },
        from: { landId: point.at.landId!, point: { x: unit.x, y: unit.y } } }));
      if (!actors.length) actors.push({ ref: { kind: 'binding', name: `worker:${point.at.landId}` },
        from: { landId: point.at.landId!, point: near.point } });
      for (const actor of actors) {
        const route = goalFact({ kind: 'route', mover: 'land', from: actor.from, to: point.approach, actor: actor.ref });
        const site = goalFact({ kind: 'build-site', buildingKind: kind, at: point.at });
        const worker = goalFact({ kind: 'worker-at', at: point.at, count: 1, byTick, worker: actor.ref });
        candidates.push({ id: `build-site:${goalValueKey([site.id, actor.ref])}`, buildingKind: kind, logicalTarget: near,
          at: point.at, worker: actor.ref, route,
          walkTicks: actor.ref.kind === 'binding' ? { state: 'pending', requestIds: [`worker-route:${route.id}`],
            reason: why('build-worker-binding-pending', [worker.id, route.id]) } : walkEstimate(context.readFact(route)),
          preconditions: point.at.entityId ? [worker] : [site, worker], factIds: [...result.factIds, site.id, worker.id, route.id] });
      }
    }
    return { state: 'met', candidates, factIds: result.factIds };
  };
  const productionOptions: GoalGroundingReader['productionOptions'] = (unitKind, near) => {
    const race = snapshot.players[owner]?.race, kind = race && trainingBuildingFor(race, unitKind);
    if (!kind) return { state: 'unmet', reason: why('race-has-no-native-production', [unitKind]) };
    const candidates: GoalProductionOption[] = [];
    for (const building of snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.kind === kind)
      .sort((a, b) => order(a.id, b.id))) {
      const regions = footprintRegions(context, kind, building, ports);
      const landId = regions.lands[0]?.id;
      const observedSeas = regions.seas;
      if (unitMover(unitKind) === 'land' && near.landId && landId !== near.landId
        || unitMover(unitKind) === 'sea' && near.seaId && !observedSeas.includes(near.seaId)) continue;
      const producer: GoalEntityReference = { kind: 'existing', entityId: building.id };
      const at: Target = { entityId: building.id, point: { x: building.x, y: building.y },
        ...(landId?.startsWith('land:') ? { landId: landId as LandId } : {}),
        ...(unitMover(unitKind) === 'sea' && (near.seaId ?? observedSeas[0]) ? { seaId: (near.seaId ?? observedSeas[0])! } : {}) };
      candidates.push({ id: `producer:${building.id}`, buildingKind: kind, producer, at,
        preconditions: [goalFact({ kind: 'building-complete', buildingKind: kind, at, building: producer })],
        // Queue work alone cannot prove legal birth/free-lane time. The
        // common production fact keeps occupied/incomplete producers pending.
        availableTick: building.complete && !building.queue.length ? context.tick : null, factIds: [building.id] });
    }
    const future = points(kind, near);
    if (future.state === 'met') for (const point of future.value) {
      if (point.at.entityId) continue; // already emitted as an existing producer above
      const producer: GoalEntityReference = { kind: 'binding', name: `producer:${kind}:${goalValueKey(point.at)}` };
      const complete = goalFact({ kind: 'building-complete', buildingKind: kind, at: point.at, building: producer });
      candidates.push({ id: `future-producer:${complete.id}`, buildingKind: kind, producer, at: point.at,
        preconditions: [complete], availableTick: null, factIds: [...future.factIds, complete.id] });
    }
    // Existing concrete producers remain usable while optional new sites are
    // pending. The separate build goal retains that missing geometry request.
    if (candidates.length) return { state: 'met', candidates, factIds: candidates.flatMap(candidate => candidate.factIds),
      ...(future.state === 'pending' ? { deferred: [{ id: `future-producer:${kind}:${goalValueKey(near)}`,
        requestIds: future.requestIds, reason: future.reason }] } : {}) };
    return future.state === 'met' ? { state: 'met', candidates: [], factIds: future.factIds } : future;
  };
  return { buildSites, productionOptions };
}
