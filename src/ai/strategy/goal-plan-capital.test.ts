import { expect, it } from 'vitest';
import { goalFact } from './goal-facts';
import { goalPlanCapital } from './goal-plan-capital';
import type { GoalActionNode, GoalFact, GoalPlan, GoalResourceFlow } from './goal-planner-types';

const at = (x = 300, y = 400) => ({ landId: 'land:2' as const, point: { x, y } });
function building(id: string, mineId: string | null = 'mine-a', x = 300, kind: 'townHall' | 'farm' = 'townHall'): GoalActionNode {
  const effects: GoalFact[] = [goalFact({ kind: 'building-complete', buildingKind: kind, at: at(x),
    building: { kind: 'output', actionId: id, output: 'building' } })];
  if (mineId) effects.push(goalFact({ kind: 'hall-complete', mineId, at: at(x) }));
  return { id, state: 'waiting-actions', startTick: 100, finishTick: 660, dependsOnActionIds: ['transport-worker'],
    prerequisiteFactIds: [], reasons: [], declaration: { id, kind: 'build', precision: 'coarse',
      preconditions: [goalFact({ kind: 'gold', minimum: 400, byTick: 9999 })],
      effects: effects.map(fact => ({ fact, operation: 'establish', at: 'finish' })), demands: [],
      flows: [{ resource: { kind: 'gold' }, delta: -400, at: 'start', factIds: ['actual-purchase'] }],
      duration: { state: 'met', value: 560, factIds: [] }, cost: { state: 'met', value: [{ code: 'nominal-casualties', gold: 9000, factIds: [] }], factIds: [] },
      successProbability: { state: 'met', value: 1, factIds: [] }, outputs: ['building'], reasons: [],
      executor: { executor: 'goal.build', parameters: { buildingKind: kind, at: at(x),
        worker: { kind: 'existing', entityId: 'worker-a' }, foundationId: null, byTick: 9999 } } } };
}
function plan(actions: readonly GoalActionNode[]): GoalPlan {
  return { id: 'quoted-plan', goal: { id: 'ConquerIsland:us:mine-a', owner: 'us', effects: [], rewardGold: 1000, deadlineTick: 10000, reasons: [] },
    status: 'ready', observedTick: 10, facts: [], actions, edges: [], subgoals: [], alternatives: [], readyActionIds: ['transport-worker'],
    resourceTimeline: [], costGold: 9000, successProbability: 1, valueGold: 100, completedTick: 660,
    search: { expansions: 1, depth: 1, work: 1, limitReason: null }, reasons: [] };
}
function flows(node: GoalActionNode, values: readonly GoalResourceFlow[]): GoalActionNode {
  return { ...node, declaration: { ...node.declaration, flows: values } };
}

it('registers the selected future hall before it becomes ready, using cash rather than quoted utility or income', () => {
  const node = flows(building('coarse-hall'), [
    { resource: { kind: 'gold' }, delta: -400, at: 'start', factIds: ['hall-price'] },
    { resource: { kind: 'gold' }, delta: 80, at: 'finish', factIds: ['bounty'] },
  ]);
  const original = plan([node]), bytes = JSON.stringify(original), result = goalPlanCapital(original);
  expect(result.pending).toEqual([]); expect(result.spends).toHaveLength(1);
  expect(result.spends[0]).toMatchObject({ amountGold: 400, expectedPaymentTick: 100,
    includedUtilityTermCodes: ['remaining-plan-actions'], externalReservationIds: ['naval:islandHall'] });
  expect(result.byAction.get(node.id)).toBe(result.spends[0]!.spendId);
  expect(JSON.stringify(original)).toBe(bytes);
});

it('keeps one logical hall identity across quote clocks, exact site, route, builder and objective changes', () => {
  const coarse = building('coarse-clock-one'), exact = building('exact-clock-two', 'mine-a', 320);
  const moved: GoalActionNode = { ...exact, startTick: 700, finishTick: 1260, declaration: { ...exact.declaration,
    precision: 'exact', executor: { ...exact.declaration.executor, parameters: { ...exact.declaration.executor.parameters,
      worker: { kind: 'existing', entityId: 'worker-b' }, byTick: 12000,
      route: { from: at(100), to: at(320) } } } } };
  const a = goalPlanCapital(plan([coarse])), b = goalPlanCapital({ ...plan([moved]), id: 'new-quote',
    goal: { ...plan([]).goal, id: 'ExpandLand:us:mine-a', deadlineTick: 12000 } });
  expect(a.spends[0]!.spendId).toBe(b.spends[0]!.spendId);
  expect(b.spends[0]!.expectedPaymentTick).toBe(700);
  const combined = goalPlanCapital(plan([moved, coarse]));
  expect(combined.spends).toHaveLength(1); expect(combined.spends[0]!.amountGold).toBe(400);
  expect(combined.spends[0]!.expectedPaymentTick).toBe(100);
  expect(combined.byAction.get(coarse.id)).toBe(combined.byAction.get(moved.id));
});

