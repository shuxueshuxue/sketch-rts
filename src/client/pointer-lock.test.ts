import { describe, expect, it } from "vitest";
import { gameShellMarkup } from "./game-shell";
import {
  isMicrosoftEdgeUserAgent,
  moveVirtualPointer,
  pointerLockRequiredBody,
  pointerLockRequiredTitle,
  shouldSuppressCanvasMouseDefault,
  shouldSuppressCanvasPointerGesture,
  shouldSuppressPointerLockMouseDefault,
  virtualPointerTransform,
} from "./pointer-lock";

describe("pointer lock virtual mouse", () => {
  it("keeps pointer lock behind the blocking gate instead of a top-strip button", () => {
    expect(gameShellMarkup).not.toContain("data-pointer-lock ");
    expect(gameShellMarkup).toContain("data-pointer-lock-gate");
    expect(gameShellMarkup).toContain("data-pointer-lock-gate-action");
  });

  it("moves by relative deltas and stays inside the viewport", () => {
    const viewport = { width: 1280, height: 800 };

    expect(moveVirtualPointer({ x: 640, y: 400 }, { x: 40, y: -30 }, viewport)).toEqual({ x: 680, y: 370 });
    expect(moveVirtualPointer({ x: 1270, y: 790 }, { x: 60, y: 80 }, viewport)).toEqual({ x: 1279, y: 799 });
    expect(moveVirtualPointer({ x: 8, y: 10 }, { x: -40, y: -80 }, viewport)).toEqual({ x: 0, y: 0 });
  });

  it("starts from the center when there is no previous virtual pointer", () => {
    expect(moveVirtualPointer(undefined, { x: 10, y: -20 }, { width: 1280, height: 800 })).toEqual({ x: 650, y: 380 });
  });

  it("keeps repeated pointer-lock interruptions as a simple continue prompt", () => {
    expect(pointerLockRequiredTitle()).toBe("Continue game");
    expect(pointerLockRequiredBody()).toContain("Mouse lock is paused");
    expect(pointerLockRequiredBody()).not.toContain("Edge");
  });

  it("centers the virtual pointer overlay on the locked pointer point", () => {
    expect(virtualPointerTransform({ x: 100.4, y: 80.6 }, 18)).toBe("translate(91px, 72px)");
    expect(virtualPointerTransform({ x: 9, y: 9 }, 18)).toBe("translate(0px, 0px)");
  });

  it("detects Microsoft Edge without classifying Chrome as Edge", () => {
    expect(isMicrosoftEdgeUserAgent("Mozilla/5.0 Edg/126.0.0.0")).toBe(true);
    expect(isMicrosoftEdgeUserAgent("Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36")).toBe(false);
    expect(isMicrosoftEdgeUserAgent("", [{ brand: "Microsoft Edge" }])).toBe(true);
    expect(isMicrosoftEdgeUserAgent("Mozilla/5.0 Chrome/126.0.0.0", [{ brand: "Chromium" }])).toBe(false);
  });

  it("suppresses browser gestures on battlefield mouse events", () => {
    for (const type of ["mousedown", "mouseup", "mousemove", "contextmenu", "auxclick", "dragstart"]) {
      expect(shouldSuppressCanvasMouseDefault(type)).toBe(true);
    }
    for (const type of ["pointermove", "pointercancel", "selectstart"]) {
      expect(shouldSuppressCanvasMouseDefault(type)).toBe(true);
    }
    expect(shouldSuppressCanvasMouseDefault("pointerdown")).toBe(false);
    expect(shouldSuppressCanvasMouseDefault("pointerup")).toBe(false);
    expect(shouldSuppressCanvasMouseDefault("click")).toBe(false);
    expect(shouldSuppressCanvasMouseDefault("keydown")).toBe(false);
  });

  it("suppresses right-button pointer gesture arming without blocking left clicks", () => {
    expect(shouldSuppressCanvasPointerGesture("pointerdown", 2, 2)).toBe(true);
    expect(shouldSuppressCanvasPointerGesture("pointerup", 2, 0)).toBe(true);
    expect(shouldSuppressCanvasPointerGesture("pointerdown", 0, 1)).toBe(false);
    expect(shouldSuppressCanvasPointerGesture("pointerup", 0, 0)).toBe(false);
    expect(shouldSuppressCanvasPointerGesture("pointermove", -1, 2)).toBe(false);
  });

  it("suppresses right-button document events while pointer lock owns the canvas", () => {
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "contextmenu"]) {
      expect(shouldSuppressPointerLockMouseDefault(type, 2, 2)).toBe(true);
    }
    expect(shouldSuppressPointerLockMouseDefault("mousemove", -1, 2)).toBe(true);
    expect(shouldSuppressPointerLockMouseDefault("pointermove", -1, 0)).toBe(false);
    expect(shouldSuppressPointerLockMouseDefault("mousedown", 0, 1)).toBe(false);
    expect(shouldSuppressPointerLockMouseDefault("keydown", 2, 2)).toBe(false);
  });
});
