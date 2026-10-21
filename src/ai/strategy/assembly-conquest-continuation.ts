import { UNIT_DEFS, unitMover } from '../../shared/catalog';
import { fnv1a } from '../../shared/sim/checksum';
import { isTransportKind } from '../../shared/transport-role';
import type { BuildingJob, GameSnapshot, Unit } from '../../shared/types';
import { strengthOf } from '../policy/v6/strength';
import { assessAllocatedForce, targetEnemyReinforcements } from './allocated-force';
import { allocatedVoyageValue } from './allocated-voyage-value';
import type { AllocationArrivalReader } from './allocation-arrival-query';
import type { AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason, ExecutableMethod } from './allocation-types';
import type { AssemblyFactsRequest } from './assembly-facts';
import { assessmentArrival, type AssemblyAssessmentCohort } from './assembly-supply-reader';
import { unitRoles } from './commitments';
import { conquestFacts } from './conquest-facts';
import { conquestMethodProvider } from './conquest-methods';
import type { ConquestContinuationInput } from './conquest-value';
import type { DecisionFacts } from './decision';
import { productionUsesOverlap } from './production-use';
import { landIdAt, unitLocation } from './regions';
import { strategicTargetCamp } from './target-camp';
import type { Arrival, Situation, SituationUnit, ValuationWindow } from './types';
import { valuationWindow } from './utility';

