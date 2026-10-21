import { expect, it } from 'vitest';
import type { GoalActionDeclaration, GoalEstimate } from './goal-planner-types';
import { selectedGoalCampBattles } from './goal-selected-camp-battles';

const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: [] });
const pending = { state: 'pending', requestIds: ['unpublished'], reason: { code: 'unpublished', factIds: [], values: {} } } as const;
const battle = (campId: string): GoalActionDeclaration => ({ id: `clear:${campId}`, kind: 'clear-camp', preconditions: [],
  effects: [], demands: [], flows: [], duration: known(50), cost: known([{ gold: 1, code: 'battle', factIds: [] }]),
  successProbability: known(0.95), executor: { executor: 'goal.clear-camp', parameters: { campId } }, outputs: [], reasons: [] });

it('binds only selected priced camp battles, never another action or an unresolved battle', () => {
  const selected = battle('selected'), alternative = battle('alternative');
  expect(selectedGoalCampBattles([selected, selected, battle('a')])).toEqual(['a', 'selected']);
  expect(selectedGoalCampBattles([{ ...selected, kind: 'assemble' }, { ...alternative, cost: pending },
    { ...alternative, successProbability: pending }, { ...alternative, duration: pending }])).toEqual([]);
  expect(selectedGoalCampBattles([selected])).not.toContain(alternative.executor.parameters.campId);
});
