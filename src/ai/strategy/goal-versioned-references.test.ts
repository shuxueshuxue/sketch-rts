import { expect, it } from 'vitest';
import { internGoalReference, readGoalReference, retainGoalReferences, type GoalReferenceMemory } from './goal-versioned-references';
import type { GoalParameter } from './goal-planner-types';

const table = (nextVersion = 1): GoalReferenceMemory => ({ version: 1, nextVersion, entries: {} });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

it('reuses only identical JSON bytes in the same namespace, without hashes or stored byte-string copies', () => {
  const memory = table(), first = { unit: 'one', at: { x: 1, y: 2 }, roles: ['worker', null, true] };
  const id = internGoalReference(memory, 'action', first);
  expect(id).toBe('goal-ref:action:v1');
  expect(internGoalReference(memory, 'action', json(first))).toBe(id);
  expect(internGoalReference(memory, 'action', { ...first, at: { x: 1, y: 3 } })).toBe('goal-ref:action:v2');
  expect(internGoalReference(memory, 'other', first)).toBe('goal-ref:other:v3');
  expect(internGoalReference(memory, 'action', { roles: first.roles, at: first.at, unit: first.unit })).toBe('goal-ref:action:v4');
  expect(memory.nextVersion).toBe(5);
  expect(Object.values(memory.entries).every(entry => Object.keys(entry).join(',') === 'namespace,content')).toBe(true);
});

it('normalizes JSON numbers, preserves string distinctions and survives plain JSON restoration', () => {
  let memory = table(0);
  const id = internGoalReference(memory, 'params', { zero: -0, number: 2.3333333333333335, unicode: '海岸' });
  memory = json(memory);
  expect(internGoalReference(memory, 'params', { zero: 0, number: 2.3333333333333335, unicode: '海岸' })).toBe(id);
  expect(readGoalReference(memory, id)).toEqual({ zero: 0, number: 2.3333333333333335, unicode: '海岸' });
  expect(internGoalReference(memory, 'params', '\u00e9')).not.toBe(internGoalReference(memory, 'params', 'e\u0301'));
  expect(readGoalReference(memory, 'goal-ref:params:v999')).toBeUndefined();
  expect(readGoalReference(memory, 'old-long-task-id')).toBeUndefined();
});

it('detaches input and returned objects, while accepting shared acyclic source objects', () => {
  const memory = table(), shared = { x: 1 }, source = { a: shared, b: shared };
  const id = internGoalReference(memory, 'params', source);
  shared.x = 2;
  const copy = readGoalReference(memory, id) as typeof source;
  expect(copy).toEqual({ a: { x: 1 }, b: { x: 1 } });
  copy.a.x = 9;
  expect(copy.b.x).toBe(1);
  expect(readGoalReference(memory, id)).toEqual({ a: { x: 1 }, b: { x: 1 } });
});

it('rejects non-JSON values without invoking accessors or changing the table/counter', () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let reads = 0;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get: () => { reads++; return 1; } });
  const hidden = Object.defineProperty({}, 'x', { enumerable: false, value: 1 });
  const symbolKey = { [Symbol('x')]: 1 };
  const extra = [1] as number[] & { extra?: number }; extra.extra = 2;
  for (const invalid of [undefined, NaN, Infinity, -Infinity, 1n, Symbol('x'), () => 1, { x: undefined }, [undefined],
    new Array(2), cyclic, new Date(), new Map(), new Set(), new Uint8Array([1]), getter, hidden, symbolKey, extra]) {
    const memory = table(), before = JSON.stringify(memory);
    expect(() => internGoalReference(memory, 'params', invalid as GoalParameter)).toThrow();
    expect(JSON.stringify(memory)).toBe(before);
  }
  expect(reads).toBe(0);
});

