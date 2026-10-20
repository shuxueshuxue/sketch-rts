import type { OpportunityAlternative, OpportunityRequest, OpportunityCostQuote, ValuationWindow, ProductionUse } from './types';
import { quoteOpportunityCost } from './utility';
import { canonicalProductionUses, productionUsesOverlap } from './production-use';

export type BundleValuation =
  | Readonly<{ status: 'feasible'; score: number; coverage: 'known-effects' | 'complete' }>
  | Readonly<{ status: 'not-runnable' | 'unknown'; reasonCode: string }>;

/** A current, explicit whole-cohort offer. The callback may assess only the
 * supplied subset and may not recruit replacements behind the allocator.
 * Sources and memo live for this transaction, never in process-wide history. */
export type BundleValuationSource = Readonly<{
  id: string;
  objectiveId: string;
  unitIds: readonly string[];
  production?: readonly ProductionUse[];
  effectKeys: readonly string[];
  committed: boolean;
  quote: (unitIds: readonly string[], window: ValuationWindow, unavailableProduction?: readonly ProductionUse[]) => BundleValuation;
}>;

/** Reprices both sides of every marginal comparison in the requester's window.
 * Caching only avoids equal computations; source order and cache warmth cannot
 * change output. A source with only a lower bound cannot establish the loss of
 * an actual commitment, even if that lower bound is a profitable alternative. */
export function createOpportunityOracle(sources: readonly BundleValuationSource[], options: Readonly<{
  effectKeysFor: (objectiveId: string) => readonly string[];
  unpricedCommitmentsFor?: (unitIds: readonly string[]) => readonly string[];
  unpricedProductionFor?: (uses: readonly ProductionUse[]) => readonly string[];
}>): (request: OpportunityRequest) => OpportunityCostQuote {
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Duplicate strategy valuation source');
  const ordered = [...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const memo = new Map<string, BundleValuation>();
  const quote = (source: BundleValuationSource, unitIds: readonly string[], window: ValuationWindow,
    unavailableProduction: readonly ProductionUse[] = []) => {
    const key = JSON.stringify([source.id, window.taskTicks, window.holdingTicks, window.horizonTicks,
      window.discountTicks, unitIds, unavailableProduction]);
    let value = memo.get(key);
    if (!value) {
      value = source.quote(unitIds, window, unavailableProduction);
      if (value.status === 'feasible' && !Number.isFinite(value.score)) throw new Error('Invalid strategy bundle score');
      memo.set(key, value);
    }
    return value;
  };
  return request => {
    const requested = new Set(request.unitIds), requestEffects = new Set(options.effectKeysFor(request.objectiveId));
    const unknown = new Set(options.unpricedCommitmentsFor?.(request.unitIds));
    const production = canonicalProductionUses(request.production);
    for (const id of options.unpricedProductionFor?.(production) ?? []) unknown.add(id);
    const alternatives: OpportunityAlternative[] = [];
    const effects = new Map<string, { alternative: OpportunityAlternative; marginal: number }>();
    for (const source of ordered) {
      const sharedProduction = productionUsesOverlap(canonicalProductionUses(source.production), production);
      if (source.objectiveId === request.objectiveId || !source.unitIds.some(id => requested.has(id)) && !sharedProduction
        || source.effectKeys.some(key => requestEffects.has(key))) continue;
      const ids = [...new Set(source.unitIds)].sort();
      const before = quote(source, ids, request.window);
      if (before.status !== 'feasible' || source.committed && before.coverage !== 'complete') {
        if (source.committed) unknown.add(source.objectiveId);
        continue;
      }
      const after = quote(source, ids.filter(id => !requested.has(id)), request.window, sharedProduction ? production : []);
      if (source.committed && (after.status === 'unknown' || after.status === 'feasible' && after.coverage !== 'complete')) {
        unknown.add(source.objectiveId);
        continue;
      }
      const alternative: OpportunityAlternative = { objectiveId: source.objectiveId, unitIds: ids,
        ...(source.production?.length ? { production: canonicalProductionUses(source.production) } : {}),
        withResourcesGold: before.score, withoutResourcesGold: after.status === 'feasible' ? after.score : null,
        withoutResourcesStatus: after.status, committed: source.committed };
      const marginal = Math.max(0, before.score - (after.status === 'feasible' ? Math.max(0, after.score) : 0));
      // Methods with the same effect are substitutes. Preserve the best offer;
      // effects may contain several keys, so remove any replaced offer once.
      const duplicate = source.effectKeys.map(key => effects.get(key)).filter(value => value !== undefined);
      if (duplicate.some(entry => entry.marginal >= marginal)) continue;
      for (const entry of duplicate) {
        const index = alternatives.indexOf(entry.alternative);
        if (index >= 0) alternatives.splice(index, 1);
        for (const [key, value] of effects) if (value === entry) effects.delete(key);
      }
      alternatives.push(alternative);
      const entry = { alternative, marginal };
      for (const key of source.effectKeys) effects.set(key, entry);
    }
    return quoteOpportunityCost(request.window, alternatives, [...unknown]);
  };
}
