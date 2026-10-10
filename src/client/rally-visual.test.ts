import { describe, expect, it } from "vitest";
import { shouldRenderBuildingRally } from "./rally-visual";

describe("building rally visual visibility", () => {
  it("keeps a selected production building rally visible when only the rally point is on screen", () => {
    expect(
      shouldRenderBuildingRally({
        selected: true,
        trainable: true,
        owner: "player",
        viewer: "player",
      }),
    ).toBe(true);
  });

  it("keeps selected production building rally rendering independent of endpoint visibility", () => {
    expect(
      shouldRenderBuildingRally({
        selected: true,
        trainable: true,
        owner: "player",
        viewer: "player",
      }),
    ).toBe(true);
  });

  it("does not show rally visuals for unselected or non-production buildings", () => {
    expect(shouldRenderBuildingRally({ selected: false, trainable: true, owner: "player", viewer: "player" })).toBe(false);
    expect(shouldRenderBuildingRally({ selected: true, trainable: false, owner: "player", viewer: "player" })).toBe(false);
  });

  it("hides inspected ally and enemy rally points and spectators without an issuing player", () => {
    for (const owner of ["ally", "enemy", "neutral", undefined]) {
      expect(shouldRenderBuildingRally({ selected: true, trainable: true, owner, viewer: "player" })).toBe(false);
    }
    expect(shouldRenderBuildingRally({ selected: true, trainable: true, owner: "player" })).toBe(false);
    expect(shouldRenderBuildingRally({ selected: true, trainable: true })).toBe(false);
    expect(shouldRenderBuildingRally({ selected: true, trainable: true, owner: "neutral", viewer: "neutral" })).toBe(false);
  });

  it("immediately reevaluates ownership when the issuing player or selected building changes", () => {
    const input = { selected: true, trainable: true, owner: "player", viewer: "player" };
    expect(shouldRenderBuildingRally(input)).toBe(true);
    input.viewer = "ally";
    expect(shouldRenderBuildingRally(input)).toBe(false);
    input.owner = "ally";
    expect(shouldRenderBuildingRally(input)).toBe(true);
  });
});
