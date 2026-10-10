import { expect, it } from 'vitest';
import { nearestByRoute, routeTravelTicks } from './route-selection';
import { walkingDistance } from './terrain';
import { SIM_TICKS_PER_SECOND } from './time';

it('selects land and sea routes independently, excluding an unreachable nearby island', () => {
  const map = { terrain: { cell: 32, cols: 9, rows: 5, cells: Array.from({ length: 45 }, (_, index) => {
    const col = index % 9;
    return col < 3 || col > 5 ? '.' : '~';
  }).join('') } };
  const home = { x: 80, y: 16 };
  const island = { x: 208, y: 16 };
  const ours = { x: 16, y: 144 };
  expect(nearestByRoute(map, [island, ours], home, 'land')).toBe(ours);
  expect(nearestByRoute(map, [island], home, 'land')).toBeUndefined();
  const sea = { x: 144, y: 48 };
  const water = { x: 144, y: 112 };
  expect(nearestByRoute(map, [home, water], sea, 'sea')).toBe(water);
  const first = { x: 112, y: 48 };
  const second = { ...first };
  expect(nearestByRoute(map, [first, second], sea, 'sea')).toBe(first);
});

it('ranks around a wall by road length and converts that road to travel ticks at the supplied speed', () => {
  const map = { terrain: { cell: 32, cols: 20, rows: 20, cells: Array.from({ length: 400 }, (_, index) =>
    index % 20 === 10 && Math.floor(index / 20) <= 15 ? 'T' : '.').join('') } };
  const home = { x: 480, y: 96 };
  const nearAcrossWall = { x: 160, y: 96 };
  const fartherSameSide = { x: 480, y: 480 };
  expect(Math.hypot(home.x - nearAcrossWall.x, home.y - nearAcrossWall.y)).toBeLessThan(384);
  expect(nearestByRoute(map, [nearAcrossWall, fartherSameSide], home, 'land')).toBe(fartherSameSide);
  const road = walkingDistance(map, nearAcrossWall, home, 'land')!;
  expect(road).toBeGreaterThan(2 * 320);
  expect(routeTravelTicks(map, nearAcrossWall, home, 'land', 40)).toBe(Math.ceil(road / 40 * SIM_TICKS_PER_SECOND));
  expect(routeTravelTicks(map, nearAcrossWall, home, 'land', 80)).toBe(Math.ceil(road / 80 * SIM_TICKS_PER_SECOND));
  expect(routeTravelTicks(map, nearAcrossWall, home, 'sea', 80)).toBeUndefined();
});
