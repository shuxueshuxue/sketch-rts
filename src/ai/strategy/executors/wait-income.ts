import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, sameAction, validExecutorGrant } from '../executor-grants';

/** Predicted income is a missing prerequisite, never spendable current cash. */
export const waitIncomeExecutor: StrategyExecutor = {
  id: 'strategy.wait-income',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const base = executorFeedback(input), budgets = input.grant.budgets.filter(budget => sameAction(budget.action, input.execution.token)
      && budget.objectiveId === input.objective.id);
    return budgets.length > 0 && budgets.every(budget => budget.state === 'reserved' && budget.amountGold > budget.paidGold)
      ? { ...base, status: 'complete', phase: 'capital-reserved' }
      : blockedExecutor(input, 'income-not-yet-reserved-for-parent-spend');
  },
};
