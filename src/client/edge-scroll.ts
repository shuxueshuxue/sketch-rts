export type EdgeScrollPoint = { x: number; y: number };
export type EdgeScrollViewport = { width: number; height: number };

// How near the window's edge the cursor scrolls the camera: over the battlefield a band wide enough to find without
// looking; over the interface (the top bar, the docks, the chips) only a cursor pressed against the edge, so a panel
// near an edge can be read and used without the camera drifting.
const EDGE_SCROLL_PAD = 34;
const EDGE_SCROLL_INTERFACE_PAD = 8;
const EDGE_SCROLL_SPEED = 18;

export function edgeScrollDelta(point: EdgeScrollPoint | undefined, viewport: EdgeScrollViewport, overInterface = false) {
  if (!point) return { x: 0, y: 0 };
  const pad = overInterface ? EDGE_SCROLL_INTERFACE_PAD : EDGE_SCROLL_PAD;
  const x = point.x <= pad ? -EDGE_SCROLL_SPEED : point.x >= viewport.width - pad ? EDGE_SCROLL_SPEED : 0;
  const y = point.y <= pad ? -EDGE_SCROLL_SPEED : point.y >= viewport.height - pad ? EDGE_SCROLL_SPEED : 0;
  return { x, y };
}
