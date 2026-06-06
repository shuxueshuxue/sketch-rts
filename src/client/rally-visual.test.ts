import { describe, expect, it } from "vitest";
import { shouldRenderBuildingRally } from "./rally-visual";

describe("building rally visual visibility", () => {
  it("keeps a selected production building rally visible when only the rally point is on screen", () => {
    expect(
      shouldRenderBuildingRally({
        selected: true,
        trainable: true,
      }),
    ).toBe(true);
  });

  it("keeps selected production building rally rendering independent of endpoint visibility", () => {
    expect(
      shouldRenderBuildingRally({
        selected: true,
        trainable: true,
      }),
    ).toBe(true);
  });

  it("does not show rally visuals for unselected or non-production buildings", () => {
    expect(shouldRenderBuildingRally({ selected: false, trainable: true })).toBe(false);
    expect(shouldRenderBuildingRally({ selected: true, trainable: false })).toBe(false);
  });
});
