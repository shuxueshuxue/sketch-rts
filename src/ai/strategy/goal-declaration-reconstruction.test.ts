import { expect, it } from 'vitest';
import { installGoalDeclarationReconstruction } from './goal-declaration-reconstruction';
import { discoverGoalActions } from './goal-provider-candidates';
import { goalFact } from './goal-facts';
import { clearGoalDeclarationRuntime, createGoalPlanningReferences, encodeGoalPlanningValue, goalPlanningIdentity,
  hydrateGoalPlanningValue, protectGoalDeclarations, retainGoalPlanningReferences, withGoalPlanningReferences } from './goal-planning-references';
import type { GoalActionDeclaration, GoalActionProvider, GoalDeclarationContext, GoalFact, GoalPlanningContext } from './goal-planner-types';

function fixture(precision: 'coarse' | 'exact' = 'exact') {
  let table = createGoalPlanningReferences(), revision = 'proof-1', source = 'world-1', gold = 10, calls = 0;
  const scoped = <T>(run: () => T) => withGoalPlanningReferences(table, run);
  const dependency = scoped(() => goalFact({ kind: 'supply-cap', minimum: 1 }));
  const effect = scoped(() => goalFact({ kind: 'camp-cleared', campId: 'test-camp' }));
  const saved: GoalDeclarationContext = { precision, reservedGold: 0, campIds: [] };
  const context = () => ({ precision, declarationContext: saved,
    declarationSourceRevision: () => source,
    readFact: (fact: GoalFact) => ({ fact, state: 'met', revision, observedTick: 10, availableTick: 10,
      evidence: [], reason: { code: 'observed', factIds: [], values: {} } }),
  }) as unknown as GoalPlanningContext;
  const provider: GoalActionProvider = { id: 'deterministic-provider', actionsFor() {
    calls++;
    return [{ id: goalPlanningIdentity('action', { kind: 'assemble', destination: effect.id }), kind: 'assemble', precision,
      preconditions: [dependency], effects: [{ fact: effect, operation: 'establish', at: 'finish' }],
      demands: [], flows: [], outputs: [], executor: { executor: 'goal.assemble', parameters: { cohort: [{ kind: 'existing', entityId: 'real-unit' }] } },
      duration: { state: 'met', value: 20, factIds: [] }, cost: { state: 'met', value: [{ code: 'loss', gold, at: 'finish', factIds: [] }], factIds: [] },
      successProbability: { state: 'met', value: .9, factIds: [] }, reasons: [] }];
  } };
  const install = () => installGoalDeclarationReconstruction({ providers: [provider], context });
  const original = scoped(() => discoverGoalActions(provider, effect, context()).actions[0]!);
  const wire = scoped(() => encodeGoalPlanningValue(original));
  const resume = <T>(run: (action: GoalActionDeclaration) => T) => scoped(() => { install();
    return run(hydrateGoalPlanningValue(wire)); });
  return { original, wire, scoped, resume, install, calls: () => calls,
    changeFact: () => { revision = 'proof-2'; }, changeSource: () => { source = 'world-2'; }, changePrice: () => { gold = 11; },
    roundtrip: () => { table = JSON.parse(JSON.stringify(retainGoalPlanningReferences(table, wire))); },
    definitions: () => Object.values(table.entries), clear: () => clearGoalDeclarationRuntime(table) };
}

it('keeps a deferred declaration as a provider recipe and reconstructs the identical action after JSON and reference GC', () => {
  const f = fixture();
  expect(f.wire).toHaveProperty('recipeRef');
  expect(f.definitions().some(row => row.namespace === 'declaration')).toBe(false);
  f.roundtrip();
  const before = f.calls();
  f.resume(action => {
    expect(action.executor).toEqual(f.original.executor);
    expect(action.preconditions).toEqual(f.original.preconditions);
    expect(action.effects).toEqual(f.original.effects);
    expect(action.duration).toEqual(f.original.duration);
    expect(action.cost).toEqual(f.original.cost);
    expect(action.successProbability).toEqual(f.original.successProbability);
  });
  expect(f.calls()).toBe(before + 1);
});

it('expires a changed prerequisite before calling its provider and never emits an executable stale action', () => {
  const f = fixture(); f.roundtrip(); f.changeFact(); const before = f.calls();
  f.resume(action => { expect(action.duration.state).toBe('pending'); expect(action.precision).toBe('coarse');
    expect(action.demands).toEqual([]); expect(action.executor.parameters).toEqual({}); });
  expect(f.calls()).toBe(before);
});

