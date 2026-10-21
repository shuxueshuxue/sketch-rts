import { expect, it } from 'vitest';
import { goalActionPresentCost } from './goal-action-value';
import type { GoalActionDeclaration } from './goal-planner-types';

it('discounts each nominal loss at its occurrence with the same reward clock', () => {
  const action: GoalActionDeclaration = { id: 'losses', kind: 'clear-camp', preconditions: [], effects: [], demands: [], flows: [], outputs: [], reasons: [],
    executor: { executor: 'goal.clear-camp', parameters: {} }, duration: { state: 'met', value: 2400, factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, cost: { state: 'met', value: [
      { code: 'consumed-on-start', gold: 100, at: 'start', factIds: [] },
      { code: 'observed-midway', gold: 120, at: { offsetTicks: 1200 }, factIds: [] },
      { code: 'loss-on-finish', gold: 160, factIds: [] },
    ], factIds: [] } };
  expect(goalActionPresentCost({ action, startTick: 2400, finishTick: 4800 }, 0)).toBeCloseTo(50 + 48 + 160 / 3, 12);
  expect(goalActionPresentCost({ action, startTick: 2500, finishTick: 4900 }, 100)).toBeCloseTo(50 + 48 + 160 / 3, 12);
});
