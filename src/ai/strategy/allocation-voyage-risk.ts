import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { ExecutableMethod, MethodAllocationQuote, PlannedVoyage } from './allocation-types';
import { boundObservationMemory, observationMemory } from './observation-memory';
import { assessVoyageRisks, type VoyageRisk, type VoyageRiskRequest, type VoyageRiskStages } from './voyage-risk';
import { CRITICAL_FACT_CANDIDATES, currentFactWork } from './fact-work';
import { landIdAt } from './regions';

/** Pure physical descriptions shared by batch registration and same-think
 * counterfactual reuse. Describing a leg never invokes navigation or risk work. */
function describeVoyageRisks(snapshot: GameSnapshot, memory: AiPolicyMemory, voyages: readonly PlannedVoyage[]) {
  const requests = new Map<string, VoyageRiskRequest>(), pairs = new Map<string, { approach: string; loaded: string }>();
  const unknowns = new Map<string, VoyageRisk>();
  const executions = memory.strategyAllocation?.executions ?? {};
  const add = (request: VoyageRiskRequest) => {
    const previous = requests.get(request.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(request)) throw new Error('Conflicting physical voyage risk identities');
    requests.set(request.id, request);
  };
  for (const voyage of voyages) {
    const approach = `${voyage.id}/approach`, loaded = `${voyage.id}/loaded`;
    pairs.set(voyage.id, { approach, loaded });
    const born = voyage.ship.kind === 'production' ? executions[voyage.ship.actionId]?.state.createdShipId : undefined;
    const shipId = voyage.ship.kind === 'existing' ? voyage.ship.unitId : typeof born === 'string' ? born : undefined;
    const producer = voyage.crossing.productionBuildingId;
    if (!shipId && !producer) {
      unknowns.set(voyage.id, { status: 'unknown', reasonCode: 'voyage-physical-producer-unquoted', samples: 0, totalSamples: 0, threatIds: [] });
      continue;
    }
    const hull = shipId ? snapshot.units.find(unit => unit.id === shipId) : undefined;
    const cargo = (id: string) => snapshot.units.some(unit => unit.id === id && hull
      && (unit.deck?.shipId === hull.id || unit.cabin?.shipId === hull.id));
    const alreadyLoaded = !!hull && voyage.unitIds.some(cargo) && voyage.unitIds.every(id => cargo(id)
      || snapshot.units.some(unit => unit.id === id && !unit.deck && !unit.cabin
        && landIdAt(snapshot.map, unit) === voyage.landingGround.landId));
    const identity = { seaId: voyage.crossing.seaId, ...(shipId ? { shipId } : { productionBuildingId: producer! }) };
    const atPickup = !!hull && Math.hypot(hull.x - voyage.departure.point.x, hull.y - voyage.departure.point.y) <= hull.radius;
    if (alreadyLoaded || atPickup) {
      // Current cargo alone does not complete a pickup. Until the remaining
      // manifest boards, the executor first visits the planned water point;
      // those already aboard are exposed during that approach too.
      const safe: VoyageRisk = { status: 'known', survivalProbability: 1, expectedDamage: 0, expectedHpLoss: 0,
        damageErrorBound: 0, samples: 0, totalSamples: 0, computedTick: snapshot.tick,
        basis: 'completed-before-evaluation', threatIds: [] };
      unknowns.set(approach, safe);
      add({ id: loaded, ...identity, destination: voyage.destination.point,
        ...(!alreadyLoaded ? { start: { ...voyage.departure.point,
          heading: voyage.crossing.departureHeading ?? hull!.sailing?.heading ?? 0 } } : {}) });
    } else {
      add({ id: approach, ...identity, destination: voyage.departure.point });
      add({ id: loaded, ...identity, destination: voyage.destination.point, previousLegId: approach });
    }
  }
  return { requests, pairs, unknowns };
}

/** One physical batch for all materialized candidate bundles. The risk of the
 * hull's route does not depend on which passengers are being priced. Passenger
 * losses remain the quote's responsibility, using these same two leg facts. */
