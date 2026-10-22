import { expect, it } from 'vitest';
import { FactWorkQueue } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory } from './goal-grounding-ports';
import { observationJsonBytes } from './observation-json-bytes';

it('retains one lossless hull/shore version across requests and JSON, charges the table, and never aliases changed geometry', () => {
  let memory: GoalGeometryMemory = { version: 1, entries: [] };
  const hull = { kind: 'transport', hull: [{ x: -10.5, y: 4.25 }, { x: 12.5, y: -3 }], heading: .123456789 };
  const shore = { landId: 'land:2', seaId: 'sea:1', water: { x: 101, y: 200 }, ground: { x: 90, y: 200 } };
  let originalHull = '', originalShore = '';
  for (const sequence of [1, 2]) {
    const work = new FactWorkQueue(1, 4, undefined, sequence);
    const read = createGoalGeometryReader({ tick: 1, work, memory });
    const h = read.reference!('hull:transport', hull), s = read.reference!('shore', shore);
    if (sequence === 1) { originalHull = h; originalShore = s; }
    else { expect(h).toBe(originalHull); expect(s).toBe(originalShore); }
    for (const key of ['one', 'two']) work.withConsumer('island-goal', null, () => read({ key, revision: 'terrain', references: [h, s], initialState: null,
      advance: state => ({ state, work: 1, done: true, value: true }) }));
    work.flush();
    expect(memory.references).toHaveLength(2);
    expect(memory.references!.find(row => row.id === h)!.value).toEqual(hull);
    expect(memory.references!.find(row => row.id === s)!.value).toEqual(shore);
    expect(memory.capacity!.pinnedBytes).toBe(observationJsonBytes({ version: 1, entries: memory.entries,
      references: memory.references, nextReference: memory.nextReference }));
    memory = JSON.parse(JSON.stringify(memory));
  }
  const read = createGoalGeometryReader({ tick: 1, work: new FactWorkQueue(1, 0, undefined, 3), memory });
  expect(read.reference!('hull:transport', { ...hull, heading: hull.heading + 1e-10 })).not.toBe(originalHull);
  expect(read.reference!('hull:transport', { ...hull, hull: [{ x: -10.50001, y: 4.25 }, hull.hull[1]!] })).not.toBe(originalHull);
  expect(read.reference!('shore', { ...shore, ground: { x: 91, y: 200 } })).not.toBe(originalShore);
});

it('releases a completed construction cursor while retaining its exact published value and timing', () => {
  const memory: GoalGeometryMemory = { version: 1, entries: [] };
  const work = new FactWorkQueue(1, 1, undefined, 1), read = createGoalGeometryReader({ tick: 1, work, memory });
  const request = { key: 'finite-build', revision: 'one', initialState: null,
    advance: () => ({ state: { abandonedWorkingBuffer: 'x'.repeat(5000) }, work: 1, done: true, value: { point: [10, 20] } }) };
  work.withConsumer('island', null, () => read(request)); work.flush();
  expect(memory.entries[0]!.state).toBeNull();
  expect(read(request).state).toBe('pending');
  const restored: GoalGeometryMemory = JSON.parse(JSON.stringify(memory));
  const next = createGoalGeometryReader({ tick: 1, memory: restored, work: new FactWorkQueue(1, 0, undefined, 2) });
  expect(next(request)).toMatchObject({ state: 'met', value: { point: [10, 20] } });
  expect(restored.capacity!.pinnedBytes).toBeLessThan(1000);
});
