import { expect, it } from 'vitest';
import { FactWorkQueue } from './fact-work';
import { createGoalGeometryReader, GOAL_GEOMETRY_BYTES, GOAL_GEOMETRY_ENTRIES, retainGoalGeometryRequests } from './goal-geometry-source';
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

it('publishes on the next owner think at a frozen game tick without borrowing twice in one think', () => {
  let retained = memory(); const request = scan('frozen-world', 5);
  for (const sequence of [1, 2, 3]) {
    const work = new FactWorkQueue(100, 2, undefined, sequence);
    const read = createGoalGeometryReader({ tick: 100, work, memory: retained });
    expect(read(request).state).toBe('pending'); work.flush();
    expect(read(request).state).toBe('pending');
    const same = new FactWorkQueue(100, 2, JSON.parse(JSON.stringify(work.receipt)), sequence);
    createGoalGeometryReader({ tick: 100, work: same, memory: retained })(request); same.flush();
    expect(same.receipt).toEqual(work.receipt);
    expect(work.receipt.used).toBe(sequence === 3 ? 1 : 2);
    retained = JSON.parse(JSON.stringify(retained));
  }
  const next = new FactWorkQueue(100, 2, undefined, 4);
  expect(createGoalGeometryReader({ tick: 100, work: next, memory: retained })(request))
    .toMatchObject({ state: 'met', value: [0, 1, 2, 3, 4] });
  expect(next.flush().used).toBe(0);
});

it('pins active plan geometry through JSON retention and evicts only unpinned entries in LRU order', () => {
  let retained = memory();
  const limits = { maxBytes: 16 * 1024, maxEntries: 3 }, root = scan('root-build', 2);
  const first = new FactWorkQueue(100, 20, undefined, 1);
  const read = createGoalGeometryReader({ tick: 100, work: first, memory: retained, limits });
  first.withConsumer('mining-goal', null, () => read(root)); read(scan('older', 1)); read(scan('recent', 1)); first.flush();
  for (let sequence = 2; sequence <= 10; sequence++) {
    retained = JSON.parse(JSON.stringify(retained));
    const work = new FactWorkQueue(100, 20, undefined, sequence);
    const current = createGoalGeometryReader({ tick: 100, work, memory: retained, limits });
    expect(work.withConsumer('mining-goal', null, () => current(root))).toMatchObject({ state: 'met', value: [0, 1] });
    current(scan(`new-${sequence}`, 1)); work.flush();
    expect(retained.entries.find(entry => entry.key === 'root-build')).toMatchObject({ readyThink: 1, planIds: ['mining-goal'] });
    expect(retained.entries).toHaveLength(3);
  }
  expect(retained.entries.some(entry => entry.key === 'older')).toBe(false);
  expect(retained.capacity!.overflowCount).toBe(0);
});

it('retains oversized pins and pauses their plans instead of evicting or restarting finite work', () => {
  let retained = memory(), advances = 0;
  const request = (key: string) => ({ ...scan(key, 3), advance: (...args: Parameters<ReturnType<typeof scan>['advance']>) => {
    advances++; return scan(key, 3).advance(...args);
  } });
  const limits = { maxBytes: 16 * 1024, maxEntries: 1 };
  for (let sequence = 1; sequence <= 4; sequence++) {
    const work = new FactWorkQueue(0, 100, undefined, sequence);
    const read = createGoalGeometryReader({ tick: 0, work, memory: retained, limits });
    work.withConsumer('goal-a', null, () => read(request('first-root')));
    work.withConsumer('goal-b', null, () => read(request('second-root')));
    work.flush();
    expect(retained.entries).toHaveLength(2);
    expect(retained.capacity!.pressure).toMatchObject({ planIds: ['goal-a', 'goal-b'], overflowCount: sequence });
    expect(retained.capacity!.pressure!.requestIds).toHaveLength(2);
    expect(advances).toBe(0); expect(work.receipt.used).toBe(0);
    retained = JSON.parse(JSON.stringify(retained));
  }
  const work = new FactWorkQueue(0, 100, undefined, 5);
  const read = createGoalGeometryReader({ tick: 0, work, memory: retained, measurement: true });
  work.withConsumer('goal-a', null, () => read(request('first-root')));
  work.withConsumer('goal-b', null, () => read(request('second-root'))); work.flush();
  expect(advances).toBe(2); expect(work.receipt.used).toBe(6);
  expect(retained.capacity!.pressure).toBeUndefined(); expect(retained.capacity!.mode).toBe('measurement');
});

