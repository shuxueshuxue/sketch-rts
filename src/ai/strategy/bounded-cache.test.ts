import { expect, it } from 'vitest';
import { boundCache, touchCache, type CacheUse } from './bounded-cache';

it('evicts only unreferenced LRU entries with stable ID ties and survives JSON', () => {
  const entries = [{ id: 'pin', lastUsedThink: 0, planIds: ['plan'] }, { id: 'b', lastUsedThink: 1 },
    { id: 'a', lastUsedThink: 1 }, { id: 'recent', lastUsedThink: 2 }];
  const result = boundCache({ kind: 'test', entries: JSON.parse(JSON.stringify(entries)) as typeof entries,
    id: entry => entry.id, lastUsed: entry => entry.lastUsedThink, plans: entry => entry.planIds ?? [], thinkSequence: 3, maxEntries: 2 });
  expect(result.entries.map(entry => entry.id)).toEqual(['pin', 'recent']);
  expect(result.evicted.map(entry => entry.id)).toEqual(['a', 'b']);
  expect(result.capacity.pressure).toBeUndefined();
});

it('preserves an oversized pinned working set and reports every affected plan without repeated overflow counts', () => {
  const entries = [{ id: 'a', planIds: ['two', 'one'] }, { id: 'b', planIds: ['one'] }];
  const input = { kind: 'test', entries, id: (entry: typeof entries[number]) => entry.id, lastUsed: () => 0,
    plans: (entry: typeof entries[number]) => entry.planIds, thinkSequence: 2, maxEntries: 1, maxBytes: 10 };
  const first = boundCache(input), second = boundCache({ ...input, capacity: first.capacity });
  expect(second.entries).toEqual(entries);
  expect(second.capacity.pressure).toMatchObject({ planIds: ['one', 'two'], requestIds: ['a', 'b'], overflowCount: 1, entries: 2, limitEntries: 1 });
  expect(second.capacity.pressure!.bytes).toBeGreaterThan(1);
  const released = boundCache({ ...input, entries: entries.map(entry => ({ ...entry, planIds: [] })), capacity: second.capacity });
  expect(released.entries).toEqual([]); expect(released.capacity.pressure).toBeUndefined();
});

it('keeps all same-think references and replaces them when a new think touches the entry', () => {
  const use: CacheUse = {};
  touchCache(use, 1, ['a']); touchCache(use, 1, ['b']);
  expect(use.planIds).toEqual(['a', 'b']);
  touchCache(use, 2, ['b']); expect(use.planIds).toEqual(['b']);
});
