export type PointerLockPoint = { x: number; y: number };
export type PointerLockViewport = { width: number; height: number };
export type PointerLockButtonState = { locked: boolean; armed: boolean };
export type UserAgentBrand = { brand: string };

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

export function pointerLockGateTitle(isEdge: boolean) {
  return isEdge ? "Edge setup needed" : "Lock mouse to keep playing";
}

export function pointerLockGateBody(isEdge: boolean) {
  return isEdge
    ? "Microsoft Edge Mouse Gesture can override right-button drag. Turn off Enable Mouse Gesture in edge://settings/appearance, then lock the mouse."
    : "This match uses mouse lock for camera movement and right-click commands. Press Escape any time to release it.";
}

export function virtualPointerTransform(point: PointerLockPoint, size: number) {
  const offset = size / 2;
  return `translate(${Math.round(point.x - offset)}px, ${Math.round(point.y - offset)}px)`;
}

export function isMicrosoftEdgeUserAgent(userAgent: string, brands: UserAgentBrand[] = []) {
  return /\bEdg\//.test(userAgent) || brands.some((brand) => brand.brand.toLowerCase().includes("microsoft edge"));
}

export function shouldSuppressCanvasMouseDefault(eventType: string) {
  return SUPPRESSED_CANVAS_MOUSE_EVENTS.has(eventType);
}

export function shouldSuppressCanvasPointerGesture(eventType: string, button: number, buttons: number) {
  if (eventType !== "pointerdown" && eventType !== "pointerup") return false;
  return button === 2 || (buttons & 2) !== 0;
}

export function shouldSuppressPointerLockMouseDefault(eventType: string, button: number, buttons: number) {
  if (!["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "contextmenu"].includes(eventType)) return false;
  return button === 2 || (buttons & 2) !== 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
