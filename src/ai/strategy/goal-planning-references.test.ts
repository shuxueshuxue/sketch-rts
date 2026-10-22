import { expect, it } from 'vitest';
import type { GoalFact } from './goal-planner-types';
import { goalFact, semanticGoalPredicate } from './goal-facts';
import { createGoalPlanningReferences, encodeGoalPlanningValue, goalPlanningIdentity, goalPlanningOrderKey,
  hydrateGoalPlanningValue, retainGoalPlanningReferences, withGoalPlanningReferences } from './goal-planning-references';
import { versionGoalObservation } from './goal-planning-references';
import { internGoalPlanningReference } from './goal-planning-references';
import { withGoalPlanningMemory } from './goal-planning-restore';
import { createAiPolicyMemory } from '../memory';

it('persists canonical fact versions across JSON and call order without hashing or content in IDs', () => {
  let memory = createGoalPlanningReferences(), first = '';
  withGoalPlanningReferences(memory, () => {
    first = goalFact({ kind: 'assets-safe', unitIds: ['b', 'a', 'a'], at: { landId: 'land:1', point: { y: 2, x: 1 } }, throughTick: 100 }).id;
    expect(goalFact({ throughTick: 100, at: { point: { x: 1, y: 2 }, landId: 'land:1' }, unitIds: ['a', 'b'], kind: 'assets-safe' }).id).toBe(first);
    expect(goalFact({ kind: 'assets-safe', unitIds: ['a', 'b'], at: { landId: 'land:1', point: { x: 1, y: 2 } }, throughTick: 101 }).id).not.toBe(first);
  });
  memory = JSON.parse(JSON.stringify(memory));
  withGoalPlanningReferences(memory, () => {
    goalFact({ kind: 'supply-cap', minimum: 99 });
    expect(goalFact({ kind: 'assets-safe', at: { landId: 'land:1', point: { x: 1, y: 2 } }, unitIds: ['b', 'a'], throughTick: 100 }).id).toBe(first);
    expect(first.length).toBeLessThan(32);
  });
});

it('shares regional pool identity while preserving each precise predicate view without input/table aliases', () => {
  const memory = createGoalPlanningReferences();
  withGoalPlanningReferences(memory, () => {
    const at = { point: { x: 1, y: 2 }, landId: 'land:1' as const };
    const a = goalFact({ kind: 'worker-at', at, count: 1, byTick: 100 });
    at.point.x = 999;
    const b = goalFact({ kind: 'worker-at', at: { ...at, point: { x: 3, y: 4 } }, count: 1, byTick: 100 });
    expect(a.id).toBe(b.id);
    expect(a.predicate).toMatchObject({ at: { point: { x: 1, y: 2 } } });
    const restored = hydrateGoalPlanningValue<GoalFact[]>(JSON.parse(JSON.stringify([a, b])));
    expect(restored.map(fact => fact.predicate)).toEqual([a.predicate, b.predicate]);
    expect(semanticGoalPredicate(a.predicate)).toEqual(semanticGoalPredicate(b.predicate));
    (restored[0]!.predicate as any).at.point.x = -5;
    expect(hydrateGoalPlanningValue(encodeGoalPlanningValue(a)).predicate).toEqual(a.predicate);
  });
});

it('collects unreachable definitions, keeps referenced content and never rewinds the version counter', () => {
  let memory = createGoalPlanningReferences(), root = '', unused = '', next = 0;
  withGoalPlanningReferences(memory, () => {
    root = goalPlanningIdentity('action', { effect: goalFact({ kind: 'supply-cap', minimum: 1 }) });
    unused = goalFact({ kind: 'supply-cap', minimum: 2 }).id;
    next = memory.nextVersion;
  });
  memory = retainGoalPlanningReferences(memory, [root]);
  expect(memory.entries[root]).toBeDefined(); expect(memory.entries[unused]).toBeUndefined(); expect(memory.nextVersion).toBe(next);
  withGoalPlanningReferences(memory, () => expect(goalFact({ kind: 'supply-cap', minimum: 3 }).id).toBe(`goal-v${next}`));
});

it('orders regenerated choices by full semantics instead of the allocation order of their versions', () => {
  const memory = createGoalPlanningReferences();
  let a = '', b = '', before = '';
  withGoalPlanningReferences(memory, () => {
    b = goalPlanningIdentity('action', { kind: 'build', at: { point: { x: 2, y: 1 } } });
    a = goalPlanningIdentity('action', { kind: 'build', at: { point: { x: 1, y: 1 } } });
    before = goalPlanningOrderKey(a); expect(before < goalPlanningOrderKey(b)).toBe(true);
  });
  const collected = retainGoalPlanningReferences(memory, [b]);
  withGoalPlanningReferences(collected, () => {
    const regenerated = goalPlanningIdentity('action', { kind: 'build', at: { point: { x: 1, y: 1 } } });
    expect(regenerated).not.toBe(a); expect(goalPlanningOrderKey(regenerated)).toBe(before);
  });
});

it('versions a regional pool answer by its published meaning while preserving the actual request view', () => {
  const memory = createGoalPlanningReferences();
  withGoalPlanningReferences(memory, () => {
    const a = goalFact({ kind: 'worker-at', at: { point: { x: 1, y: 2 }, landId: 'land:1' }, count: 1, byTick: 100 });
    const b = goalFact({ kind: 'worker-at', at: { point: { x: 3, y: 4 }, landId: 'land:1' }, count: 1, byTick: 100 });
    const native = { fact: a, state: 'met' as const, observedTick: 10, revision: 'native-price-inputs', availableTick: 10,
      entityIds: ['worker'], quantity: 1, evidence: [], reason: { code: 'native-callable-region-pool', factIds: [a.id], values: {} } };
    const first = versionGoalObservation(a, native), other = versionGoalObservation(b, { ...native, revision: 'different-native-inputs', observedTick: 11 });
    expect(first.revision).toBe(other.revision); expect(other.fact.predicate).toEqual(b.predicate);
    expect(versionGoalObservation(a, { ...native, quantity: 0 }).revision).not.toBe(first.revision);
    expect(versionGoalObservation(a, { ...native, entityIds: ['replacement'] }).revision).not.toBe(first.revision);
  });
});

it('detaches discarded trace facts before collecting the seat definitions they no longer root', () => {
  const memory = createAiPolicyMemory();
  const trace = withGoalPlanningMemory(memory, () => ({ fact: goalFact({ kind: 'supply-cap', minimum: 1 }) }));
  expect(Object.keys(memory.goalPlanningReferences!.entries)).toEqual([]);
  expect(JSON.parse(JSON.stringify(trace))).toMatchObject({ fact: { predicate: { kind: 'supply-cap', minimum: 1 } } });
});

it('rejects non-JSON identity collisions before serialization and leaves the version counter unchanged', () => {
  const memory = createGoalPlanningReferences(), cycle: any = {}; cycle.self = cycle;
  withGoalPlanningReferences(memory, () => {
    for (const invalid of [NaN, Infinity, -Infinity, undefined, 1n, new Date(), new Map(), cycle, Array(1), [undefined],
      Object.defineProperty({}, 'x', { get: () => 1, enumerable: true })])
      expect(() => internGoalPlanningReference('fact', invalid)).toThrow();
    expect(memory.nextVersion).toBe(1); expect(memory.entries).toEqual({});
  });
});
