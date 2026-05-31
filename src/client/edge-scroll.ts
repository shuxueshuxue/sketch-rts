export type EdgeScrollPoint = { x: number; y: number };
export type EdgeScrollViewport = { width: number; height: number };

const EDGE_SCROLL_PAD = 34;
const EDGE_SCROLL_SPEED = 18;

export function edgeScrollDelta(point: EdgeScrollPoint | undefined, viewport: EdgeScrollViewport) {
  if (!point) return { x: 0, y: 0 };
  const x = point.x <= EDGE_SCROLL_PAD ? -EDGE_SCROLL_SPEED : point.x >= viewport.width - EDGE_SCROLL_PAD ? EDGE_SCROLL_SPEED : 0;
  const y = point.y <= EDGE_SCROLL_PAD ? -EDGE_SCROLL_SPEED : point.y >= viewport.height - EDGE_SCROLL_PAD ? EDGE_SCROLL_SPEED : 0;
  return { x, y };
}
