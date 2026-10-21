import { effectiveCombatRating } from '../policy/v6/strength';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalEstimate, GoalPlanningContext } from './goal-planner-types';
import type { Target } from './types';

export type GoalProtectionReader = (kind: 'hold-position' | 'defend', site: Target,
  cohortIds: readonly string[], throughTick: number, post?: Target) => GoalEstimate<true>;

/** An observed enemy does not by itself make a priced defense impossible.
 * Reuse the same current-window model with the exact admitted cohort and all
 * its real prerequisites. No alternate army or hypothetical origin qualifies. */
export function readGoalCurrentProtection(context: GoalPlanningContext, kind: 'hold-position' | 'defend', site: Target,
  cohortIds: readonly string[], throughTick: number, post: Target = site): GoalEstimate<true> {
  const safe = goalFact({ kind: 'site-safe', site, throughTick }), observed = context.readFact(safe);
  const pending = (code: string, ids: readonly string[]): GoalEstimate<true> => ({ state: 'pending', requestIds: ids.length ? ids : [safe.id],
    reason: { code, factIds: ids, values: {} } });
  const unmet = (code: string, ids: readonly string[]): GoalEstimate<true> => ({ state: 'unmet', reason: { code, factIds: ids, values: {} } });
  if (observed.fact.id !== safe.id || observed.observedTick !== context.tick
    || (observed.availableTick ?? context.tick) > context.tick) return pending('current-protection-proof-not-active', [safe.id]);
  const refs = [...new Set(cohortIds)].sort().map(entityId => ({ kind: 'existing' as const, entityId }));
  const units = refs.map(ref => context.snapshot.units.find(unit => unit.id === ref.entityId && unit.owner === context.owner
    && unit.hp > 0 && !unit.deck && !unit.cabin));
  if (!refs.length || units.some(unit => !unit)) return unmet('current-protection-member-unavailable', cohortIds);
  if (observed.state === 'met') return { state: 'met', value: true, factIds: [safe.id] };
  if (observed.state === 'pending') return pending('current-protection-facts-pending', [observed.requestId]);
  const effect = kind === 'defend' ? safe : goalFact({ kind: 'route-controlled', at: site, throughTick });
  const quote = context.grounding?.combatOptions?.(effect);
  if (!quote) return pending('current-protection-quotation-missing', [effect.id]);
  if (quote.state === 'pending') return pending(quote.reason.code, quote.requestIds);
  if (quote.state === 'unmet') return quote;
  const cohortQuotes = quote.candidates.filter(option => goalValueKey([...option.cohort].sort((a, b) => goalValueKey(a).localeCompare(goalValueKey(b)))) === goalValueKey(refs));
  const matching = cohortQuotes.filter(option => goalValueKey(option.target) === goalValueKey(post));
  if (cohortQuotes.length && !matching.length) return pending('current-protection-post-unquoted', [effect.id]);
  const strength = units.reduce((sum, unit) => sum + effectiveCombatRating(context.snapshot, unit!), 0);
  for (const option of matching) {
    if (option.requiredForce > strength || option.duration.state !== 'met' || option.cost.state !== 'met'
      || option.successProbability.state !== 'met' || option.successProbability.value <= 0) continue;
    const preconditions = option.preconditions.map(fact => context.readFact(fact));
    if (preconditions.some((row, index) => row.fact.id !== option.preconditions[index]!.id || row.state !== 'met'
      || row.observedTick !== context.tick || (row.availableTick ?? context.tick) > context.tick)) continue;
    return { state: 'met', value: true, factIds: [...new Set([effect.id, ...option.factIds, ...preconditions.map(row => row.fact.id)])].sort() };
  }
  if (matching.some(option => option.duration.state === 'pending' || option.cost.state === 'pending' || option.successProbability.state === 'pending'
    || option.preconditions.some(fact => context.readFact(fact).state === 'pending'))) return pending('current-protection-quotation-pending', [effect.id]);
  return unmet('current-protection-cohort-insufficient', [effect.id, ...cohortIds]);
}
