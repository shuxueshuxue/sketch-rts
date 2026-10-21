import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { boardingBerthCandidateAt } from '../../shared/naval';
import { shareShipProfile } from '../../shared/ship-geometry';
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
import { advanceGoalBoardingCandidate, beginGoalBoardingCandidate, type GoalBoardingCandidate } from './goal-boarding-candidates';

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

it.each([false, true])('continues native 4180 boarding geometry with finite work and JSON turns (prepared cell index: %s)', indexed => {
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
    const read = createGoalBoardingGeometry({ ...input, geometry, geometryRevision: 'same-native-bodies',
      ...(indexed ? { regions: regionIndex(input.snapshot.map) } : {}), readGroundPoint: request => {
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
  if (!indexed) expect(total).toBeGreaterThan(input.snapshot.map.terrain!.cells.length);
  else expect(total).toBeLessThan(input.snapshot.map.terrain!.cells.length);
  expect(JSON.stringify(input.snapshot)).toBe(before);
});

it('retains every native boarding candidate and global row-order tie in the prepared region index', () => {
  const input = frame(), regions = regionIndex(input.snapshot.map), terrain = input.snapshot.map.terrain!;
  const examples = new Map<string, Shore>();
  for (const shore of regions.shores) examples.set(`${shore.landId}/${shore.seaId}`, shore);
  expect(examples.size).toBeGreaterThan(1);
  for (const shore of [...examples.values()].slice(0, 6)) {
    const person = { ...input.passenger, x: shore.ground.x, y: shore.ground.y, deck: undefined, cabin: undefined };
    const ship = { ...input.hull.assessment, x: shore.water.x, y: shore.water.y };
    shareShipProfile(input.hull.assessment, ship);
    const all = Array.from({ length: terrain.cells.length }, (_, index) => index);
    const indexed = regions.boardingCellsByLand!.get(shore.landId)?.get(shore.seaId) ?? [];
    const evaluate = (indices: readonly number[]) => indices.flatMap(index => {
      const candidate = boardingBerthCandidateAt(input.snapshot.map, person, ship, index);
      return candidate ? [{ index, ...candidate }] : [];
    });
    expect(evaluate(indexed)).toEqual(evaluate(all));
  }
});

it('proves the same first and rejected-next native candidates with bounded nearby rings and JSON continuation', () => {
  const input = frame(), regions = regionIndex(input.snapshot.map), terrain = input.snapshot.map.terrain!;
  const shores = new Map<string, Shore>();
  for (const shore of regions.shores) shores.set(`${shore.landId}/${shore.seaId}`, shore);
  let reduced = 0;
  for (const shore of [...shores.values()].slice(0, 6)) {
    const person = { ...input.passenger, x: shore.ground.x, y: shore.ground.y, deck: undefined, cabin: undefined };
    const ship = { ...input.hull.assessment, x: shore.water.x, y: shore.water.y };
    shareShipProfile(input.hull.assessment, ship);
    const all = Array.from({ length: terrain.cells.length }, (_, index) => index).flatMap(index => {
      const value = boardingBerthCandidateAt(input.snapshot.map, person, ship, index);
      return value ? [{ ...value, index }] : [];
    }).sort((a, b) => a.score - b.score || a.index - b.index);
    for (const slice of [1, 7, 128]) {
      let after: GoalBoardingCandidate | null = null;
      for (const expected of all.slice(0, 3)) {
        let cursor = beginGoalBoardingCandidate(), total = 0;
        for (let n = 0; n < 100000; n++) {
          const next = strict(() => advanceGoalBoardingCandidate(input.snapshot.map, person, ship, cursor, slice, after));
          expect(next.work).toBeLessThanOrEqual(slice); total += next.work;
          cursor = JSON.parse(JSON.stringify(next.cursor));
          if (next.done) { expect(next.value).toEqual(expected); break; }
          if (n === 99999) throw Error('native candidate did not finish');
        }
        if (total < terrain.cells.length) reduced++;
        after = expected;
      }
    }
  }
  expect(reduced).toBeGreaterThan(0);
  const cursor = beginGoalBoardingCandidate(), before = JSON.stringify(cursor);
  expect(strict(() => advanceGoalBoardingCandidate(input.snapshot.map, input.passenger, input.hull.assessment, cursor, 0)).work).toBe(0);
  expect(JSON.stringify(cursor)).toBe(before);
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
