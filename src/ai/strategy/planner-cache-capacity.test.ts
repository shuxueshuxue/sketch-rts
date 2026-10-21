import { expect, it } from 'vitest';
import { boundPointRouteMemory, POINT_ROUTE_MEMORY_BYTES, type PointRouteMemory } from './point-routes';
import { boundObservationMemory, OBSERVATION_BYTE_LIMIT, type StrategyObservationMemory } from './observation-memory';
import { retainCachePins } from './bounded-cache';

it('retains oversized selected point progress through both local and aggregate bounds until its plan releases it', () => {
  // Cache policy contract: the large identity stands for a stored native
  // continuation. No geometry, route or arrival is asserted by this fixture.
  const points: PointRouteMemory = { entries: [{ id: 'selected', key: 'x'.repeat(OBSERVATION_BYTE_LIMIT + 1),
    firstRequestedTick: 0, lastRequestedTick: 0, geometryVersion: 'v1', readyTick: null, work: 7,
    state: { phase: 'prepare' }, lastUsedThink: 1, planIds: ['island-plan'] }] };
  const original = JSON.stringify(points.entries);
  expect(boundPointRouteMemory(points, 2).capacity.pressure).toMatchObject({ limitBytes: POINT_ROUTE_MEMORY_BYTES, planIds: ['island-plan'] });
  const observation: StrategyObservationMemory = { version: 1, owner: 'us', terrain: 'one', landBodies: 'one',
    fields: { land: [], sea: [] }, crossings: [], pointRoutes: points };
  boundObservationMemory(observation);
  expect(observation.cacheCapacities!.observation!.pressure).toMatchObject({ limitBytes: OBSERVATION_BYTE_LIMIT, planIds: ['island-plan'] });
  expect(JSON.stringify(points.entries)).toBe(original);
  const restored: StrategyObservationMemory = JSON.parse(JSON.stringify(observation));
  retainCachePins(restored.pointRoutes!.entries, new Map(), entry => `point:${entry.key}`, 3);
  boundPointRouteMemory(restored.pointRoutes!, 3); boundObservationMemory(restored);
  expect(restored.pointRoutes!.entries).toEqual([]);
  expect(restored.pointRoutes!.capacity!.pressure).toBeUndefined();
  expect(restored.cacheCapacities!.observation!.pressure).toBeUndefined();
});
