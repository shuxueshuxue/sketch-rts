import { describe, expect, it } from "vitest";
import { hammerEffectFrame } from "./effect-renderer";

describe("hammer effect frames", () => {
  it("describes build and repair as the same animated hammer action with different site colors", () => {
    const build = hammerEffectFrame("build", 1, 60);
    const repair = hammerEffectFrame("repair", 1, 60);
    const later = hammerEffectFrame("repair", 0.5, 52);
    const oldClockwiseAngle = 0.64 + ((Math.sin(60 * 0.76) + 1) / 2) * 0.82;

    expect(build.handle.from).not.toEqual(build.handle.to);
    expect(build.head.from).not.toEqual(build.head.to);
    expect(build.impact.x).toBeGreaterThan(build.handle.from.x);
    expect(repair.siteStroke).not.toBe(build.siteStroke);
    expect(later.angle).not.toBe(repair.angle);
    expect(repair.angle).toBeCloseTo(oldClockwiseAngle - Math.PI / 2);
    expect(later.handle.from).toEqual(repair.handle.from);
    expect(later.handle.to).not.toEqual(repair.handle.to);
    expect(later.impact).not.toEqual(repair.impact);
  });
});