it('does not merge different mines, owners or physical building sites', () => {
  const result = goalPlanCapital(plan([building('hall-a'), building('hall-b', 'mine-b'),
    building('farm-a', null, 600, 'farm'), building('farm-b', null, 700, 'farm')]));
  expect(result.spends).toHaveLength(4); expect(new Set(result.byAction.values()).size).toBe(4);
  const otherOwner = goalPlanCapital({ ...plan([building('hall-a')]), goal: { ...plan([]).goal, owner: 'them' } });
  expect(otherOwner.spends[0]!.spendId).not.toBe(result.byAction.get('hall-a'));
});

it('retains start, offset and finish cash sources while registering the total at the earliest payment tick', () => {
  const node = flows({ ...building('scheduled'), startTick: 100, finishTick: 200 }, [
    { resource: { kind: 'gold' }, delta: -50, at: 'finish', factIds: ['late-purchase'] },
    { resource: { kind: 'gold' }, delta: 1000, at: 'start', factIds: ['income'] },
    { resource: { kind: 'gold' }, delta: -70, at: { offsetTicks: 25 }, factIds: ['early-purchase'] },
    { resource: { kind: 'population-room' }, delta: -4, at: 'start', factIds: [] },
  ]);
  const result = goalPlanCapital(plan([node]));
  expect(result.spends[0]).toMatchObject({ amountGold: 120, expectedPaymentTick: 125 });
  expect(result.spends[0]!.paymentSchedule.map(p => [p.tick, p.amountGold, p.factIds])).toEqual([
    [125, 70, ['early-purchase']], [200, 50, ['late-purchase']],
  ]);
});

it('does not reserve already realized world effects or actions with only nominal loss', () => {
  const done = { ...building('already-present'), state: 'world-effects-met' as const };
  const nominal = flows(building('nominal-only'), []);
  expect(goalPlanCapital(plan([done, nominal])).spends).toEqual([]);
  expect(goalPlanCapital(plan([done, nominal])).pending).toEqual([]);
});

it('keeps ambiguous future training batches separately pending instead of coalescing fungible units', () => {
  const train = (id: string): GoalActionNode => { const base = building(id); return { ...base, declaration: {
    ...base.declaration, kind: 'train', effects: [], outputs: [], executor: { executor: 'goal.train', parameters: {
      producer: { kind: 'existing', entityId: 'same-barracks' }, unitKind: 'footman', count: 1 } } } }; };
  const result = goalPlanCapital(plan([train('batch-a'), train('batch-b')]));
  expect(result.spends).toEqual([]); expect(result.byAction.size).toBe(0);
  expect(result.pending.map(p => [p.actionId, p.reason.code])).toEqual([
    ['batch-a', 'goal-capital-training-batch-identity-required'], ['batch-b', 'goal-capital-training-batch-identity-required'],
  ]);
});

it('exposes unscheduled, invalid or unidentifiable cash without discarding other assets', () => {
  const unknown = { ...building('unscheduled'), startTick: null };
  const invalid = flows(building('nonfinite'), [{ resource: { kind: 'gold' }, delta: -Infinity, at: 'start', factIds: ['invalid'] }]);
  const outside = flows(building('outside'), [{ resource: { kind: 'gold' }, delta: -10, at: { offsetTicks: -1 }, factIds: ['outside'] }]);
  const result = goalPlanCapital(plan([building('valid'), unknown, invalid, outside]));
  expect(result.spends).toHaveLength(1);
  expect(result.pending.map(p => p.actionId)).toEqual(['nonfinite', 'outside', 'unscheduled']);
  expect(result.byAction.has('unscheduled')).toBe(false);
});

it('is stable under JSON restoration and selected-node order without reading alternatives', () => {
  const input = plan([building('b', 'mine-b'), building('a')]);
  const a = goalPlanCapital(input), b = goalPlanCapital(JSON.parse(JSON.stringify({ ...input, actions: [...input.actions].reverse() })));
  expect(b.spends).toEqual(a.spends); expect([...b.byAction]).toEqual([...a.byAction]); expect(b.pending).toEqual(a.pending);
});
