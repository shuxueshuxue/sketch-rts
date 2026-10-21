import { unitMover } from '../../shared/catalog';
import { assessAllocatedForce } from './allocated-force';
import type { AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason, AllocationUtility,
  ExecutableMethod, ForceQuotation, MethodAllocationQuote } from './allocation-types';
import { assessForceAssemblyPosts } from './assembly-posts';
import { bindConquestAssemblyPosts } from './conquest-rallies';
import { strategicTargetCamp } from './target-camp';
import { assertUnitValueSides } from './unit-value-ledger';
import { resolveValuation, sameValuationWindow, valuationWindow } from './utility';

export const forceAssemblyActionId = (methodId: string) => `${methodId}/assemble-force`;

/** A partial cohort obtains only a gathering action. It reserves neither hall
 * capital nor a future ship/engineer, and never adopts a forecast recruit. */
export function materializeConquestAssembly(input: AllocationMethodQuoteInput): ExecutableMethod | undefined {
  if (input.objective.kind !== 'ConquerIsland') return undefined;
  const { snapshot, method, objective } = input, actionId = forceAssemblyActionId(method.id);
  const camp = strategicTargetCamp(snapshot, objective.target);
  if (!camp) return undefined;
  const departed = input.executions.some(action => action.methodId === method.id && ['active', 'complete'].includes(action.status)
    && ['deliver-force', 'clear-camp'].includes(action.intent.kind));
  if (departed) return undefined;
  const selected = new Set(input.unitIds);
  const fighters = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === objective.owner && unit.hp > 0
    && unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0 && unit.expiresTick === undefined);
  const assessment = assessAllocatedForce(objective.owner, fighters, { metric: 'camp-force', camp });
  const previous = input.executions.find(action => action.token.actionId === actionId);
  // An initially sufficient batch retains the existing direct execution path.
  // A persistent partial batch must physically reach its posts first.
  if (assessment.sufficient && !previous) return undefined;
  const bound = bindConquestAssemblyPosts({ ...input, methodId: method.id });
  const intent = { kind: 'assemble-force' as const, campTarget: objective.target, requiredForce: assessment.requiredForce, posts: bound.posts };
  const current = assessForceAssemblyPosts({ snapshot, owner: objective.owner, intent, unitIds: bound.unitIds });
  if (!bound.missing.length && current.status === 'known' && current.sufficient) return undefined;
  const target = bound.posts.find(post => post.unitIds.length)?.target ?? bound.posts[0]?.target ?? objective.target;
  const demand = { kind: 'force' as const, metric: 'camp-force' as const, strength: assessment.requiredForce,
    roles: ['frontline' as const, 'ranged' as const], at: objective.target, neededByTick: null, permanent: true };
  return { ...method, stage: 'assembly', demands: [demand], actions: [{ id: actionId, executor: 'strategy.assemble-force',
    intent, target, unitIds: bound.unitIds, demands: [demand], dependsOn: [], spendIds: [], completionEffects: [] }],
    voyagePlans: [], spends: [], estimatedTicks: null, preconditions: bound.missing,
    subgoals: [{ id: actionId, parentMethodId: method.id, kind: 'assemble-force', target, demands: [demand],
      dependsOn: [], estimatedTicks: null, status: 'proposed', reasons: [] }] };
}

/** One current gross/net reader, one whole-resource opportunity request. The
 * reader already delayed and integrated continuation income and costs. */
