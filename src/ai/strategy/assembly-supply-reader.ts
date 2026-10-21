import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { createUnit } from '../../shared/map';
import { landSpawnPoint } from '../../shared/production-spawn';
import { trainingRecruitPrototype } from '../../shared/sim';
import { fnv1a } from '../../shared/sim/checksum';
import { standingBodies } from '../../shared/structure-bodies';
import { sameGround } from '../../shared/terrain';
import type { BootstrapAiVersion, GameSnapshot, TrainableUnitKind, Unit } from '../../shared/types';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import type { AssemblyFactsRequest } from './assembly-facts';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { calibratedAssemblySupply, type AssemblyProducerRoute } from './assembly-supply-calibration';
import { assessAllocatedForce } from './allocated-force';
import { forecastForceAssembly, type AssemblyJobRoute, type ForceAssemblyInput } from './force-assembly-forecast';
import { landIdAt } from './regions';
import { strategicTargetCamp } from './target-camp';
import { STRATEGY_PARAMETERS } from './utility';
import type { DecisionFacts } from './decision';
import type { Arrival, Situation, Target } from './types';

type Missing = Readonly<{ code: string; status: 'unknown' | 'unmet'; factIds: readonly string[] }>;
export type AssemblySpawnRequest = Readonly<{ id: string; buildingId: string; unitKind: TrainableUnitKind;
  geometryVersion: string; status: 'pending' | 'known'; from: { x: number; y: number }; goal: { x: number; y: number } }>;
const geometryKeys = new WeakMap<GameSnapshot, string>();
function spawnGeometry(snapshot: GameSnapshot) {
  let key = geometryKeys.get(snapshot);
  if (!key) {
    const terrain = snapshot.map.terrain;
    key = fnv1a(JSON.stringify([snapshot.map.width, snapshot.map.height, terrain?.cols, terrain?.rows, terrain?.cell, terrain?.cells,
      standingBodies(snapshot).map(body => [body.id, body.x, body.y, body.radius]).sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0)]));
    geometryKeys.set(snapshot, key);
  }
  return key;
}
export type AssemblyAssessmentCohort = Readonly<{ pathId: string; readyTick: number; units: readonly Unit[];
  realUnitIds: readonly string[]; sourceFactIds: readonly string[]; missing: readonly Missing[] }>;

/** Give assessment geometry its own query identity. A forecast position must
 * not hit the shared query's cache for this same live unit at its actual
 * position. Equivalent geometry across empirical paths deliberately shares
 * one numerical query, while evidence identities stay outside this key. */
export function assessmentArrival(read: AllocationArrivalReader, unit: Unit, target: Target): DecisionFacts<Arrival> {
  const proxy = { ...unit, id: `assembly-route:${unit.kind}:${unit.x},${unit.y}:${unit.speed}:${unit.radius}` };
  delete proxy.deck; delete proxy.cabin;
  return read(proxy, target);
}

/** Supply facts and future assessment copies only. No commands, grants,
 * real births, hidden free army, producer mutation or recovery promise. */
