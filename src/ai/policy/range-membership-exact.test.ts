import { describe, expect, it } from "vitest";
import { createRangeIndex } from "../../sdk/snapshot/range-index";
import { anyWithinRangeOf, withinRangeOf } from "./spatial";

describe("exact range membership", () => {
  it("retains native membership and order for zero, negative, nonfinite and extreme ranges", () => {
    const values = [0, -0, 1, -1, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022, -(2 ** -1022),
      Number.MAX_VALUE, -Number.MAX_VALUE, 1e-200, 1e200, Infinity, -Infinity, NaN];
    const items = values.map((x, id) => ({ id, x, y: values[(id + 4) % values.length]! }));
    const indexed = createRangeIndex(items);
    for (const range of values) {
      const near = withinRangeOf(items, range);
      for (const x of values) {
        const point = { x, y: x };
        const expected = items.filter(item => Math.hypot(item.x - point.x, item.y - point.y) <= range);
        expect(near(point)).toEqual(expected);
        expect(indexed(point, range)).toEqual(expected);
      }
    }
    // The boolean helper deliberately retains its original NaN-inclusive predicate.
    expect(withinRangeOf([{ x: NaN, y: 900 }], 5)({ x: 0, y: 0 })).toEqual([]);
    expect(anyWithinRangeOf([{ x: NaN, y: 900 }], 5)({ x: 0, y: 0 })).toBe(true);
  });

  it("keeps grid and plain results in source order at circular and cell boundaries", () => {
    const items = Array.from({ length: 128 }, (_, id) => ({ id: 127 - id, x: (id % 16) * 64, y: Math.floor(id / 16) * 64 }));
    items.push({ id: 128, x: 180, y: 240 }, { id: 129, x: 256, y: 0 },
      { id: 130, x: NaN, y: 10 }, { id: 131, x: Infinity, y: NaN });
    const indexed = createRangeIndex(items);
    for (const range of [-300, -0, 0, Number.MIN_VALUE, 95, 128, 256, 300, 520, 2000, Infinity, -Infinity, NaN]) {
      const near = withinRangeOf(items, range);
      for (const point of [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 255.99999999999997, y: 64 }, { x: 1024, y: 128 }, { x: NaN, y: 0 }, { x: Infinity, y: NaN }]) {
        const expected = items.filter(item => Math.hypot(item.x - point.x, item.y - point.y) <= range);
        expect(near(point)).toEqual(expected);
        expect(indexed(point, range)).toEqual(expected);
      }
    }
  });

  it("matches native decisions for 200,000 seeded binary64 coordinate and range inputs", () => {
    const view = new DataView(new ArrayBuffer(8));
    let state = 0x732acb01, nanInputs = 0, subnormalInputs = 0, negativeRanges = 0;
    const word = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const value = () => {
      view.setUint32(0, word());
      view.setUint32(4, word());
      const number = view.getFloat64(0);
      if (Number.isNaN(number)) nanInputs += 1;
      if (Math.abs(number) > 0 && Math.abs(number) < 2 ** -1022) subnormalInputs += 1;
      return number;
    };
    const item = { x: 0, y: 0 }, point = { x: 0, y: 0 };
    const items = [item], indexed = createRangeIndex(items);
    for (let index = 0; index < 200_000; index += 1) {
      item.x = value(); item.y = value(); point.x = value(); point.y = value();
      const range = value();
      if (range < 0) negativeRanges += 1;
      const expected = Math.hypot(item.x - point.x, item.y - point.y) <= range;
      const policyResult = withinRangeOf(items, range)(point), sdkResult = indexed(point, range);
      if (policyResult.length !== Number(expected) || sdkResult.length !== Number(expected)
        || expected && (policyResult[0] !== item || sdkResult[0] !== item)) {
        throw new Error(`Range input ${index}: item(${item.x},${item.y}), point(${point.x},${point.y}), range=${range}, expected=${expected}`);
      }
    }
    expect(nanInputs).toBeGreaterThan(0);
    expect(subnormalInputs).toBeGreaterThan(0);
    expect(negativeRanges).toBeGreaterThan(0);
  });
});
