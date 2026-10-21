import { UNIT_DEFS } from '../../shared/catalog';
import type { Unit } from '../../shared/types';
import { assessAllocatedForce } from './allocated-force';
import { allocatedVoyageValue } from './allocated-voyage-value';
import type { AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason, AllocationUtility,
  ForceQuotation, MethodAllocationQuote } from './allocation-types';
import { arrivalWeightedForce } from './arrival-force';
import { conquestFacts } from './conquest-facts';
import type { ProductionUse } from './types';
import { resolveValuation } from './utility';
import { valueConquestContinuation } from './conquest-value';
import { assertUnitValueSides } from './unit-value-ledger';

export function quoteConquestMethod(input: AllocationMethodQuoteInput): MethodAllocationQuote {
  const { method, objective, situation, snapshot } = input, facts = conquestFacts(input);
  const missing: AllocationPrecondition[] = method.preconditions.filter(condition => condition.status !== 'met')
    .map(condition => ({ ...condition, reason: { code: condition.reason.code,
      factIds: condition.reason.factIds ?? [], values: condition.reason.values ?? {} } }));
  const add = (code: string, ids: readonly string[] = [], kind: AllocationPrecondition['kind'] = 'route') => missing.push({
    id: `${method.id}/${code}:${ids.join(',')}`, kind, status: /unknown|unpublished|unquoted|unobserved/.test(code) ? 'unknown' : 'unmet',
    reason: { code, factIds: ids, values: {} }, demand: method.demands[0] ?? null, subgoalIds: [] });
  if (facts.members.length !== new Set(input.unitIds).size) add('allocated-member-no-longer-present', input.unitIds, 'force');
  const actualForce = facts.cleared ? facts.survivingPermanentCampForce : facts.battle.ourForce;
  const declaredForce = method.demands.reduce((maximum, demand) => demand.kind === 'force' ? Math.max(maximum, demand.strength) : maximum, 0);
  const requirement = Math.max(1, facts.cleared ? 0 : facts.battle.requiredForce ?? declaredForce);
  if (actualForce !== null && actualForce < requirement) missing.push({
    id: `${method.id}/clearing-force`, kind: 'force', status: 'unmet',
    reason: { code: actualForce === 0 ? 'clearing-force' : 'insufficient-assembled-clearing-force',
      factIds: facts.fighters.map(unit => unit.id), values: { allocatedForce: actualForce, requiredForce: requirement,
        deficit: requirement - actualForce } },
    demand: { kind: 'force', metric: 'camp-force', strength: requirement, roles: ['frontline', 'ranged'],
      at: objective.target, neededByTick: null, permanent: true }, subgoalIds: [],
  });
  facts.unknown.forEach(value => add(value.code, value.ids));
  const assessment = (group: readonly Unit[]) => assessAllocatedForce(situation.owner, group,
    { metric: 'camp-force', camp: facts.battle.engagement.opposition, requiredForce: requirement }).force;
  const weighted = arrivalWeightedForce(facts.fighters.filter(unit => facts.onStation.has(unit.id)),
    facts.fighters.filter(unit => !facts.onStation.has(unit.id) && facts.arrivals.has(unit.id))
      .map(unit => ({ unit, etaTicks: facts.arrivals.get(unit.id)! })), situation.horizonTicks, assessment);
  const force: ForceQuotation = { metric: 'camp-force', target: objective.target,
    onStationUnitIds: facts.fighters.filter(unit => facts.onStation.has(unit.id)).map(unit => unit.id).sort(),
    enRouteUnitIds: facts.fighters.filter(unit => !facts.onStation.has(unit.id) && facts.arrivals.has(unit.id)).map(unit => unit.id).sort(),
    unavailableUnitIds: [], unknownUnitIds: facts.fighters.filter(unit => !facts.arrivals.has(unit.id)).map(unit => unit.id).sort(),
    onStationForce: weighted.onStationForce, effectiveForce: weighted.effectiveForce, discountedEnRouteForce: weighted.discountedEnRouteForce,
    requiredForce: requirement, evaluationUntilTick: snapshot.tick + facts.window.horizonTicks };
  const recruitment = method.actions.filter(action => action.executor === 'strategy.train-worker');
  if (recruitment.length < facts.forecast.training.length || facts.forecast.workers.some(worker => !['paid-queue', 'train-worker'].includes(worker.source)
    && !method.actions.some(action => action.executor === 'strategy.start-mining' && action.unitIds?.includes(worker.unitId))))
    add('mining-workforce-prerequisite-plan-unmaterialized', [objective.target.entityId ?? ''], 'workers');
  const production: ProductionUse[] = [...facts.forecast.production];
  const tails = new Map<string, number>();
  for (const action of method.actions.filter(action => action.executor === 'strategy.train-transport')) {
    const execution = input.executions.find(execution => execution.token.actionId === action.id);
    if (execution?.status === 'complete') continue;
    const yard = snapshot.buildings.find(building => building.id === action.target.entityId && building.owner === situation.owner && building.kind === 'shipyard');
    if (!yard) { add('transport-producer-unobserved', [action.id], 'production'); continue; }
    const observed = execution?.state.observedNativeJobId;
    const at = typeof observed === 'string' ? yard.queue.findIndex(job => job.id === observed) : -1;
    if (execution?.state.observedProduction === true && at < 0) { add('transport-production-progress-unobserved', [action.id], 'production'); continue; }
    const fromTicks = at >= 0 ? yard.queue.slice(0, at).reduce((sum, job) => sum + job.remaining, 0)
      : Math.max(tails.get(yard.id) ?? 0, yard.queue.reduce((sum, job) => sum + job.remaining, 0));
    const throughTicks = fromTicks + (at >= 0 ? yard.queue[at]!.remaining : UNIT_DEFS.transport.trainTime);
    if (throughTicks > fromTicks) production.push({ buildingId: yard.id, lane: 'training', fromTicks, throughTicks });
    tails.set(yard.id, throughTicks);
  }
  const valuation = resolveValuation({ objectiveId: objective.id, methodId: method.id, unitIds: input.unitIds,
    production, window: facts.window }, input.valuation);
  if (valuation.phase === 'net' && valuation.opportunity?.status !== 'known') add('committed-opportunity-cost-unknown', input.unitIds);
  const voyages = allocatedVoyageValue(input);
  voyages.unknown.forEach(value => add(value.code, value.ids));
  const continuation = valueConquestContinuation({ method, facts, voyages,
    remainingOre: snapshot.resources.find(mine => mine.id === objective.target.entityId)?.amount ?? 0,
    persistenceBonus: objective.utility.persistenceBonus, realUnitIds: snapshot.units.map(unit => unit.id) });
  const { benefit, successProbability: probability, persistenceBonus } = continuation.utility;
  const { forceSurvival, workerSurvival, battleProbability, postSurvival } = continuation;
  const cost = [
    ...continuation.utility.cost,
    ...(valuation.opportunity?.status === 'known' ? [{ code: 'bundle-opportunity', value: valuation.opportunity.gold }] : []),
  ];
  const utility: AllocationUtility = { horizonTicks: facts.window.horizonTicks, benefit, cost, successProbability: probability,
    persistenceBonus, score: probability * benefit.reduce((sum, term) => sum + term.value, 0)
      - cost.reduce((sum, term) => sum + term.value, 0) + persistenceBonus };
  assertUnitValueSides(utility);
  const reason: AllocationReason = { code: missing[0]?.reason.code ?? 'concrete-arrival-clearing-and-staffing-plan-feasible',
    factIds: facts.fighters.map(unit => unit.id), values: { requiredForce: requirement, assembledForce: actualForce,
      actualOpponentForce: facts.cleared ? 0 : facts.battle.actualOpponentForce, currentEffectiveForce: weighted.effectiveForce,
      latestArrivalTicks: facts.latestArrivalTicks, combatTicks: facts.cleared ? 0 : facts.battle.durationTicks,
      hallReadyTicks: facts.hallReadyTicks, battleProbability, postSurvival, forceSurvival, workerSurvival,
      forecastWorkers: facts.forecast.workers.length, trainingGold: facts.forecast.trainingGold, netCapitalCash: facts.netCapitalCash } };
  return missing.length ? { methodId: method.id, status: 'blocked', force, valuation, utility: null, potentialUtility: null,
    missingPreconditions: missing, reason } : { methodId: method.id, status: 'feasible', force, valuation, utility, potentialUtility: null,
    missingPreconditions: [], reason };
}