export function readAssemblySupply(input: Readonly<{ snapshot: GameSnapshot; situation: DecisionFacts<Situation>;
  version: BootstrapAiVersion; request: AssemblyFactsRequest; arrival: AllocationArrivalReader }>) {
  const { snapshot, request, arrival } = input, now = snapshot.tick, owner = request.objective.owner;
  const missing: Missing[] = [], camp = strategicTargetCamp(snapshot, request.campTarget);
  const posts = new Map(request.posts.map(post => [post.id, post]));
  const postAt = (unit: { x: number; y: number }) => request.posts.find(post => post.target.landId === landIdAt(snapshot.map, unit));
  const routes: AssemblyJobRoute[] = [], producerRoutes: AssemblyProducerRoute[] = [];
  const spawnRequests = new Map<string, AssemblySpawnRequest>();
  const combatant = (unit: Unit) => unit.kind !== 'worker' && unitMover(unit.kind) === 'land'
    && unit.hp > 0 && unit.attackDamage > 0 && unit.expiresTick === undefined;
  const routeCache = new Map<string, DecisionFacts<Arrival> | null>();
  const recruitRoute = (building: GameSnapshot['buildings'][number], kind: TrainableUnitKind) => {
    const key = `${building.id}/${kind}`;
    if (routeCache.has(key)) return routeCache.get(key)!;
    const post = postAt(building);
    const recruit = trainingRecruitPrototype(snapshot, building, { unitKind: kind, remaining: 0 });
    let pendingExit = false;
    const geometryVersion = spawnGeometry(snapshot);
    const rallyIdentity = building.rallyTarget ? JSON.stringify(building.rallyTarget) : `${building.rallyX},${building.rallyY}`;
    const requestId = `assembly-spawn:${building.id}:${kind}:${rallyIdentity}:${geometryVersion}`;
    const spawn = landSpawnPoint(snapshot, building, recruit, (from, goal) => {
      const origin = landIdAt(snapshot.map, from), targetLand = landIdAt(snapshot.map, goal);
      const fact = origin && targetLand && origin !== targetLand ? null
        : assessmentArrival(arrival, { ...recruit, x: from.x, y: from.y },
          { point: goal, ...(targetLand ? { landId: targetLand } : {}) });
      const pending = fact?.status === 'unknown';
      spawnRequests.set(requestId, { id: requestId, buildingId: building.id, unitKind: kind, geometryVersion,
        status: pending ? 'pending' : 'known', from: { ...from }, goal: { ...goal } });
      if (pending) { pendingExit = true; return undefined; }
      return fact !== null && fact.status === 'reachable' && !fact.crossings.length;
    });
    let result: DecisionFacts<Arrival> | null = null;
    if (!post || !spawn) missing.push({ code: !post ? 'assembly-producer-post-unknown' : pendingExit
      ? 'assembly-recruit-native-exit-route-pending' : 'assembly-recruit-native-exit-blocked',
      status: 'unknown', factIds: [building.id, kind] });
    else result = assessmentArrival(arrival, { ...recruit, x: spawn.x, y: spawn.y }, post.target);
    routeCache.set(key, result); return result;
  };
  for (const building of snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.complete)) {
    for (const kind of BUILDING_DEFS[building.kind].trains) {
      if (!combatant(trainingRecruitPrototype(snapshot, building, { unitKind: kind, remaining: 0 }))) continue;
      producerRoutes.push({ buildingId: building.id, unitKind: kind, arrival: recruitRoute(building, kind) });
    }
    for (const job of building.queue) if ('unitKind' in job && job.id && combatant(trainingRecruitPrototype(snapshot, building, job))) {
      const post = postAt(building);
      if (post) routes.push({ buildingId: building.id, jobId: job.id, postId: post.id, arrival: recruitRoute(building, job.unitKind) });
    }
  }
  const unitSupply: ForceAssemblyInput['unitSupply'] = request.unitIds.flatMap(id => {
    if (request.valuation?.allowedUnitIds && !request.valuation.allowedUnitIds.includes(id)) return [];
    const unit = snapshot.units.find(unit => unit.id === id && unit.owner === owner && combatant(unit));
    if (!unit || unit.deck || unit.cabin) return [];
    const post = request.posts.find(post => post.unitIds.includes(id)) ?? postAt(unit);
    if (!post) { missing.push({ code: 'assembly-member-post-unknown', status: 'unknown', factIds: [id] }); return []; }
    const here = sameGround(snapshot.map, unit, post.target.point)
      && Math.hypot(unit.x - post.target.point.x, unit.y - post.target.point.y) <= ASSEMBLY_RANGE;
    const travel: DecisionFacts<Arrival> = here ? { status: 'reachable', ticks: 0, landTicks: 0, crossings: [] }
      : arrival(unit, post.target);
    return [{ unitId: id, postId: post.id, source: 'assigned' as const, availableTick: now, arrival: travel }];
  });
  const calibration = calibratedAssemblySupply({ snapshot, owner, version: input.version,
    posts: request.posts, producerRoutes });
  const remainingQueue = Math.max(0, ...snapshot.buildings.filter(building => building.owner === owner)
    .map(building => building.queue.reduce((sum, job) => sum + Math.max(1, Math.ceil(job.remaining)), 0)));
  const throughTick = request.valuation?.window ? now + request.valuation.window.horizonTicks
    : Math.max(now + STRATEGY_PARAMETERS.utilityHorizonTicks + remainingQueue,
      ...calibration.alignments.map(alignment => alignment.supportThroughTick));
  const target = camp ? { metric: 'camp-force' as const, camp, requiredForce: request.requiredForce }
    : { metric: 'field-strength' as const, requiredForce: request.requiredForce };
  const forecastInput: ForceAssemblyInput = { snapshot, owner, rallies: request.posts, target, unitSupply, paidJobRoutes: routes,
    throughTick, conditionalProduction: calibration.status === 'known' ? calibration.model : null,
    unavailableUnitIds: [...new Set([...(request.interruptedUnitIds ?? []), ...(request.valuation?.unavailableUnitIds ?? [])])],
    ...(request.valuation?.allowedProduction ? { allowedProduction: request.valuation.allowedProduction } : {}),
    ...(request.valuation?.unavailableProduction ? { unavailableProduction: request.valuation.unavailableProduction } : {}) };
  let forecast = forecastForceAssembly(forecastInput);
  // Certain events can establish completion without an optional economic
  // sample. Otherwise missing calibration is unresolved mass, never a known
  // zero producer silently converted to needs-production.
  if (calibration.status === 'unknown' && forecast.completionProbability === 0) forecast = { ...forecast,
    status: 'unknown', probabilityBasis: 'proven-lower-bound', completionProbabilityBounds: { lower: 0, upper: 1 },
    diagnostics: { ...forecast.diagnostics, unresolvedProbability: 1 },
    missing: [...forecast.missing.filter(fact => fact.code !== 'needs-production'),
      ...calibration.missing.map(fact => ({ ...fact, status: 'unknown' as const }))] };
  const cohorts: AssemblyAssessmentCohort[] = forecast.fillScenarios.flatMap(path => {
    if (path.readyTick === null || path.probability <= 0) return [];
    const units: Unit[] = [], realUnitIds: string[] = [], sourceFactIds: string[] = [], pathMissing: Missing[] = [];
    const place = (unit: Unit, postId: string) => {
      const post = posts.get(postId);
      if (!post) { pathMissing.push({ code: 'assembly-assessment-post-unknown', status: 'unknown', factIds: [postId] }); return; }
      const projected = { ...unit, x: post.target.point.x, y: post.target.point.y,
        order: { type: 'hold' as const, x: post.target.point.x, y: post.target.point.y } };
      delete projected.deck; delete projected.cabin; delete projected.orderQueue;
      units.push(projected);
    };
    for (const supply of forecast.supplies.filter(supply => supply.readyTick <= path.readyTick!)) {
      if (supply.unitId) {
        const unit = snapshot.units.find(unit => unit.id === supply.unitId)!;
        place(unit, supply.postId); realUnitIds.push(unit.id); sourceFactIds.push(unit.id);
      } else if (supply.buildingId && supply.jobId) {
        const building = snapshot.buildings.find(building => building.id === supply.buildingId)!;
        const job = building.queue.find(job => job.id === supply.jobId);
        if (job && 'unitKind' in job) { const unit = trainingRecruitPrototype(snapshot, building, job);
          place({ ...unit, id: `assembly-assessment:${request.methodId}:${path.id}:paid:${building.id}:${job.id}` }, supply.postId);
          sourceFactIds.push(building.id, supply.jobId); }
      }
    }
    for (const selected of path.stockSelections ?? []) {
      const alignment = calibration.alignments.find(value => value.scenarioId === path.id && value.buildingId === selected.buildingId);
      const point = alignment?.points.find(point => point.tick === selected.sampleTick);
      if (!point || Math.abs(point.force - selected.force) > 1e-9) {
        pathMissing.push({ code: 'assembly-conditional-cohort-unquoted', status: 'unknown', factIds: [path.id, selected.buildingId] }); continue;
      }
      for (const [index, profile] of point.members.entries()) {
        const unit = { ...createUnit(`assembly-assessment:${request.methodId}:${path.id}:conditional:${selected.buildingId}:${index}`,
          owner, profile.kind, 0, 0), hp: profile.hp, maxHp: profile.maxHp, attackDamage: profile.attackDamage,
          attackCooldown: profile.attackCooldown, attackRange: profile.attackRange, speed: profile.speed, level: profile.level };
        place(unit, selected.postId);
      }
      sourceFactIds.push(selected.buildingId, path.id);
    }
    if (assessAllocatedForce(owner, units, target).force < request.requiredForce)
      pathMissing.push({ code: 'assembly-assessment-cohort-insufficient', status: 'unknown', factIds: units.map(unit => unit.id) });
    return [{ pathId: path.id, readyTick: path.readyTick, units, realUnitIds, sourceFactIds: [...new Set(sourceFactIds)], missing: pathMissing }];
  });
  if (!camp) missing.push({ code: 'assembly-target-camp-unobserved', status: 'unknown', factIds: [request.objective.id] });
  return { forecast, forecastInput, calibration, cohorts, missing, spawnRequests: [...spawnRequests.values()] };
}
