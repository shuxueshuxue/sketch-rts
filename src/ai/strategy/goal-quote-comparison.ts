import type { GoalActionDeclaration } from './goal-planner-types';
import { discountGold } from './utility';
import { goalActionPresentCost } from './goal-action-value';

/** One gold is the smallest quoted economic improvement that can replace an
 * otherwise equal confirmed choice. Coarse optimism never receives this tie
 * break: it remains an unconfirmed challenger behind the exact-ready gate. */
export const GOAL_CONFIRMED_CHOICE_TIE_GOLD = 1;
export function compareConfirmedGoalChoices(a: GoalActionDeclaration, b: GoalActionDeclaration, rewardGold: number): number {
  const value = (action: GoalActionDeclaration) => action.precision === 'exact' && action.duration.state === 'met'
    && action.cost.state === 'met' && action.successProbability.state === 'met'
    ? discountGold(action.successProbability.value * rewardGold, action.duration.value)
      - goalActionPresentCost({ action, startTick: 0, finishTick: action.duration.value }, 0) : null;
  const first = value(a), second = value(b);
  if (first === null || second === null) return 0;
  const preferred = (action: GoalActionDeclaration) => Number(action.reasons.some(reason => reason.code === 'goal-exact-incumbent-choice'));
  return (Math.abs(first - second) <= GOAL_CONFIRMED_CHOICE_TIE_GOLD ? preferred(b) - preferred(a) : 0)
    || second - first;
}
