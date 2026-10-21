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
export type ConditionalAssemblyProducer = Readonly<{ buildingId: string; postId: string; startsAtTick: number }> & (
  | Readonly<{ kind: 'conditional-rate'; forcePerTick: number }>
  | Readonly<{ kind: 'stock-curve'; points: readonly Readonly<{ tick: number; force: number }>[]; throughTick: number }>
);
export type ConditionalAssemblyScenario = Readonly<{
  id: string; probability: number; producers: readonly ConditionalAssemblyProducer[];
}>;
export type ConditionalAssemblyProduction = Readonly<{
  source: 'conditional-incumbent-production'; model: 'joint-hurdle'; forceBasis: 'combatRating';
  calibrationId: string; phase: string;
  /** Joint empirical paths preserve cross-producer dependence and zero-supply
   * mass. Rates, when supplied, are success-conditioned, never unconditional
   * average growth divided into a deficit and penalised by failure again. */
  scenarios: readonly ConditionalAssemblyScenario[];
  timeMaeTicks: number; timeP90ErrorTicks: number; sampleCount: number;
}>;
export const ASSEMBLY_SCENARIO_LIMIT = 64;
export type AssemblyFillScenario = Readonly<{
  id: string; probability: number; readyTick: number | null; conditionalForce: number;
  production: readonly ProductionUse[];
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
  fillScenarios: readonly AssemblyFillScenario[];
  diagnostics: Readonly<{ scenarioCount: number; scenarioLimitCount: number; unresolvedProbability?: number }>;
  completionProbabilityBounds?: Readonly<{ lower: number; upper: number }>;
  probabilityBasis?: 'exact' | 'proven-lower-bound';
  conditionalSegments: readonly Readonly<{ scenarioId: string; fromTick: number; throughTick: number; forcePerTick: number; producerIds: readonly string[] }>[];
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
  const missing: Missing[] = [];
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
  const paidPipelineUntil = new Map<string, number>();
  for (const building of [...snapshot.buildings].sort((a, b) => compare(a.id, b.id))) {
    if (building.owner !== owner || building.hp <= 0) continue;
    let next = 0;
    for (const job of building.queue) {
      const fromTicks = next;
      // Native updateTraining completes at most one job per building per tick.
      next += Math.max(1, Math.ceil(finite(job.remaining, 'job remaining')));
      // Queue work occupies this producer even if its output has no known
      // route, is a worker/upgrade, or belongs to another candidate.
      paidPipelineUntil.set(building.id, Math.max(paidPipelineUntil.get(building.id) ?? now, now + next));
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
      paidPipelineUntil.set(building.id, Math.max(paidPipelineUntil.get(building.id) ?? now, readyTick));
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
  const conditional = input.conditionalProduction, atRallyForce = force(stationed);
  const deficit = Math.max(0, requiredForce - certainForce);
  const base = { forecastTick: now, requiredForce, assignedForce: force(assigned), atRallyForce, certainForce, deficit,
    conditionalProduction: conditional, certainReadyTick, supplies: events.map(event => event.supply), forceCurve };
  const diagnostic = { scenarioCount: conditional?.scenarios.length ?? 0, scenarioLimitCount: 0 };
  // This is a quote-local failure, never an exception from a player's think.
  // Keep certain facts and the explicit cause for audit/trace aggregation.
  if (conditional && conditional.scenarios.length > ASSEMBLY_SCENARIO_LIMIT) return { ...base,
    status: 'unknown', readyTick: null, completionProbability: 0, conditionalForce: 0,
    fillScenarios: [], conditionalSegments: [], production: [],
    diagnostics: { ...diagnostic, scenarioLimitCount: 1, unresolvedProbability: 1 },
    completionProbabilityBounds: { lower: 0, upper: 1 },
    missing: [...missing, { code: 'scenario-limit', status: 'unknown', factIds: [conditional.calibrationId] }] };
  if (conditional) {
    for (const key of ['timeMaeTicks', 'timeP90ErrorTicks', 'sampleCount'] as const) finite(conditional[key], `conditional ${key}`);
    if (!conditional.calibrationId || conditional.model !== 'joint-hurdle' || conditional.forceBasis !== 'combatRating')
      throw new Error('Invalid conditional assembly calibration');
    const ids = new Set<string>(); let probability = 0;
    for (const scenario of conditional.scenarios) {
      finite(scenario.probability, 'scenario probability');
      if (!scenario.id || ids.has(scenario.id) || scenario.probability > 1) throw new Error('Invalid assembly scenario');
      ids.add(scenario.id); probability += scenario.probability;
    }
    if (Math.abs(probability - 1) > 1e-9) throw new Error('Invalid assembly scenario probability mass');
  }
  type Segment = ForceAssemblyForecast['conditionalSegments'][number];
  const conditionalSegments: Segment[] = [];
  const unresolved = new Set<string>();
  const knownForce = (tick: number) => forceCurve.filter(point => point.tick <= tick).at(-1)?.force ?? 0;
  const evaluate = (scenario: ConditionalAssemblyScenario): AssemblyFillScenario => {
    const producerIds = new Set<string>();
    const producers = [...scenario.producers].sort((a, b) => compare(a.buildingId, b.buildingId)).filter(producer => {
      finite(producer.startsAtTick, 'producer epoch');
      if (producer.startsAtTick < now || producerIds.has(producer.buildingId) || !rallies.has(producer.postId))
        throw new Error('Invalid conditional assembly producer/post');
      producerIds.add(producer.buildingId);
      if (producer.kind === 'conditional-rate') finite(producer.forcePerTick, 'conditional producer speed');
      else {
        finite(producer.throughTick, 'conditional support'); let last = producer.startsAtTick - 1;
        if (producer.throughTick < producer.startsAtTick) throw new Error('Invalid assembly curve support');
        for (const point of producer.points) {
          finite(point.tick, 'conditional sample epoch'); finite(point.force, 'conditional sample force');
          if (point.tick <= last || point.tick > producer.throughTick) throw new Error('Invalid assembly curve ordering/support');
          last = point.tick;
        }
      }
      const building = snapshot.buildings.find(building => building.id === producer.buildingId);
      if (!building || building.owner !== owner || building.hp <= 0 || !building.complete
        || input.allowedProduction && !input.allowedProduction.some(lane => lane.buildingId === building.id && lane.lane === 'training')) return false;
      // A historical stock column cannot attribute partial-lane occupancy to
      // individual future births. Remove that column conservatively; do not
      // retain its stock while pricing its producer as unavailable.
      return producer.kind !== 'stock-curve' || !productionUsesOverlap([{ buildingId: building.id, lane: 'training',
        fromTicks: 0, throughTicks: input.throughTick - now }], excluded);
    });
    const start = (producer: ConditionalAssemblyProducer) => Math.max(producer.startsAtTick, paidPipelineUntil.get(producer.buildingId) ?? now);
    const shift = (producer: ConditionalAssemblyProducer) => start(producer) - producer.startsAtTick;
    const curves = producers.filter((producer): producer is Extract<ConditionalAssemblyProducer, { kind: 'stock-curve' }> => producer.kind === 'stock-curve');
    const stockForProducer = (producer: typeof curves[number], tick: number) => {
      const unshifted = tick - shift(producer);
      if (unshifted < producer.startsAtTick || unshifted > producer.throughTick) return 0;
      return producer.points.filter(point => point.tick <= unshifted).at(-1)?.force ?? 0;
    };
    const stock = (tick: number) => curves.reduce((sum, producer) => sum + stockForProducer(producer, tick), 0);
    const boundaries = [...new Set([now, input.throughTick, ...forceCurve.map(point => point.tick),
      ...producers.map(start), ...curves.flatMap(producer => [...producer.points.map(point => point.tick + shift(producer)),
        producer.throughTick + shift(producer) + 1]),
      ...excluded.filter(use => use.lane === 'training').flatMap(use => [now + use.fromTicks, now + use.throughTicks])])]
      .filter(tick => tick >= now && tick <= input.throughTick).sort((a, b) => a - b);
    const uses: ProductionUse[] = [];
    let accumulated = 0, readyTick: number | null = null, conditionalForce = 0;
    for (let index = 0; index < boundaries.length; index++) {
      const fromTick = boundaries[index]!, throughTick = boundaries[index + 1] ?? fromTick;
      const available = producers.filter((producer): producer is Extract<ConditionalAssemblyProducer, { kind: 'conditional-rate' }> =>
        producer.kind === 'conditional-rate' && fromTick >= start(producer)
        && !productionUsesOverlap([{ buildingId: producer.buildingId, lane: 'training', fromTicks: fromTick - now,
          throughTicks: throughTick - now }], excluded));
      const forcePerTick = available.reduce((sum, producer) => sum + producer.forcePerTick, 0);
      if (throughTick > fromTick) conditionalSegments.push({ scenarioId: scenario.id, fromTick, throughTick, forcePerTick,
        producerIds: available.map(producer => producer.buildingId).sort() });
      const present = knownForce(fromTick) + stock(fromTick) + accumulated;
      const remaining = Math.max(0, requiredForce - present);
      const at = remaining === 0 ? fromTick : forcePerTick > 0 ? fromTick + Math.ceil(remaining / forcePerTick) : null;
      if (at !== null && at <= throughTick && readyTick === null
        && knownForce(at) + stock(at) + accumulated + forcePerTick * (at - fromTick) >= requiredForce) {
        readyTick = at; conditionalForce = stock(at) + accumulated + forcePerTick * (at - fromTick);
      }
      accumulated += forcePerTick * (throughTick - fromTick);
      for (const producer of available) if (producer.forcePerTick > 0 && throughTick > fromTick) uses.push({
        buildingId: producer.buildingId, lane: 'training', fromTicks: fromTick - now, throughTicks: throughTick - now });
    }
    // A sampled series has finite support. A longer comparison window is not
    // evidence that its final inventory persists or that production continues.
    if (readyTick === null && scenario.probability > 0) for (const producer of curves)
      if (producer.throughTick + shift(producer) < input.throughTick) {
        unresolved.add(scenario.id);
        missing.push({ code: 'assembly-conditional-support-exhausted', status: 'unknown', factIds: [scenario.id, producer.buildingId] });
      }
    const cutoff = readyTick ?? input.throughTick;
    for (const producer of curves) if (readyTick !== null && stockForProducer(producer, readyTick) > 0 && start(producer) < cutoff)
      uses.push({ buildingId: producer.buildingId, lane: 'training', fromTicks: start(producer) - now,
        throughTicks: Math.min(cutoff, producer.throughTick + shift(producer)) - now });
    const paid = events.filter(event => event.supply.source === 'paid-job' && event.supply.readyTick <= cutoff)
      .map(event => paidUses.get(`${event.supply.buildingId}\0${event.supply.jobId}`)!);
    const production = canonicalProductionUses([...paid, ...(conditionalForce > 0 ? uses.flatMap(use => {
      const throughTicks = Math.min(use.throughTicks, cutoff - now);
      return throughTicks > use.fromTicks ? [{ ...use, throughTicks }] : [];
    }) : [])]);
    return { id: scenario.id, probability: scenario.probability, readyTick, conditionalForce, production };
  };
  const fillScenarios = (conditional?.scenarios ?? [{ id: 'certain-supply', probability: 1, producers: [] }])
    .slice().sort((a, b) => compare(a.id, b.id)).map(evaluate);
  const filled = fillScenarios.filter(scenario => scenario.readyTick !== null && scenario.probability > 0);
  const filledProbability = filled.reduce((sum, scenario) => sum + scenario.probability, 0);
  const completionProbability = Math.min(1, filledProbability);
  const unresolvedProbability = fillScenarios.filter(scenario => unresolved.has(scenario.id)).reduce((sum, scenario) => sum + scenario.probability, 0);
  const status = atRallyForce >= requiredForce ? 'ready' : completionProbability > 0 ? 'gathering' : unresolvedProbability > 0 ? 'unknown'
    : missing.some(fact => fact.status === 'unknown') ? 'unknown' : 'blocked';
  if (status === 'blocked' && deficit > 0) missing.push({ code: 'needs-production', status: 'unmet', factIds: [] });
  const readyTick = status === 'ready' ? now : completionProbability > 0
    ? Math.ceil(filled.reduce((sum, scenario) => sum + scenario.probability * scenario.readyTick!, 0) / filledProbability - 1e-9) : null;
  // Known filled mass is an actionable conservative lower bound. Unobserved
  // tails retain their upper mass; they are neither known zero nor credited
  // value. Assembly occupation is still paid for the whole present cohort.
  // The mean is diagnostic. A continuation must price each successful path at
  // its own time/cohort, not use a fractional mean unit or discount twice.
  const conditionalForce = completionProbability > 0
    ? filled.reduce((sum, scenario) => sum + scenario.probability * scenario.conditionalForce, 0) / filledProbability : 0;
  return { ...base, status, readyTick, completionProbability: status === 'ready' ? 1 : completionProbability,
    conditionalForce, fillScenarios, conditionalSegments, diagnostics: { ...diagnostic, unresolvedProbability },
    probabilityBasis: status !== 'ready' && unresolvedProbability > 0 ? 'proven-lower-bound' : 'exact',
    completionProbabilityBounds: status === 'ready' ? { lower: 1, upper: 1 }
      : { lower: completionProbability, upper: Math.min(1, completionProbability + unresolvedProbability) },
    production: canonicalProductionUses(filled.flatMap(scenario => scenario.production)), missing };
}
