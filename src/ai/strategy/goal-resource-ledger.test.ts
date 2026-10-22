import { expect, it } from 'vitest';
import { UNIT_DEFS, BUILDING_DEFS } from '../../shared/catalog';
import { projectGoalResources, type GoalScheduledAction } from './goal-resource-ledger';
import type { GoalActionDeclaration, GoalResourceFlow } from './goal-planner-types';

const gold = { kind: 'gold' as const };
function action(id: string, startTick: number, finishTick: number, flows: readonly GoalResourceFlow[]): GoalScheduledAction {
  const declaration: GoalActionDeclaration = { id, kind: 'train', preconditions: [], effects: [], demands: [], flows,
    duration: { state: 'met', value: finishTick - startTick, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
    successProbability: { state: 'met', value: 1, factIds: [] }, executor: { executor: 'test-ledger', parameters: {} }, outputs: [], reasons: [] };
  return { action: declaration, startTick, finishTick };
}
const spend = (amount: number): GoalResourceFlow => ({ resource: gold, delta: -amount, at: 'start', factIds: [] });
const reward = (id: string, amount: number): GoalResourceFlow => ({ resource: gold, delta: amount, at: 'finish', factIds: [], source: { kind: 'event', id } });
const income = (throughTick: number, amount: number, rate = 1): GoalResourceFlow => ({ resource: gold, delta: amount, at: 'finish', factIds: [],
  source: { kind: 'income', id: 'owner-income', segments: [{ fromTick: 0, throughTick, ratePerTick: rate }] } });
const initial = (quantity: number) => [{ resource: gold, quantity, asOfTick: 0, factIds: ['native-bank'] }];

it('permits spending then earning while proving every prefix solvent with native prices', () => {
  const train = UNIT_DEFS.footman.cost, hall = BUILDING_DEFS.townHall.cost;
  const result = projectGoalResources({ epoch: 0, initial: initial(train), actions: [
    action('train-footman', 0, 20, [spend(train)]), action('camp-a', 20, 40, [reward('guard-a', hall / 2)]),
    action('camp-b', 40, 60, [reward('guard-b', hall / 2)]), action('build-hall', 60, 100, [spend(hall)])] });
  expect(result.state).toBe('met');
  if (result.state !== 'pending') {
    expect(result.timeline.map(event => event.after)).toEqual([0, hall / 2, hall, 0]);
    expect(result.deficits).toEqual([]);
  }
  const tooEarly = projectGoalResources({ epoch: 0, initial: initial(train), actions: [
    action('build-hall', 0, 100, [spend(hall)]), action('camp-a', 20, 40, [reward('guard-a', hall)])] });
  expect(tooEarly.state).toBe('unmet'); // A positive final balance cannot repair an earlier overdraft.
});

it('credits overlapping income once across distinct gold thresholds and keeps signed expenditures', () => {
  const actions = [action('wait-350', 0, 25, [income(25, 25)]), action('wait-400', 0, 75, [income(75, 75)]),
    action('hall', 75, 100, [spend(400)])];
  const before = JSON.stringify(actions), result = projectGoalResources({ epoch: 0, initial: initial(325), actions });
  expect(result.state).toBe('met');
  if (result.state !== 'pending') {
    expect(result.timeline.map(event => event.delta)).toEqual([25, 50, -400]);
    expect(result.balances[0]!.quantity).toBe(0);
    expect(result.duplicateCredits).toEqual([{ actionId: 'wait-400', sourceId: 'owner-income', declared: 75, credited: 50 }]);
  }
  expect(JSON.stringify(actions)).toBe(before);
  expect(projectGoalResources({ epoch: 0, initial: initial(325), actions: [...actions].reverse() })).toEqual(result);
});

it('deduplicates one-shot bounties and rejects conflicting source evidence rather than adding it twice', () => {
  const result = projectGoalResources({ epoch: 0, initial: initial(0), actions: [
    action('clear-for-gold', 0, 10, [reward('guard-x', 30)]), action('clear-for-island', 0, 10, [reward('guard-x', 30)])] });
  expect(result.state).toBe('met');
  if (result.state !== 'pending') expect(result.balances[0]!.quantity).toBe(30);
  expect(projectGoalResources({ epoch: 0, initial: initial(0), actions: [
    action('clear-a', 0, 10, [reward('guard-x', 30)]), action('clear-b', 0, 10, [reward('guard-x', 40)])] }))
    .toMatchObject({ state: 'pending', reason: { code: 'goal-reward-source-conflict' } });
  expect(projectGoalResources({ epoch: 0, initial: initial(0), actions: [
    action('wait-a', 0, 25, [income(25, 25)]), action('wait-b', 0, 75, [income(75, 150, 2)])] }))
    .toMatchObject({ state: 'pending', reason: { code: 'goal-income-source-conflict' } });
});

it('does not extend income support or credit unproved gold, and preserves finite source/epoch checks', () => {
  expect(projectGoalResources({ epoch: 0, initial: initial(0), actions: [action('future-income', 0, 10, [income(75, 75)])] }))
    .toMatchObject({ state: 'pending', reason: { code: 'goal-income-source-invalid' } });
  expect(projectGoalResources({ epoch: 0, initial: initial(0), actions: [action('free-money', 0, 10,
    [{ resource: gold, delta: 100, at: 'finish', factIds: [] }])] }))
    .toMatchObject({ state: 'pending', reason: { code: 'goal-positive-gold-source-unbound' } });
  expect(projectGoalResources({ epoch: 0, initial: [...initial(100), ...initial(200)], actions: [] }))
    .toMatchObject({ state: 'pending', reason: { code: 'goal-initial-resource-conflict' } });
});