export function prepareAllocationVoyageRisks(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  methods: readonly ExecutableMethod[], quotes?: readonly MethodAllocationQuote[]): ReadonlyMap<string, VoyageRiskStages> {
  const executions = memory.strategyAllocation?.executions ?? {};
  const active = new Set(Object.values(executions).filter(action => action.status === 'active' || action.status === 'blocked').map(action => action.objectiveId));
  // A concrete voyage already has a known coarse crossing and a named bundle.
  // Do not prioritize candidates with a known unmet force/worker prerequisite
  // or a known nonpositive quote. Missing detailed risk stays a fact request.
  const candidates = [...new Set(methods.filter((method, index) => {
    const quote = quotes?.[index];
    if (!method.voyagePlans?.length) return false;
    if (!quote) return true;
    return quote.status === 'feasible' ? quote.utility.score > 0
      : quote.missingPreconditions.every(condition => condition.status === 'unknown');
  }).map(method => method.objectiveId))]
    .sort((a, b) => Number(active.has(b)) - Number(active.has(a)) || (a < b ? -1 : a > b ? 1 : 0));
  const priority = new Set([...active, ...candidates.filter(id => !active.has(id)).slice(0, CRITICAL_FACT_CANDIDATES)]);
  currentFactWork()?.prioritizePoints(methods.filter(method => priority.has(method.objectiveId))
    .flatMap(method => method.voyagePlans?.flatMap(voyage => [voyage.departure.point, voyage.destination.point]) ?? []));
  const { requests, pairs, unknowns } = describeVoyageRisks(snapshot, memory, methods.flatMap(method => method.voyagePlans ?? []));
  const observation = observationMemory(snapshot, owner, memory);
  const state = observation.voyageRisks ??= { version: 1, owner, tick: snapshot.tick - 1, routeIds: [], entries: [] };
  const published = requests.size ? assessVoyageRisks(snapshot, owner, [...requests.values()], state, observation).results : new Map<string, VoyageRisk>();
  if (!requests.size) { state.tick = snapshot.tick; state.routeIds = []; state.entries = []; state.nativeRoutes = []; }
  const result = new Map<string, VoyageRiskStages>();
  for (const [id, pair] of pairs) {
    const absent = unknowns.get(id) ?? { status: 'unknown' as const, reasonCode: 'voyage-leg-risk-unpublished', samples: 0, totalSamples: 0, threatIds: [] };
    result.set(id, { approach: unknowns.get(pair.approach) ?? published.get(pair.approach) ?? absent,
      loaded: published.get(pair.loaded) ?? absent });
  }
  boundObservationMemory(observation);
  return result;
}

/** Reuse only exact physical stage inputs from this snapshot's published
 * batch. A new passenger/assessment ID does not require another hull search;
 * a different hull, endpoint, start pose or preceding leg remains unpublished. */
export function publishedVoyageRiskReader(snapshot: GameSnapshot, memory: AiPolicyMemory,
  methods: readonly ExecutableMethod[], published: ReadonlyMap<string, VoyageRiskStages>) {
  const described = describeVoyageRisks(snapshot, memory, methods.flatMap(method => method.voyagePlans ?? []));
  const signature = (request: VoyageRiskRequest, requests: ReadonlyMap<string, VoyageRiskRequest>): string => {
    const previous = request.previousLegId ? requests.get(request.previousLegId) : undefined;
    return JSON.stringify({ seaId: request.seaId, shipId: request.shipId ?? null,
      productionBuildingId: request.productionBuildingId ?? null, destination: [request.destination.x, request.destination.y],
      start: request.start ? [request.start.x, request.start.y, request.start.heading] : null,
      route: request.route ? { points: request.route.points.map(point => [point.x, point.y, point.heading]), partial: request.route.partial } : null,
      previous: previous ? signature(previous, requests) : request.previousLegId ? 'unpublished-previous' : null });
  };
  const facts = new Map<string, VoyageRisk>();
  for (const [id, pair] of described.pairs) {
    const value = published.get(id); if (!value) continue;
    for (const stage of ['approach', 'loaded'] as const) {
      const request = described.requests.get(pair[stage]);
      if (request) {
        const key = signature(request, described.requests), old = facts.get(key), next = value[stage];
        // Duplicate identities may have different publication provenance. Do
        // not let a pending duplicate erase the same proven physical fact.
        if (!old || old.status !== 'known' && next.status === 'known'
          || old.status === next.status && JSON.stringify(next) < JSON.stringify(old)) facts.set(key, next);
      }
    }
  }
  return (targets: readonly ExecutableMethod[]): ReadonlyMap<string, VoyageRiskStages> => {
    const next = describeVoyageRisks(snapshot, memory, targets.flatMap(method => method.voyagePlans ?? []));
    const result = new Map<string, VoyageRiskStages>();
    for (const [id, pair] of next.pairs) {
      const absent = next.unknowns.get(id) ?? { status: 'unknown' as const, reasonCode: 'voyage-counterfactual-leg-unpublished',
        samples: 0, totalSamples: 0, threatIds: [] };
      const stage = (name: 'approach' | 'loaded') => {
        const request = next.requests.get(pair[name]);
        return next.unknowns.get(pair[name]) ?? (request ? facts.get(signature(request, next.requests)) : undefined) ?? absent;
      };
      result.set(id, { approach: stage('approach'), loaded: stage('loaded') });
    }
    return result;
  };
}
