import type { GoalScheduledAction } from './goal-resource-ledger';
import { discountGold } from './utility';

/** Benefits and losses share one present-value clock. Capital exchanges stay
 * in the cash-flow ledger; domains quote only expected loss/consumption here.
 * Resource occupancy is priced once by the allocator's opportunity oracle. */
export function goalActionPresentCost(step: GoalScheduledAction, epoch: number): number {
  if (step.action.cost.state !== 'met') throw Error('Unquoted goal action cost');
  return step.action.cost.value.reduce((sum, term) => {
    const tick = term.at === 'start' ? step.startTick : typeof term.at === 'object'
      ? step.startTick + term.at.offsetTicks : step.finishTick;
    return sum + discountGold(term.gold, tick - epoch);
  }, 0);
}
