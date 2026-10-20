import type { AllocationEta, AllocationMethodProvider, AllocationMethodQuoteInput, ExecutableMethod,
  FormalAssignment, MethodAllocationQuote, ResourceLease, StrategyAllocationDecision,
  StrategyAllocationInput, StrategyAllocationMemory } from './allocation-types';
import { allocationGrants, advanceAllocationGraph, appendAllocationEvent, actionDependencySatisfied,
  observeAllocationOrders, pruneAllocationProvenance } from './allocation-lifecycle';
import { reserveAllocationSpends } from './allocation-ledger';
import { assertStrategyAllocationBounds, createStrategyAllocationMemory, sameAction } from './control';
import { createOpportunityOracle, type BundleValuationSource } from './opportunity-oracle';
import { unitArrival } from './unit-arrivals';
import { productionUsesOverlap } from './production-use';
import { STRATEGY_PARAMETERS } from './utility';
import type { DecisionFacts } from './decision';
import type { Effect, Objective, SituationUnit, ValuationContext } from './types';

/** A fixed prefix bound limits speculative group quotes, not committed forces.
 * Every prefix is repriced as a whole group, including camp-force interactions. */
export const ALLOCATION_CANDIDATES_PER_ORIGIN = 24;
export const ALLOCATION_BUNDLE_QUOTES_PER_METHOD = 12;
type Offer = { objective: DecisionFacts<Objective>; method: ExecutableMethod; provider: AllocationMethodProvider;
  unitIds: readonly string[]; gross: MethodAllocationQuote; net?: MethodAllocationQuote };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ordered = <T extends { id: string }>(values: readonly T[]) => [...values].sort((a, b) => compare(a.id, b.id));
