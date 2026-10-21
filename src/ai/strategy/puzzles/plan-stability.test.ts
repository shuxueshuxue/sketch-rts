import { describe, expect, it } from 'vitest';
import type { GoalActionKind, GoalActionNode } from '../goal-planner-types';
import { comparePuzzlePlanWindow } from './plan-stability';

// These are projection contracts for a chosen graph, not authored world
// facts or a substitute planner/puzzle success path.
function action(id: string, kind: GoalActionKind, unit = 'unit-a', tick = 10, x = 240): GoalActionNode {
  return { id, prerequisiteFactIds: [], dependsOnActionIds: [], startTick: tick, finishTick: tick + 669,
    state: 'ready', reasons: [], declaration: { id, kind, preconditions: [], effects: [], demands: [], flows: [],
      duration: { state: 'met', value: 669, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
      successProbability: { state: 'met', value: 1, factIds: [] }, outputs: [], reasons: [],
      executor: { executor: `goal.${kind}`, parameters: { actor: { kind: 'existing', entityId: unit }, at: { x, y: 240 } } } } };
}
function output(actions: readonly GoalActionNode[]) {
  return { plans: [{ goal: { id: 'objective' }, actions, facts: [], edges: [] }] };
}
function chain(tick = 10, x = 240) {
  const assemble = action(`assemble:${tick}:${x}`, 'assemble', 'unit-a', tick, x);
  const transport = action(`transport:${tick}:${x}`, 'transport-force', 'unit-a', tick + 20, x);
  return output([assemble, { ...transport, dependsOnActionIds: [assemble.id] }]);
}

describe('public puzzle last-three structural stability', () => {
  it('keeps numeric publication refinements and encoded action IDs out of the structural verdict', () => {
    const last = chain(30, 304), node = last.plans[0].actions[1];
    const refined = output([last.plans[0].actions[0], { ...node, finishTick: node.startTick! + 719, declaration: {
      ...node.declaration, duration: { state: 'met', value: 719, factIds: [] } } }]);
    const frames = [chain(), chain(20), refined];
    const result = comparePuzzlePlanWindow(frames);
    expect(result.stable).toBe(true);
    expect(result.numericChanges).toContainEqual({ path: 'plans[0].actions[0].parameters.at.x', values: [240, 240, 304], range: 64 });
    expect(result.numericChanges).toContainEqual({ path: 'plans[0].actions[0].startTick', values: [10, 20, 30], range: 20 });
    expect(result.numericChanges).toContainEqual({ path: 'plans[0].actions[1].duration.value', values: [669, 669, 719], range: 50 });
  });

  it('requires three observations', () => {
    expect(comparePuzzlePlanWindow([chain(), chain()]).stable).toBe(false);
  });

  it.each(['order', 'kind', 'participants', 'dependency', 'added-action'] as const)('rejects changed %s', change => {
    const baseline = chain(), actions = [...chain().plans[0].actions];
    if (change === 'order') actions.reverse();
    if (change === 'kind') actions[1] = { ...action(actions[1].id, 'transport-worker'), dependsOnActionIds: actions[1].dependsOnActionIds };
    if (change === 'participants') actions[1] = { ...action(actions[1].id, 'transport-force', 'unit-b'), dependsOnActionIds: actions[1].dependsOnActionIds };
    if (change === 'dependency') actions[1] = { ...actions[1], dependsOnActionIds: [] };
    if (change === 'added-action') actions.push(action('hold', 'hold-position'));
    expect(comparePuzzlePlanWindow([baseline, baseline, output(actions)]).stable).toBe(false);
  });

  it('retains a dependency represented by a chosen fact producer', () => {
    const baseline = chain(), plan = baseline.plans[0], [assemble, transport] = plan.actions;
    const viaFact = { plans: [{ ...plan, actions: [assemble, { ...transport,
      dependsOnActionIds: [], prerequisiteFactIds: ['arrival-refined'] }],
      facts: [{ id: 'arrival-refined', producerActionIds: [assemble.id] }],
      edges: [{ from: assemble.id, to: 'arrival-refined', kind: 'establishes' as const },
        { from: 'arrival-refined', to: transport.id, kind: 'requires' as const }] }] };
    expect(comparePuzzlePlanWindow([baseline, viaFact, viaFact]).stable).toBe(true);
  });

  it('treats a different training choice as a different plan', () => {
    const train = action('train', 'train');
    const footman = { ...train, declaration: { ...train.declaration,
      executor: { ...train.declaration.executor, parameters: { unitKind: 'footman' } } } };
    const knight = { ...footman, declaration: { ...footman.declaration,
      executor: { ...footman.declaration.executor, parameters: { unitKind: 'knight' } } } };
    expect(comparePuzzlePlanWindow([output([footman]), output([footman]), output([knight])]).stable).toBe(false);
  });
});
