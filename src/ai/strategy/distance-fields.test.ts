import { describe, expect, it } from 'vitest';
import { groundDistanceField, setBuildingBodies, shareBuildingBodies } from '../../shared/terrain';
import type { GameMap, GameSnapshot } from '../../shared/types';
import { createPlanningDistanceQuery } from './distance-fields';
import { regionIndex } from './regions';

const map = (): GameMap => ({ id: 'bareDuel', name: 'Goal field test', landmarks: [], width: 1000, height: 500,
  terrain: { cols: 20, rows: 10, cell: 50, cells: '.'.repeat(200) } });
describe('event-refreshed planning goal fields', () => {
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
    const first = createPlanningDistanceQuery(snapshot, 1);
    expect(first.field({ x: 875, y: 125 })!.builtTick).toBe(100);
    expect(first.field({ x: 875, y: 375 })).toBeNull();
    expect(first.built).toBe(1); expect(first.deferred).toBe(1);
    const second = createPlanningDistanceQuery({ ...snapshot, tick: 115 }, 1);
    expect(second.field({ x: 875, y: 125 })!.builtTick).toBe(100);
    expect(second.field({ x: 875, y: 375 })!.builtTick).toBe(115);
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
