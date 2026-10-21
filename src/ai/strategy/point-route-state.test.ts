import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync, gunzipSync } from 'node:zlib';
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

it.each([{ x: 112, y: 816 }, { x: 176, y: 816 }])('resumes the original far-ship search to $x,$y losslessly within the existing resident limit', goal => {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url)));
  expect(createHash('sha256').update(raw).digest('hex')).toBe('4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78');
  const snapshot: GameSnapshot = JSON.parse(raw.toString()), before = JSON.stringify(snapshot);
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const ship = snapshot.units.find(unit => unit.kind === 'transport')!;
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
  const end = expected!.points.at(-1) ?? ship;
  const exactEnd = Math.hypot(end.x - goal.x, end.y - goal.y) <= 1e-5;
  withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
  }, () => {
    for (let sequence = 1; sequence <= 32 && !published; sequence++) {
      const observation = observationMemory(snapshot, 'planner', memory);
      const work = new FactWorkQueue(snapshot.tick, 6144, observation.factWork, sequence);
      withFactWork(work, () => {
        const fact = pointRoute(snapshot, observation, ship, ship, goal);
        if (fact.status === 'complete' || fact.status === 'static-infeasible') {
          published = true; expect(fact.status).toBe(exactEnd ? 'complete' : 'static-infeasible');
          if (fact.status === 'complete') expect(fact.route).toEqual(expected);
          expect(observation.pointRoutes!.entries[0]!.state).toEqual({ phase: 'done', result: expected });
          expect(fact.work).toBe(nativeWork);
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

it('restores the previous graph encoding with its unchanged native heap', () => {
  const header = new TextEncoder().encode(JSON.stringify({ state: { phase: 'search', heap: [{ id: 7, cost: 1, score: 2 }] },
    count: 1, values: [1] }));
  const bytes: number[] = []; let length = header.length;
  do { const byte = length % 128; length = Math.floor(length / 128); bytes.push(byte | (length ? 128 : 0)); } while (length);
  bytes.push(...header, 7, 0, 0);
  const data = deflateRawSync(Uint8Array.from(bytes)).toString('base64');
  expect(restoreShipRouteSearchState({ encoding: 'native-graph-deflate-v1', data })).toEqual({ phase: 'search',
    heap: [{ id: 7, cost: 1, score: 2 }], nodes: [{ id: 7, parent: -1, cost: 1 }] });
});

it('settles both selected far-ship leg requests under the shared limits and retains native projected endpoints', () => {
  const snapshot: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url))).toString());
  const before = JSON.stringify(snapshot); setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const ship = snapshot.units.find(unit => unit.kind === 'transport')!;
  let memory: AiPolicyMemory = { jobs: [], unitClaims: {} }, long = false, short = false;
  for (let sequence = 1; sequence <= 32 && !(long && short); sequence++) {
    const observation = observationMemory(snapshot, 'planner', memory), work = new FactWorkQueue(snapshot.tick, 6144, observation.factWork, sequence);
    withFactWork(work, () => {
      long ||= pointRoute(snapshot, observation, ship, ship, { x: 176, y: 816 }).status === 'static-infeasible';
      short ||= pointRoute(snapshot, observation, ship, ship, { x: 1488, y: 688 }).status === 'static-infeasible';
      observation.factWork = structuredClone(work.flush());
      expect(observationJsonBytes(observation.pointRoutes)).toBeLessThanOrEqual(POINT_ROUTE_MEMORY_BYTES);
      expect(observation.pointRoutes!.entries.every(entry => !entry.failure)).toBe(true);
      expect(work.receipt.used).toBeLessThanOrEqual(6144);
    });
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect({ long, short }).toEqual({ long: true, short: true });
  const entries = memory.strategy!.observation.pointRoutes!.entries;
  expect(entries.map(entry => 'phase' in entry.state && entry.state.result?.points.at(-1)).map(point => point && [point.x, point.y]))
    .toEqual([[112, 816], [1552, 688]]);
  expect(JSON.stringify(snapshot)).toBe(before);
}, 60_000);
