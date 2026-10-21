import type { AllocationEta, AllocationMethodProvider, AllocationMethodQuoteInput, ExecutableMethod,
  FormalAssignment, MethodAllocationQuote, PreemptionQuotation, ResourceLease, StrategyAllocationDecision,
  StrategyAllocationInput, StrategyAllocationMemory } from './allocation-types';
import { allocationGrants, advanceAllocationGraph, appendAllocationEvent, actionDependencySatisfied,
  observeAllocationOrders, pruneAllocationProvenance, settleAllocationState, advanceAllocationLeases } from './allocation-lifecycle';
import { reserveAllocationSpends } from './allocation-ledger';
import { assertStrategyAllocationBounds, createStrategyAllocationMemory, sameAction } from './control';
import { createOpportunityOracle, type BundleValuationSource } from './opportunity-oracle';
import { unitArrival } from './unit-arrivals';
import { productionUsesOverlap } from './production-use';
import { STRATEGY_PARAMETERS } from './utility';
import { plannedVoyageArrival, plannedVoyageContext } from './planned-voyage-arrival';
import type { DecisionFacts } from './decision';
import type { Effect, Objective, SituationUnit, ValuationContext, ValuationWindow, ProductionUse } from './types';
import { assertUnitValueSides } from './unit-value-ledger';
import { allocationResponseCandidates } from './allocation-eligibility';
import { currentSiteThreatIsClear } from './protection-activation';
import { assemblyPostArrivalId, assemblyPostForUnit } from './assembly-facts';
import { assessForceAssemblyPosts } from './assembly-posts';
import { continueGoalMethod } from './goal-execution-continuation';
import { readGoalIntent, restoreGoalAuthorityReferences, storeGoalMethod, storeGoalObjective } from './goal-authority-references';

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
  const interruptedUnitIds = [...new Set(Object.values(memory.assignments).filter(assignment => assignment.interruption).map(assignment => assignment.unitId))].sort();
  const method = offer.method.kind === 'goal-plan' ? { ...offer.method, actions: offer.method.actions.map(action => ({ ...action,
    intent: action.intent.kind === 'goal-action' ? readGoalIntent(memory, action.intent) : action.intent })) } : offer.method;
  return { snapshot: input.snapshot, situation: input.situation, objective: offer.objective, method,
    unitIds: offer.unitIds, budgets: Object.values(memory.budgets).filter(budget => budget.methodId === offer.method.id),
    responseEligibleUnitIds: allocationResponseCandidates(input.snapshot, input.situation, memory), interruptedUnitIds,
    executions: Object.values(memory.executions).filter(action => action.methodId === offer.method.id).map(action => ({ ...action,
      intent: action.intent.kind === 'goal-action' ? readGoalIntent(memory, action.intent) : action.intent })), valuation,
    ...(input.voyageRisks ? { voyageRisks: input.voyageRisks } : {}),
    ...(input.assemblyFacts ? { assemblyFacts: request => input.assemblyFacts!({ ...request,
      objective: offer.objective, methodId: offer.method.id, unitIds: offer.unitIds, valuation, interruptedUnitIds,
      responseEligibleUnitIds: allocationResponseCandidates(input.snapshot, input.situation, memory) }) } : {}),
    ...(input.fixedVoyageArrival ? { fixedVoyageArrival: input.fixedVoyageArrival } : {}) };
}
function reprice(input: StrategyAllocationInput, memory: StrategyAllocationMemory, provider: AllocationMethodProvider,
  offer: Pick<Offer, 'objective' | 'method' | 'unitIds'>, valuation: ValuationContext): { method: ExecutableMethod; quote: MethodAllocationQuote; unitIds: readonly string[] } {
  const request = quoteInput(input, memory, offer, valuation);
  const method = provider.materialize?.(request) ?? request.method;
  if (method.id !== offer.method.id || method.objectiveId !== offer.objective.id || method.providerId !== provider.id)
    throw new Error('Materialized method changed its identity');
  const permitted = new Set(offer.unitIds);
  // A ready goal atom is an explicit actor bundle. A subset is an unknown
  // alternative, never a materialized action allowed to recruit the missing
  // actors (or a zero-cost empty version of that same action).
  if (method.kind === 'goal-plan' && !provider.materialize
    && method.actions.some(action => action.unitIds?.some(id => !permitted.has(id)))) {
    const reason = { code: 'goal-ready-bundle-not-wholly-available', factIds: [method.id], values: {} };
    return { method, unitIds: offer.unitIds, quote: { methodId: method.id, status: 'blocked', utility: null,
      potentialUtility: null, force: null, reason, missingPreconditions: [{ id: `${method.id}/current-actors`,
        kind: 'force', status: 'unknown', reason, demand: null, subgoalIds: [] }] } };
  }
  for (const action of method.actions) for (const id of action.unitIds ?? []) if (!permitted.has(id))
    throw new Error(`Materialized action ${action.id} recruited an ungranted unit ${id}`);
  for (const voyage of method.voyagePlans ?? []) {
    if (voyage.unitIds.some(id => !permitted.has(id)) || voyage.ship.kind === 'existing' && !permitted.has(voyage.ship.unitId))
      throw new Error('Materialized voyage recruited outside the quoted bundle');
  }
  const actual = method.stage === 'assembly' ? new Set(method.actions.flatMap(action => action.unitIds ?? [])) : permitted;
  const unitIds = offer.unitIds.filter(id => actual.has(id));
  const quote = provider.quote({ ...quoteInput(input, memory, { ...offer, method, unitIds }, valuation), method });
  if (quote.utility) assertUnitValueSides(quote.utility);
  if (quote.potentialUtility) assertUnitValueSides(quote.potentialUtility);
  if (quote.methodId !== method.id || quote.status === 'feasible' && !Number.isFinite(quote.utility.score))
    throw new Error('Invalid allocation method quote');
  input.observeCandidate?.({ objectiveId: offer.objective.id, method, unitIds, phase: valuation.phase, quote,
    ...(input.voyageRisks ? { voyageRisks: input.voyageRisks } : {}) });
  return { method, quote, unitIds };
}
function candidateBundles(input: StrategyAllocationInput, memory: StrategyAllocationMemory, method: ExecutableMethod): readonly string[][] {
  if (method.kind === 'goal-plan') {
    if (!method.goalBundle) throw Error('Goal plan has no explicit allocation bundle');
    return [[...new Set(method.goalBundle.unitIds)].sort(compare)];
  }
  const owned = input.situation.units.filter(unit => unit.owner === input.situation.owner && unit.hp > 0);
  const free = new Set(allocationResponseCandidates(input.snapshot, input.situation, memory));
  const existing = Object.values(memory.assignments).filter(assignment => assignment.methodId === method.id).map(assignment => assignment.unitId);
  for (const action of Object.values(memory.executions).filter(action => action.methodId === method.id)) {
    for (const id of [action.state.createdUnitId, action.state.createdShipId])
      if (typeof id === 'string' && owned.some(unit => unit.id === id)) existing.push(id);
  }
  const targetId = method.actions.at(-1)?.id ?? '', objective = input.objectives.find(objective => objective.id === method.objectiveId)!;
  const namedWorkers = new Set(objective.effects.flatMap(effect => effect.kind === 'assets-evacuated' ? effect.unitIds : []));
  const localDefense = objective.kind === 'DefendSite' && ['local-squad', 'main-army-recall', 'wait-in-cover'].includes(method.kind);
  const eta = (unit: DecisionFacts<SituationUnit>) => {
    const assembly = method.actions.find(action => action.intent.kind === 'assemble-force');
    const post = assembly?.intent.kind === 'assemble-force' ? assemblyPostForUnit(assembly.intent, unit) : null;
    const arrival = assembly ? post && unitArrival(unit, assemblyPostArrivalId(assembly.id, post.id))
      : unitArrival(unit, targetId) ?? unitArrival(unit, objective.target.entityId ?? '');
    return arrival && 'ticks' in arrival ? arrival.ticks : null;
  };
  const eligible = owned.filter(unit => {
    if (localDefense && !unit.roles.some(role => ['worker', 'transport', 'warship'].includes(role))) {
      if (unit.location.kind !== 'land' || unit.location.landId !== objective.target.landId) return false;
      if (method.kind === 'local-squad' && Math.hypot(unit.location.point.x - objective.target.point.x,
        unit.location.point.y - objective.target.point.y) > 650) return false;
    }
    if (method.kind === 'evacuation' && unit.roles.includes('worker') && namedWorkers.size && !namedWorkers.has(unit.id)) return false;
    if (method.kind === 'evacuation' && unit.roles.includes('worker') && !namedWorkers.size
      && (unit.location.kind !== 'land' || unit.location.landId !== objective.target.landId
        || Math.hypot(unit.location.point.x - objective.target.point.x, unit.location.point.y - objective.target.point.y) > 650)) return false;
    const lease = memory.leases[`unit:${unit.id}`];
    if (lease?.objectiveId === method.objectiveId) return true;
    // Proposed reservations are not authority. Actual unpriced execution stays
    // out of a free pool until an explicit imported lease/quote can represent it.
    return !!lease || free.has(unit.id);
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
  if (workers && combat && !base.some(id => auxiliaries.some(unit => unit.id === id)) && auxiliaries[0]) base.push(auxiliaries[0].id);
  if (workers && !combat && namedWorkers.size) base.push(...auxiliaries.filter(unit => namedWorkers.has(unit.id)).map(unit => unit.id));
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
  const additions = (combat ? force : workers ? auxiliaries : []).filter(unit => !base.includes(unit.id));
  // Include the full eligible prefix as well as small bundles. A large threat
  // must not be declared impossible just because the quote count is bounded.
  const sizes = [...new Set([0, 1, 2, 3, 4, 5, 6, 8, 12, 16, 24, additions.length]
    .map(size => Math.min(size, additions.length)))].sort((a, b) => a - b);
  if (sizes.length > ALLOCATION_BUNDLE_QUOTES_PER_METHOD) throw new Error('Allocation quote schedule exceeds its bound');
  for (const size of sizes) push([...base, ...additions.slice(0, size).map(unit => unit.id)]);
  return [...choices.values()];
}
function currentEta(unit: DecisionFacts<SituationUnit>, method: ExecutableMethod, actionId: string, tick: number): AllocationEta {
  const action = method.actions.find(action => action.id === actionId)!;
  const post = action.intent.kind === 'assemble-force' ? assemblyPostForUnit(action.intent, unit) : null;
  const arrival = action.intent.kind === 'assemble-force'
    ? post && unitArrival(unit, assemblyPostArrivalId(action.id, post.id))
    : unitArrival(unit, actionId) ?? (action.target.entityId && action.target.point.x === method.actions.at(-1)?.target.point.x
    && action.target.point.y === method.actions.at(-1)?.target.point.y ? unitArrival(unit, action.target.entityId) : undefined);
  if (!arrival) return { status: 'unknown', forecastTick: tick, arrivalTick: null,
    reason: { code: 'current-action-arrival-unquoted', factIds: [unit.id, actionId], values: {} } };
  if (arrival.status === 'reachable') return { status: 'known', forecastTick: tick, arrivalTick: tick + arrival.ticks };
  return { status: arrival.status, forecastTick: tick, arrivalTick: 'ticks' in arrival ? tick + arrival.ticks : null,
    reason: { code: 'reason' in arrival ? arrival.reason.code : arrival.unmet[0]?.code ?? 'arrival-prerequisite', factIds: [unit.id, actionId], values: {} } };
}
function assignMethod(input: StrategyAllocationInput, memory: StrategyAllocationMemory, offer: Offer): StrategyAllocationMemory {
  const { snapshot, situation } = input, tick = snapshot.tick, objective = offer.objective;
  const stored = storeGoalMethod(memory, continueGoalMethod(clean(offer.method), memory));
  memory = stored.memory;
  const method = stored.method;
  const definition = method.kind === 'goal-plan' ? storeGoalObjective(memory, clean(objective)) : undefined;
  if (definition) memory = definition.memory;
  const executions = { ...memory.executions };
  let generation = memory.nextActionGeneration;
  const restart = !!memory.objectives[objective.id] && terminal(memory.objectives[objective.id]!.status);
  for (const action of method.actions) {
    const old = restart ? undefined : executions[action.id];
    if (old && old.methodId !== method.id) throw new Error('Two allocation methods share an action id');
    executions[action.id] = { ...old, token: old?.token ?? { actionId: action.id, generation: generation++ }, objectiveId: objective.id,
      methodId: method.id, executor: action.executor, intent: action.intent, target: action.target, dependsOn: [...action.dependsOn],
      completionEffects: [...action.completionEffects], ...(action.production ? { production: action.production } : {}),
      status: old?.status ?? 'waiting', phase: old?.phase ?? 'allocated', sinceTick: old?.sinceTick ?? tick,
      lastProgressTick: old?.lastProgressTick ?? tick, state: old?.state ?? {} };
    if (method.stage === 'assembly' && action.intent.kind === 'assemble-force' && old?.status === 'complete') {
      const assessment = assessForceAssemblyPosts({ snapshot, owner: situation.owner, intent: action.intent,
        unitIds: action.unitIds ?? offer.unitIds,
        interruptedUnitIds: Object.values(memory.assignments).filter(assignment => assignment.interruption).map(assignment => assignment.unitId) });
      const changed = old.intent.kind !== 'assemble-force' || old.intent.requiredForce !== action.intent.requiredForce
        || JSON.stringify([...old.intent.posts].sort((a, b) => compare(a.id, b.id)).map(post => ({ ...post, unitIds: [...post.unitIds].sort() })))
          !== JSON.stringify([...action.intent.posts].sort((a, b) => compare(a.id, b.id)).map(post => ({ ...post, unitIds: [...post.unitIds].sort() })));
      if (changed || assessment.status !== 'known' || !assessment.sufficient)
        executions[action.id] = { ...executions[action.id]!, status: 'ready', phase: 'assembling-force' };
    }
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
    const target = action.intent.kind === 'assemble-force' ? assemblyPostForUnit(action.intent, unit)?.target ?? action.target : action.target;
    const onStation = unit.location.kind === 'land' && unit.location.landId === target.landId
      && Math.hypot(unit.location.point.x - target.point.x, unit.location.point.y - target.point.y) <= (action.intent.kind === 'assemble-force' ? 180 : 240);
    const order = memory.issuedOrders[id];
    const moving = order?.observedTick === tick && sameAction(order.action, token);
    const stage = old?.interruption ? 'assigned' : onStation ? 'on-station'
      : unit.location.kind === 'aboard' || moving ? 'en-route' : 'assigned';
    leases[key] = { id: before?.id ?? `lease:${id}`, resourceKey: key, objectiveId: objective.id, methodId: method.id,
      action: token, sinceTick: before?.sinceTick ?? tick,
      minimumStayUntilTick: Math.max(before?.minimumStayUntilTick ?? tick + STRATEGY_PARAMETERS.minimumStayTicks,
        action.intent.kind === 'goal-action' && ['hold-position', 'defend'].includes(action.intent.actionKind)
          && typeof readGoalIntent(memory, action.intent).parameters.throughTick === 'number'
          ? readGoalIntent(memory, action.intent).parameters.throughTick as number : tick),
      origin: 'allocator', incumbentTask: null };
    assignments[assignmentId] = { authority: 'committed', id: assignmentId, leaseId: leases[key]!.id, unitId: id,
      role: unit.roles[0] ?? 'frontline', objectiveId: objective.id, methodId: method.id, action: token, target,
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
    const request = quoteInput(input, next, offer, { phase: 'gross' });
    const arrivals = plan.unitIds.map(id => snapshot.units.find(unit => unit.id === id)).map(unit => unit
      ? plannedVoyageArrival(request, plan, unit, plan.landingGround) : undefined);
    const expectedFreeTick = arrivals.length && arrivals.every(arrival => arrival?.status === 'reachable')
      ? tick + Math.max(...arrivals.map(arrival => arrival!.status === 'reachable' ? arrival!.ticks : 0)) : null;
    const context = plannedVoyageContext(request, plan);
    const pendingLoads = plan.unitIds.flatMap((id, index) => {
      const location = situation.units.find(unit => unit.id === id)?.location;
      if (passengers.includes(id) || location?.kind === 'land' && location.landId === plan.landingGround.landId) return [];
      const unit = snapshot.units.find(unit => unit.id === id);
      if (input.fixedVoyageLoading) {
        const forecast = unit && input.fixedVoyageLoading(unit, { shipId, seaId: plan.crossing.seaId,
          departure: plan.departure.point, landing: plan.destination.point,
          departureGround: plan.departureGround, landingGround: plan.landingGround, phase: context.phase });
        return [forecast?.status === 'known' && forecast.forecastTick === tick ? forecast.expectedLoadedTick : undefined];
      }
      const arrival = arrivals[index];
      return [arrival?.status === 'reachable'
        ? arrival.crossings.find(crossing => crossing.shipId === shipId)?.expectedLoadedTick : undefined];
    });
    const expectedLoadedTick = pendingLoads.length ? pendingLoads.every(value => typeof value === 'number' && Number.isFinite(value))
      ? Math.max(...pendingLoads as number[]) : null : prior?.expectedLoadedTick ?? null;
    const loadingForecastTick = pendingLoads.length ? expectedLoadedTick === null ? null : tick : prior?.loadingForecastTick ?? null;
    voyages[plan.id] = { id: plan.id, objectiveId: objective.id, action: next.executions[plan.actionId]!.token,
      shipAssignmentId: shipAssignment.id, crewAssignmentIds: plan.unitIds.map(id => `assignment:${id}`), passengerIds: passengers,
      departure: plan.departure, destination: plan.destination, departureGround: plan.departureGround, landingGround: plan.landingGround,
      phase: prior?.phase === 'return' ? 'return' : plannedVoyageContext(request, plan).phase, startedTick: prior?.startedTick ?? tick,
      expectedFreeTick, expectedLoadedTick, loadingForecastTick, decision: prior?.decision ?? 'continue' };
  }
  const own = Object.values(assignments).filter(assignment => assignment.objectiveId === objective.id);
  next = { ...next, leases, assignments, voyages, objectives: { ...next.objectives, [objective.id]: {
    ...(definition ? { goalDefinitionRef: definition.ref } : {}),
    objectiveId: objective.id, methodId: method.id, target: objective.target, effectKeys: objective.effects.map(allocationEffectKey), status: 'active',
    actionIds: method.actions.map(action => action.id), assignmentIds: own.map(assignment => assignment.id).sort(),
    budgetIds: [], sinceTick: memory.objectives[objective.id]?.sinceTick ?? tick,
    minimumStayUntilTick: memory.objectives[objective.id]?.minimumStayUntilTick ?? tick + STRATEGY_PARAMETERS.minimumStayTicks,
    challengerId: memory.objectives[objective.id]?.challengerId ?? null,
    challengerThinks: memory.objectives[objective.id]?.challengerThinks ?? 0,
    committedUtilityGold: offer.net?.status === 'feasible' ? offer.net.utility.score : null,
    ...(offer.net?.valuationBasis ? { valuationBasis: offer.net.valuationBasis } : {}),
    force: offer.net?.force ?? offer.gross.force } } };
  const capital = reserveAllocationSpends({ memory: next, method, actions: Object.values(next.executions).filter(action => action.methodId === method.id),
    cashGold: situation.economy.cashGold, tick });
  next = { ...capital.memory, unmet: [...capital.memory.unmet, ...capital.unmet], objectives: { ...capital.memory.objectives,
    [objective.id]: { ...capital.memory.objectives[objective.id]!, budgetIds: Object.values(capital.memory.budgets)
      .filter(budget => budget.objectiveId === objective.id && budget.state !== 'released').map(budget => budget.id).sort() } } };
  return next;
}

/** A completed expansion's garrison is an observed continuation, not a free
 * pool followed by a new recruitment. Transfer the identical cohort before
 * ordinary competition; an unpriced defense remains committed/unknown. */
function handoffCompletedGarrisons(input: StrategyAllocationInput, memory: StrategyAllocationMemory): StrategyAllocationMemory {
  for (const action of Object.values(memory.executions).sort((a, b) => compare(a.token.actionId, b.token.actionId))) {
    if (action.executor !== 'strategy.establish-garrison' || action.status !== 'complete'
      || typeof action.state.hallId !== 'string' || action.state.leasesTransferredTo) continue;
    const objective = input.objectives.find(objective => objective.kind === 'DefendSite' && objective.target.entityId === action.state.hallId);
    const method = objective && input.methods.filter(method => method.objectiveId === objective.id && method.kind === 'local-squad')
      .sort((a, b) => a.preference - b.preference || compare(a.id, b.id))[0];
    if (!objective || !method || terminal(objective.status)) continue;
    const provider = input.providers.find(provider => provider.id === method.providerId);
    if (!provider) continue;
    const assignments = Object.values(memory.assignments).filter(assignment => sameAction(assignment.action, action.token));
    const unitIds = assignments.map(assignment => assignment.unitId).sort();
    if (!unitIds.length) continue;
    const result = reprice(input, memory, provider, { objective, method, unitIds }, { phase: 'gross' });
    const leases = { ...memory.leases }, nextAssignments = { ...memory.assignments };
    const priorLeases = assignments.map(assignment => memory.leases[`unit:${assignment.unitId}`]!);
    for (const assignment of assignments) { delete leases[`unit:${assignment.unitId}`]; delete nextAssignments[assignment.id]; }
    memory = { ...memory, leases, assignments: nextAssignments };
    memory = assignMethod(input, memory, { objective, provider, method: result.method, unitIds: result.unitIds, gross: result.quote });
    const nextAssignment = memory.assignments[assignments[0]!.id];
    if (!nextAssignment || nextAssignment.objectiveId !== objective.id) throw new Error('Garrison continuation lost its existing cohort');
    memory = { ...memory, executions: { ...memory.executions, [action.token.actionId]: {
      ...memory.executions[action.token.actionId]!, state: { ...action.state, leasesTransferredTo: objective.id } } },
      objectives: { ...memory.objectives, [action.objectiveId]: { ...memory.objectives[action.objectiveId]!,
        assignmentIds: Object.values(memory.assignments).filter(assignment => assignment.objectiveId === action.objectiveId).map(assignment => assignment.id).sort() } } };
    memory = appendAllocationEvent(memory, { objectiveId: objective.id, methodId: result.method.id, action: nextAssignment.action,
      kind: 'lease-transferred', fromObjectiveId: action.objectiveId, toObjectiveId: objective.id,
      leaseIds: priorLeases.map(lease => lease.id), assignmentIds: assignments.map(assignment => assignment.id),
      reason: { code: 'observed-expansion-garrison-to-defense', factIds: unitIds, values: {} } }, input.snapshot.tick);
  }
  return memory;
}

/** Greedy whole-bundle allocation. Quote data is local to one transaction;
 * memory stores only the committed graph, not the speculative search tree. */
export function allocateStrategy(input: StrategyAllocationInput): StrategyAllocationDecision {
  const tick = input.snapshot.tick, owner = input.situation.owner;
  if (input.previous && input.previous.owner !== owner) throw new Error('Wrong allocation owner');
  let memory = restoreGoalAuthorityReferences(clean(input.previous ? structuredClone(input.previous) : createStrategyAllocationMemory(owner, tick)));
  if (memory.evaluatedTick === tick) return { memory, grants: allocationGrants(memory), events: [], unmet: memory.unmet };
  if (memory.evaluatedTick > tick) throw new Error('Allocation cannot move backwards in simulation time');
  const firstEventSequence = memory.nextEventSequence;
  memory = { ...memory, evaluatedTick: tick, revision: memory.revision + 1, unmet: [] };
  memory = observeAllocationOrders(memory, input.snapshot);
  for (const objective of input.objectives) {
    const prior = memory.objectives[objective.id];
    if (!prior || memory.methods[prior.methodId]?.stage === 'goal-plan' || terminal(prior.status) || !['DefendSite', 'Evacuate'].includes(objective.kind)
      || !terminal(objective.status) || !currentSiteThreatIsClear(input.snapshot, input.situation, objective.target)) continue;
    const executions = { ...memory.executions };
    const status = objective.kind === 'DefendSite' ? 'complete' as const : 'abandoned' as const;
    for (const id of prior.actionIds) if (executions[id] && !terminal(executions[id]!.status)) executions[id] = {
      ...executions[id]!, status, phase: 'current-site-threat-cleared', lastProgressTick: tick };
    const leases = Object.values(memory.leases).filter(lease => lease.objectiveId === objective.id);
    memory = appendAllocationEvent({ ...memory, executions, objectives: { ...memory.objectives, [objective.id]: {
      ...prior, status, committedUtilityGold: null, challengerId: null, challengerThinks: 0 } } }, {
      objectiveId: objective.id, methodId: prior.methodId, action: executions[prior.actionIds[0]!]!.token,
      kind: 'parent-invalidated', releasedLeaseIds: leases.map(lease => lease.id),
      releasedBudgetIds: Object.values(memory.budgets).filter(budget => budget.objectiveId === objective.id && budget.state !== 'released').map(budget => budget.id),
      reason: { code: 'current-site-threat-cleared', factIds: objective.target.entityId ? [objective.target.entityId] : [], values: {} } }, tick);
  }
  memory = settleAllocationState(memory, input.snapshot);
  memory = advanceAllocationLeases(memory, input.snapshot);
  memory = handoffCompletedGarrisons(input, memory);
  // A temporarily unknown quote must not preserve yesterday's relative ETA.
  // Keep the commitment, but refresh its current physical facts independently.
  memory = { ...memory, assignments: Object.fromEntries(Object.entries(memory.assignments).map(([id, assignment]) => {
    const unit = input.situation.units.find(unit => unit.id === assignment.unitId), method = memory.methods[assignment.methodId];
    return [id, unit && method?.actions.some(action => action.id === assignment.action.actionId)
      ? { ...assignment, eta: currentEta(unit, method, assignment.action.actionId, tick),
        lastLocation: unit.location.kind === 'unknown' ? { ...unit.location,
          reason: { code: unit.location.reason.code, factIds: [unit.id], values: {} } } : clean(unit.location) } : assignment];
  })) };
  const offers: Offer[] = [];
  for (const method of ordered(input.methods)) {
    const objective = input.objectives.find(objective => objective.id === method.objectiveId);
    if (!objective || terminal(objective.status)) continue;
    const provider = input.providers.find(provider => provider.id === method.providerId);
    if (!provider) throw new Error(`Missing allocation provider ${method.providerId}`);
    for (const unitIds of candidateBundles(input, memory, method)) {
      const result = reprice(input, memory, provider, { objective, method, unitIds }, { phase: 'gross' });
      if (result.method.stage === 'assembly' && offers.some(offer => offer.method.id === result.method.id
        && offer.method.stage === 'assembly' && offer.unitIds.join('\0') === result.unitIds.join('\0'))) continue;
      offers.push({ objective, method: result.method, provider, unitIds: result.unitIds, gross: result.quote });
    }
  }
  if (input.prepareVoyageRisks) {
    input = { ...input, voyageRisks: input.prepareVoyageRisks(offers.map(offer => offer.method), offers.map(offer => offer.gross)) };
    for (const offer of offers) {
      const result = reprice(input, memory, offer.provider, offer, { phase: 'gross' });
      offer.method = result.method; offer.gross = result.quote; offer.unitIds = result.unitIds;
    }
  }
  const assemblyValueUnknown = new Set<string>();
  const displacementFor = (objectiveId: string, methodId: string, unitIds: readonly string[]) =>
    (remainingUnitIds: readonly string[], window: ValuationWindow, unavailableProduction: readonly ProductionUse[], requestingObjectiveId: string) => {
      const result = input.assemblyDelayLossUpperBound!({ objectiveId, methodId, unitIds, remainingUnitIds, window, unavailableProduction });
      if (result.status === 'unknown' && result.reasonCode === 'assembly-continuation-value-unknown')
        assemblyValueUnknown.add(`${objectiveId}\0${requestingObjectiveId}`);
      return result;
    };

  const sources: BundleValuationSource[] = offers.filter(offer => offer.gross.status === 'feasible').map((offer, index) => ({
    id: `${offer.method.id}/bundle:${index}`, objectiveId: offer.objective.id, unitIds: offer.unitIds,
    ...(offer.gross.valuation?.production ? { production: offer.gross.valuation.production } : {}),
    effectKeys: offer.objective.effects.map(allocationEffectKey), committed: memory.objectives[offer.objective.id]?.methodId === offer.method.id
      && Object.values(memory.assignments).filter(assignment => assignment.objectiveId === offer.objective.id).map(assignment => assignment.unitId)
        .sort().join('\0') === [...offer.unitIds].sort().join('\0'),
    ...(offer.method.stage === 'assembly' && input.assemblyDelayLossUpperBound ? {
      assemblyDisplacement: displacementFor(offer.objective.id, offer.method.id, offer.unitIds) } : {}),
    quote: (ids, window, unavailableProduction) => {
      const result = reprice(input, memory, offer.provider, { ...offer, unitIds: ids }, { phase: 'gross', window,
        allowedUnitIds: offer.unitIds, unavailableUnitIds: offer.unitIds.filter(id => !ids.includes(id)),
        ...(offer.gross.valuation?.production ? { allowedProduction: offer.gross.valuation.production } : {}),
        ...(unavailableProduction ? { unavailableProduction } : {}) });
      return result.quote.status === 'feasible' ? { status: 'feasible', score: result.quote.utility.score,
        coverage: result.quote.valuationBasis?.kind === 'proven-lower-bound' ? 'known-effects' : 'complete' }
        : { status: result.quote.missingPreconditions.some(condition => condition.status === 'unknown') ? 'unknown' : 'not-runnable', reasonCode: result.quote.reason.code };
    },
  }));
  // A gathering cohort can temporarily have no runnable smaller quote. Its
  // independently proved finite delay/cap is still a valid displacement fact;
  // it must not disappear merely because feasible-offer filtering removed it.
  if (input.assemblyDelayLossUpperBound) for (const objective of Object.values(memory.objectives)) {
    const method = memory.methods[objective.methodId];
    if (terminal(objective.status) || method?.stage !== 'assembly' || sources.some(source => source.objectiveId === objective.objectiveId && source.committed)) continue;
    const provider = input.providers.find(provider => provider.id === method.providerId);
    const goal = input.objectives.find(goal => goal.id === objective.objectiveId);
    const unitIds = Object.values(memory.assignments).filter(assignment => assignment.objectiveId === objective.objectiveId)
      .map(assignment => assignment.unitId).sort();
    if (!provider || !goal || !unitIds.length) continue;
    sources.push({ id: `${method.id}/committed-assembly`, objectiveId: objective.objectiveId, unitIds,
      effectKeys: objective.effectKeys, committed: true, assemblyDisplacement: displacementFor(objective.objectiveId, method.id, unitIds),
      quote(ids, window, unavailableProduction) {
        const result = reprice(input, memory, provider, { objective: goal, method, unitIds: ids }, { phase: 'gross', window,
          allowedUnitIds: unitIds, unavailableUnitIds: unitIds.filter(id => !ids.includes(id)),
          ...(unavailableProduction ? { unavailableProduction } : {}) });
        return result.quote.status === 'feasible' ? { status: 'feasible', score: result.quote.utility.score,
          coverage: result.quote.valuationBasis ? 'known-effects' : 'complete' }
          : { status: result.quote.missingPreconditions.some(condition => condition.status === 'unknown') ? 'unknown' : 'not-runnable', reasonCode: result.quote.reason.code };
      } });
  }
  const continuesImported = (fromId: string, toId: string) => {
    const held = Object.values(memory.leases).filter(lease => lease.objectiveId === fromId);
    return !!held.length && held.every(lease => lease.origin === 'imported-task' && lease.incumbentTask)
      && input.continuesImported?.(fromId, toId) === true;
  };
  const oracle = createOpportunityOracle(sources, {
    continuesCommitment: continuesImported,
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
    importedUpperBoundFor: (id, window) => {
      const leases = Object.values(memory.leases).filter(lease => lease.objectiveId === id);
      // An unavailable formal-plan quote cannot be replaced with the migration
      // envelope. Only already adopted, actual producer orders qualify.
      if (!leases.length || leases.some(lease => lease.origin !== 'imported-task' || !lease.incumbentTask)) return null;
      const bound = input.importedUpperBound?.(id, window);
      return bound ? { bound, unitIds: leases.filter(lease => lease.resourceKey.startsWith('unit:'))
        .map(lease => lease.resourceKey.slice(5)).sort() } : null;
    },
  });
  for (const offer of offers) {
    if (offer.gross.status !== 'feasible') continue;
    const result = reprice(input, memory, offer.provider, offer, { phase: 'net', opportunity: oracle });
    offer.method = result.method; offer.net = result.quote; offer.unitIds = result.unitIds;
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
      return { ...offer, method: result.method, unitIds: result.unitIds, net: result.quote };
    }).filter(offer => offer.net?.status === 'feasible').sort(byUtility);
    const offer = pending.shift(); if (!offer) break;
    const quote = offer.net!;
    if (quote.status !== 'feasible' || quote.utility.score <= 0 || selected.has(offer.objective.id)
      || offer.objective.effects.some(effect => effects.has(allocationEffectKey(effect)))) continue;
    const existingObjective = memory.objectives[offer.objective.id];
    let replacing: { methodId: string; resources: ResourceLease['resourceKey'][] } | undefined;
    if (existingObjective && !terminal(existingObjective.status) && existingObjective.methodId !== offer.method.id) {
      const held = Object.values(memory.leases).filter(lease => lease.objectiveId === offer.objective.id);
      const currentMembers = Object.values(memory.assignments).filter(assignment => assignment.objectiveId === offer.objective.id)
        .map(assignment => assignment.unitId).sort().join('\0');
      const old = offers.find(old => old.method.id === existingObjective.methodId && [...old.unitIds].sort().join('\0') === currentMembers
        && old.net?.status === 'feasible');
      const resources = held.map(lease => lease.resourceKey).sort();
      const cost = input.switchingCost?.({ fromObjectiveId: offer.objective.id, toObjectiveId: offer.objective.id, resourceKeys: resources });
      const inFlight = Object.values(memory.executions).some(action => action.methodId === existingObjective.methodId
        && !terminal(action.status) && (!!action.production && action.status !== 'waiting' || action.executor === 'strategy.transport' && action.status === 'active'));
      if (old?.net?.status !== 'feasible' || cost === undefined || cost === null || !Number.isFinite(cost) || cost < 0
        || tick < existingObjective.minimumStayUntilTick || quote.utility.score <= old.net.utility.score + cost || inFlight) continue;
      replacing = { methodId: existingObjective.methodId, resources };
    }
    const conflicts = Object.values(memory.leases).filter(lease => lease.resourceKey.startsWith('unit:')
      && offer.unitIds.includes(lease.resourceKey.slice(5)) && lease.objectiveId !== offer.objective.id);
    if (conflicts.some(lease => selected.has(lease.objectiveId))) continue;
    let failed = false, switchingGold = 0;
    const transfers: { fromId: string; taken: ResourceLease[]; resourceKeys: ResourceLease['resourceKey'][];
      cost: number; loss: number; displacedLoss: NonNullable<PreemptionQuotation['displacedLoss']>; eventId: string }[] = [];
    for (const fromId of [...new Set(conflicts.map(lease => lease.objectiveId))].sort()) {
      const taken = conflicts.filter(lease => lease.objectiveId === fromId), resourceKeys = taken.map(lease => lease.resourceKey).sort();
      const cost = input.switchingCost?.({ fromObjectiveId: fromId, toObjectiveId: offer.objective.id, resourceKeys });
      const alternate = quote.valuation?.opportunity;
      const priced = alternate?.status === 'known' ? (alternate.displacements ?? alternate.alternatives)
        .find(alternative => alternative.objectiveId === fromId) : undefined;
      const continuation = continuesImported(fromId, offer.objective.id);
      const loss = continuation ? 0 : priced?.marginalGold;
      if (cost === undefined || cost === null || loss === undefined || !Number.isFinite(cost) || cost < 0
        || quote.utility.score <= cost) { failed = true; break; }
      switchingGold += cost;
      const old = memory.objectives[fromId];
      const emergency = offer.objective.kind === 'DefendSite' && input.situation.lands.flatMap(land => land.threats)
        .some(threat => threat.siteId === offer.objective.target.entityId && threat.attackers.some(attacker => attacker.intent?.kind === 'actual-intrusion'));
      if (old && !emergency && !continuation) {
        if (challenged.has(fromId) && old.challengerId !== offer.objective.id) { failed = true; break; }
        const challengerThinks = old.challengerId === offer.objective.id ? old.challengerThinks + (challenged.has(fromId) ? 0 : 1) : 1;
        challenged.add(fromId);
        memory = { ...memory, objectives: { ...memory.objectives, [fromId]: { ...old, challengerId: offer.objective.id, challengerThinks } } };
        if (tick < old.minimumStayUntilTick || challengerThinks < STRATEGY_PARAMETERS.challengerThinks) { failed = true; break; }
      }
      const displacedLoss: NonNullable<PreemptionQuotation['displacedLoss']> = priced?.assemblyDelayUpperBound
        ? { kind: 'assembly-delay-upper-bound', bound: priced.assemblyDelayUpperBound } : priced?.upperBound
          ? { kind: 'upper-bound', bound: priced.upperBound } : { kind: 'remaining-utility' };
      if (displacedLoss.kind === 'upper-bound' && taken.some(lease => lease.origin !== 'imported-task')) {
        failed = true; break;
      }
      transfers.push({ fromId, taken, resourceKeys, cost, loss, displacedLoss,
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
      const { fromId, taken, resourceKeys, cost, loss, displacedLoss } = transfer;
      const token = memory.executions[taken[0]!.action.actionId]?.token ?? taken[0]!.action;
      const remaining = Object.values(memory.assignments).filter(assignment => assignment.objectiveId === fromId
        && !resourceKeys.includes(`unit:${assignment.unitId}`));
      const handoff = acknowledgements.find(ack => ack.eventId === transfer.eventId)?.disposition ?? (remaining.length ? 'shrink' : 'pause');
      memory = appendAllocationEvent(memory, { objectiveId: fromId, methodId: taken[0]!.methodId, action: token, kind: 'preempted', handoff,
        quotation: { fromObjectiveId: fromId, toObjectiveId: offer.objective.id, resourceKeys,
          marginalBenefitGold: quote.utility.score + loss, displacedLossGold: loss, displacedLoss, switchingCostGold: cost,
          reason: { code: continuesImported(fromId, offer.objective.id) ? 'same-goal-imported-progress'
            : displacedLoss.kind === 'assembly-delay-upper-bound' ? 'same-window-assembly-delay-loss-upper-bound'
            : displacedLoss.kind === 'upper-bound' ? 'same-window-imported-loss-upper-bound' : 'same-window-marginal-reallocation',
            factIds: resourceKeys, values: {} } },
        reason: { code: 'higher-marginal-utility-after-switching', factIds: resourceKeys, values: {} } }, tick);
      const leases = { ...memory.leases }, assignments = { ...memory.assignments };
      for (const lease of taken) { delete leases[lease.resourceKey]; delete assignments[`assignment:${lease.resourceKey.slice(5)}`]; }
      const prior = memory.objectives[fromId];
      memory = { ...memory, leases, assignments, ...(prior ? { objectives: { ...memory.objectives, [fromId]: { ...prior,
        assignmentIds: remaining.map(assignment => assignment.id).sort(), committedUtilityGold: null,
        challengerId: null, challengerThinks: 0, status: handoff === 'shrink' ? prior.status : 'paused' } } } : {}) };
    }
    if (replacing) {
      const oldActions = Object.values(memory.executions).filter(action => action.methodId === replacing!.methodId);
      const leases = { ...memory.leases }, assignments = { ...memory.assignments }, budgets = { ...memory.budgets };
      const oldLeaseIds = replacing.resources.map(key => leases[key]!.id);
      for (const key of replacing.resources) { delete leases[key]; if (key.startsWith('unit:')) delete assignments[`assignment:${key.slice(5)}`]; }
      for (const budget of Object.values(budgets)) if (budget.methodId === replacing.methodId)
        budgets[budget.id] = { ...budget, state: 'released', releasedTick: tick };
      memory = appendAllocationEvent(memory, { objectiveId: offer.objective.id, methodId: replacing.methodId,
        action: oldActions[0]!.token, kind: 'parent-invalidated', releasedLeaseIds: oldLeaseIds,
        releasedBudgetIds: Object.values(budgets).filter(budget => budget.methodId === replacing!.methodId).map(budget => budget.id),
        reason: { code: 'same-objective-method-replaced-after-current-requote', factIds: replacing.resources, values: {} } }, tick);
      memory = { ...memory, leases, assignments, budgets,
        methods: Object.fromEntries(Object.entries(memory.methods).filter(([id]) => id !== replacing!.methodId)),
        executions: Object.fromEntries(Object.entries(memory.executions).filter(([, action]) => action.methodId !== replacing!.methodId)) };
    }
    const renewal = !!memory.objectives[offer.objective.id] && !terminal(memory.objectives[offer.objective.id]!.status);
    memory = assignMethod(input, memory, offer); selected.add(offer.objective.id);
    if (quote.valuationBasis) {
      const basis = quote.valuationBasis, action = offer.method.actions[0] && memory.executions[offer.method.actions[0].id]?.token;
      const counts = memory.decisionCounts;
      memory = { ...memory, decisionCounts: { ...counts, lowerBoundSelections: (counts?.lowerBoundSelections ?? 0) + 1,
        lowerBoundInitialSelections: (counts?.lowerBoundInitialSelections ?? 0) + Number(!renewal) } };
      if (action) memory = appendAllocationEvent(memory, { objectiveId: offer.objective.id, methodId: offer.method.id, action,
        kind: 'valuation-bound-selected', basis, scoreGold: quote.utility.score, renewal,
        reason: { code: 'selected-proven-lower-bound', factIds: offer.unitIds,
          values: { probabilityLower: basis.probabilityLower, probabilityUpper: basis.probabilityUpper,
            unresolvedProbability: basis.unresolvedProbability } } }, tick);
    }
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
  if (assemblyValueUnknown.size) memory = { ...memory, decisionCounts: {
    lowerBoundSelections: memory.decisionCounts?.lowerBoundSelections ?? 0,
    lowerBoundInitialSelections: memory.decisionCounts?.lowerBoundInitialSelections ?? 0,
    assemblyValueUnknownComparisons: (memory.decisionCounts?.assemblyValueUnknownComparisons ?? 0) + assemblyValueUnknown.size } };
  memory = pruneAllocationProvenance(memory);
  assertStrategyAllocationBounds(memory);
  return { memory, grants: allocationGrants(memory), events: memory.events.filter(event =>
    Number(event.id.slice(event.id.lastIndexOf(':') + 1)) >= firstEventSequence), unmet: memory.unmet };
}
