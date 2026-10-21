import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { OpportunityAlternative, OpportunityCostQuote, OpportunityRequest, Utility, ValuationContext,
  ValuationQuotation, ValuationWindow, ProductionUse } from './types';
import { canonicalProductionUses, productionUsesOverlap } from './production-use';
import { copiedEvidenceProjection, deferredEvidence, deferredRecord, projectedCopy, valueReader } from './explanations';

/** A shared gold-equivalent scale for every objective family; never map-specific. */
export const STRATEGY_PARAMETERS = Object.freeze({
  utilityHorizonTicks: 120 * SIM_TICKS_PER_SECOND,
  threatHorizonTicks: 45 * SIM_TICKS_PER_SECOND,
  knownThreatHorizonTicks: 600 * SIM_TICKS_PER_SECOND,
  goldPerFieldStrength: 100,
  minimumStayTicks: 15 * SIM_TICKS_PER_SECOND,
  challengerThinks: 3,
  persistenceBenefitShare: .1,
  maximumPersistenceGold: 50,
});

function finite(value: number, name: string, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid strategy ${name}: ${value}`);
  return value;
}

/** This is a stated heuristic, not a measured probability of winning a match.
 * Both inputs must use the same currency (field strength, or camp force).
 * Opposition is actual enemy strength; the method's departure safety margin
 * belongs only in its force demand, never in this probability denominator.
 * Scaling before squaring keeps even very large finite strengths finite. */
export function forceSuccessProbability(availableStrength: number, requiredStrength: number): number {
  finite(availableStrength, 'available strength', 0);
  finite(requiredStrength, 'required strength', 0);
  if (!availableStrength) return 0;
  const scale = Math.max(availableStrength, requiredStrength);
  const available = availableStrength / scale, required = requiredStrength / scale;
  return available * available / (available * available + required * required);
}

/** Discount a benefit by time to its effect, using the common evaluation window. */
export function discountGold(value: number, etaTicks: number): number {
  finite(value, 'benefit');
  finite(etaTicks, 'effect ETA', 0);
  return value / (1 + etaTicks / STRATEGY_PARAMETERS.utilityHorizonTicks);
}

/** Historical observation scale. New quotes use whole-bundle opportunity cost;
 * this helper is retained only for comparison with recorded observations. */
export function forceTimeGold(strength: number, occupiedTicks: number): number {
  finite(strength, 'occupied field strength', 0);
  finite(occupiedTicks, 'occupied duration', 0);
  return finite(strength * STRATEGY_PARAMETERS.goldPerFieldStrength
    * occupiedTicks / STRATEGY_PARAMETERS.utilityHorizonTicks, 'force time cost', 0);
}

/** Compare plans at the same present epoch. Income and foregone alternatives
 * both use task duration + 120 seconds of holding, with a 120-second hyperbolic
 * discount scale. Alternatives are repriced in the requesting plan's window.
 * Extending the holding period can legitimately favor a later, enduring income
 * stream over an immediate, one-off effect; it is not a neutral rescaling. */
export function valuationWindow(taskTicks: number, context?: ValuationContext): ValuationWindow {
  finite(taskTicks, 'task duration', 0);
  const source = context?.window;
  const task = source?.taskTicks ?? taskTicks;
  const holding = source?.holdingTicks ?? context?.holdingTicks ?? STRATEGY_PARAMETERS.utilityHorizonTicks;
  const discount = source?.discountTicks ?? context?.discountTicks ?? STRATEGY_PARAMETERS.utilityHorizonTicks;
  finite(task, 'valuation task duration', 0);
  finite(holding, 'holding duration', 0);
  finite(discount, 'discount duration', 1);
  const horizon = finite(task + holding, 'valuation horizon', 1);
  if (source && source.horizonTicks !== horizon) throw new Error('Inconsistent strategy valuation window');
  return { taskTicks: task, holdingTicks: holding, horizonTicks: horizon, discountTicks: discount };
}

function checkedWindow(window: ValuationWindow): ValuationWindow {
  return valuationWindow(window.taskTicks, { phase: 'gross', window });
}

export function sameValuationWindow(a: ValuationWindow, b: ValuationWindow): boolean {
  return a.taskTicks === b.taskTicks && a.holdingTicks === b.holdingTicks
    && a.horizonTicks === b.horizonTicks && a.discountTicks === b.discountTicks;
}

/** Present value of a one-off effect. Values outside the declared comparison
 * window are excluded instead of charging one plan for a longer horizon. */
export function discountedValue(valueGold: number, atTicks: number, window: ValuationWindow): number {
  finite(valueGold, 'cash flow');
  finite(atTicks, 'cash flow ETA', 0);
  checkedWindow(window);
  if (atTicks > window.horizonTicks) return 0;
  return finite(valueGold / (1 + atTicks / window.discountTicks), 'discounted cash flow');
}

/** Exact integral of rate/(1+t/discountTicks), limited by remaining resources.
 * This measures actual prospective income, never strength multiplied by time. */
export function discountedFlow(input: Readonly<{ goldPerTick: number; remainingGold: number;
  startsInTicks: number; window: ValuationWindow }>): number {
  const { goldPerTick: rate, remainingGold, startsInTicks: start, window } = input;
  finite(rate, 'income rate', 0);
  finite(remainingGold, 'remaining income', 0);
  finite(start, 'income ETA', 0);
  checkedWindow(window);
  if (!rate || !remainingGold || start >= window.horizonTicks) return 0;
  const duration = Math.min(window.horizonTicks - start, remainingGold / rate);
  const value = rate * window.discountTicks * Math.log1p(duration / (window.discountTicks + start));
  return finite(Math.min(remainingGold, value), 'discounted income', 0);
}

/** Hulls and completed halls remain assets after the action. Cash admission
 * still needs full price; utility charges future expected loss, not full price.
 * Occupancy is charged once for the entire bundle by quoteOpportunityCost. */
export function reusableAssetCost(input: Readonly<{ priceGold: number; survivalProbability: number;
  atTicks: number; window: ValuationWindow }>): Readonly<{ residualGold: number;
    expectedLossGold: number; presentCostGold: number }> {
  const price = finite(input.priceGold, 'asset price', 0);
  const survival = finite(input.survivalProbability, 'asset survival probability', 0);
  if (survival > 1) throw new Error('Invalid strategy asset survival probability');
  const residualGold = price * survival;
  const expectedLossGold = price - residualGold;
  return { residualGold, expectedLossGold,
    presentCostGold: discountedValue(expectedLossGold, input.atTicks, input.window) };
}

/** Asset-specific, post-task risk, not the probability that clearing succeeds.
 * Unknown exposure remains unknown. A confirmed empty threat set preserves the
 * asset even when no garrison is needed; inputs otherwise share one force unit. */
export function assetSurvivalProbability(assessment:
  Readonly<{ status: 'known'; ourForce: number; opponentForce: number }> | Readonly<{ status: 'unknown' }>): number | null {
  if (assessment.status === 'unknown') return null;
  finite(assessment.ourForce, 'asset defending force', 0);
  finite(assessment.opponentForce, 'asset opposing force', 0);
  return assessment.opponentForce === 0 ? 1 : forceSuccessProbability(assessment.ourForce, assessment.opponentForce);
}

/** Whole-cohort marginal alternatives, not the sum of per-soldier prices.
 * Shared units and the same objective cannot earn two incompatible payoffs.
 * The greedy disjoint selection is the allocator's stated approximation.
 * Unknown loss of an actual commitment remains unknown. For a prospective
 * alternative with a known value but no reduced-team quote, its whole positive
 * value is a conservative upper bound; it is never represented as a fake zero. */
export function quoteOpportunityCost(window: ValuationWindow, alternatives: readonly OpportunityAlternative[],
  unpricedCommittedObjectiveIds: readonly string[] = []): OpportunityCostQuote {
  checkedWindow(window);
  const unknown = new Set(unpricedCommittedObjectiveIds);
  const candidates: Extract<OpportunityCostQuote, { status: 'known' }>['alternatives'][number][] = [];
  const displacements: typeof candidates = [];
  for (const alternative of alternatives) {
    const before = finite(alternative.withResourcesGold, 'alternative utility');
    const ids = [...new Set(alternative.unitIds)].sort();
    const production = canonicalProductionUses(alternative.production);
    if (!ids.length && !production.length) throw new Error('Strategy alternative has no shared resources');
    if (alternative.withoutResourcesStatus === 'feasible') {
      if (alternative.withoutResourcesGold === null) throw new Error('Feasible strategy alternative has no reduced-team quote');
      finite(alternative.withoutResourcesGold, 'reduced-team alternative utility');
    } else if (alternative.withoutResourcesGold !== null) {
      throw new Error('Unavailable strategy alternative has a numeric utility');
    }
    const bound = alternative.upperBound, assemblyBound = alternative.assemblyDelayUpperBound;
    if (bound && assemblyBound) throw new Error('Two displacement bounds on one alternative');
    if (bound) {
      if (!alternative.committed || !sameValuationWindow(bound.window, window)
        || bound.gold !== before || bound.gold !== bound.components.reduce((sum, term) => sum + finite(term.valueGold, 'loss bound component', 0), 0)
        || !bound.targetId || alternative.withoutResourcesGold !== null)
        throw new Error('Invalid imported task loss upper bound');
      finite(bound.gold, 'imported loss upper bound', 0);
    }
    if (assemblyBound) {
      if (!alternative.committed || !sameValuationWindow(assemblyBound.window, window) || assemblyBound.gold !== before
        || !assemblyBound.targetId || alternative.withoutResourcesGold !== null
        || assemblyBound.gold > assemblyBound.continuationUpperGold
        || assemblyBound.gold !== assemblyBound.components.reduce((sum, term) => sum + finite(term.valueGold, 'assembly loss component', 0), 0))
        throw new Error('Invalid formal assembly delay loss upper bound');
      finite(assemblyBound.gold, 'assembly delay loss upper bound', 0);
      finite(assemblyBound.continuationUpperGold, 'assembly continuation upper value', 0);
    }
    if (alternative.committed && alternative.withoutResourcesStatus === 'unknown' && !bound && !assemblyBound) {
      unknown.add(alternative.objectiveId);
      continue;
    }
    const after = alternative.withoutResourcesStatus === 'feasible' ? Math.max(0, alternative.withoutResourcesGold!) : 0;
    const marginalGold = assemblyBound?.gold ?? bound?.gold ?? Math.max(0, before - after);
    const priced = { objectiveId: alternative.objectiveId, unitIds: ids,
      ...(production.length ? { production } : {}),
      marginalGold, withResourcesGold: before, withoutResourcesGold: alternative.withoutResourcesGold,
      basis: assemblyBound ? 'assembly-delay-upper-bound' as const : bound ? 'upper-bound' as const : alternative.withoutResourcesStatus === 'unknown' ? 'conservative-bound' as const : 'exact' as const,
      ...(bound ? { upperBound: bound } : {}), ...(assemblyBound ? { assemblyDelayUpperBound: assemblyBound } : {}) };
    if (marginalGold > 0) candidates.push(priced);
    if (alternative.committed) {
      const previous = displacements.findIndex(value => value.objectiveId === priced.objectiveId);
      if (previous < 0) displacements.push(priced);
      else if (displacements[previous]!.marginalGold < priced.marginalGold) displacements[previous] = priced;
    }
  }
  if (unknown.size) return { window, status: 'unknown', objectiveIds: [...unknown].sort(),
    reason: { code: 'committed-opportunity-cost-unknown' } };
  candidates.sort((a, b) => b.marginalGold - a.marginalGold
    || (a.objectiveId < b.objectiveId ? -1 : a.objectiveId > b.objectiveId ? 1 : 0));
  const units = new Set<string>(), objectives = new Set<string>(), production: ProductionUse[] = [];
  const selected = candidates.filter(candidate => {
    if (objectives.has(candidate.objectiveId) || candidate.unitIds.some(id => units.has(id))
      || productionUsesOverlap(candidate.production ?? [], production)) return false;
    objectives.add(candidate.objectiveId);
    for (const id of candidate.unitIds) units.add(id);
    production.push(...candidate.production ?? []);
    return true;
  });
  // Actual leases are disjoint authority. A high speculative alternative that
  // overlaps several old tasks must not hide their combined displacement loss.
  // This floor preserves that loss without charging the same units twice.
  displacements.sort((a, b) => a.objectiveId < b.objectiveId ? -1 : a.objectiveId > b.objectiveId ? 1 : 0);
  return { window, status: 'known', gold: finite(Math.max(selected.reduce((sum, item) => sum + item.marginalGold, 0),
    displacements.reduce((sum, item) => sum + item.marginalGold, 0)),
    'bundle opportunity cost', 0), basis: selected.length ? 'feasible-bundle-quotes' : 'no-positive-feasible-alternative',
    alternatives: selected, ...(displacements.length ? { displacements } : {}) };
}

/** Gross passes never call the opportunity oracle. Net quotes may enter the
 * allocator only after a same-window whole-bundle opportunity quote is known. */
export function resolveValuation(request: OpportunityRequest, context?: ValuationContext): ValuationQuotation {
  checkedWindow(request.window);
  const unitIds = [...new Set(request.unitIds)].sort();
  const production = canonicalProductionUses(request.production);
  const resources = { unitIds, ...(production.length ? { production } : {}) };
  const phase = context?.phase ?? 'gross';
  if (phase === 'gross') return { phase, window: request.window, ...resources, opportunity: null };
  const opportunity = context?.opportunity?.({ ...request, ...resources }) ?? {
    window: request.window, status: 'unknown' as const, objectiveIds: [], reason: { code: 'opportunity-quoter-unavailable' } };
  checkedWindow(opportunity.window);
  if (!sameValuationWindow(request.window, opportunity.window)) throw new Error('Strategy opportunity quote uses a different valuation window');
  if (opportunity.status === 'known') finite(opportunity.gold, 'opportunity cost', 0);
  return { phase, window: request.window, ...resources, opportunity };
}

type UtilityInput = Pick<Utility, 'benefit' | 'cost' | 'successProbability'>
  & { evidence: Utility['evidence'] | (() => Utility['evidence']) }
  & Partial<Pick<Utility, 'horizonTicks' | 'persistenceBonus'>>;

/** Failed attempts still incur their expected costs. A success-only expense is
 * a negative benefit term. Paid, unrecoverable sunk expenses are not paid twice. */
export function strategyUtility(input: UtilityInput): Utility {
  const probability = finite(input.successProbability, 'success probability', 0);
  if (probability > 1) throw new Error(`Invalid strategy success probability: ${probability}`);
  const benefit = input.benefit.map(term => deferredRecord(projectedCopy(term, { value: finite(term.value, `benefit ${term.code}`) })));
  const cost = input.cost.map(term => deferredRecord(projectedCopy(term, { value: finite(term.value, `cost ${term.code}`, 0) })));
  const persistenceBonus = finite(input.persistenceBonus ?? 0, 'persistence bonus', 0);
  const horizonTicks = finite(input.horizonTicks ?? STRATEGY_PARAMETERS.utilityHorizonTicks, 'utility horizon', 1);
  const score = finite(probability * benefit.reduce((sum, term) => sum + term.value, 0)
    - cost.reduce((sum, term) => sum + term.value, 0) + persistenceBonus, 'utility score');
  const source = typeof input.evidence === 'function' ? input.evidence : valueReader(input.evidence);
  return deferredEvidence({ horizonTicks, benefit, cost, successProbability: probability, persistenceBonus, score }, copiedEvidenceProjection(source));
}
