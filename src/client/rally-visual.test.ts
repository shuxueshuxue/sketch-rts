import { describe, expect, it } from "vitest";
import { shouldRenderBuildingRally } from "./rally-visual";

describe("building rally visual visibility", () => {
  const nearScreen = (point: { x: number; y: number }, pad: number) => point.x >= -pad && point.x <= 800 + pad && point.y >= -pad && point.y <= 600 + pad;

  it("keeps a selected production building rally visible when only the rally point is on screen", () => {
    expect(
      shouldRenderBuildingRally({
        selected: true,
        trainable: true,
        buildingPoint: { x: -900, y: 300 },
        rallyPoint: { x: 420, y: 300 },
        nearScreen,
      }),
    ).toBe(true);
  });

  it("does not show rally visuals for unselected or non-production buildings", () => {
    const visible = {
      buildingPoint: { x: 400, y: 300 },
      rallyPoint: { x: 460, y: 320 },
      nearScreen,
    };

    expect(shouldRenderBuildingRally({ ...visible, selected: false, trainable: true })).toBe(false);
    expect(shouldRenderBuildingRally({ ...visible, selected: true, trainable: false })).toBe(false);
  });
});
