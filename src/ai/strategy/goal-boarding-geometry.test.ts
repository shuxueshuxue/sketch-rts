import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { walkableGoal, walkDestination } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { createGoalBoardingGeometry, type GoalNativeGroundRequest } from './goal-boarding-geometry';
import { FactWorkQueue } from './fact-work';
import { goalValueKey } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalBerth, GoalGeometryMemory, GoalHullCandidate, GoalPublishedValue } from './goal-grounding-ports';
import type { GoalFactReader } from './goal-planner-types';
import { regionIndex, type Shore } from './regions';
import { nativeVoyageBerth } from './voyage-berth';

function frame() {
  const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  regionIndex(snapshot.map);
  const passenger = snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')!, ship = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
  const hull: GoalHullCandidate = { id: ship.id, reference: { kind: 'existing', entityId: ship.id }, assessment: ship,
    capacity: 10000, cargoUnitIds: [], preconditions: [], factIds: [], seaId: 'sea:1', availableTick: snapshot.tick };
  const shore: Shore = { landId: 'land:2', seaId: 'sea:1', water: { x: 1584, y: 2448 }, ground: { x: 1648, y: 2448 } };
  const readFact: GoalFactReader = fact => ({ fact, state: 'unmet', observedTick: snapshot.tick, revision: 'no-exact-road',
    reason: { code: 'exact-road-unavailable', factIds: [], values: {} }, evidence: [] });
  return { snapshot, passenger, hull, shore, readFact, owner };
}
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));

it('continues native 4180 boarding geometry with finite work and JSON turns, consuming explicit published ground endpoints', () => {
  const input = frame(), expected = nativeVoyageBerth(input.snapshot, input.passenger, input.hull.assessment, input.shore);
  expect(expected.status).toBe('known');
  let memory: GoalGeometryMemory = { version: 1, entries: [] }, result: GoalPublishedValue<GoalBerth> | undefined;
  const requests = new Map<string, GoalNativeGroundRequest>(), published = new Map<string, { x: number; y: number }>();
  let total = 0;
  const before = JSON.stringify(input.snapshot);
  for (let turn = 0; turn < 500; turn++) {
    // Fixed native destination facts are prepared outside the measured owner
    // work. This validates the berth adapter, not the future ground resolver.
    for (const [key, request] of requests) if (!published.has(key)) published.set(key, request.kind === 'project-goal'
      ? walkableGoal(input.snapshot.map, request.point.x, request.point.y, request.mover)
      : walkDestination(input.snapshot.map, request.from, request.goal));
    const work = new FactWorkQueue(input.snapshot.tick + turn * 15, 6144);
    const geometry = createGoalGeometryReader({ tick: input.snapshot.tick + turn * 15, work, memory });
    const read = createGoalBoardingGeometry({ ...input, geometry, geometryRevision: 'same-native-bodies', readGroundPoint: request => {
      const key = goalValueKey(request), value = published.get(key); requests.set(key, request);
      return value ? { state: 'met', value, factIds: [`ground:${key}`] } : { state: 'pending', requestIds: [key],
        reason: { code: 'ground-pending', factIds: [], values: {} } };
    } });
    result = strict(() => read(input.passenger, input.hull, input.shore));
    strict(() => work.flush()); total += work.receipt.used;
    expect(work.receipt.used).toBeLessThanOrEqual(6144);
    memory = JSON.parse(JSON.stringify(memory));
    if (result.state !== 'pending') break;
  }
  expect(result?.state).toBe('met');
  if (result?.state !== 'met' || expected.status !== 'known') throw Error('not published');
  expect(result.value).toEqual({ water: expected.shore.water, ground: expected.shore.ground, heading: expected.heading });
  expect(result.value.water).toEqual({ x: 1584, y: 2448 }); expect(result.value.ground).toEqual(result.value.water);
  expect(total).toBeGreaterThan(input.snapshot.map.terrain!.cells.length);
  expect(JSON.stringify(input.snapshot)).toBe(before);
});

it('does not run native destination lookup at zero allowance or turn absent exact roads into physical infeasibility', () => {
  const input = frame(); let memory: GoalGeometryMemory = { version: 1, entries: [] }, calls = 0;
  const zero = new FactWorkQueue(input.snapshot.tick, 0), geometry = createGoalGeometryReader({ tick: input.snapshot.tick, work: zero, memory });
  const read = createGoalBoardingGeometry({ ...input, geometry, geometryRevision: 'same', readGroundPoint: request => {
    calls++; return { state: 'pending', requestIds: [goalValueKey(request)], reason: { code: 'unpublished', factIds: [], values: {} } };
  } });
  expect(strict(() => read(input.passenger, input.hull, input.shore)).state).toBe('pending'); strict(() => zero.flush());
  expect(calls).toBe(0); expect(zero.receipt.used).toBe(0);
  for (let turn = 1; turn < 20; turn++) {
    const work = new FactWorkQueue(input.snapshot.tick + turn * 15, 6144);
    const port = createGoalBoardingGeometry({ ...input, geometryRevision: 'same',
      geometry: createGoalGeometryReader({ tick: input.snapshot.tick + turn * 15, work, memory }) });
    expect(strict(() => port(input.passenger, input.hull, input.shore)).state).toBe('pending'); strict(() => work.flush());
    memory = JSON.parse(JSON.stringify(memory)); expect(work.receipt.used).toBeLessThanOrEqual(6144);
  }
  expect(memory.entries[0]?.readyTick).toBeNull();
});