it('bounds namespaces and counters before publishing an identity', () => {
  for (const namespace of ['', 'has:colon', 'with space', '海岸', 'x'.repeat(65), 1, undefined]) {
    const memory = table(); expect(() => internGoalReference(memory, namespace as string, null)).toThrow(); expect(memory.nextVersion).toBe(1);
  }
  const memory = table(Number.MAX_SAFE_INTEGER - 1), id = internGoalReference(memory, 'x'.repeat(64), null);
  expect(id.length).toBeLessThanOrEqual(128);
  expect(memory.nextVersion).toBe(Number.MAX_SAFE_INTEGER);
  expect(internGoalReference(memory, 'x'.repeat(64), null)).toBe(id);
  const before = JSON.stringify(memory);
  expect(() => internGoalReference(memory, 'new', 1)).toThrow(); expect(JSON.stringify(memory)).toBe(before);
  const stale = table(1); stale.entries['goal-ref:a:v1'] = { namespace: 'a', content: null };
  expect(() => internGoalReference(stale, 'b', null)).toThrow();
});

it('retains a transitive closure through nested values and map keys, and never reuses a collected version', () => {
  let memory = table();
  const leaf = internGoalReference(memory, 'params', { actors: ['one', 'two'] });
  const middle = internGoalReference(memory, 'action', { dependencies: [leaf] });
  const root = internGoalReference(memory, 'token', { [middle]: { ref: leaf } });
  const orphan = internGoalReference(memory, 'params', 'orphan'), nextVersion = memory.nextVersion;
  memory = json(memory); retainGoalReferences(memory, new Set([root, 'absent-root']));
  expect(Object.keys(memory.entries)).toEqual([leaf, middle, root]);
  expect(readGoalReference(memory, orphan)).toBeUndefined(); expect(memory.nextVersion).toBe(nextVersion);
  const again = internGoalReference(memory, 'params', 'orphan');
  expect(again).not.toBe(orphan); expect(again).toBe(`goal-ref:params:v${nextVersion}`);
  retainGoalReferences(memory, []);
  expect(memory.entries).toEqual({}); expect(memory.nextVersion).toBe(nextVersion + 1);
});

it('follows forward/cyclic reference edges without confusing them with an invalid JSON object cycle', () => {
  const memory = table();
  const first = internGoalReference(memory, 'link', { next: 'goal-ref:link:v2' });
  const second = internGoalReference(memory, 'link', { next: first });
  const unused = internGoalReference(memory, 'link', 'unused');
  retainGoalReferences(memory, [first]);
  expect(Object.keys(memory.entries)).toEqual([first, second]); expect(readGoalReference(memory, unused)).toBeUndefined();
  retainGoalReferences(memory, []); expect(memory.entries).toEqual({}); expect(memory.nextVersion).toBe(4);
});

it('does not collect authoritative roots by recency, and does not retain substring lookalikes', () => {
  const memory = table(), id = internGoalReference(memory, 'old', 'live');
  for (let i = 0; i < 200; i++) internGoalReference(memory, 'recent', { i });
  const root = internGoalReference(memory, 'root', { text: `prefix-${id}-suffix`, exact: id });
  retainGoalReferences(memory, [root]);
  expect(Object.keys(memory.entries)).toEqual([id, root]);
  const lookalike = internGoalReference(memory, 'root', `prefix-${id}-suffix`);
  retainGoalReferences(memory, [lookalike]);
  expect(Object.keys(memory.entries)).toEqual([lookalike]);
});

it('traverses broad JSON arrays without imposing a reference quota or relying on function argument limits', () => {
  const memory = table(), leaf = internGoalReference(memory, 'leaf', null);
  const root = internGoalReference(memory, 'root', Array.from({ length: 140000 }, () => leaf));
  retainGoalReferences(memory, [root]);
  expect(Object.keys(memory.entries)).toEqual([leaf, root]);
  expect((readGoalReference(memory, root) as GoalParameter[])).toHaveLength(140000);
});

it('keeps the table unchanged if reachable content is invalid during GC', () => {
  const memory = table(), id = internGoalReference(memory, 'params', { x: 1 });
  internGoalReference(memory, 'params', 'unreachable');
  const bad: Record<string, GoalParameter> = {}; bad.loop = bad;
  memory.entries[id]!.content = bad;
  const oldEntries = memory.entries, oldKeys = Object.keys(oldEntries), nextVersion = memory.nextVersion;
  expect(() => retainGoalReferences(memory, [id])).toThrow();
  expect(memory.entries).toBe(oldEntries); expect(Object.keys(memory.entries)).toEqual(oldKeys); expect(memory.nextVersion).toBe(nextVersion);
});
