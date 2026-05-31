import { describe, expect, it } from "vitest";
import { edgeScrollDelta } from "./edge-scroll";

describe("edge camera scrolling", () => {
  it("moves the camera when the mouse is held near a viewport edge", () => {
    const viewport = { width: 1280, height: 800 };

    expect(edgeScrollDelta({ x: 10, y: 400 }, viewport)).toEqual({ x: -18, y: 0 });
    expect(edgeScrollDelta({ x: 1270, y: 400 }, viewport)).toEqual({ x: 18, y: 0 });
    expect(edgeScrollDelta({ x: 640, y: 8 }, viewport)).toEqual({ x: 0, y: -18 });
    expect(edgeScrollDelta({ x: 640, y: 792 }, viewport)).toEqual({ x: 0, y: 18 });
    expect(edgeScrollDelta({ x: 1270, y: 792 }, viewport)).toEqual({ x: 18, y: 18 });
  });

  it("does not move the camera when the mouse is away from the edges", () => {
    expect(edgeScrollDelta({ x: 640, y: 400 }, { width: 1280, height: 800 })).toEqual({ x: 0, y: 0 });
  });
});