const terminal = (status: string) => ['complete', 'failed', 'abandoned'].includes(status);
export function allocationEffectKey(effect: Effect): string {
  switch (effect.kind) {
    case 'site-safe': return `site-safe:${effect.siteId}`;
    case 'mining-established': return `mining-established:${effect.mineId}:complete-hall:garrison-handoff`;
    case 'force-present': return `force-present:${effect.landId}`;
    case 'entity-destroyed': return `entity-destroyed:${effect.entityId}`;
    case 'route-controlled': return `route-controlled:${effect.target.landId}:${effect.target.point.x}:${effect.target.point.y}`;
    case 'harassment-ended': return `harassment-ended:${effect.unitId}:${effect.siteId}`;
    case 'assets-evacuated': return `assets-evacuated:${[...effect.unitIds].sort().join(',')}`;
  }
}
function clean<T>(value: T): T {
  // Optional native fields may be present with undefined. No function/world
  // graph can survive assertStrategyAllocationBounds at transaction commit.
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).map(([key, item]) => [key, clean(item)])) as T;
  return value;
}
function quoteInput(input: StrategyAllocationInput, memory: StrategyAllocationMemory, offer: Pick<Offer, 'objective' | 'method' | 'unitIds'>,
  valuation: ValuationContext): AllocationMethodQuoteInput {
  return { snapshot: input.snapshot, situation: input.situation, objective: offer.objective, method: offer.method,
    unitIds: offer.unitIds, budgets: Object.values(memory.budgets).filter(budget => budget.methodId === offer.method.id),
    executions: Object.values(memory.executions).filter(action => action.methodId === offer.method.id), valuation,
    ...(input.voyageRisks ? { voyageRisks: input.voyageRisks } : {}),
    ...(input.fixedVoyageArrival ? { fixedVoyageArrival: input.fixedVoyageArrival } : {}) };
}
function reprice(input: StrategyAllocationInput, memory: StrategyAllocationMemory, provider: AllocationMethodProvider,
  offer: Pick<Offer, 'objective' | 'method' | 'unitIds'>, valuation: ValuationContext): { method: ExecutableMethod; quote: MethodAllocationQuote } {
  const request = quoteInput(input, memory, offer, valuation);
  const method = provider.materialize?.(request) ?? request.method;
  if (method.id !== offer.method.id || method.objectiveId !== offer.objective.id || method.providerId !== provider.id)
    throw new Error('Materialized method changed its identity');
  const permitted = new Set(offer.unitIds);
  for (const action of method.actions) for (const id of action.unitIds ?? []) if (!permitted.has(id))
    throw new Error(`Materialized action recruited an ungranted unit ${id}`);
  for (const voyage of method.voyagePlans ?? []) {
    if (voyage.unitIds.some(id => !permitted.has(id)) || voyage.ship.kind === 'existing' && !permitted.has(voyage.ship.unitId))
      throw new Error('Materialized voyage recruited outside the quoted bundle');
  }
  const quote = provider.quote({ ...request, method });
  if (quote.methodId !== method.id || quote.status === 'feasible' && !Number.isFinite(quote.utility.score))
    throw new Error('Invalid allocation method quote');
  return { method, quote };
}
function candidateBundles(input: StrategyAllocationInput, memory: StrategyAllocationMemory, method: ExecutableMethod): readonly string[][] {
  const owned = input.situation.units.filter(unit => unit.owner === input.situation.owner && unit.hp > 0);
  const existing = Object.values(memory.assignments).filter(assignment => assignment.methodId === method.id).map(assignment => assignment.unitId);
  for (const action of Object.values(memory.executions).filter(action => action.methodId === method.id)) {
    for (const id of [action.state.createdUnitId, action.state.createdShipId])
      if (typeof id === 'string' && owned.some(unit => unit.id === id)) existing.push(id);
  }
  const targetId = method.actions.at(-1)?.id ?? '', objective = input.objectives.find(objective => objective.id === method.objectiveId)!;
  const eta = (unit: DecisionFacts<SituationUnit>) => {
    const arrival = unitArrival(unit, targetId) ?? unitArrival(unit, objective.target.entityId ?? '');
    return arrival && 'ticks' in arrival ? arrival.ticks : null;
  };
  const eligible = owned.filter(unit => {
    const lease = memory.leases[`unit:${unit.id}`];
    if (lease?.objectiveId === method.objectiveId) return true;
    // Proposed reservations are not authority. Actual unpriced execution stays
    // out of a free pool until an explicit imported lease/quote can represent it.
    const actual = input.snapshot.units.find(actor => actor.id === unit.id);
    return !!lease || unit.commitments.length === 0 || actual?.order.type === 'idle' && !actual.deck && !actual.cabin;
  }).sort((a, b) => {
    const x = eta(a), y = eta(b);
    const priority = (id: string) => {
      const lease = memory.leases[`unit:${id}`];
      return lease?.objectiveId === method.objectiveId ? 0 : lease ? 2 : 1;
    };
    return priority(a.id) - priority(b.id) || Number(x === null) - Number(y === null)
      || (x ?? 0) - (y ?? 0) || compare(a.id, b.id);
  });
  const origins = new Map<string, number>();
  const pool = eligible.filter(unit => {
    const origin = unit.location.kind === 'land' ? unit.location.landId : unit.location.kind === 'aboard' ? unit.location.shipId : 'unknown';
    const count = origins.get(origin) ?? 0;
    if (count >= ALLOCATION_CANDIDATES_PER_ORIGIN && !existing.includes(unit.id)) return false;
    origins.set(origin, count + 1); return true;
  });
  const workers = method.demands.some(demand => demand.kind === 'workers');
  const combat = method.demands.some(demand => demand.kind === 'force');
  const auxiliaries = pool.filter(unit => workers && unit.roles.includes('worker'));
  const force = pool.filter(unit => combat && !unit.roles.some(role => ['worker', 'transport', 'warship'].includes(role)));
  const base = [...new Set(existing)];
  // Workers and hulls enter the same explicit bundle; transport providers may
  // not add an available boat or an economic worker during materialization.
  if (workers && !base.some(id => auxiliaries.some(unit => unit.id === id)) && auxiliaries[0]) base.push(auxiliaries[0].id);
  const withHulls = (ids: readonly string[]) => {
    const result = new Set(ids);
    for (const id of ids) {
      const unit = owned.find(unit => unit.id === id); if (!unit) continue;
      const arrival = unitArrival(unit, targetId) ?? unitArrival(unit, objective.target.entityId ?? '');
      if (arrival && 'crossings' in arrival) for (const crossing of arrival.crossings)
        if (crossing.shipId && eligible.some(unit => unit.id === crossing.shipId)) result.add(crossing.shipId);
    }
    return [...result].sort();
  };
  const choices = new Map<string, string[]>();
  const push = (ids: readonly string[]) => { const list = withHulls(ids); choices.set(list.join('\0'), list); };
  const additions = force.filter(unit => !base.includes(unit.id));
  // Include the full eligible prefix as well as small bundles. A large threat
  // must not be declared impossible just because the quote count is bounded.
  const sizes = [...new Set([0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, additions.length]
    .map(size => Math.min(size, additions.length)))].sort((a, b) => a - b);
  if (sizes.length > ALLOCATION_BUNDLE_QUOTES_PER_METHOD) throw new Error('Allocation quote schedule exceeds its bound');
  for (const size of sizes) push([...base, ...additions.slice(0, size).map(unit => unit.id)]);
  return [...choices.values()];
}
function currentEta(unit: DecisionFacts<SituationUnit>, method: ExecutableMethod, actionId: string, tick: number): AllocationEta {
  const action = method.actions.find(action => action.id === actionId)!;
  const arrival = unitArrival(unit, actionId) ?? (action.target.entityId && action.target.point.x === method.actions.at(-1)?.target.point.x
    && action.target.point.y === method.actions.at(-1)?.target.point.y ? unitArrival(unit, action.target.entityId) : undefined);
  if (!arrival) return { status: 'unknown', forecastTick: tick, arrivalTick: null,
    reason: { code: 'current-action-arrival-unquoted', factIds: [unit.id, actionId], values: {} } };
  if (arrival.status === 'reachable') return { status: 'known', forecastTick: tick, arrivalTick: tick + arrival.ticks };
  return { status: arrival.status, forecastTick: tick, arrivalTick: 'ticks' in arrival ? tick + arrival.ticks : null,
    reason: { code: 'reason' in arrival ? arrival.reason.code : arrival.unmet[0]?.code ?? 'arrival-prerequisite', factIds: [unit.id, actionId], values: {} } };
}
function assignMethod(input: StrategyAllocationInput, memory: StrategyAllocationMemory, offer: Offer): StrategyAllocationMemory {
  const { snapshot, situation } = input, tick = snapshot.tick, method = clean(offer.method), objective = offer.objective;
  const executions = { ...memory.executions };
  let generation = memory.nextActionGeneration;
  for (const action of method.actions) {
    const old = executions[action.id];
    if (old && old.methodId !== method.id) throw new Error('Two allocation methods share an action id');
    executions[action.id] = { ...old, token: old?.token ?? { actionId: action.id, generation: generation++ }, objectiveId: objective.id,
      methodId: method.id, executor: action.executor, intent: action.intent, target: action.target, dependsOn: [...action.dependsOn],
      completionEffects: [...action.completionEffects], ...(action.production ? { production: action.production } : {}),
      status: old?.status ?? 'waiting', phase: old?.phase ?? 'allocated', sinceTick: old?.sinceTick ?? tick,
      lastProgressTick: old?.lastProgressTick ?? tick, state: old?.state ?? {} };
  }
  let next = advanceAllocationGraph({ ...memory, methods: { ...memory.methods, [method.id]: method }, executions, nextActionGeneration: generation });
  const leases = { ...next.leases }, assignments = { ...next.assignments }, voyages = { ...next.voyages };
  const live = new Map(situation.units.filter(unit => unit.owner === situation.owner && unit.hp > 0).map(unit => [unit.id, unit]));
  const runnable = method.actions.filter(action => !terminal(next.executions[action.id]!.status)
    && action.dependsOn.every(id => actionDependencySatisfied(next.executions[id]!)));
  for (const id of offer.unitIds) {
    const unit = live.get(id); if (!unit) throw new Error('Allocation bundle contains a missing unit');
    const uses = method.actions.filter(action => !terminal(next.executions[action.id]!.status)
      && (action.unitIds ? action.unitIds.includes(id) : action.demands.some(demand =>
        unit.roles.includes('worker') ? demand.kind === 'workers' : unit.roles.includes('transport') ? demand.kind === 'transport' : demand.kind === 'force')));
    const aboard = unit.location.kind === 'aboard';
    const action = uses.find(action => runnable.includes(action) && (!aboard || action.executor === 'strategy.transport'))
      ?? uses.find(action => runnable.includes(action)) ?? uses[0];
    if (!action) continue;
    const key = `unit:${id}` as const, before = leases[key];
    if (before && before.objectiveId !== objective.id) throw new Error('Allocation assigned a resource before handoff');
    const token = next.executions[action.id]!.token, assignmentId = `assignment:${id}`;
    const eta = currentEta(unit, method, action.id, tick), old = assignments[assignmentId];
    const onStation = unit.location.kind === 'land' && unit.location.landId === action.target.landId
      && Math.hypot(unit.location.point.x - action.target.point.x, unit.location.point.y - action.target.point.y) <= 240;
    const order = memory.issuedOrders[id];
    const moving = order?.observedTick === tick && sameAction(order.action, token);
    const stage = old?.interruption ? 'assigned' : onStation ? 'on-station'
      : unit.location.kind === 'aboard' || moving ? 'en-route' : 'assigned';
    leases[key] = { id: before?.id ?? `lease:${id}`, resourceKey: key, objectiveId: objective.id, methodId: method.id,
      action: token, sinceTick: before?.sinceTick ?? tick,
      minimumStayUntilTick: before?.minimumStayUntilTick ?? tick + STRATEGY_PARAMETERS.minimumStayTicks,
      origin: 'allocator', incumbentTask: null };
    assignments[assignmentId] = { authority: 'committed', id: assignmentId, leaseId: leases[key]!.id, unitId: id,
      role: unit.roles[0] ?? 'frontline', objectiveId: objective.id, methodId: method.id, action: token, target: action.target,
      stage, eta, lastLocation: unit.location.kind === 'unknown' ? { ...unit.location,
        reason: { code: unit.location.reason.code, factIds: [id], values: {} } } : clean(unit.location),
      interruption: old?.interruption ?? null } satisfies FormalAssignment;
    if (old && !sameAction(old.action, token)) next = appendAllocationEvent(next, { objectiveId: objective.id, methodId: method.id,
      action: token, kind: 'lease-transferred', fromObjectiveId: old.objectiveId, toObjectiveId: objective.id,
      leaseIds: [leases[key]!.id], assignmentIds: [assignmentId], reason: { code: 'dependency-action-handoff', factIds: [id], values: {} } }, tick);
    if (old && old.stage !== stage) next = appendAllocationEvent(next, { objectiveId: objective.id, methodId: method.id,
      action: token, kind: 'assignment-stage', assignmentId, from: old.stage, to: stage,
      reason: { code: 'current-world-arrival-stage', factIds: [id], values: {} } }, tick);
  }
  for (const action of runnable) {
    const production = action.production;
    const producer = production?.producer.kind === 'existing' ? production.producer.buildingId
      : production?.producer.kind === 'action-result' ? next.executions[production.producer.actionId]?.state.hallId : null;
    const key = typeof producer === 'string' ? `queue:${producer}` as const : null;
    if (key && !leases[key]) leases[key] = { id: `lease:${key}`, resourceKey: key, objectiveId: objective.id, methodId: method.id,
      action: next.executions[action.id]!.token, sinceTick: tick, minimumStayUntilTick: tick, origin: 'allocator', incumbentTask: null };
    if (typeof producer === 'string' && production?.producer.kind === 'action-result') {
      const entity = snapshot.buildings.find(building => building.id === producer && building.owner === situation.owner && building.hp > 0 && building.complete);
      if (entity) next = { ...next, executions: { ...next.executions, [action.id]: { ...next.executions[action.id]!, target: {
        entityId: entity.id, point: { x: entity.x, y: entity.y }, ...(action.target.landId ? { landId: action.target.landId } : {}) } } } };
    }
  }
  for (const plan of method.voyagePlans ?? []) {
    const shipId = plan.ship.kind === 'existing' ? plan.ship.unitId : next.executions[plan.ship.actionId]?.state.createdShipId;
    if (typeof shipId !== 'string') continue;
    const shipAssignment = assignments[`assignment:${shipId}`];
    if (!shipAssignment) continue;
    const prior = voyages[plan.id], passengers = snapshot.units.filter(unit => unit.deck?.shipId === shipId || unit.cabin?.shipId === shipId).map(unit => unit.id).sort();
    voyages[plan.id] = { id: plan.id, objectiveId: objective.id, action: next.executions[plan.actionId]!.token,
      shipAssignmentId: shipAssignment.id, crewAssignmentIds: plan.unitIds.map(id => `assignment:${id}`), passengerIds: passengers,
      departure: plan.departure, destination: plan.destination, departureGround: plan.departureGround, landingGround: plan.landingGround,
      phase: prior?.phase === 'return' ? 'return' : passengers.length ? 'sailing' : prior?.phase ?? 'loading', startedTick: prior?.startedTick ?? tick,
      expectedFreeTick: offer.gross.force?.evaluationUntilTick ?? null, decision: prior?.decision ?? 'continue' };
  }
  const own = Object.values(assignments).filter(assignment => assignment.objectiveId === objective.id);
  next = { ...next, leases, assignments, voyages, objectives: { ...next.objectives, [objective.id]: {
    objectiveId: objective.id, methodId: method.id, target: objective.target, effectKeys: objective.effects.map(allocationEffectKey), status: 'active',
    actionIds: method.actions.map(action => action.id), assignmentIds: own.map(assignment => assignment.id).sort(),
    budgetIds: [], sinceTick: memory.objectives[objective.id]?.sinceTick ?? tick,
    minimumStayUntilTick: memory.objectives[objective.id]?.minimumStayUntilTick ?? tick + STRATEGY_PARAMETERS.minimumStayTicks,
    challengerId: memory.objectives[objective.id]?.challengerId ?? null,
    challengerThinks: memory.objectives[objective.id]?.challengerThinks ?? 0,
    committedUtilityGold: offer.net?.status === 'feasible' ? offer.net.utility.score : null,
    force: offer.net?.force ?? offer.gross.force } } };
  const capital = reserveAllocationSpends({ memory: next, method, actions: Object.values(next.executions).filter(action => action.methodId === method.id),
    cashGold: situation.economy.cashGold, tick });
  next = { ...capital.memory, unmet: [...capital.memory.unmet, ...capital.unmet], objectives: { ...capital.memory.objectives,
    [objective.id]: { ...capital.memory.objectives[objective.id]!, budgetIds: Object.values(capital.memory.budgets)
      .filter(budget => budget.objectiveId === objective.id && budget.state !== 'released').map(budget => budget.id).sort() } } };
  return next;
}

