import { describe, expect, it } from 'vitest';
import { createRangeIndex } from './range-index';

describe('range index final selection predicate', () => {
  it.each([10, 96])('matches filtering the ordinary result for %i source items across grid, plain and nonfinite inputs', count => {
    const items = Array.from({ length: count }, (_, index) => ({ id: count - index, x: (index % 12) * 64, y: Math.floor(index / 12) * 64 }));
    items.push({ id: -1, x: 180, y: 240 }, { id: -2, x: 256, y: 0 },
      { id: -3, x: NaN, y: 10 }, { id: -4, x: Infinity, y: 0 });
    const near = createRangeIndex(items), matches = (item: typeof items[number]) => item.id % 3 !== 0;
    for (const point of [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 255.99999999999997, y: 64 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }]) {
      for (const range of [-300, -0, 0, Number.MIN_VALUE, 95, 128, 256, 300, 520, 2000, Infinity, -Infinity, NaN]) {
        const ordinary = near(point, range), expected = ordinary.filter(matches);
        const selected = near(point, range, matches);
        expect(selected).toEqual(expected);
        for (let index = 0; index < selected.length; index += 1) expect(selected[index]).toBe(expected[index]);
        selected.reverse(); selected.pop();
        expect(near(point, range, matches)).toEqual(expected);
        expect(near(point, range)).toEqual(ordinary);
      }
    }
  });

  it('calls the final predicate only for hits, in the original source order on both query paths', () => {
    const items = Array.from({ length: 96 }, (_, index) => ({ id: 95 - index, x: (index % 12) * 64, y: Math.floor(index / 12) * 64 }));
    const near = createRangeIndex(items), point = { x: 256, y: 256 };
    for (const range of [128, 2000]) {
      const seen: number[] = [];
      const ordinary = near(point, range);
      const selected = near(point, range, item => { seen.push(item.id); return item.id % 2 === 0; });
      expect(seen).toEqual(ordinary.map(item => item.id));
      expect(selected).toEqual(ordinary.filter(item => item.id % 2 === 0));
    }
  });
});
