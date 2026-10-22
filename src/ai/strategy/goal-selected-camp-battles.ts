import type { GoalActionDeclaration } from './goal-planner-types';

/** Selected, quoted battles own their target camp's engagement exposure.
 * Unselected candidates and unresolved quotes cannot supply this evidence. */
export function selectedGoalCampBattles(actions: readonly (Pick<GoalActionDeclaration, 'kind' | 'executor'>
  & Partial<Pick<GoalActionDeclaration, 'cost' | 'successProbability' | 'duration'>>)[]): readonly string[] {
  return [...new Set(actions.flatMap(action => action.kind === 'clear-camp' && action.cost?.state === 'met'
    && action.successProbability?.state === 'met' && action.duration?.state === 'met'
    && typeof action.executor.parameters.campId === 'string' ? [action.executor.parameters.campId] : []))].sort();
}
