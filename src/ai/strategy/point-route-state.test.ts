import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { advanceShipRouteSearch, type ShipRouteSearchState } from '../../shared/ship-navigation';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import { withNavigationAudit } from '../../shared/navigation-audit';
import type { AiPolicyMemory } from '../memory';
import { FactWorkQueue, withFactWork } from './fact-work';
import { observationMemory } from './observation-memory';
import { observationJsonBytes } from './observation-json-bytes';
import { pointRoute, POINT_ROUTE_MEMORY_BYTES } from './point-routes';
import { restoreShipRouteSearchState, storeShipRouteSearchState, type StoredShipRouteSearchState } from './point-route-state';

it('resumes the original far-ship native search losslessly within the existing resident limit', () => {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url)));
  expect(createHash('sha256').update(raw).digest('hex')).toBe('4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78');
  const snapshot: GameSnapshot = JSON.parse(raw.toString()), before = JSON.stringify(snapshot);
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const ship = snapshot.units.find(unit => unit.kind === 'transport')!, goal = { x: 112, y: 816 };
  const clear = Object.assign(() => true, { hasTraffic: false });
  let native: ShipRouteSearchState = { phase: 'prepare' }, stored: StoredShipRouteSearchState = { phase: 'prepare' };
  let expected: ReturnType<typeof advanceShipRouteSearch>, nativeWork = 0, rawPeak = 0, packedPeak = 0;
  for (let slice = 0; slice < 256 && !expected; slice++) {
    const restored = restoreShipRouteSearchState(stored);
    const a = { logicalWork: 0, expandedStates: 0 }, b = { logicalWork: 0, expandedStates: 0 };
    expected = advanceShipRouteSearch(snapshot.map, ship, goal, clear, Number.MAX_SAFE_INTEGER, true, native, a);
    const actual = advanceShipRouteSearch(snapshot.map, ship, goal, clear, Number.MAX_SAFE_INTEGER, true, restored, b);
    expect(actual).toEqual(expected); expect(b).toEqual(a);
    const graph = (state: ShipRouteSearchState) => ({ ...state,
      ...(state.nodes ? { nodes: [...state.nodes].sort((a, b) => a.id - b.id) } : {}) });
    expect(graph(restored)).toEqual(graph(native));
    nativeWork += a.logicalWork; rawPeak = Math.max(rawPeak, observationJsonBytes(native));
    stored = JSON.parse(JSON.stringify(storeShipRouteSearchState(restored)));
    if (!expected) packedPeak = Math.max(packedPeak, observationJsonBytes(stored));
    // The baseline uses its original JSON continuation, without compression.
    native = JSON.parse(JSON.stringify(native));
  }
  expect(expected?.partial).toBe(false);
  expect(rawPeak).toBeGreaterThan(POINT_ROUTE_MEMORY_BYTES);
  expect(packedPeak).toBeLessThan(POINT_ROUTE_MEMORY_BYTES);
  let memory: AiPolicyMemory = { jobs: [], unitClaims: {} }, published = false;
  withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
  }, () => {
    for (let sequence = 1; sequence <= 32 && !published; sequence++) {
      const observation = observationMemory(snapshot, 'planner', memory);
      const work = new FactWorkQueue(snapshot.tick, 6144, observation.factWork, sequence);
      withFactWork(work, () => {
        const fact = pointRoute(snapshot, observation, ship, ship, goal);
        if (fact.status === 'complete') {
          published = true; expect(fact.route).toEqual(expected); expect(fact.work).toBe(nativeWork);
        }
        observation.factWork = structuredClone(work.flush());
        expect(work.receipt.used).toBeLessThanOrEqual(6144);
        expect(observation.pointRoutes!.entries[0]!.failure).toBeUndefined();
        expect(observationJsonBytes(observation.pointRoutes)).toBeLessThanOrEqual(POINT_ROUTE_MEMORY_BYTES);
      });
      memory = JSON.parse(JSON.stringify(memory));
    }
  });
  expect(published).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
}, 60_000);

it('keeps small native states readable and rejects a damaged encoded continuation', () => {
  const state: ShipRouteSearchState = { phase: 'prepare' };
  expect(storeShipRouteSearchState(state)).toBe(state);
  expect(() => restoreShipRouteSearchState({ encoding: 'native-graph-deflate-v1', data: 'broken' })).toThrow();
});
