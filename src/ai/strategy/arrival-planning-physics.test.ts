import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import * as launch from '../../shared/ship-launch';
import * as terrain from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { createArrivalPlanningPhysics } from './arrival-planning-physics';
import { createArrivalQuery, type ArrivalPlanningPhysics } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { FactWorkQueue, withFactWork } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory } from './goal-grounding-ports';
import { landIdAt, regionIndex } from './regions';
import * as voyage from './voyage-berth';

const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
const pending = (id: string) => ({ state: 'pending' as const, requestIds: [id],
  reason: { code: 'published-physical-fact-pending', factIds: [id], values: {} } });
function frame() {
  const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const regions = regionIndex(snapshot.map), memory = createAiPolicyMemory();
  terrain.setBuildingBodies(snapshot.map, []);
  const unit = snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')!;
  const hull = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
  const mine = snapshot.resources.find(resource => resource.id === 'gold-satellite-4')!;
  const target = { entityId: mine.id, landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
  const fields = createPlanningDistanceQuery(snapshot);
  // A fixed already-published inland field isolates the crossing's physical
  // port. No field is computed inside the zero-work diagnostic below.
  fields.field(target.point);
  return { snapshot, owner, regions, memory, unit, hull, target, fields };
}
afterEach(() => vi.restoreAllMocks());

it('keeps the actual crossing pending at zero work without native berth, launch or ground projection', () => {
  const f = frame(), before = JSON.stringify(f.snapshot), work = new FactWorkQueue(f.snapshot.tick, 0);
  const ground = vi.fn(() => pending('native-ground-request'));
  const berth = vi.fn(() => pending('native-berth-request'));
  const nativeBerth = vi.spyOn(voyage, 'nativeVoyageBerth'), nativeLaunch = vi.spyOn(launch, 'shipLaunchPose');
  const nativeGround = vi.spyOn(terrain, 'walkableGoal');
  const query = createArrivalQuery(f.snapshot, f.owner, f.memory, f.fields, 0, f.regions, undefined, false, { ground, berth });
  const result = strict(() => withFactWork(work, () => query.arrival(f.unit, f.target)));
  strict(() => work.flush());
  expect(result.status).toBe('unknown');
  expect(result.status === 'unknown' && result.reason.factIds).toEqual(expect.arrayContaining(['native-berth-request', 'native-ground-request']));
  expect(ground).toHaveBeenCalled(); expect(berth).toHaveBeenCalled();
  expect(nativeBerth).not.toHaveBeenCalled(); expect(nativeLaunch).not.toHaveBeenCalled(); expect(nativeGround).not.toHaveBeenCalled();
  expect(work.receipt.used).toBe(0); expect(JSON.stringify(f.snapshot)).toBe(before);
  expect(strict(() => withFactWork(work, () => query.arrival(f.unit, f.target)))).toEqual(result);
});

it('uses the injected launch fact without suppressing real hull berth candidates when that future launch is missing', () => {
  const f = frame(), yard = f.snapshot.buildings.find(building => building.owner === f.owner && building.kind === 'shipyard')!;
  const seaPoint = terrain.walkableGoal(f.snapshot.map, yard.x, yard.y, 'sea');
  const requested: string[] = [], work = new FactWorkQueue(f.snapshot.tick, 0);
  const physics: ArrivalPlanningPhysics = { ground: request => ({ state: 'met', value: request.kind === 'project-goal'
    && request.mover === 'sea' ? seaPoint : request.kind === 'project-goal' ? request.point : request.goal, factIds: ['ground-published'] }),
  launch: vi.fn(() => pending('native-launch-request')), berth: (passenger, hull) => {
    requested.push(hull.id); expect(passenger.id).toBe(f.unit.id); return pending('existing-hull-berth');
  } };
  const nativeBerth = vi.spyOn(voyage, 'nativeVoyageBerth'), nativeLaunch = vi.spyOn(launch, 'shipLaunchPose');
  const nativeGround = vi.spyOn(terrain, 'walkableGoal');
  const query = createArrivalQuery(f.snapshot, f.owner, f.memory, f.fields, 0, f.regions, undefined, false, physics);
  const result = strict(() => withFactWork(work, () => query.arrival(f.unit, f.target)));
  expect(result.status).toBe('unknown');
  expect(physics.launch).toHaveBeenCalled(); expect(requested).toContain(f.hull.id);
  expect(result.status === 'unknown' && result.reason.factIds).toContain('native-launch-request');
  expect(nativeBerth).not.toHaveBeenCalled(); expect(nativeLaunch).not.toHaveBeenCalled(); expect(nativeGround).not.toHaveBeenCalled();
});

it('retains unobserved enemy unload projection across repeated passenger queries rather than inventing a landing', () => {
  const f = frame(), ownPassenger = f.snapshot.units.find(unit => unit.deck?.shipId === f.hull.id)!;
  const ship = { ...f.hull, id: 'observed-enemy-ship', owner: 'p0', order: { type: 'unload' as const, ...f.target.point } };
  const passenger = { ...ownPassenger, id: 'observed-enemy-passenger', owner: 'p0', deck: { ...ownPassenger.deck!, shipId: ship.id } };
  const snapshot = { ...f.snapshot, units: [...f.snapshot.units, ship, passenger] };
  const nativeGround = vi.spyOn(terrain, 'walkableGoal'), ground = vi.fn(() => pending('enemy-unload-ground'));
  const query = createArrivalQuery(snapshot, f.owner, f.memory, f.fields, 0, f.regions, undefined, false,
    { ground, berth: () => pending('unused-berth') });
  const first = strict(() => query.arrival(passenger, f.target)), second = strict(() => query.arrival(passenger, f.target));
  expect(first).toMatchObject({ status: 'unknown', reason: { factIds: ['enemy-unload-ground'] } });
  expect(second).toEqual(first); expect(ground).toHaveBeenCalledTimes(1); expect(nativeGround).not.toHaveBeenCalled();
});

it('queues exact native ground checks on the shared allowance and publishes only in a later think', () => {
  const f = frame(), point = { x: f.unit.x, y: f.unit.y }, request = { kind: 'project-goal' as const, point, mover: 'land' as const };
  let memory: GoalGeometryMemory = { version: 1, entries: [] };
  const run = (turn: number, limit: number) => {
    const work = new FactWorkQueue(f.snapshot.tick + turn * 15, limit), geometry = createGoalGeometryReader({ tick: work.receipt.tick, work, memory });
    const physics = createArrivalPlanningPhysics({ snapshot: f.snapshot, geometry, geometryRevision: 'unchanged-geometry',
      landRoute: () => ({ status: 'unknown', reasonCode: 'same-field-pending' }) });
    const result = strict(() => physics.ground(request)); strict(() => work.flush());
    memory = JSON.parse(JSON.stringify(memory)); return { result, work };
  };
  expect(run(0, 0).work.receipt.used).toBe(0);
  expect(run(1, 1).work.receipt.used).toBe(0);
  const first = run(2, 2); expect(first.result.state).toBe('pending'); expect(first.work.receipt.used).toBe(2);
  expect(run(3, 0).result).toMatchObject({ state: 'met', value: point });
});

it('proves a native stationary open walking endpoint without creating a whole-map route request', () => {
  const f = frame(), point = { x: f.unit.x, y: f.unit.y }, before = JSON.stringify(f.snapshot);
  expect(terrain.isOpenGround(f.snapshot.map, point.x, point.y)).toBe(true);
  expect(terrain.walkDestination(f.snapshot.map, point, point)).toEqual(point);
  let memory: GoalGeometryMemory = { version: 1, entries: [] };
  const landRoute = vi.fn(() => ({ status: 'unknown' as const, reasonCode: 'whole-field-unpublished' }));
  for (let turn = 0; turn < 3; turn++) {
    const tick = f.snapshot.tick + 15 * turn, work = new FactWorkQueue(tick, turn === 1 ? 2 : 0);
    const physics = createArrivalPlanningPhysics({ snapshot: f.snapshot, geometryRevision: 'same', landRoute,
      geometry: createGoalGeometryReader({ tick, work, memory }) });
    const result = strict(() => physics.ground({ kind: 'walk-destination', from: point, goal: point }));
    strict(() => work.flush());
    expect(result.state).toBe(turn === 2 ? 'met' : 'pending');
    if (result.state === 'met') expect(result.value).toEqual(point);
    expect(work.receipt.used).toBe(turn === 1 ? 2 : 0);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(landRoute).not.toHaveBeenCalled(); expect(JSON.stringify(f.snapshot)).toBe(before);
});

it('keeps blocked projection, partial walking endpoints and missing launch pending instead of synchronous fallback', () => {
  const f = frame(), work = new FactWorkQueue(f.snapshot.tick, 0), memory: GoalGeometryMemory = { version: 1, entries: [] };
  const nativeGround = vi.spyOn(terrain, 'walkableGoal'), nativeWalk = vi.spyOn(terrain, 'walkDestination');
  const physics = createArrivalPlanningPhysics({ snapshot: f.snapshot, geometryRevision: 'bodies',
    geometry: createGoalGeometryReader({ tick: f.snapshot.tick, work, memory }),
    landRoute: () => ({ status: 'unreachable', reasonCode: 'exact-goal-unreachable' }) });
  expect(strict(() => physics.ground({ kind: 'walk-destination', from: f.unit, goal: f.target.point })).state).toBe('pending');
  expect(strict(() => physics.launch!(f.snapshot.buildings.find(building => building.kind === 'shipyard')!, f.hull)).state).toBe('pending');
  expect(nativeGround).not.toHaveBeenCalled(); expect(nativeWalk).not.toHaveBeenCalled();
});

it('does not turn a non-walkable exact point into a proven impossible native projection', () => {
  const f = frame(), point = f.target.point;
  let memory: GoalGeometryMemory = { version: 1, entries: [] };
  // A mine is land. Its sea projection requires a real nearest-goal service.
  expect(terrain.isWalkable(f.snapshot.map, point.x, point.y, 'sea')).toBe(false);
  for (const turn of [0, 1]) {
    const tick = f.snapshot.tick + turn * 15, work = new FactWorkQueue(tick, 2);
    const physics = createArrivalPlanningPhysics({ snapshot: f.snapshot, geometryRevision: 'same-ground',
      geometry: createGoalGeometryReader({ tick, work, memory }),
      landRoute: () => ({ status: 'unreachable', reasonCode: 'not-this-component' }) });
    expect(strict(() => physics.ground({ kind: 'project-goal', point, mover: 'sea' })).state).toBe('pending');
    strict(() => work.flush()); expect(work.receipt.used).toBeLessThanOrEqual(2);
    memory = JSON.parse(JSON.stringify(memory));
  }
});
