import type { AiPlanTrace } from '../ai/plan-trace';
import type { GoalActionNode } from '../ai/strategy/goal-planner-types';

export function recordedGoalExecution(trace: AiPlanTrace, action: GoalActionNode) {
  const b = action.allocation;
  return b && trace.strategy?.allocation?.executions.find(row => row.objectiveId === b.objectiveId
    && row.methodId === b.methodId && row.token.actionId === b.actionId && row.token.generation === b.generation);
}
export function recordedGoalAssignments(trace: AiPlanTrace, action: GoalActionNode) {
  const b = action.allocation;
  return b ? trace.strategy?.allocation?.assignments.filter(row => row.objectiveId === b.objectiveId
    && row.methodId === b.methodId && row.action.actionId === b.actionId && row.action.generation === b.generation) ?? [] : [];
}
export function recordedGoalBudgets(trace: AiPlanTrace, action: GoalActionNode) {
  const b = action.allocation;
  return b ? trace.strategy?.allocation?.budget.filter(row => row.objectiveId === b.objectiveId
    && row.methodId === b.methodId && row.action.actionId === b.actionId && row.action.generation === b.generation) ?? [] : [];
}
