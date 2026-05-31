export type PointerLockPoint = { x: number; y: number };
export type PointerLockViewport = { width: number; height: number };
export type PointerLockButtonState = { locked: boolean; armed: boolean };

const SUPPRESSED_CANVAS_MOUSE_EVENTS = new Set([
  "mousedown",
  "mouseup",
  "mousemove",
  "contextmenu",
  "auxclick",
  "dragstart",
  "pointermove",
  "pointercancel",
  "selectstart",
]);

export function moveVirtualPointer(
  current: PointerLockPoint | undefined,
  movement: PointerLockPoint,
  viewport: PointerLockViewport,
) {
  const start = current ?? { x: viewport.width / 2, y: viewport.height / 2 };
  return {
    x: clamp(start.x + movement.x, 0, viewport.width - 1),
    y: clamp(start.y + movement.y, 0, viewport.height - 1),
  };
}

export function pointerLockButtonLabel(state: PointerLockButtonState) {
  if (state.locked) return "Mouse Locked";
  if (state.armed) return "Click Field";
  return "Lock Mouse";
}

export function shouldSuppressCanvasMouseDefault(eventType: string) {
  return SUPPRESSED_CANVAS_MOUSE_EVENTS.has(eventType);
}

export function shouldSuppressCanvasPointerGesture(eventType: string, button: number, buttons: number) {
  if (eventType !== "pointerdown" && eventType !== "pointerup") return false;
  return button === 2 || (buttons & 2) !== 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
