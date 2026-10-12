import { describe, expect, it } from "vitest";
import { hypot2 } from "./hypot";

function expectSame(x: number, y: number) {
  expect(Object.is(hypot2(x, y), Math.hypot(x, y))).toBe(true);
}

describe("two-coordinate hypotenuse", () => {
  it("retains exact distances for movement and range boundaries", () => {
    for (const [x, y] of [[3, 4], [-3, 4], [3, -4], [-3, -4], [3840.25, 2160.75], [0.0125, -0.0075]] as const) {
      expectSame(x, y);
    }
    for (const radius of [5, 48, 110, 160, 420, 520, 620, 900, 1800]) {
      for (const offset of [-Number.EPSILON, 0, Number.EPSILON]) {
        const x = radius * (0.6 + offset), y = radius * 0.8;
        expectSame(x, y);
        expect(hypot2(x, y) <= radius).toBe(Math.hypot(x, y) <= radius);
      }
    }
  });

  it("matches signed zero, NaN, infinity, normal and subnormal extremes", () => {
    const edges = [0, -0, 1, -1, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022, -(2 ** -1022),
      Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE / 2, 1e-200, Infinity, -Infinity, NaN];
    for (const x of edges) for (const y of edges) expectSame(x, y);
    expect(Object.is(hypot2(-0, -0), 0)).toBe(true);
    expect(hypot2(NaN, Infinity)).toBe(Infinity);
    expect(hypot2(-Infinity, NaN)).toBe(Infinity);
  });

  it("preserves tiny and huge results without intermediate range loss", () => {
    expect(hypot2(3e-200, 4e-200)).toBeGreaterThan(0);
    expect(Number.isFinite(hypot2(3e200, 4e200))).toBe(true);
    for (const large of [1, 1e100, 1e200, Number.MAX_VALUE / 2]) {
      for (const small of [Number.MIN_VALUE, 2 ** -1022, 1e-200, 1e-100, 1]) {
        expectSame(large, small);
        expectSame(-small, large);
      }
    }
  });

  it("matches Math.hypot exactly for 200,000 seeded binary64 pairs", () => {
    // Generate the actual IEEE-754 words rather than restricting values to
    // a coordinate-sized interval. This includes both signs and all exponents.
    const view = new DataView(new ArrayBuffer(8));
    let state = 0x2468ace0, subnormals = 0, huge = 0, nanInputs = 0;
    const word = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const value = () => {
      view.setUint32(0, word());
      view.setUint32(4, word());
      return view.getFloat64(0);
    };
    for (let index = 0; index < 200_000; index += 1) {
      const x = value(), y = value();
      if (Number.isNaN(x) || Number.isNaN(y)) nanInputs += 1;
      if (Math.abs(x) > 1e200 || Math.abs(y) > 1e200) huge += 1;
      if (Math.abs(x) > 0 && Math.abs(x) < 2 ** -1022 || Math.abs(y) > 0 && Math.abs(y) < 2 ** -1022) subnormals += 1;
      const actual = hypot2(x, y), expected = Math.hypot(x, y);
      if (!Object.is(actual, expected)) {
        throw new Error(`Binary64 pair ${index}: hypot2(${x}, ${y})=${actual}; Math.hypot=${expected}`);
      }
    }
    expect(subnormals).toBeGreaterThan(0);
    expect(huge).toBeGreaterThan(0);
    expect(nanInputs).toBeGreaterThan(0);
  });
});
