import { expect, it } from 'vitest';
import { globalizeGoalBindings, goalGlobalStepKey, goalGroundingKey, goalSemanticDecision, goalSemanticPlan,
  type GoalIncumbent, type GoalIncumbentStep, type GoalSearchMemory } from './goal-search-format';
import { goalSearchWire } from './goal-search-wire';

const step = (id: string, kind: GoalIncumbentStep['selector']['kind'], fields: Record<string, string | number> = {}): GoalIncumbentStep => ({
  id, selector: { provider: 'economy', kind, grounding: fields }, bindings: {}, dependsOn: [], startOffsetTicks: 0, finishOffsetTicks: 10,
  quote: { basis: 'published', durationTicks: 10, costGold: 100, successProbability: 1, dependencies: [] },
});
function plan(): GoalIncumbent {
  return { goalId: 'island', scheduledAtTick: 15, condition: { state: 'valid' }, ready: ['yard'], steps: [
    step('yard', 'build', { buildingKind: 'shipyard', 'site.landId': 'land:1', 'site.x': 1, 'site.y': 2 }),
    { ...step('ship', 'train', { unitKind: 'transport', count: 1 }), dependsOn: ['yard'],
      bindings: { producer: { kind: 'step-output', step: 'yard', output: 'building' } } },
  ] };
}

it('keeps full semantic selector identity across JSON, property order and other goals', () => {
  const selector = plan().steps[0]!.selector;
  const key = goalGlobalStepKey('island', selector);
  expect(goalGlobalStepKey('island', { ...selector, grounding: Object.fromEntries(Object.entries(selector.grounding).reverse()) })).toBe(key);
  expect(goalGlobalStepKey('other-island', selector)).not.toBe(key);
  expect(goalGlobalStepKey('island', { ...selector, provider: 'other-provider' })).not.toBe(key);
  const memory: GoalSearchMemory = { version: 1, goals: { island: { incumbent: plan(), cursor: {
    scheduledAtTick: 15, stack: [{ requirement: { kind: 'transport-in', seaId: 'sea:1' }, nextAlternative: 2 }], prefix: [], dependencies: [], exhausted: false,
  } } } };
  const restored = goalSearchWire(JSON.parse(JSON.stringify(memory)));
  expect(goalSemanticPlan(restored.goals.island!.incumbent!)).toBe(goalSemanticPlan(plan()));
  expect(restored.goals.island!.cursor!.stack[0]!.nextAlternative).toBe(2);
});

it('keeps real wire data rather than hiding declarations behind accessors or JSON hooks', () => {
  const memory: GoalSearchMemory = { version: 1, goals: { island: { incumbent: plan() } } };
  const restored = goalSearchWire(memory);
  expect(restored).toEqual(memory); expect(restored).not.toBe(memory);
  const invalid: unknown[] = [
    { ...memory, refinements: { alternatives: [] } },
    { ...memory, goals: { island: { incumbent: { ...plan(), declaration: {} } } } },
    { ...memory, goals: { island: { incumbent: { ...plan(), scheduledAtTick: Infinity } } } },
    Object.defineProperty({ ...memory }, 'toJSON', { value: () => ({ version: 1, goals: {} }) }),
    { ...memory, goals: { island: { incumbent: { ...plan(), steps: Array(1) } } } },
  ];
  for (const value of invalid) expect(() => goalSearchWire(value)).toThrow();
});

it('compares bindings and dependency topology, while ignoring labels, prices and rolling clocks', () => {
  const before = plan(), original = goalSemanticPlan(before);
  const renamed: GoalIncumbent = { ...before, ready: ['new-yard'], steps: [...before.steps].reverse().map(row => ({
    ...row, id: `new-${row.id}`, dependsOn: row.dependsOn.map(id => `new-${id}`), startOffsetTicks: row.startOffsetTicks + 50,
    finishOffsetTicks: row.finishOffsetTicks + 50, quote: { ...row.quote, costGold: 120 }, bindings: row.id === 'ship'
      ? { producer: { kind: 'step-output', step: 'new-yard', output: 'building' } } : {},
  })) };
  expect(goalSemanticPlan(renamed)).toBe(original);
  const actual = { ...before, steps: before.steps.map(row => row.id === 'ship'
    ? { ...row, bindings: { producer: { kind: 'existing' as const, entityId: 'actual-yard' } } } : row) };
  expect(goalSemanticPlan(actual)).not.toBe(original);
  expect(() => goalSemanticPlan({ ...before, steps: before.steps.map(row => ({ ...row, dependsOn: [] })) })).toThrow('causal producer');
  expect(goalSemanticPlan({ ...before, ready: [] })).toBe(original);
  expect(goalSemanticDecision({ ...before, ready: [] })).not.toBe(goalSemanticDecision(before));
});

it('globalizes local future outputs without granting a real unit, building or lease', () => {
  const input = plan(), unchanged = JSON.stringify(input), bindings = globalizeGoalBindings(input);
  expect(bindings.ship!.producer).toEqual({ kind: 'output', actionId: goalGlobalStepKey(input.goalId, input.steps[0]!.selector), output: 'building' });
  expect(bindings.ship!.producer).not.toHaveProperty('entityId');
  expect(JSON.stringify(input)).toBe(unchanged);
  const other = globalizeGoalBindings({ ...input, goalId: 'other' });
  expect(other.ship!.producer).not.toEqual(bindings.ship!.producer);
  expect(() => globalizeGoalBindings({ ...input, steps: [input.steps[1]!] })).toThrow('local goal output');
});

it('rejects recursive definitions, bad JSON atoms and ambiguous local/global identities', () => {
  for (const fields of [{ n: NaN }, { n: Infinity }, { definition: { id: 'action', preconditions: [] } }, { id: 'goal-v123' },
    Object.defineProperty({}, 'x', { get: () => 1, enumerable: true }), { [Symbol('hidden')]: 1 }])
    expect(() => goalGroundingKey(fields as any)).toThrow();
  const input = plan();
  expect(() => goalSemanticPlan({ ...input, steps: [input.steps[0]!, { ...input.steps[0]!, id: 'duplicate' }] })).toThrow('Ambiguous');
  expect(() => goalSemanticPlan({ ...input, steps: input.steps.map(row => ({ ...row, dependsOn: ['ship'] })) })).toThrow('cyclic');
  expect(() => globalizeGoalBindings({ ...input, steps: [{ ...input.steps[0]!, bindings: {
    producer: { kind: 'output', actionId: 'local-number', output: 'building' },
  } }] })).toThrow('globalized');
});

it('reports no-plan separately from a retained but invalid incumbent', () => {
  expect(goalSemanticDecision(undefined)).toBe('{"state":"no-plan"}');
  const input = plan(), invalid: GoalIncumbent = { ...input, condition: { state: 'invalid', step: 'yard', reason: 'worker-dead' } };
  expect(goalSemanticDecision(invalid)).not.toBe(goalSemanticDecision(undefined));
  expect(goalSemanticDecision(invalid)).not.toBe(goalSemanticDecision(input));
  expect(goalSemanticPlan(invalid)).toBe(goalSemanticPlan(input));
});