it('measures the full pinned payload without changing finite work or publication', () => {
  const retained = memory(), work = new FactWorkQueue(0, 4, undefined, 1);
  const read = createGoalGeometryReader({ tick: 0, work, memory: retained, measurement: true });
  const request: GoalGeometryRequest<number, string> = { key: 'large-native-result', revision: 'one', initialState: 0,
    advance: () => ({ work: 1, state: 1, done: true, value: 'x'.repeat(GOAL_GEOMETRY_BYTES * 2) }) };
  work.withConsumer('large-plan', null, () => read(request)); work.flush();
  expect(work.receipt.used).toBe(1);
  expect(retained.capacity!.peakPinnedBytes).toBeGreaterThan(GOAL_GEOMETRY_BYTES * 2);
  expect(retained.entries[0]!.value).toBe('x'.repeat(GOAL_GEOMETRY_BYTES * 2));
  expect(read(request).state).toBe('pending');
});

it('includes the serialization envelope when the pinned payload crosses its byte capacity', () => {
  const retained = memory(), work = new FactWorkQueue(0, 2, undefined, 1);
  const read = createGoalGeometryReader({ tick: 0, work, memory: retained, limits: { maxBytes: 1024, maxEntries: 4 } });
  const request: GoalGeometryRequest<number, string> = { key: 'wrapper-boundary', revision: 'v1', initialState: 0,
    advance: () => ({ state: 1, work: 1, done: true, value: 'x'.repeat(1000) }) };
  work.withConsumer('boundary-plan', null, () => read(request)); work.flush();
  const payload = new TextEncoder().encode(JSON.stringify({ version: retained.version, entries: retained.entries })).byteLength;
  expect(retained.capacity!.pinnedBytes).toBe(payload);
  expect(retained.capacity!.pressure).toMatchObject({ bytes: payload, limitBytes: 1024, planIds: ['boundary-plan'] });
  expect(retained.entries[0]!.value).toBe('x'.repeat(1000));
});

it('releases obsolete versions of a continuing goal while retaining its graph proof and current requests', () => {
  const retained = memory(), initial = new FactWorkQueue(0, 20, undefined, 1);
  const reader = createGoalGeometryReader({ tick: 0, work: initial, memory: retained,
    limits: { maxBytes: 16384, maxEntries: 3 } });
  const results = ['retained-proof', 'old-pose', 'current-pose'].map(key =>
    initial.withConsumer('same-goal', 100, () => reader(scan(key, 1))));
  initial.flush();
  const proof = results[0]!; if (proof.state !== 'pending') throw Error('cold result must be pending');
  retained.entries.find(entry => entry.key === 'current-pose')!.lastUsedThink = 2;
  retainGoalGeometryRequests(retained, [{ planId: 'same-goal', requestIds: proof.requestIds }], 2);
  expect(retained.entries.find(entry => entry.key === 'old-pose')!.planIds).toBeUndefined();
  expect(retained.entries.filter(entry => entry.planIds?.includes('same-goal')).map(entry => entry.key).sort())
    .toEqual(['current-pose', 'retained-proof']);
  const next = new FactWorkQueue(0, 20, undefined, 3);
  const continued = createGoalGeometryReader({ tick: 0, work: next, memory: retained,
    limits: { maxBytes: 16384, maxEntries: 3 } });
  next.withConsumer('same-goal', 100, () => continued(scan('new-pose', 1))); next.flush();
  expect(retained.entries.some(entry => entry.key === 'old-pose')).toBe(false);
  expect(continued(scan('retained-proof', 1))).toMatchObject({ state: 'met', value: [0] });
  expect(retained.entries.find(entry => entry.key === 'retained-proof')).toMatchObject({ readyThink: 1, work: 1 });
  expect(retained.capacity).toMatchObject({ maxBytes: 16384, maxEntries: 3, overflowCount: 0 });
});
