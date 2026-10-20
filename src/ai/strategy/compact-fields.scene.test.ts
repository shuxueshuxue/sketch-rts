import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { goalDistanceFieldStorage, moverDistanceField, prepareMoverDistanceField, setBuildingBodies, type Mover } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameMap, GameSnapshot } from '../../shared/types';

type Reference = { event: string; mover: Mover; goal: { x: number; y: number }; hash: string;
  roads: { from: { x: number; y: number }; road: { x: number; y: number }[] | null }[] };
const frames: { event: string; snapshot: GameSnapshot }[] = JSON.parse(gunzipSync(readFileSync(
  new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
const references: Reference[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-field-reference.json.gz', import.meta.url))).toString()).references;

describe('compact exact goal fields', () => {
  it('preserves every cell cost and smoothed road from the full Int32 fields at all five recorded events', () => {
    for (const reference of references) {
      const { snapshot } = structuredClone(frames.find(frame => frame.event === reference.event)!);
      setBuildingBodies(snapshot.map, standingBodies(snapshot));
      const terrain = snapshot.map.terrain!, field = moverDistanceField(snapshot.map, reference.goal, reference.mover)!;
      const hash = createHash('sha256');
      for (let row = 0; row < terrain.rows; row++) for (let col = 0; col < terrain.cols; col++)
        hash.update(JSON.stringify(field.cost({ x: (col + .5) * terrain.cell, y: (row + .5) * terrain.cell }) ?? null) + '\n');
      expect(hash.digest('hex'), `${reference.event}:${reference.mover}:${JSON.stringify(reference.goal)}`).toBe(reference.hash);
      for (const { from, road } of reference.roads) expect(field.road(from, reference.goal)).toEqual(road);
    }
  }, 30000);

  it('stores only the target island and exact 16-bit costs, with one-byte directions', () => {
    const map: GameMap = { id: 'bareDuel', name: 'Separated islands', width: 640, height: 320, landmarks: [],
      terrain: { cols: 20, rows: 10, cell: 32, cells: Array.from({ length: 10 }, (_, row) => row < 2 || row > 7
        ? '~'.repeat(20) : '~~......~~~~......~~').join('') } };
    const goal = { x: 80, y: 80 }, field = moverDistanceField(map, goal, 'land')!;
    expect(goalDistanceFieldStorage(field)).toEqual({ cells: 36, distanceBytes: 72, descentBytes: 0 });
    expect(field.cost({ x: 144, y: 144 })).toBe(89.60000000000001);
    expect(field.cost({ x: 464, y: 144 })).toBeUndefined();
    setBuildingBodies(map, [{ x: 144, y: 112, radius: 25 }]);
    const around = moverDistanceField(map, goal, 'land')!;
    around.road({ x: 176, y: 176 }, goal);
    expect(goalDistanceFieldStorage(around)!.descentBytes).toBe(36);
  });

  it('keeps wide finite costs exact rather than wrapping or quantizing them', () => {
    const cols = 4000, map: GameMap = { id: 'bareDuel', name: 'Long weighted corridor', width: cols * 32, height: 64, landmarks: [],
      terrain: { cols, rows: 2, cell: 32, cells: '.'.repeat(cols) + 'm'.repeat(cols) } };
    const goal = { x: 16, y: 16 }, from = { x: (cols - .5) * 32, y: 16 };
    const field = moverDistanceField(map, goal, 'land')!;
    expect(field.cost(from)).toBe((cols - 1) * 32);
    expect(goalDistanceFieldStorage(field)!.distanceBytes).toBe(cols * 2 * 4);
    const rebuilt = prepareMoverDistanceField(structuredClone(map), goal, 'land', Infinity);
    expect(rebuilt.field!.cost(from)).toBe(field.cost(from));
    expect(rebuilt.work).toBeGreaterThan(0);
  });
});
