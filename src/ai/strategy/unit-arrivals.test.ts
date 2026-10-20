import { expect, it } from 'vitest';
import { actionTargetArrival, arrivalColumns, mapUnitArrivals, unitArrival, withUnitArrivals } from './unit-arrivals';
import type { Arrival } from './types';

it('queries owned facts without constructing the array view, and reads a saved plain view identically', () => {
  const arrival: Arrival = { status: 'reachable', ticks: 120, landTicks: 120, crossings: [], evidence: [] };
  const unit = withUnitArrivals({ id: 'crew', owner: 'p0', kind: 'footman' as const,
    location: { kind: 'land' as const, landId: 'land:1' as const, point: { x: 10, y: 10 } },
    hp: 100, maxHp: 100, strength: 1, roles: ['frontline'] as const, expiresTick: null, commitments: [] },
  { columns: arrivalColumns(['pending', 'mine']), values: [undefined, arrival], count: 1 });
  const descriptor = Object.getOwnPropertyDescriptor(unit, 'arrivals')!;
  let projections = 0;
  Object.defineProperty(unit, 'arrivals', { ...descriptor, get() { projections++; return descriptor.get!.call(this); } });
  expect(unitArrival(unit, 'mine')).toBe(arrival);
  expect(unitArrival(unit, 'pending')).toBeUndefined();
  expect(mapUnitArrivals(unit, (targetId, arrival) => [targetId, arrival.status])).toEqual([['mine', 'reachable']]);
  const target = { entityId: 'mine', point: { x: 100, y: 100 }, landId: 'land:1' as const };
  expect(actionTargetArrival(unit, 'evacuation', target, [{ id: 'mine', target }])).toBe(arrival);
  expect(actionTargetArrival(unit, 'rally', { ...target, point: { x: 200, y: 100 } }, [{ id: 'mine', target }])).toBeUndefined();
  expect(actionTargetArrival(unit, 'evacuation', { ...target, landId: 'land:2' }, [{ id: 'mine', target }])).toBeUndefined();
  expect(projections).toBe(0);
  const saved = JSON.parse(JSON.stringify(unit));
  expect(projections).toBe(1);
  expect(saved.arrivals).toEqual([{ targetId: 'mine', arrival }]);
  expect(unitArrival(saved, 'mine')).toEqual(arrival);
  expect(mapUnitArrivals(saved, (id, arrival) => [id, arrival.status])).toEqual([['mine', 'reachable']]);
});