it.each(['source', 'price'] as const)('expires a changed %s rather than borrowing the stored exact price', change => {
  const f = fixture(); f.roundtrip();
  if (change === 'source') f.changeSource(); else f.changePrice();
  f.resume(action => { expect(action.precision).toBe('coarse'); expect(action.duration.state).toBe('pending'); });
});

it('keeps a ready declaration in full for admission and execution without a provider reconstruction scope', () => {
  const f = fixture(); const wire = f.scoped(() => { protectGoalDeclarations([f.original.id]); return encodeGoalPlanningValue(f.original); });
  expect(wire).toHaveProperty('declarationRef'); f.clear();
  f.scoped(() => { const restored = hydrateGoalPlanningValue(wire);
    expect(restored.executor).toEqual(f.original.executor); expect(restored.preconditions).toEqual(f.original.preconditions); });
});

it('does not treat a recipe outside its provider scope as an admitted declaration', () => {
  const f = fixture(); f.clear();
  f.scoped(() => expect(() => hydrateGoalPlanningValue(f.wire).executor).toThrow('native provider scope'));
});

it('regenerates an expired coarse cursor as a fresh coarse proposal without borrowing exact authority', () => {
  const f = fixture('coarse'); f.roundtrip(); f.changeFact(); f.changePrice();
  f.resume(action => { expect(action.precision).toBe('coarse');
    expect(action.cost.state === 'met' && action.cost.value[0]!.gold).toBe(11);
    expect(action.regeneration!.dependencies[0]!.revision).toBe('proof-2'); });
});

it('preserves an exact quote origin when a coarse discovery wrapper returns it', () => {
  const f = fixture();
  f.scoped(() => {
    const coarse = { precision: 'coarse', declarationContext: { precision: 'coarse', reservedGold: 100, campIds: [] },
      readFact() { throw Error('An existing exact origin must not be recaptured'); },
      declarationSourceRevision() { throw Error('An existing exact origin must not be recaptured'); } } as unknown as GoalPlanningContext;
    const output = discoverGoalActions({ id: 'wrapped-provider', actionsFor: () => [f.original] }, f.original.effects[0]!.fact, coarse);
    expect(output.actions[0]!.regeneration).toBe(f.original.regeneration);
    expect(output.actions[0]!.regeneration!.context.precision).toBe('exact');
  });
});

it('keeps an expired native selector distinct without retaining executable authority', () => {
  const table = createGoalPlanningReferences();
  withGoalPlanningReferences(table, () => {
    const parameters = { cohort: [{ kind: 'existing', entityId: 'worker-a' }],
      transport: { kind: 'existing', entityId: 'hull-a' }, departure: { ground: { x: 1, y: 2 } } };
    const id = goalPlanningIdentity('action', `goal-action:transport-worker:${JSON.stringify(parameters)}`);
    const effect = goalFact({ kind: 'camp-cleared', campId: 'test-camp' });
    const original: GoalActionDeclaration = { id, kind: 'transport-worker', precision: 'exact',
      preconditions: [], effects: [{ fact: effect, operation: 'establish', at: 'finish' }], demands: [], flows: [], outputs: [],
      duration: { state: 'met', value: 10, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
      successProbability: { state: 'met', value: 1, factIds: [] }, reasons: [],
      executor: { executor: 'goal.transport-worker', parameters }, regeneration: { providerId: 'provider', effect, groundingKey: id,
        context: { precision: 'exact', reservedGold: 0, campIds: [] }, dependencies: [],
        sourceRevision: 'prior-declaration-context-unrecorded' } };
    const wire = JSON.parse(JSON.stringify(encodeGoalPlanningValue(original)));
    installGoalDeclarationReconstruction({ providers: [], context() { throw Error('No expired provider evaluation'); } });
    const action = hydrateGoalPlanningValue<GoalActionDeclaration>(wire);
    expect(action.executor.parameters).toEqual(parameters);
    expect(action.precision).toBe('coarse'); expect(action.duration.state).toBe('pending');
    expect(action.demands).toEqual([]); expect(action.outputs).toEqual([]);
    clearGoalDeclarationRuntime(table);
  });
});
