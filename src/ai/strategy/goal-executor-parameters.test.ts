import { expect, it } from 'vitest';
import { goalEntityId, goalEntityIds, goalPoint, goalTarget } from './goal-executor-parameters';

it('accepts only resolved real references and keeps JSON identities stable', () => {
  const value = [{ kind: 'existing', entityId: 'b' }, { kind: 'existing', entityId: 'a' }, { kind: 'existing', entityId: 'b' }];
  expect(goalEntityIds(value)).toEqual(['a', 'b']);
  expect(goalEntityIds(JSON.parse(JSON.stringify(value)))).toEqual(['a', 'b']);
  for (const unresolved of [{ kind: 'output', actionId: 'train', output: 'unit-0' }, { kind: 'binding', name: 'hull' }, 'a']) {
    expect(goalEntityId(unresolved)).toBeNull(); expect(goalEntityIds([unresolved])).toBeNull();
  }
});
it('rejects non-finite points and malformed region bindings without a native geometry fallback', () => {
  expect(goalTarget({ point: { x: 10, y: 20 }, landId: 'land:2', seaId: 'sea:1', entityId: 'mine' }))
    .toEqual({ point: { x: 10, y: 20 }, landId: 'land:2', seaId: 'sea:1', entityId: 'mine' });
  expect(goalTarget({ point: { x: 0, y: 0 }, landId: 'sea:2' })).toBeNull();
  expect(goalPoint({ x: Infinity, y: 0 })).toBeNull(); expect(goalPoint(null)).toBeNull();
});