export function quoteConquestAssembly(input: AllocationMethodQuoteInput): MethodAllocationQuote {
  const { method, objective, snapshot } = input;
  const action = method.actions.find(action => action.intent.kind === 'assemble-force');
  if (!action || action.intent.kind !== 'assemble-force') throw new Error('Missing assembly coordinator');
  const intent = action.intent, unitIds = action.unitIds ?? [];
  const missing: AllocationPrecondition[] = method.preconditions.filter(condition => condition.status !== 'met')
    .map(condition => ({ ...condition, reason: { code: condition.reason.code,
      factIds: condition.reason.factIds ?? [], values: condition.reason.values ?? {} } }));
  const add = (code: string, status: 'unknown' | 'unmet' = 'unknown', factIds: readonly string[] = [], values: AllocationReason['values'] = {}) => {
    missing.push({ id: `${method.id}/${code}`, kind: code === 'needs-production' ? 'production' : 'force', status,
      reason: { code, factIds, values }, demand: method.demands[0] ?? null, subgoalIds: [action.id] });
  };
  const facts = input.assemblyFacts?.({ objective, methodId: method.id, campTarget: intent.campTarget,
    requiredForce: intent.requiredForce, posts: intent.posts, unitIds,
    ...(input.valuation ? { valuation: input.valuation } : {}),
    ...(input.responseEligibleUnitIds ? { responseEligibleUnitIds: input.responseEligibleUnitIds } : {}) });
  const current = assessForceAssemblyPosts({ snapshot, owner: objective.owner, intent, unitIds });
  if (current.status === 'blocked') add(current.reasonCode, 'unknown', current.unitIds);
  if (!facts) {
    const value = current.status === 'known' ? current.assembledForce : null;
    if (value !== null && value < intent.requiredForce) add(value === 0 ? 'clearing-force' : 'insufficient-assembled-clearing-force', 'unmet', unitIds,
      { allocatedForce: value, requiredForce: intent.requiredForce, deficit: intent.requiredForce - value });
    add('assembly-facts-unquoted');
  }
  const forecast = facts?.forecast, continuation = facts?.continuation;
  if (facts) {
    missing.push(...facts.missing);
    if (forecast!.status === 'blocked' || forecast!.status === 'unknown') {
      for (const fact of forecast!.missing) add(fact.code, fact.status, fact.factIds);
      if (!forecast!.missing.length) add(forecast!.status === 'blocked' ? 'needs-production' : 'assembly-supply-unquoted',
        forecast!.status === 'blocked' ? 'unmet' : 'unknown');
    }
    if (['ready', 'gathering'].includes(forecast!.status) && (forecast!.forecastTick !== snapshot.tick || forecast!.readyTick === null || !Number.isFinite(forecast!.readyTick)
      || forecast!.readyTick < snapshot.tick || !Number.isFinite(forecast!.completionProbability)
      || forecast!.completionProbability < 0 || forecast!.completionProbability > 1)) add('assembly-current-completion-forecast-unquoted');
    if (['ready', 'gathering'].includes(forecast!.status) && !continuation) add('assembly-continuation-value-unquoted');
  }
  const window = continuation?.window ?? valuationWindow(Math.max(0, (forecast?.readyTick ?? snapshot.tick) - snapshot.tick), input.valuation);
  if (continuation && (!continuation.assemblyDelayApplied || input.valuation?.window
    && !sameValuationWindow(input.valuation.window, window))) add('assembly-continuation-window-mismatch');
  const valuation = !missing.length && continuation && forecast ? resolveValuation({ objectiveId: objective.id, methodId: method.id, unitIds,
    production: forecast.production, window }, input.valuation) : undefined;
  if (valuation?.phase === 'net' && valuation.opportunity?.status !== 'known') add('committed-opportunity-cost-unknown', 'unknown', unitIds);
  const stationed = current.status === 'known' ? current.onStationUnitIds : [];
  const force: ForceQuotation = { metric: 'camp-force', target: objective.target, onStationUnitIds: stationed,
    enRouteUnitIds: unitIds.filter(id => !stationed.includes(id)), unavailableUnitIds: [], unknownUnitIds: [],
    onStationForce: current.status === 'known' ? current.assembledForce : 0,
    effectiveForce: current.status === 'known' ? current.assembledForce : 0, discountedEnRouteForce: 0,
    requiredForce: intent.requiredForce, evaluationUntilTick: snapshot.tick + window.horizonTicks };
  const assumptions = continuation?.assumptions ?? [];
  const calibration = forecast?.conditionalProduction;
  const reason: AllocationReason = { code: missing[0]?.reason.code ?? 'conditional-conquest-force-assembly', factIds: unitIds,
    values: { assembledForce: force.onStationForce, requiredForce: intent.requiredForce, forecastTick: forecast?.forecastTick ?? null,
      battleProbability: current.status === 'known' && current.unitIds.length === 0 ? 0 : null,
      readyTick: forecast?.readyTick ?? null, completionProbability: forecast?.completionProbability ?? null,
      continuationGold: continuation?.utility.score ?? null, assemblyDelayApplied: continuation?.assemblyDelayApplied ?? false,
      calibrationId: calibration?.calibrationId ?? null, timeMaeTicks: calibration?.timeMaeTicks ?? null,
      timeP90ErrorTicks: calibration?.timeP90ErrorTicks ?? null } };
  if (missing.length || !continuation || !forecast) return { methodId: method.id, status: 'blocked', force, ...(valuation ? { valuation } : {}),
    utility: null, potentialUtility: null, reason, missingPreconditions: missing, assumptions };
  const p = forecast.completionProbability, original = continuation.utility;
  const scaled = (terms: AllocationUtility['benefit'], scale: number) => terms.map(term => ({ ...term, value: term.value * scale,
    ...(term.catalogUnitValues ? { catalogUnitValues: term.catalogUnitValues.map(entry => ({ ...entry, valueGold: entry.valueGold * scale })) } : {}) }));
  const benefit = scaled(original.benefit, p * original.successProbability);
  const cost = [...scaled(original.cost, p), ...(valuation?.opportunity?.status === 'known'
    ? [{ code: 'assembly-bundle-opportunity', value: valuation.opportunity.gold }] : [])];
  const utility: AllocationUtility = { horizonTicks: window.horizonTicks, benefit, cost, successProbability: 1,
    persistenceBonus: p * original.persistenceBonus, score: p * original.score - (valuation?.opportunity?.status === 'known' ? valuation.opportunity.gold : 0) };
  assertUnitValueSides(utility);
  return { methodId: method.id, status: 'feasible', force, ...(valuation ? { valuation } : {}), utility, potentialUtility: null,
    reason, missingPreconditions: [], assumptions };
}
