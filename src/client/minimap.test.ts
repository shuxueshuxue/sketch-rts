import { describe, expect, it } from "vitest";
import { minimapPointToWorld, minimapViewportRectFor, shouldDragMinimap } from "./minimap";

describe("minimap input mapping", () => {
  const rect = { x: 100, y: 200, width: 200, height: 200 };

  it("starts camera dragging from any left click inside the minimap", () => {
    const viewport = { x: 120, y: 220, width: 40, height: 40 };

    expect(shouldDragMinimap(0, { x: 180, y: 280 }, viewport)).toBe(false);
    expect(shouldDragMinimap(0, { x: 260, y: 340 }, rect)).toBe(true);
    expect(shouldDragMinimap(2, { x: 260, y: 340 }, rect)).toBe(false);
  });

  it("maps minimap clicks into world coordinates for orders", () => {
    expect(minimapPointToWorld({ x: 150, y: 250 }, rect, { width: 4000, height: 3000 })).toEqual({ x: 1000, y: 750 });
    expect(minimapPointToWorld({ x: 300, y: 400 }, rect, { width: 4000, height: 3000 })).toEqual({ x: 4000, y: 3000 });
  });

  it("projects the camera viewport into the minimap", () => {
    expect(
      minimapViewportRectFor(rect, { x: 1000, y: 750 }, { width: 1000, height: 500 }, { width: 4000, height: 3000 }),
    ).toEqual({ x: 150, y: 250, width: 50, height: 33.33333333333333 });
  });
});
