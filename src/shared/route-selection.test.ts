import { expect, it } from 'vitest';
import { nearestByRoute } from './route-selection';

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
