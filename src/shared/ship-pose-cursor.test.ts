import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame } from './sim';
import { groundRegionIndex } from './terrain';
import { advanceNearestShipPose, beginNearestShipPose, nearestShipPose, type NearestShipPoseCursor, type ShipPose } from './ship-navigation';
import type { GameMap, Unit } from './types';

function fixture(bare = false): GameMap {
  const base = createGame('bareDuel').map;
  if (bare) { const map = { ...base, width: 960, height: 768 }; delete map.terrain; return map; }
  let cells = '';
  for (let row = 0; row < 24; row++) for (let col = 0; col < 30; col++)
    cells += col < 2 || row < 2 || col > 27 || row > 21 || col >= 12 && col <= 15 && row >= 5 && row <= 13 ? '.' : '~';
  const map = { ...base, width: 960, height: 768, terrain: { cells, cols: 30, rows: 24, cell: 32 } };
  groundRegionIndex(map); return map;
}
const point = (col: number, row: number) => ({ x: (col + .5) * 32, y: (row + .5) * 32 });
function finish(map: GameMap, unit: Unit, goal: { x: number; y: number }, slices: readonly number[]) {
  let cursor: NearestShipPoseCursor = beginNearestShipPose(), turns = 0, work = 0;
  for (;;) {
    const allowance = slices[turns++ % slices.length]!;
    const result = advanceNearestShipPose(map, unit, goal, cursor, allowance);
    expect(result.work).toBeLessThanOrEqual(allowance); expect(result.work).toBeGreaterThanOrEqual(0);
    expect(result.pendingReason).toBeUndefined();
    work += result.work; cursor = JSON.parse(JSON.stringify(result.cursor));
    if (result.done) return { value: result.value, work, turns };
    if (turns > 100000) throw Error('Cursor did not finish');
  }
}

describe('native nearest hull pose finite continuation', () => {
  it('matches native preferred headings and ring ties for coastal/blocked/outside targets under JSON continuation', () => {
    const map = fixture();
    let cases = 0;
    for (const kind of ['transport', 'carrier'] as const) for (const heading of [0, .3, 2.7]) {
      const unit = createUnit('boat', 'player', kind, point(6, 10).x, point(6, 10).y);
      unit.sailing = { heading, speed: 0, load: 0, balance: 0 };
      for (const goal of [point(13, 9), point(0, 10), point(22, 10), point(15, 13), { x: -50, y: 400 }]) {
        const native = nearestShipPose(map, unit, goal) ?? null;
        const cold = finish(map, unit, goal, [1]), warm = finish(map, unit, goal, [7, 128, 2]);
        expect(cold.value).toEqual(native); expect(warm.value).toEqual(native);
        expect(cold.work).toBe(warm.work); cases++;
      }
    }
    expect(cases).toBe(30);
  });

  it('matches the native bare-map clamping and finite radial alternatives', () => {
    const map = fixture(true), unit = createUnit('boat', 'player', 'transport', 400, 400);
    unit.sailing = { heading: .8, speed: 0, load: 0, balance: 0 };
    for (const goal of [{ x: -100, y: -100 }, { x: 950, y: 760 }, { x: 400, y: 400 }])
      expect(finish(map, unit, goal, [1, 3]).value).toEqual(nearestShipPose(map, unit, goal) ?? null);
  });

  it('does no work at zero allowance and leaves an unprojected origin pending instead of scanning for it', () => {
    const map = fixture(), unit = createUnit('boat', 'player', 'transport', point(0, 0).x, point(0, 0).y);
    const cursor = beginNearestShipPose(), before = JSON.stringify(cursor), goal = point(6, 10);
    expect(advanceNearestShipPose(map, unit, goal, cursor, 0)).toEqual({ cursor, work: 0, done: false });
    expect(JSON.stringify(cursor)).toBe(before);
    expect(advanceNearestShipPose(map, unit, goal, cursor, 128)).toMatchObject({ done: false, work: 0,
      pendingReason: 'ship-origin-projection-pending' });
  });

  it('publishes known no-fit only after finite exhaustion rather than a truncated search', () => {
    const map = fixture();
    map.terrain = { cols: 30, rows: 24, cell: 32, cells: '.'.repeat(720) };
    // An explicitly legal but too small sea pool permits checking every ring.
    map.terrain.cells = map.terrain.cells.slice(0, 306) + '~' + map.terrain.cells.slice(307);
    groundRegionIndex(map);
    const unit = createUnit('boat', 'player', 'carrier', point(6, 10).x, point(6, 10).y);
    const result = finish(map, unit, point(14, 10), [128]);
    expect(result.value).toBeNull(); expect(result.work).toBeGreaterThan(720);
    expect(nearestShipPose(map, unit, point(14, 10))).toBeUndefined();
  });
});
