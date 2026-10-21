import { expect, it } from 'vitest';
import { FactWorkQueue } from './fact-work';
import { createGoalGeometryReader, GOAL_GEOMETRY_BYTES, GOAL_GEOMETRY_ENTRIES } from './goal-geometry-source';
import type { GoalGeometryMemory, GoalGeometryRequest } from './goal-grounding-ports';
import { recordNativeRouting, withNavigationAudit } from '../../shared/navigation-audit';

const scan = (key: string, count: number, revision = 'terrain-a'): GoalGeometryRequest<number, readonly number[]> => ({
  key, revision, initialState: 0, advance: (cursor, allowance) => {
    const next = Math.min(count, cursor + allowance);
    return { state: next, work: next - cursor, done: next === count,
      ...(next === count ? { value: Array.from({ length: count }, (_, index) => index) } : {}) };
  },
});
const memory = (): GoalGeometryMemory => ({ version: 1, entries: [] });

it('continues one finite scan across JSON turns and shares the existing owner-think allowance', () => {
  let retained = memory(); const request = scan('legal-hall-sites', 5);
  for (const [tick, limit, expected] of [[0, 2, 2], [15, 2, 4], [30, 2, 5]] as const) {
    const work = new FactWorkQueue(tick, limit), read = createGoalGeometryReader({ tick, work, memory: retained });
    expect(read(request).state).toBe('pending'); work.flush();
    expect(retained.entries[0]!.work).toBe(expected);
    expect(work.receipt.used).toBeLessThanOrEqual(limit);
    expect(read(request).state).toBe('pending'); // never publishes in its completion think
    const sameThink = new FactWorkQueue(tick, limit, work.receipt);
    createGoalGeometryReader({ tick, work: sameThink, memory: retained })(request); sameThink.flush();
    expect(sameThink.receipt).toEqual(work.receipt);
    retained = JSON.parse(JSON.stringify(retained));
  }
  const work = new FactWorkQueue(45, 0), read = createGoalGeometryReader({ tick: 45, work, memory: retained });
  expect(read(request)).toMatchObject({ state: 'met', value: [0, 1, 2, 3, 4] });
  work.flush(); expect(work.receipt.used).toBe(0);
  const result = read(request); if (result.state === 'met') (result.value as number[]).pop();
  expect(read(request)).toMatchObject({ state: 'met', value: [0, 1, 2, 3, 4] });
});

it('queues at zero allowance, invalidates changed geometry, and accounts alongside other shared tasks', () => {
  const retained = memory(), zero = new FactWorkQueue(0, 0);
  let calls = 0;
  const request = scan('footprint', 3), measured = { ...request, advance: (...args: Parameters<typeof request.advance>) => {
    calls++; return request.advance(...args);
  } };
  const read = createGoalGeometryReader({ tick: 0, work: zero, memory: retained });
  expect(read(measured).state).toBe('pending'); zero.flush(); expect(calls).toBe(0);
  const shared = new FactWorkQueue(15, 4);
  shared.register({ key: 'critical-arrival', tier: 'critical-route', minimum: 1, run: () => ({ work: 2, done: true }) });
  createGoalGeometryReader({ tick: 15, work: shared, memory: retained })(measured); shared.flush();
  expect(shared.receipt.used).toBe(4); expect(retained.entries[0]!.state).toBe(2);
  const changed = new FactWorkQueue(30, 0);
  expect(createGoalGeometryReader({ tick: 30, work: changed, memory: retained })(scan('footprint', 3, 'new-body'))).toMatchObject({ state: 'pending' });
  expect(retained.entries).toHaveLength(1); expect(retained.entries[0]!.state).toBe(0);
});

it('keeps finite JSON retention and invalid cursors pending rather than inventing a geometry answer', () => {
  const retained = memory(), work = new FactWorkQueue(0, 0), read = createGoalGeometryReader({ tick: 0, work, memory: retained });
  for (let index = 0; index < GOAL_GEOMETRY_ENTRIES + 8; index++) read(scan(`site-${index}`, 1));
  expect(retained.entries.length).toBeLessThanOrEqual(GOAL_GEOMETRY_ENTRIES);
  expect(new TextEncoder().encode(JSON.stringify(retained)).byteLength).toBeLessThanOrEqual(GOAL_GEOMETRY_BYTES);
  expect(read({ ...scan('invalid', 1), initialState: Infinity })).toMatchObject({ state: 'pending', reason: { code: 'goal-geometry-cursor-invalid' } });
  const next = new FactWorkQueue(15, 1), bad = { ...scan('bad-work', 1), advance: () => ({ state: 0, work: 2, done: false }) };
  const pending = createGoalGeometryReader({ tick: 15, work: next, memory: retained });
  pending(bad); next.flush();
  expect(next.receipt.used).toBe(0);
  expect(pending(bad)).toMatchObject({ state: 'pending', reason: { code: 'goal-geometry-work-invalid' } });
});

it('isolates a failed domain cursor while keeping diagnostic audit failures visible', () => {
  const retained = memory(), work = new FactWorkQueue(0, 3), read = createGoalGeometryReader({ tick: 0, work, memory: retained });
  const request = { ...scan('domain-failure', 5), advance: () => { throw new Error('malformed domain cursor'); } };
  read(request); expect(() => work.flush()).not.toThrow();
  expect(work.receipt.used).toBe(3);
  expect(read(request)).toMatchObject({ state: 'pending', reason: { code: 'goal-geometry-advance-failed' } });
  const diagnostic = new FactWorkQueue(15, 3), diagnostics = createGoalGeometryReader({ tick: 15, work: diagnostic, memory: memory() });
  diagnostics({ ...scan('audit-failure', 1), advance: () => { recordNativeRouting('diagnostic-native-route'); return { state: 1, work: 1, done: true, value: [] }; } });
  expect(() => withNavigationAudit(() => { throw new Error('audit rejection'); }, () => diagnostic.flush())).toThrow('audit rejection');
});
