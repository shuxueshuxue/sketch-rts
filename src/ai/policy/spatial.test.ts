import { describe, expect, it } from "vitest";
import { distance, withinRangeOf, type Point } from "./spatial";

describe("withinRangeOf", () => {
  it("returns exactly what filtering by distance returns, in the same order, on the grid and without it", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const scatter = (count: number) => Array.from({ length: count }, (_, id) => ({ id, x: random() * 3000, y: random() * 3000 }));
    for (const [count, range] of [[12, 560], [40, 520], [400, 700], [900, 90]] as const) {
      const items = scatter(count);
      // Items exactly one range away along an axis and a diagonal, and some just past it, sit on the boundary of the test.
      items.push({ id: -1, x: items[0]!.x + range, y: items[0]!.y }, { id: -2, x: items[0]!.x, y: items[0]!.y - range }, { id: -3, x: items[0]!.x + range * 0.6, y: items[0]!.y + range * 0.8 }, { id: -4, x: items[0]!.x + range + 1e-9, y: items[0]!.y });
      // And items and points off any grid: a coordinate that is not a finite number.
      items.push({ id: -5, x: Number.NaN, y: 10 }, { id: -6, x: Number.POSITIVE_INFINITY, y: 10 });
      const near = withinRangeOf(items, range);
      const points: Point[] = [items[0]!, { x: 0, y: 0 }, { x: -range / 2, y: 10 }, { x: Number.NaN, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 10 }, { x: 10, y: Number.NEGATIVE_INFINITY }, ...scatter(60)];
      for (const point of points) expect(near(point)).toEqual(items.filter((item) => distance(item, point) <= range));
    }
  });
});
