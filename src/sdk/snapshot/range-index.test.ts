import { describe, expect, it } from "vitest";
import { createRangeIndex } from "./range-index";

describe("createRangeIndex", () => {
  it("answers exactly what filtering by distance answers, in the same order, for any range", () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const scatter = (count: number) => Array.from({ length: count }, (_, id) => ({ id, x: random() * 4000, y: random() * 4000 }));
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    for (const count of [10, 50, 600]) {
      const items = scatter(count);
      // Items on a range boundary from the first one, and items off any grid (a coordinate that is not a finite number).
      items.push({ id: -1, x: items[0]!.x + 256, y: items[0]!.y }, { id: -2, x: items[0]!.x - 600, y: items[0]!.y }, { id: -3, x: items[0]!.x + 180, y: items[0]!.y + 240 });
      items.push({ id: -4, x: Number.NaN, y: 5 }, { id: -5, x: 5, y: Number.NEGATIVE_INFINITY });
      const near = createRangeIndex(items);
      const points = [items[0]!, { x: 0, y: 0 }, { x: -300, y: 4100 }, { x: Number.NaN, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }, ...scatter(40)];
      for (const range of [-300, -1, 0, 1, 90, 255, 256, 300, 600, 900, 2500, 12_000, Number.NaN, Number.POSITIVE_INFINITY]) {
        for (const point of points) expect(near(point, range)).toEqual(items.filter((item) => distance(item, point) <= range));
      }
    }
  });
});
