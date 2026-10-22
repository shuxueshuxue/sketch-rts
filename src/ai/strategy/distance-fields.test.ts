import { describe, expect, it } from 'vitest';
import { prepareMoverDistanceField, groundDistanceField, segmentWalkable, setBuildingBodies, shareBuildingBodies } from '../../shared/terrain';
import type { GameMap, GameSnapshot } from '../../shared/types';
import { createPlanningDistanceQuery } from './distance-fields';
import { FactWorkQueue, withFactWork } from './fact-work';
import { regionIndex } from './regions';
import { observationMemory } from './observation-memory';

const map = (): GameMap => ({ id: 'bareDuel', name: 'Goal field test', landmarks: [], width: 1000, height: 500,
  terrain: { cols: 20, rows: 10, cell: 50, cells: '.'.repeat(200) } });
describe('event-refreshed planning goal fields', () => {
  it('does not change a retained field when its detached computation buffer is reused', () => {
    const world = map(), goal = { x: 875, y: 125 }, from = { x: 125, y: 125 };
    const old = groundDistanceField(world, goal)!, before = old.cost(from);
    for (const next of [{ x: 125, y: 375 }, { x: 475, y: 275 }, { x: 875, y: 375 }]) groundDistanceField(world, next);
    expect(old.cost(from)).toBe(before);
    expect(old.road(from, goal)).toEqual([from, goal]);
  });
  it('reuses one building-aware field for all actors and refreshes on construction', () => {
    const world = map(), goal = { x: 875, y: 125 }, from = { x: 125, y: 125 };
    const clear = groundDistanceField(world, goal)!;
    expect(clear.cost(from)).toBe(750);
    expect(groundDistanceField(world, goal, true)).toBe(clear);
    setBuildingBodies(world, [{ x: 475, y: 125, radius: 110 }]);
    expect(groundDistanceField(world, goal, true)).toBeUndefined();
    const detour = groundDistanceField(world, goal)!;
    expect(detour.cost(from)).toBeGreaterThan(clear.cost(from)!);
    const oldMap = { ...world }; shareBuildingBodies(world, oldMap);
    const old = groundDistanceField(oldMap, goal)!;
    const oldCost = old.cost(from);
    setBuildingBodies(world, []);
    expect(groundDistanceField(world, goal)!.cost(from)).toBe(750);
    expect(old.cost(from)).toBe(oldCost);
  });
  it('uses native building-perimeter goal seeds and never invents a cliff crossing', () => {
    const world = map(), goal = { x: 875, y: 125 };
    setBuildingBodies(world, [{ ...goal, radius: 75 }]);
    expect(groundDistanceField(world, goal)!.cost({ x: 125, y: 125 })).toBeGreaterThan(0);
    const split = map(); split.terrain!.cells = Array.from({ length: 10 }, () => '.'.repeat(10) + '~' + '.'.repeat(9)).join('');
    expect(groundDistanceField(split, goal)!.cost({ x: 125, y: 125 })).toBeUndefined();
  });
  it('defers cold fields by a deterministic count and exposes their original geometry tick', () => {
    const world = map(), snapshot = { tick: 100, map: world } as GameSnapshot;
    const state = observationMemory({ ...snapshot, buildings: [], resources: [] } as unknown as GameSnapshot, 'player', { jobs: [], unitClaims: {} });
    const first = createPlanningDistanceQuery(snapshot, 1, 'land', state);
    expect(first.field({ x: 875, y: 125 })!.builtTick).toBe(100);
    expect(first.field({ x: 875, y: 375 })).toBeNull();
    expect(first.built).toBe(1); expect(first.deferred).toBe(1);
    const second = createPlanningDistanceQuery({ ...snapshot, tick: 115 }, 1, 'land', state);
    expect(second.field({ x: 875, y: 125 })!.builtTick).toBe(100);
    expect(second.field({ x: 875, y: 375 })!.builtTick).toBe(115);
  });
  it('resumes the native weighted flow within a fixed work budget and agrees at every cell', () => {
    const world = map();
    world.terrain = { cols: 40, rows: 30, cell: 25,
      cells: Array.from({ length: 30 }, (_, row) => '.'.repeat(18) + (row === 18 ? '.' : '~') + '.'.repeat(21)).join('') };
    const other = structuredClone(world), goal = { x: 875, y: 125 };
    const bodies = [{ x: 750, y: 125, radius: 60 }];
    setBuildingBodies(world, bodies); setBuildingBodies(other, bodies);
    const expected = groundDistanceField(other, goal)!;
    let result = prepareMoverDistanceField(world, goal, 'land', 31), turns = 1;
    expect(result.field).toBeUndefined(); expect(result.work).toBeLessThanOrEqual(31);
    expect(groundDistanceField(world, goal, true)).toBeUndefined();
    while (!result.field && turns < 200) {
      result = prepareMoverDistanceField(world, goal, 'land', 31 * turns); turns++;
      expect(result.work).toBeLessThanOrEqual(31 * (turns - 1));
    }
    expect(turns).toBeGreaterThan(1); expect(result.field).toBeDefined();
    for (let row = 0; row < 30; row++) for (let col = 0; col < 40; col++) {
      const from = { x: (col + .5) * 25, y: (row + .5) * 25 };
      expect(result.field!.cost(from)).toBe(expected.cost(from));
    }
    const from = { x: 125, y: 125 }, road = result.field!.road(from, goal)!;
    expect(road[0]).toEqual(from); expect(road.at(-1)).toEqual(goal);
    expect(road.slice(1).every((point, index) => segmentWalkable(world, road[index]!, point))).toBe(true);
    const pending = { x: 125, y: 125 };
    prepareMoverDistanceField(world, pending, 'land', 1);
    setBuildingBodies(world, [{ x: 475, y: 125, radius: 100 }]);
    expect(prepareMoverDistanceField(world, pending, 'land', 1).field).toBeUndefined();
    expect(groundDistanceField(world, goal, true)).toBeUndefined();
  });
  it('enumerates all original labels immediately while scanning shores over several thinks', () => {
    const world = map();
    world.terrain!.cells = Array.from({ length: 10 }, () => '.'.repeat(10) + '~' + '.'.repeat(9)).join('');
    const first = regionIndex(world, 2, 100);
    expect(first.lands.size).toBe(2); expect(first.seas.size).toBe(1);
    expect(first.scannedRows).toBe(2); expect(first.totalRows).toBe(10);
    const prefix = first.shores.length;
    const final = regionIndex(world, Infinity, 115);
    expect(final.scannedRows).toBe(10); expect(final.scannedAtTick).toBe(115);
    expect(final.shores.length).toBeGreaterThan(prefix);
    expect(final.lands.size).toBe(2);
  });
});

 it('publishes weighted land fields by think sequence with a fixed physical clock', () => {
  const world = map(), snapshot = { tick: 100, map: world, buildings: [], resources: [] } as unknown as GameSnapshot;
  let state = observationMemory(snapshot, 'player', { jobs: [], unitClaims: {} });
  const goal = { x: 875, y: 125 };
  const first = new FactWorkQueue(100, 6144, undefined, 1);
  withFactWork(first, () => {
    const query = createPlanningDistanceQuery(snapshot, 1, 'land', state);
    expect(query.field(goal)).toBeNull(); first.flush();
    expect(createPlanningDistanceQuery(snapshot, 1, 'land', state).field(goal)).toBeNull();
  });
  state = JSON.parse(JSON.stringify(state));
  const next = new FactWorkQueue(100, 6144, first.receipt, 2);
  withFactWork(next, () => {
    const result = createPlanningDistanceQuery(snapshot, 1, 'land', state).field(goal);
    expect(result?.builtTick).toBe(100); expect(result?.field.cost({ x: 125, y: 125 })).toBe(750);
    expect(next.flush().used).toBe(0);
  });
});
