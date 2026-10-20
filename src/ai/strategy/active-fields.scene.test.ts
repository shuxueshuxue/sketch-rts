import { describe, expect, it } from 'vitest';
import { goalDistanceFieldCacheStats, moverDistanceField, setBuildingBodies, withGoalDistanceFieldLease,
  type GroundDistanceField, type Mover } from '../../shared/terrain';
import type { GameMap, GameSnapshot } from '../../shared/types';
import { createPlanningDistanceQuery } from './distance-fields';

const map = (): GameMap => ({ id: 'bareDuel', name: 'Active field residency', width: 1200, height: 1200, landmarks: [],
  terrain: { cols: 30, rows: 30, cell: 40, cells: ','.repeat(900) } });
const goals = Array.from({ length: 70 }, (_, index) => ({ x: (index % 15 + .5) * 40, y: (Math.floor(index / 15) + .5) * 40 }));
function think(world: GameMap, owner: string, tick: number, targets = goals, mover: Mover = 'land') {
  return withGoalDistanceFieldLease(world, owner, tick, () => {
    const query = createPlanningDistanceQuery({ map: world, tick } as GameSnapshot, Infinity, mover);
    return targets.map(goal => query.field(goal)!.field);
  });
}
function bytes(fields: readonly GroundDistanceField[], targets: typeof goals) {
  return JSON.stringify(fields.map((field, index) => ({ costs: goals.map(point => field.cost(point) ?? null),
    road: field.road({ x: 1180, y: 1180 }, targets[index]!) })));
}

describe('active published goal field residency', () => {
  it.each(['land', 'sea'] as const)('keeps all 33 active %s goals, identical to an unlimited set of held fields', mover => {
    const world = map(), reference = map(), targets = goals.slice(0, 33);
    // These external references deliberately have no eviction limit.
    const unlimited = targets.map(goal => moverDistanceField(reference, goal, mover)!);
    const actual = think(world, 'us', 100, targets, mover);
    expect(bytes(actual, targets)).toBe(bytes(unlimited, targets));
    expect(goalDistanceFieldCacheStats(world, mover)).toMatchObject({ fields: 33, peakFields: 33, peakOverflow: 1,
      overflowInsertions: 1, overflowThinks: 1 });
    for (const [index, goal] of targets.entries()) expect(moverDistanceField(world, goal, mover, true)).toBe(actual[index]);
    think(world, 'us', 115, targets.slice(1), mover);
    expect(goalDistanceFieldCacheStats(world, mover)).toMatchObject({ fields: 32, evictions: 1 });
    expect(moverDistanceField(world, targets[0]!, mover, true)).toBeUndefined();
  });

  it('protects other owners and the old set throughout target replacement', () => {
    const world = map(), first = goals.slice(0, 16), second = goals.slice(16, 32), next = goals.slice(32, 48);
    const firstFields = think(world, 'one', 100, first), secondFields = think(world, 'two', 101, second);
    withGoalDistanceFieldLease(world, 'one', 115, () => {
      const query = createPlanningDistanceQuery({ map: world, tick: 115 } as GameSnapshot);
      for (const goal of next) query.field(goal);
      for (const [index, goal] of first.entries()) expect(moverDistanceField(world, goal, 'land', true)).toBe(firstFields[index]);
      for (const [index, goal] of second.entries()) expect(moverDistanceField(world, goal, 'land', true)).toBe(secondFields[index]);
      expect(goalDistanceFieldCacheStats(world, 'land').fields).toBe(48);
    });
    expect(goalDistanceFieldCacheStats(world, 'land')).toMatchObject({ fields: 32, peakFields: 48, peakOverflow: 16 });
    for (const [index, goal] of second.entries()) expect(moverDistanceField(world, goal, 'land', true)).toBe(secondFields[index]);
    for (const goal of next) expect(moverDistanceField(world, goal, 'land', true)).toBeDefined();
  });

  it('releases stopped owners and empty current references without affecting returned answers', () => {
    const world = map(), held = think(world, 'stopped', 100, goals.slice(0, 33));
    const before = bytes(held, goals.slice(0, 33));
    think(world, 'another', 131, goals.slice(33, 65));
    expect(goalDistanceFieldCacheStats(world, 'land').fields).toBe(32);
    expect(bytes(held, goals.slice(0, 33))).toBe(before);
    think(world, 'another', 146, []);
    think(world, 'new', 147, goals.slice(0, 32));
    expect(goalDistanceFieldCacheStats(world, 'land').fields).toBe(32);
  });

  it('invalidates pinned land geometry on construction and releases its scope on a thrown think', () => {
    const world = map(), goal = goals[0]!, field = think(world, 'one', 100, [goal])[0]!;
    setBuildingBodies(world, [{ x: 200, y: 200, radius: 100 }]);
    expect(moverDistanceField(world, goal, 'land', true)).toBeUndefined();
    const next = think(world, 'one', 115, [goal])[0]!;
    expect(next).not.toBe(field);
    expect(() => withGoalDistanceFieldLease(world, 'two', 116, () => { throw new Error('stop'); })).toThrow('stop');
    think(world, 'one', 130, []);
    for (const other of goals) moverDistanceField(world, other, 'land');
    expect(goalDistanceFieldCacheStats(world, 'land').fields).toBe(32);
  });
});
