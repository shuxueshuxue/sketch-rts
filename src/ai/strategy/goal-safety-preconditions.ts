import { retimeGoalActionPreconditions } from './goal-action-facts';
import type { GoalActionDeclaration } from './goal-planner-types';

/** Admission safety covers this atom's execution. Holding/defense obligations
 * keep their requested world window; their duration is that obligation. */
export function withGoalSafetyPreconditionWindows(action: GoalActionDeclaration, tick: number): GoalActionDeclaration {
  if (action.kind === 'hold-position' || action.kind === 'defend') return action;
  const safety = action.preconditions.filter(fact => fact.predicate.kind === 'site-safe'
    || fact.predicate.kind === 'shore-safe' || fact.predicate.kind === 'assets-safe');
  if (!safety.length) return action;
  const windows = [...new Map([...(action.preconditionWindows ?? []),
    ...safety.map(fact => ({ factId: fact.id, through: 'finish' as const }))].map(window => [window.factId, window])).values()];
  // Pending/unmet duration stays pending/unmet. Its current-epoch prototype
  // cannot become executable before the scheduler has a real finish to bind.
  const finish = tick + (action.duration.state === 'met' && Number.isFinite(action.duration.value)
    && action.duration.value >= 0 ? action.duration.value : 0);
  return retimeGoalActionPreconditions({ ...action, preconditionWindows: windows }, finish)!;
}
