import { describe, expect, it } from "vitest";
import { moveVirtualPointer, pointerLockButtonLabel, shouldSuppressCanvasMouseDefault } from "./pointer-lock";

describe("pointer lock virtual mouse", () => {
  it("moves by relative deltas and stays inside the viewport", () => {
    const viewport = { width: 1280, height: 800 };

    expect(moveVirtualPointer({ x: 640, y: 400 }, { x: 40, y: -30 }, viewport)).toEqual({ x: 680, y: 370 });
    expect(moveVirtualPointer({ x: 1270, y: 790 }, { x: 60, y: 80 }, viewport)).toEqual({ x: 1279, y: 799 });
    expect(moveVirtualPointer({ x: 8, y: 10 }, { x: -40, y: -80 }, viewport)).toEqual({ x: 0, y: 0 });
  });

  it("starts from the center when there is no previous virtual pointer", () => {
    expect(moveVirtualPointer(undefined, { x: 10, y: -20 }, { width: 1280, height: 800 })).toEqual({ x: 650, y: 380 });
  });

  it("labels the one-click capture states", () => {
    expect(pointerLockButtonLabel({ locked: false, armed: false })).toBe("Lock Mouse");
    expect(pointerLockButtonLabel({ locked: false, armed: true })).toBe("Click Field");
    expect(pointerLockButtonLabel({ locked: true, armed: true })).toBe("Mouse Locked");
  });

  it("suppresses browser gestures on battlefield mouse events", () => {
    for (const type of ["mousedown", "mouseup", "mousemove", "contextmenu", "auxclick", "dragstart"]) {
      expect(shouldSuppressCanvasMouseDefault(type)).toBe(true);
    }
    expect(shouldSuppressCanvasMouseDefault("click")).toBe(false);
    expect(shouldSuppressCanvasMouseDefault("keydown")).toBe(false);
  });
});
