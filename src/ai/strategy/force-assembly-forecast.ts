import { unitMover } from '../../shared/catalog';
import { trainingRecruitPrototype } from '../../shared/sim';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { assessAllocatedForce, type AllocatedForceTarget } from './allocated-force';
import { canonicalProductionUses, productionUsesOverlap } from './production-use';
import type { DecisionFacts } from './decision';
import type { Arrival, ProductionUse, Target } from './types';

export type AssemblyUnitSupply = Readonly<{
  unitId: string; postId: string; source: 'assigned' | 'idle' | 'borrowed' | 'recovery';
  /** Same-think shared rally route, measured after this availability epoch. */
  availableTick: number; arrival: DecisionFacts<Arrival> | null;
  /** An actual service/return forecast, never assumed healing of every unit. */
  recovery?: Readonly<{ serviceId: string; hp: number }>;
}>;
export type AssemblyJobRoute = Readonly<{ buildingId: string; jobId: string; postId: string; arrival: DecisionFacts<Arrival> | null }>;
export type ConditionalAssemblyProduction = Readonly<{
  source: 'conditional-incumbent-production'; calibrationId: string; phase: string;
  /** Net available camp-force, after deaths, cancellations and other leases.
   * This residual rate excludes the explicit recovery events below. */
  producerRates: readonly Readonly<{ buildingId: string; postId: string; forcePerTick: number }>[];
  startsAtTick: number; completionProbability: number;
  timeMaeTicks: number; timeP90ErrorTicks: number; sampleCount: number;
}>;
export type ForceAssemblyInput = Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; rallies: readonly Readonly<{ id: string; target: Target }>[]; target: AllocatedForceTarget;
  unitSupply: readonly AssemblyUnitSupply[]; paidJobRoutes: readonly AssemblyJobRoute[];
  unavailableUnitIds?: readonly string[]; allowedProduction?: readonly Pick<ProductionUse, 'buildingId' | 'lane'>[];
  unavailableProduction?: readonly ProductionUse[];
  throughTick: number; conditionalProduction: ConditionalAssemblyProduction | null;
}>;
type Supply = Readonly<{
  source: AssemblyUnitSupply['source'] | 'paid-job'; unitId: string | null;
  buildingId: string | null; jobId: string | null; postId: string; readyTick: number;
}>;
type Missing = Readonly<{ code: string; status: 'unknown' | 'unmet'; factIds: readonly string[] }>;
type ForcePoint = Readonly<{ tick: number; force: number; unitIds: readonly string[]; jobIds: readonly string[] }>;
export type ForceAssemblyForecast = Readonly<{
  status: 'ready' | 'gathering' | 'blocked' | 'unknown'; forecastTick: number; readyTick: number | null;
  requiredForce: number; assignedForce: number; atRallyForce: number; certainForce: number; deficit: number;
  completionProbability: number; conditionalForce: number; conditionalProduction: ConditionalAssemblyProduction | null;
  conditionalSegments: readonly Readonly<{ fromTick: number; throughTick: number; forcePerTick: number; producerIds: readonly string[] }>[];
  certainReadyTick: number | null; supplies: readonly Supply[]; forceCurve: readonly ForcePoint[];
  production: readonly ProductionUse[]; missing: readonly Missing[];
}>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const finite = (n: number, label: string) => {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid assembly ${label}`);
  return n;
};
const combatant = (unit: Unit) => unit.hp > 0 && unit.kind !== 'worker' && unitMover(unit.kind) === 'land'
  && unit.expiresTick === undefined && unit.attackDamage > 0;

/** Forecast supply, not authority. Live members keep real IDs; a paid job is
 * assessed with native upgraded stats but remains a job in every output. No
 * navigation, training command, payment, queue mutation or birth is performed. */
export function forecastForceAssembly(input: ForceAssemblyInput): ForceAssemblyForecast {
  const { snapshot, owner, target } = input, now = snapshot.tick;
  finite(now, 'epoch'); finite(input.throughTick, 'horizon');
  if (input.throughTick < now) throw new Error('Assembly horizon precedes forecast');
  const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const unavailable = new Set(input.unavailableUnitIds ?? []), seen = new Set<string>();
  const rallies = new Map(input.rallies.map(post => [post.id, post.target]));
  if (rallies.size !== input.rallies.length) throw new Error('Duplicate assembly post');
  const missing: Missing[] = [], conditionalUses: ProductionUse[] = [];
  const paidUses = new Map<string, ProductionUse>();
  const events: { supply: Supply; unit: Unit }[] = [], assigned: Unit[] = [], stationed: Unit[] = [];
  const add = (supply: Supply, unit: Unit) => { events.push({ supply, unit }); };
  const travel = (arrival: DecisionFacts<Arrival> | null, code: string, factIds: string[]) => {
    if (!arrival || arrival.status === 'unknown') { missing.push({ code, status: 'unknown', factIds }); return null; }
    if (arrival.status !== 'reachable' || arrival.crossings.length) {
      missing.push({ code: 'assembly-post-route-unreachable', status: 'unmet', factIds }); return null;
    }
    return finite(arrival.ticks, 'travel');
  };
  for (const entry of [...input.unitSupply].sort((a, b) => compare(a.unitId, b.unitId))) {
    if (seen.has(entry.unitId)) throw new Error(`Duplicate assembly member ${entry.unitId}`);
    seen.add(entry.unitId); finite(entry.availableTick, 'availability');
    if (unavailable.has(entry.unitId)) continue;
    const unit = units.get(entry.unitId);
    if (!unit || unit.owner !== owner || !combatant(unit)) continue;
    const rally = rallies.get(entry.postId);
    if (!rally) throw new Error(`Missing assembly post ${entry.postId}`);
    if (entry.source === 'assigned') assigned.push(unit);
    const atRally = !unit.deck && !unit.cabin && sameGround(snapshot.map, unit, rally.point)
      && Math.hypot(unit.x - rally.point.x, unit.y - rally.point.y) <= 180;
    if (entry.source === 'assigned' && atRally && entry.availableTick <= now) stationed.push(unit);
    const travelTicks = travel(entry.arrival, 'assembly-member-arrival-unknown', [unit.id, entry.postId]);
    if (travelTicks === null) continue;
    let projected = unit;
    if (entry.source === 'recovery') {
      const service = entry.recovery;
      if (!service || !service.serviceId || !Number.isFinite(service.hp) || service.hp < unit.hp || service.hp > unit.maxHp) {
        missing.push({ code: 'assembly-recovery-return-unquoted', status: 'unknown', factIds: [unit.id] }); continue;
      }
      projected = { ...unit, hp: service.hp };
    }
    add({ source: entry.source, unitId: unit.id, buildingId: null, jobId: null, postId: entry.postId,
      readyTick: Math.max(now, entry.availableTick) + travelTicks }, projected);
  }
  const routes = new Map<string, AssemblyJobRoute>();
  for (const route of input.paidJobRoutes) {
    const key = `${route.buildingId}\0${route.jobId}`;
    if (routes.has(key)) throw new Error(`Duplicate assembly job route ${route.jobId}`);
    if (!rallies.has(route.postId)) throw new Error(`Missing recruit assembly post ${route.postId}`);
    routes.set(key, route);
  }
  const excluded = canonicalProductionUses(input.unavailableProduction);
  let paidPipelineUntil = now;
  for (const building of [...snapshot.buildings].sort((a, b) => compare(a.id, b.id))) {
    if (building.owner !== owner || building.hp <= 0) continue;
    let next = 0;
    for (const job of building.queue) {
      const fromTicks = next;
      // Native updateTraining completes at most one job per building per tick.
      next += Math.max(1, Math.ceil(finite(job.remaining, 'job remaining')));
      if (!('unitKind' in job)) continue;
      const recruit = trainingRecruitPrototype(snapshot, building, job);
      if (!combatant(recruit)) continue;
      if (!job.id) { missing.push({ code: 'assembly-paid-job-id-unknown', status: 'unknown', factIds: [building.id] }); continue; }
      const use: ProductionUse = { buildingId: building.id, lane: 'training', fromTicks, throughTicks: next };
      if (input.allowedProduction && !input.allowedProduction.some(lane => lane.buildingId === building.id && lane.lane === 'training')
        || productionUsesOverlap([use], excluded)) continue;
      if (!building.complete) {
        missing.push({ code: 'assembly-producer-readiness-unknown', status: 'unknown', factIds: [building.id, job.id] }); continue;
      }
      const route = routes.get(`${building.id}\0${job.id}`);
      const travelTicks = travel(route?.arrival ?? null, 'assembly-recruit-arrival-unknown', [building.id, job.id]);
      if (!route || travelTicks === null) continue;
      const readyTick = now + next + travelTicks;
      paidPipelineUntil = Math.max(paidPipelineUntil, readyTick);
      paidUses.set(`${building.id}\0${job.id}`, use);
      add({ source: 'paid-job', unitId: null, buildingId: building.id, jobId: job.id, postId: route.postId, readyTick }, recruit);
    }
  }
  events.sort((a, b) => a.supply.readyTick - b.supply.readyTick || compare(a.unit.id, b.unit.id));
  const force = (cohort: readonly Unit[]) => assessAllocatedForce(owner, cohort, target).force;
  const requiredForce = assessAllocatedForce(owner, [], target).requiredForce;
  const cohort: Unit[] = [], forceCurve: ForcePoint[] = [];
  let certainReadyTick: number | null = null, certainForce = 0;
  for (let index = 0; index < events.length;) {
    const tick = events[index]!.supply.readyTick;
    if (tick > input.throughTick) break;
    do { cohort.push(events[index++]!.unit); } while (index < events.length && events[index]!.supply.readyTick === tick);
    certainForce = force(cohort);
    const included = events.slice(0, index).map(event => event.supply);
    forceCurve.push({ tick, force: certainForce, unitIds: included.flatMap(supply => supply.unitId ? [supply.unitId] : []).sort(),
      jobIds: included.flatMap(supply => supply.jobId ? [supply.jobId] : []).sort() });
    if (certainReadyTick === null && certainForce >= requiredForce) certainReadyTick = tick;
  }
  const conditional = input.conditionalProduction;
  if (conditional) {
    for (const key of ['startsAtTick', 'completionProbability', 'timeMaeTicks', 'timeP90ErrorTicks', 'sampleCount'] as const)
      finite(conditional[key], `conditional ${key}`);
    if (!conditional.calibrationId || conditional.completionProbability > 1 || conditional.startsAtTick < now)
      throw new Error('Invalid conditional assembly calibration/epoch');
  }
  // The historical rate includes ordinary queue births. Start its residual
  // after the explicit paid pipeline so those births cannot be counted twice.
  const startsAt = Math.max(now, paidPipelineUntil, conditional?.startsAtTick ?? now);
  let readyTick = certainReadyTick, conditionalForce = 0;
  const producerIds = new Set<string>();
  const rates = (conditional?.producerRates ?? []).filter(rate => {
    finite(rate.forcePerTick, 'producer growth');
    if (producerIds.has(rate.buildingId) || !rallies.has(rate.postId)) throw new Error('Invalid conditional assembly producer/post');
    producerIds.add(rate.buildingId);
    const building = snapshot.buildings.find(building => building.id === rate.buildingId);
    return building && building.owner === owner && building.hp > 0 && building.complete
      && (!input.allowedProduction || input.allowedProduction.some(lane => lane.buildingId === rate.buildingId && lane.lane === 'training'));
  });
  const conditionalSegments: { fromTick: number; throughTick: number; forcePerTick: number; producerIds: string[] }[] = [];
  if (conditional && rates.length) {
    const boundaries = [...new Set([startsAt, input.throughTick, ...forceCurve.map(point => point.tick),
      ...excluded.filter(use => use.lane === 'training').flatMap(use => [now + use.fromTicks, now + use.throughTicks])])]
      .filter(tick => tick >= startsAt && tick <= input.throughTick).sort((a, b) => a - b);
    let accumulated = 0;
    for (let index = 0; index + 1 < boundaries.length; index++) {
      const fromTick = boundaries[index]!, throughTick = boundaries[index + 1]!;
      const available = rates.filter(rate => !productionUsesOverlap([{ buildingId: rate.buildingId, lane: 'training',
        fromTicks: fromTick - now, throughTicks: throughTick - now }], excluded));
      const forcePerTick = available.reduce((sum, rate) => sum + rate.forcePerTick, 0);
      conditionalSegments.push({ fromTick, throughTick, forcePerTick, producerIds: available.map(rate => rate.buildingId).sort() });
      const known = forceCurve.filter(point => point.tick <= fromTick).at(-1)?.force ?? 0;
      const deficit = Math.max(0, requiredForce - known - accumulated);
      const at = deficit === 0 ? fromTick : forcePerTick > 0 ? fromTick + Math.ceil(deficit / forcePerTick) : null;
      if (at !== null && at <= throughTick && (readyTick === null || at < readyTick)) readyTick = at;
      accumulated += forcePerTick * (throughTick - fromTick);
      for (const rate of available) if (rate.forcePerTick > 0) conditionalUses.push({ buildingId: rate.buildingId,
        lane: 'training', fromTicks: fromTick - now, throughTicks: throughTick - now });
    }
    if (readyTick !== null) {
      const predictedTick = readyTick;
      conditionalForce = Math.max(0, requiredForce - (forceCurve.filter(point => point.tick <= predictedTick).at(-1)?.force ?? 0));
    }
  }
  const atRallyForce = force(stationed), deficit = Math.max(0, requiredForce - certainForce);
  const status = atRallyForce >= requiredForce ? 'ready' : readyTick !== null ? 'gathering'
    : missing.some(fact => fact.status === 'unknown') ? 'unknown' : 'blocked';
  if (status === 'blocked' && deficit > 0) missing.push({ code: 'needs-production', status: 'unmet', factIds: [] });
  const resolvedReadyTick = status === 'ready' ? now : readyTick, cutoff = resolvedReadyTick ?? input.throughTick;
  const usedPaid = events.filter(event => event.supply.source === 'paid-job' && event.supply.readyTick <= cutoff)
    .map(event => paidUses.get(`${event.supply.buildingId}\0${event.supply.jobId}`)!);
  const usedConditional = conditionalForce > 0 ? conditionalUses.flatMap(use => {
    const throughTicks = Math.min(use.throughTicks, cutoff - now);
    return throughTicks > use.fromTicks ? [{ ...use, throughTicks }] : [];
  }) : [];
  return { status, forecastTick: now, readyTick: resolvedReadyTick, requiredForce,
    assignedForce: force(assigned), atRallyForce, certainForce, deficit,
    completionProbability: readyTick === null && status !== 'ready' ? 0 : conditionalForce > 0 ? conditional!.completionProbability : 1,
    conditionalForce, conditionalProduction: conditional, conditionalSegments, certainReadyTick,
    supplies: events.map(event => event.supply), forceCurve, production: canonicalProductionUses([...usedPaid, ...usedConditional]), missing };
}