/** Greedy whole-bundle allocation. Quote data is local to one transaction;
 * memory stores only the committed graph, not the speculative search tree. */
export function allocateStrategy(input: StrategyAllocationInput): StrategyAllocationDecision {
  const tick = input.snapshot.tick, owner = input.situation.owner;
  if (input.previous && input.previous.owner !== owner) throw new Error('Wrong allocation owner');
  let memory = clean(input.previous ? structuredClone(input.previous) : createStrategyAllocationMemory(owner, tick));
  if (memory.evaluatedTick === tick) return { memory, grants: allocationGrants(memory), events: [], unmet: memory.unmet };
  if (memory.evaluatedTick > tick) throw new Error('Allocation cannot move backwards in simulation time');
  memory = { ...memory, evaluatedTick: tick, revision: memory.revision + 1, unmet: [] };
  memory = observeAllocationOrders(memory, input.snapshot);
  const firstEventSequence = memory.nextEventSequence, offers: Offer[] = [];
  for (const method of ordered(input.methods)) {
    const objective = input.objectives.find(objective => objective.id === method.objectiveId);
    if (!objective || terminal(objective.status)) continue;
    const provider = input.providers.find(provider => provider.id === method.providerId);
    if (!provider) throw new Error(`Missing allocation provider ${method.providerId}`);
    for (const unitIds of candidateBundles(input, memory, method)) {
      const result = reprice(input, memory, provider, { objective, method, unitIds }, { phase: 'gross' });
      offers.push({ objective, method: result.method, provider, unitIds, gross: result.quote });
    }
  }
  const sources: BundleValuationSource[] = offers.filter(offer => offer.gross.status === 'feasible').map((offer, index) => ({
    id: `${offer.method.id}/bundle:${index}`, objectiveId: offer.objective.id, unitIds: offer.unitIds,
    ...(offer.gross.valuation?.production ? { production: offer.gross.valuation.production } : {}),
    effectKeys: offer.objective.effects.map(allocationEffectKey), committed: memory.objectives[offer.objective.id]?.methodId === offer.method.id
      && Object.values(memory.assignments).filter(assignment => assignment.objectiveId === offer.objective.id).map(assignment => assignment.unitId)
        .sort().join('\0') === [...offer.unitIds].sort().join('\0'),
    quote: (ids, window, unavailableProduction) => {
      const result = reprice(input, memory, offer.provider, { ...offer, unitIds: ids }, { phase: 'gross', window,
        allowedUnitIds: offer.unitIds, unavailableUnitIds: offer.unitIds.filter(id => !ids.includes(id)),
        ...(offer.gross.valuation?.production ? { allowedProduction: offer.gross.valuation.production } : {}),
        ...(unavailableProduction ? { unavailableProduction } : {}) });
      return result.quote.status === 'feasible' ? { status: 'feasible', score: result.quote.utility.score, coverage: 'complete' }
        : { status: result.quote.missingPreconditions.some(condition => condition.status === 'unknown') ? 'unknown' : 'not-runnable', reasonCode: result.quote.reason.code };
    },
  }));
  const oracle = createOpportunityOracle(sources, {
    effectKeysFor: id => input.objectives.find(objective => objective.id === id)?.effects.map(allocationEffectKey) ?? memory.objectives[id]?.effectKeys ?? [],
    unpricedCommitmentsFor: ids => [...new Set(ids.flatMap(id => {
      const lease = memory.leases[`unit:${id}`];
      return lease && !sources.some(source => source.objectiveId === lease.objectiveId && source.committed) ? [lease.objectiveId] : [];
    }))],
    unpricedProductionFor: uses => [...new Set(uses.flatMap(use => {
      const lease = memory.leases[`${use.lane === 'training' ? 'queue' : 'research'}:${use.buildingId}`];
      return lease && !sources.some(source => source.objectiveId === lease.objectiveId && source.committed && productionUsesOverlap(source.production ?? [], [use]))
        ? [lease.objectiveId] : [];
    }))],
  });
  for (const offer of offers) {
    if (offer.gross.status !== 'feasible') continue;
    const result = reprice(input, memory, offer.provider, offer, { phase: 'net', opportunity: oracle });
    offer.method = result.method; offer.net = result.quote;
  }
  const byUtility = (a: Offer, b: Offer) =>
    (b.net?.utility?.score ?? 0) - (a.net?.utility?.score ?? 0) || a.method.preference - b.method.preference
      || compare(a.method.id, b.method.id) || compare(a.unitIds.join(','), b.unitIds.join(','));
  let pending = offers.filter(offer => offer.net?.status === 'feasible');
  const selected = new Set<string>(), effects = new Set<string>(), challenged = new Set<string>();
  while (pending.length) {
    // Earlier grants change the remaining bundles. Reprice only offers whose
    // members were actually taken, then sort their new marginal values again.
    pending = pending.filter(offer => !selected.has(offer.objective.id)).map(offer => {
      const ids = offer.unitIds.filter(id => !selected.has(memory.leases[`unit:${id}`]?.objectiveId ?? ''));
      if (ids.length === offer.unitIds.length) return offer;
      const result = reprice(input, memory, offer.provider, { ...offer, unitIds: ids }, { phase: 'net', opportunity: oracle,
        allowedUnitIds: offer.unitIds, unavailableUnitIds: offer.unitIds.filter(id => !ids.includes(id)) });
      return { ...offer, method: result.method, unitIds: ids, net: result.quote };
    }).filter(offer => offer.net?.status === 'feasible').sort(byUtility);
    const offer = pending.shift(); if (!offer) break;
    const quote = offer.net!;
    if (quote.status !== 'feasible' || quote.utility.score <= 0 || selected.has(offer.objective.id)
      || offer.objective.effects.some(effect => effects.has(allocationEffectKey(effect)))) continue;
    const conflicts = Object.values(memory.leases).filter(lease => lease.resourceKey.startsWith('unit:')
      && offer.unitIds.includes(lease.resourceKey.slice(5)) && lease.objectiveId !== offer.objective.id);
    if (conflicts.some(lease => selected.has(lease.objectiveId))) continue;
    let failed = false, switchingGold = 0;
    const transfers: { fromId: string; taken: ResourceLease[]; resourceKeys: ResourceLease['resourceKey'][];
      cost: number; loss: number; eventId: string }[] = [];
    for (const fromId of [...new Set(conflicts.map(lease => lease.objectiveId))].sort()) {
      const taken = conflicts.filter(lease => lease.objectiveId === fromId), resourceKeys = taken.map(lease => lease.resourceKey).sort();
      const cost = input.switchingCost?.({ fromObjectiveId: fromId, toObjectiveId: offer.objective.id, resourceKeys });
      const alternate = quote.valuation?.opportunity;
      const loss = alternate?.status === 'known' ? alternate.alternatives.find(alternative => alternative.objectiveId === fromId)?.marginalGold : undefined;
      if (cost === undefined || cost === null || loss === undefined || !Number.isFinite(cost) || cost < 0
        || quote.utility.score <= cost) { failed = true; break; }
      switchingGold += cost;
      const old = memory.objectives[fromId];
      const emergency = offer.objective.kind === 'DefendSite' && input.situation.lands.flatMap(land => land.threats)
        .some(threat => threat.siteId === offer.objective.target.entityId && threat.attackers.some(attacker => attacker.intent?.kind === 'actual-intrusion'));
      if (old && !emergency) {
        if (challenged.has(fromId) && old.challengerId !== offer.objective.id) { failed = true; break; }
        const challengerThinks = old.challengerId === offer.objective.id ? old.challengerThinks + (challenged.has(fromId) ? 0 : 1) : 1;
        challenged.add(fromId);
        memory = { ...memory, objectives: { ...memory.objectives, [fromId]: { ...old, challengerId: offer.objective.id, challengerThinks } } };
        if (tick < old.minimumStayUntilTick || challengerThinks < STRATEGY_PARAMETERS.challengerThinks) { failed = true; break; }
      }
      transfers.push({ fromId, taken, resourceKeys, cost, loss,
        eventId: `${owner}:allocation:${memory.nextEventSequence + transfers.length}` });
    }
    if (failed || switchingGold >= quote.utility.score && transfers.length) continue;
    const imported = transfers.filter(transfer => transfer.taken.some(lease => lease.origin === 'imported-task'));
    const acknowledgements = imported.length ? input.handoffImported?.(imported.map(transfer => ({
      leases: transfer.taken, resourceKeys: transfer.resourceKeys, eventId: transfer.eventId }))) : [];
    if (!acknowledgements || imported.some(transfer => !acknowledgements.some(ack => ack.eventId === transfer.eventId))) continue;
    // No authority changes occur until every displacement price and producer
    // acknowledgement is available for this entire bundle.
    for (const transfer of transfers) {
      const { fromId, taken, resourceKeys, cost, loss } = transfer;
      const token = memory.executions[taken[0]!.action.actionId]?.token ?? taken[0]!.action;
      const remaining = Object.values(memory.assignments).filter(assignment => assignment.objectiveId === fromId
        && !resourceKeys.includes(`unit:${assignment.unitId}`));
      const handoff = acknowledgements.find(ack => ack.eventId === transfer.eventId)?.disposition ?? (remaining.length ? 'shrink' : 'pause');
      memory = appendAllocationEvent(memory, { objectiveId: fromId, methodId: taken[0]!.methodId, action: token, kind: 'preempted', handoff,
        quotation: { fromObjectiveId: fromId, toObjectiveId: offer.objective.id, resourceKeys,
          marginalBenefitGold: quote.utility.score + loss, displacedLossGold: loss, switchingCostGold: cost,
          reason: { code: 'same-window-marginal-reallocation', factIds: resourceKeys, values: {} } },
        reason: { code: 'higher-marginal-utility-after-switching', factIds: resourceKeys, values: {} } }, tick);
      const leases = { ...memory.leases }, assignments = { ...memory.assignments };
      for (const lease of taken) { delete leases[lease.resourceKey]; delete assignments[`assignment:${lease.resourceKey.slice(5)}`]; }
      const prior = memory.objectives[fromId];
      memory = { ...memory, leases, assignments, ...(prior ? { objectives: { ...memory.objectives, [fromId]: { ...prior,
        assignmentIds: remaining.map(assignment => assignment.id).sort(), committedUtilityGold: null,
        challengerId: null, challengerThinks: 0, status: handoff === 'shrink' ? prior.status : 'paused' } } } : {}) };
    }
    memory = assignMethod(input, memory, offer); selected.add(offer.objective.id);
    for (const effect of offer.objective.effects) effects.add(allocationEffectKey(effect));
  }
  // Failed/unknown quotes remain explicit unmet prerequisites; no zero-score
  // blocked offer enters the feasible ordering or earns a resource lease.
  for (const offer of offers.filter(offer => !selected.has(offer.objective.id) && offer.gross.status === 'blocked')) {
    const quote = offer.gross; if (quote.status !== 'blocked') continue;
    for (const condition of quote.missingPreconditions) if (condition.demand && !memory.unmet.some(item => item.id === condition.id))
      memory = { ...memory, unmet: [...memory.unmet, { id: condition.id, objectiveId: offer.objective.id, methodId: offer.method.id,
        action: null, demand: condition.demand, reason: condition.reason }] };
  }
  memory = pruneAllocationProvenance(memory);
  assertStrategyAllocationBounds(memory);
  return { memory, grants: allocationGrants(memory), events: memory.events.filter(event =>
    Number(event.id.slice(event.id.lastIndexOf(':') + 1)) >= firstEventSequence), unmet: memory.unmet };
}
