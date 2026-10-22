import { replaceGoalActionFacts, retimeGoalActionPreconditions } from './goal-action-facts';
import { goalFact } from './goal-facts';
import type { GoalActionDeclaration } from './goal-planner-types';

/** Finite-action safety follows its finish. Holding/defense effects retain
 * their full obligation while quotation proofs use the supplied support. */
export function withGoalSafetyPreconditionWindows(action: GoalActionDeclaration, tick: number,
  observationHorizonTicks?: number): GoalActionDeclaration {
  const safety = action.preconditions.filter(fact => fact.predicate.kind === 'site-safe'
    || fact.predicate.kind === 'shore-safe' || fact.predicate.kind === 'assets-safe');
  if (!safety.length) return action;
  if (action.kind === 'hold-position' || action.kind === 'defend') {
    // This is a quotation/admission proof for the current observation only.
    // The executor rechecks it on subsequent thinks; the full world effect,
    // lease and retained through parameter must not be shortened with it.
    if (observationHorizonTicks === undefined || !Number.isFinite(observationHorizonTicks)
      || observationHorizonTicks < 0) return action;
    const through = action.executor.parameters.throughTick;
    const supportedThrough = Math.min(tick + observationHorizonTicks, typeof through === 'number' ? through : Infinity);
    const replacements = new Map(safety.flatMap(fact => 'throughTick' in fact.predicate
      && fact.predicate.throughTick > supportedThrough ? [[fact.id, goalFact({ ...fact.predicate, throughTick: supportedThrough })] as const] : []));
    const updated = replaceGoalActionFacts(action, replacements);
    const safetyIds = new Set([...safety.map(fact => fact.id), ...[...replacements.values()].map(fact => fact.id)]);
    const { preconditionWindows: _windows, ...rest } = updated;
    const windows = updated.preconditionWindows?.filter(window => !safetyIds.has(window.factId));
    return { ...rest, ...(windows?.length ? { preconditionWindows: windows } : {}),
      effects: action.effects, executor: action.executor, duration: action.duration, demands: action.demands };
  }
  const windows = [...new Map([...(action.preconditionWindows ?? []),
    ...safety.map(fact => ({ factId: fact.id, through: 'finish' as const }))].map(window => [window.factId, window])).values()];
  // Pending/unmet duration stays pending/unmet. Its current-epoch prototype
  // cannot become executable before the scheduler has a real finish to bind.
  const finish = tick + (action.duration.state === 'met' && Number.isFinite(action.duration.value)
    && action.duration.value >= 0 ? action.duration.value : 0);
  return retimeGoalActionPreconditions({ ...action, preconditionWindows: windows }, finish)!;
}