export type PreparedAssemblyConquestContinuation = Readonly<{
  pathId: string; readyTick: number; delayTicks: number;
  method: ExecutableMethod | null;
  /** Evaluation-only input for the one external risk batch and pure repricing.
   * Never copy it, its prototype IDs or its callbacks to authority memory. */
  materializedInput: AllocationMethodQuoteInput | null;
  window: ValuationWindow | null; realUnitIds: readonly string[];
  preparationMissing: readonly AllocationPrecondition[];
  settlement: (ConquestContinuationInput & Readonly<{ coverage: 'known-effects' }>) | null;
  missing: readonly AllocationPrecondition[]; assumptions: readonly AllocationReason[];
  coverage: 'known-effects'; completedInTicks: number | null;
}>;
type Input = Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; request: AssemblyFactsRequest;
  cohort: AssemblyAssessmentCohort; skeleton: ExecutableMethod;
  executions: AllocationMethodQuoteInput['executions']; budgets: AllocationMethodQuoteInput['budgets'];
  arrival: AllocationArrivalReader; fixedVoyageArrival?: AllocationMethodQuoteInput['fixedVoyageArrival'];
  voyageRisks?: AllocationMethodQuoteInput['voyageRisks'];
}>;
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const finite = (value: number) => Number.isFinite(value) && value >= 0;
const reason = (code: string, factIds: readonly string[], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const condition = (methodId: string, code: string, factIds: readonly string[], status: 'unknown' | 'unmet' = 'unknown',
  kind: AllocationPrecondition['kind'] = 'route'): AllocationPrecondition => ({ id: `${methodId}/${code}:${factIds.join(',')}`,
  kind, status, reason: reason(code, factIds), demand: null, subgoalIds: [] });
const unique = (missing: readonly AllocationPrecondition[]) => [...new Map(missing.map(fact => [fact.id, fact])).values()];

/** Relative routes move to the assembly-ready epoch once. Unknowns remain
 * unknown; an old search cutoff becomes a correspondingly shorter lower bound. */
function afterDelay(arrival: DecisionFacts<Arrival>, delay: number): DecisionFacts<Arrival> {
  if ('ticks' in arrival) return { ...arrival, ticks: Math.max(0, arrival.ticks - delay),
    landTicks: Math.max(0, arrival.landTicks - delay) };
  return typeof arrival.lowerBoundTicks === 'number' ? { ...arrival, lowerBoundTicks: Math.max(0, arrival.lowerBoundTicks - delay) } : arrival;
}
function queueAfter(queue: readonly BuildingJob[], delay: number): BuildingJob[] {
  let elapsed = delay;
  return queue.flatMap(job => {
    const work = Math.max(1, Math.ceil(job.remaining)), consumed = Math.min(elapsed, work);
    elapsed -= consumed;
    return consumed === work ? [] : [{ ...job, remaining: work - consumed }];
  });
}
function remainingWindow(window: ValuationWindow, delay: number): ValuationWindow | null {
  const horizonTicks = window.horizonTicks - delay;
  if (horizonTicks <= 0) return null;
  const taskTicks = Math.max(0, window.taskTicks - delay);
  return { taskTicks, holdingTicks: horizonTicks - taskTicks, horizonTicks, discountTicks: window.discountTicks };
}

/** Prepare one empirical path using the current transaction's readers. Only
 * assessment copies move to posts; real support assets must be named by the
 * explicit response pool. No query, Situation, risk sampler or budget is built. */
export function prepareAssemblyConquestContinuation(input: Input): PreparedAssemblyConquestContinuation {
  const { snapshot, situation, request, cohort } = input, now = snapshot.tick, delay = cohort.readyTick - now;
  const missing = cohort.missing.map(fact => condition(request.methodId, fact.code, fact.factIds, fact.status));
  const assumptions: AllocationReason[] = [reason('assembly-continuation-observed-world-held', cohort.sourceFactIds,
    { forecastTick: now, readyTick: cohort.readyTick, coverage: 'known-effects' })];
  const result = (patch: Partial<PreparedAssemblyConquestContinuation> = {}): PreparedAssemblyConquestContinuation => ({
    pathId: cohort.pathId, readyTick: cohort.readyTick, delayTicks: delay, method: null, materializedInput: null,
    settlement: null, window: request.valuation?.window ?? null, realUnitIds: cohort.realUnitIds,
    preparationMissing: unique(missing), missing: unique(missing), assumptions, coverage: 'known-effects', completedInTicks: null, ...patch });
  const add = (code: string, ids: readonly string[], status: 'unknown' | 'unmet' = 'unknown', kind: AllocationPrecondition['kind'] = 'route') =>
    missing.push(condition(request.methodId, code, ids, status, kind));
  if (!cohort.pathId || !finite(delay) || situation.tick !== now || request.objective.kind !== 'ConquerIsland'
    || !request.campTarget.landId || request.objective.owner !== situation.owner
    || request.objective.target.point.x !== request.campTarget.point.x || request.objective.target.point.y !== request.campTarget.point.y
    || request.objective.target.landId !== request.campTarget.landId) {
    add('assembly-continuation-context-unquoted', [cohort.pathId, request.objective.id]); return result();
  }
  let futureWindow: ValuationWindow | undefined;
  if (request.valuation?.window) {
    try { valuationWindow(request.valuation.window.taskTicks, request.valuation); }
    catch { add('assembly-continuation-window-invalid', [cohort.pathId]); return result(); }
    const remaining = remainingWindow(request.valuation.window, delay);
    if (!remaining) { add('assembly-ready-outside-valuation-window', [cohort.pathId], 'unmet'); return result(); }
    futureWindow = remaining;
  }
  const unavailable = new Set([...(request.valuation?.unavailableUnitIds ?? []), ...(request.interruptedUnitIds ?? [])]);
  const eligible = new Set(request.responseEligibleUnitIds ?? []), assigned = new Set(request.unitIds);
  const actors = new Map(snapshot.units.map(unit => [unit.id, unit])), real = new Set(cohort.realUnitIds), projected: Unit[] = [];
  for (const copy of [...cohort.units].sort(byId)) {
    const actual = actors.get(copy.id), isReal = real.has(copy.id);
    if (copy.owner !== situation.owner || copy.hp <= 0 || unitMover(copy.kind) !== 'land' || copy.kind === 'worker'
      || copy.attackDamage <= 0 || copy.expiresTick !== undefined || unavailable.has(copy.id)
      || isReal && (!actual || actual.owner !== situation.owner || !assigned.has(copy.id) || actual.hp <= 0 || actual.deck || actual.cabin
        || actual.kind === 'worker' || unitMover(actual.kind) !== 'land' || actual.attackDamage <= 0 || actual.expiresTick !== undefined)
      || !isReal && (actual || !copy.id.startsWith('assembly-assessment:'))) {
      add('assembly-continuation-cohort-source-invalid', [copy.id], 'unknown', 'force'); continue;
    }
    const post = request.posts.find(post => post.unitIds.includes(copy.id))
      ?? request.posts.find(post => post.target.point.x === copy.x && post.target.point.y === copy.y);
    if (!post || !post.target.landId || landIdAt(snapshot.map, post.target.point) !== post.target.landId
      || actual && landIdAt(snapshot.map, actual) !== post.target.landId) {
      add('assembly-continuation-member-post-unquoted', [copy.id], 'unknown', 'force'); continue;
    }
    const unit = { ...(isReal ? actual! : copy), x: post.target.point.x, y: post.target.point.y,
      order: { type: 'hold' as const, x: post.target.point.x, y: post.target.point.y } };
    delete unit.deck; delete unit.cabin; delete unit.orderQueue;
    projected.push(unit);
  }
  if (new Set(projected.map(unit => unit.id)).size !== projected.length || !projected.length)
    add('assembly-continuation-cohort-empty-or-duplicated', projected.map(unit => unit.id), 'unmet', 'force');
  const camp = strategicTargetCamp(snapshot, request.campTarget);
  if (camp && !assessAllocatedForce(situation.owner, projected, { metric: 'camp-force', camp }).sufficient) {
    add('assembly-continuation-clearing-cohort-insufficient', projected.map(unit => unit.id), 'unmet', 'force'); return result();
  }
  if (!request.responseEligibleUnitIds) add('assembly-support-pool-unquoted', [], 'unknown', 'workers');
  const routeRows = new Map<string, DecisionFacts<Arrival>>();
  const route = (unit: Unit, assessment = false) => {
    const found = routeRows.get(unit.id); if (found) return found;
    const arrival = assessment ? assessmentArrival(input.arrival, unit, request.campTarget) : input.arrival(unit, request.campTarget);
    routeRows.set(unit.id, arrival); return arrival;
  };
  projected.forEach(unit => route(unit, true));
  const workerCandidates = snapshot.units.filter(unit => unit.owner === situation.owner && unit.hp > 0 && unit.kind === 'worker'
    && !unit.deck && !unit.cabin && !unavailable.has(unit.id) && (eligible.has(unit.id) || assigned.has(unit.id)))
    .map(unit => ({ unit, arrival: route(unit) }));
  const workers = workerCandidates.filter(pair => 'ticks' in pair.arrival)
    .sort((a, b) => ('ticks' in a.arrival ? a.arrival.ticks : Infinity) - ('ticks' in b.arrival ? b.arrival.ticks : Infinity) || byId(a.unit, b.unit));
  const engineer = workers[0]?.unit;
  if (!engineer) {
    const unresolved = workerCandidates.filter(pair => pair.arrival.status === 'unknown');
    add(unresolved.length ? 'assembly-construction-worker-route-unknown' : 'assembly-construction-worker-unavailable',
      (unresolved.length ? unresolved : workerCandidates).map(pair => pair.unit.id),
      unresolved.length || !request.responseEligibleUnitIds ? 'unknown' : 'unmet', 'workers');
  }
  const selected = [...projected.map(unit => unit.id), ...(engineer ? [engineer.id] : [])], hulls = new Set<string>();
  for (const unit of [...projected, ...(engineer ? [engineer] : [])]) {
    const arrival = routeRows.get(unit.id)!;
    if (!('ticks' in arrival)) { add(arrival.reason.code, [unit.id], arrival.status === 'unreachable' ? 'unmet' : 'unknown'); continue; }
    for (const crossing of arrival.crossings) {
      if (crossing.requiresNewShip) {
        const yard = snapshot.buildings.find(building => building.id === crossing.productionBuildingId
          && building.owner === situation.owner && building.complete && building.hp > 0 && building.kind === 'shipyard');
        if (!yard || request.valuation?.allowedProduction && !request.valuation.allowedProduction.some(use => use.buildingId === yard.id && use.lane === 'training'))
          add('assembly-continuation-ship-producer-unavailable', crossing.productionBuildingId ? [crossing.productionBuildingId] : [], yard ? 'unmet' : 'unknown', 'production');
      } else {
        const hull = crossing.shipId ? actors.get(crossing.shipId) : undefined;
        if (!hull || hull.owner !== situation.owner || hull.hp <= 0 || !isTransportKind(hull.kind)
          || unavailable.has(hull.id) || !eligible.has(hull.id) && !assigned.has(hull.id))
          add('assembly-continuation-hull-unavailable', crossing.shipId ? [crossing.shipId] : [], hull ? 'unmet' : 'unknown', 'transport');
        else { hulls.add(hull.id); selected.push(hull.id); }
      }
    }
  }
  const projectedById = new Map(projected.map(unit => [unit.id, unit]));
  const additionalSupply = projected.filter(unit => !actors.has(unit.id)).reduce((sum, unit) => sum + UNIT_DEFS[unit.kind].supplyUsed, 0);
  const future: GameSnapshot = { ...snapshot, tick: cohort.readyTick,
    players: { ...snapshot.players, [situation.owner]: { ...snapshot.players[situation.owner]!,
      supplyUsed: snapshot.players[situation.owner]!.supplyUsed + additionalSupply } },
    units: [...snapshot.units.map(unit => projectedById.get(unit.id) ?? unit), ...projected.filter(unit => !actors.has(unit.id))],
    buildings: snapshot.buildings.map(building => building.owner === situation.owner && building.complete
      ? { ...building, queue: queueAfter(building.queue, delay) } : building) };
  if (delay) assumptions.push(reason('assembly-paid-work-consumed-without-unobserved-births',
    snapshot.buildings.filter(building => building.owner === situation.owner && building.queue.length).map(building => building.id), { elapsedTicks: delay }));
  const enemies = targetEnemyReinforcements({ snapshot, situation, target: request.campTarget,
    battleStartTicks: delay, windowTicks: request.valuation?.window?.horizonTicks ?? 2400 }).candidateEnemies;
  const enemyIds = new Set(enemies.map(unit => unit.id));
  for (const unit of enemies) routeRows.set(unit.id, afterDelay(input.arrival(unit, request.campTarget), delay));
  // Counterfactual response is still the explicit current pool; no unrelated
  // real soldier becomes a hidden member of the future clearing cohort.
  for (const id of eligible) {
    const unit = actors.get(id);
    if (unit && unit.owner === situation.owner && unit.kind !== 'worker' && unitMover(unit.kind) === 'land'
      && !unavailable.has(id) && !selected.includes(id)) route(unit);
  }
  const futureActors = new Map(future.units.map(unit => [unit.id, unit]));
  const priorRows = new Map(situation.units.map(unit => [unit.id, unit]));
  const futureRows: DecisionFacts<SituationUnit>[] = future.units.filter(unit => unit.hp > 0).map(unit => {
    const prior = priorRows.get(unit.id), ownProjection = projectedById.has(unit.id);
    const arrivals = (prior?.arrivals ?? []).map(entry => ({ targetId: entry.targetId,
      arrival: enemyIds.has(unit.id) ? afterDelay(entry.arrival, delay) : entry.arrival }));
    const arrival = routeRows.get(unit.id);
    if (arrival) {
      const index = arrivals.findIndex(row => row.targetId === (request.campTarget.entityId ?? ''));
      const entry = { targetId: request.campTarget.entityId ?? '', arrival };
      if (index >= 0) arrivals[index] = entry; else arrivals.push(entry);
    }
    return { id: unit.id, owner: unit.owner, kind: unit.kind,
      location: ownProjection ? unitLocation(future.map, unit, futureActors, future.tick) : prior?.location ?? unitLocation(future.map, unit, futureActors, future.tick),
      hp: unit.hp, maxHp: unit.maxHp, strength: ownProjection || !prior ? strengthOf([unit]) : prior.strength,
      roles: prior?.roles ?? unitRoles(unit), expiresTick: unit.expiresTick ?? null, commitments: prior?.commitments ?? [], arrivals };
  });
  const futureSituation: DecisionFacts<Situation> = { ...situation, tick: future.tick, units: futureRows };
  const identity = `assembly-assessment:${fnv1a(JSON.stringify([request.methodId, cohort.pathId, cohort.readyTick,
    projected.map(unit => [unit.id, unit.x, unit.y])]))}:hulls:${[...hulls].sort().join(',') || 'none'}`;
  // The caller retains the original full skeleton. Rebuilding here would
  // choose posts again and could invoke native reachability outside our reader.
  const built = input.skeleton;
  if (!built.actions.some(action => action.intent.kind === 'deliver-force') || built.objectiveId !== request.objective.id) {
    add('assembly-continuation-skeleton-unquoted', [request.methodId]); return result();
  }
  const id = (value: string) => value.startsWith(built.id) ? identity + value.slice(built.id.length) : value;
  const skeleton: ExecutableMethod = { ...built, id: identity, stage: 'execution',
    actions: built.actions.map(action => ({ ...action, id: id(action.id), dependsOn: action.dependsOn.map(id), spendIds: action.spendIds.map(id) })),
    spends: built.spends.map(spend => ({ ...spend, spendId: id(spend.spendId) })), preconditions: [], voyagePlans: [] };
  const futureValuation = { ...request.valuation, phase: 'gross' as const, ...(futureWindow ? { window: futureWindow } : {}),
    ...(request.valuation?.unavailableProduction ? { unavailableProduction: request.valuation.unavailableProduction.filter(use => use.throughTicks > delay)
      .map(use => ({ ...use, fromTicks: Math.max(0, use.fromTicks - delay), throughTicks: use.throughTicks - delay })) } : {}) };
  const concrete: AllocationMethodQuoteInput = { snapshot: future, situation: futureSituation, objective: request.objective,
    method: skeleton, unitIds: [...new Set(selected)].sort(), budgets: input.budgets, executions: input.executions,
    responseEligibleUnitIds: request.responseEligibleUnitIds ?? [], ...(request.interruptedUnitIds ? { interruptedUnitIds: request.interruptedUnitIds } : {}),
    valuation: futureValuation, ...(input.fixedVoyageArrival ? { fixedVoyageArrival: input.fixedVoyageArrival } : {}),
    ...(input.voyageRisks ? { voyageRisks: input.voyageRisks } : {}) };
  const method = conquestMethodProvider.materialize!(concrete);
  const tails = new Map<string, number>();
  for (const action of method.actions.filter(action => action.executor === 'strategy.train-transport')) {
    const yard = future.buildings.find(building => building.id === action.target.entityId);
    if (!yard) continue;
    const fromTicks = tails.get(yard.id) ?? yard.queue.reduce((sum, job) => sum + job.remaining, 0);
    const throughTicks = fromTicks + UNIT_DEFS.transport.trainTime;
    if (productionUsesOverlap([{ buildingId: yard.id, lane: 'training', fromTicks, throughTicks }], futureValuation.unavailableProduction ?? []))
      add('assembly-continuation-transport-production-unavailable', [yard.id, action.id], 'unmet', 'production');
    tails.set(yard.id, throughTicks);
  }
  const materializedInput = { ...concrete, method };
  const prepared = result({ method, materializedInput,
    realUnitIds: [...new Set([...cohort.realUnitIds, ...(engineer ? [engineer.id] : []), ...hulls])].sort() });
  return settlePreparedAssemblyConquestContinuation(prepared, input.voyageRisks);
}

/** Consume a published batch only. There is no materialization, route request,
 * risk work or opportunity callback in this phase. */
export function settlePreparedAssemblyConquestContinuation(prepared: PreparedAssemblyConquestContinuation,
  voyageRisks?: AllocationMethodQuoteInput['voyageRisks']): PreparedAssemblyConquestContinuation {
  if (!prepared.materializedInput) return prepared;
  const risks = voyageRisks ?? prepared.materializedInput.voyageRisks;
  const input = { ...prepared.materializedInput, ...(risks ? { voyageRisks: risks } : {}) }, method = input.method;
  const facts = conquestFacts(input), voyages = allocatedVoyageValue(input);
  const missing = [...prepared.preparationMissing];
  missing.push(...method.preconditions.filter(fact => fact.status !== 'met').map(fact => ({ ...fact,
    reason: { code: fact.reason.code, factIds: fact.reason.factIds ?? [], values: fact.reason.values ?? {} } })));
  for (const fact of [...facts.unknown, ...voyages.unknown]) missing.push(condition(method.id, fact.code, fact.ids));
  // A staffed partial curve is a known effect, as in the formal conquest
  // quote. Missing optional extra workers cannot erase its measured income;
  // facts.unknown still blocks a missing capacity or wholly unknown curve.
  const assumptions = [...new Map([...prepared.assumptions, ...facts.forecast.unknown.map(fact =>
    reason(fact.code, fact.entityIds, { coverage: 'known-effects' }))]
    .map(fact => [JSON.stringify([fact.code, fact.factIds]), fact])).values()];
  const actual = facts.battle.ourForce, required = facts.battle.requiredForce;
  if (!facts.cleared && actual !== null && required !== null && actual < required)
    missing.push(condition(method.id, 'insufficient-assembled-clearing-force', facts.fighters.map(unit => unit.id), 'unmet', 'force'));
  const ready = facts.hallReadyTicks, completedInTicks = finite(ready) ? prepared.delayTicks + ready : null;
  const window = prepared.window ?? valuationWindow(completedInTicks ?? prepared.delayTicks);
  const settlement: PreparedAssemblyConquestContinuation['settlement'] = missing.length ? null : { facts, voyages, method,
    remainingOre: input.snapshot.resources.find(mine => mine.id === input.objective.target.entityId)?.amount ?? 0,
    persistenceBonus: input.objective.utility.persistenceBonus,
    realUnitIds: prepared.realUnitIds,
    window, delayTicks: prepared.delayTicks, coverage: 'known-effects' };
  return { ...prepared, materializedInput: input, settlement, window, assumptions, missing: unique(missing), completedInTicks };
}
