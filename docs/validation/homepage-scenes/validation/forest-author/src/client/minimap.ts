export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type WorldSize = { width: number; height: number };

/** UI hover keeps the last map sample; before the first map hover use the view center. */
export function windProbePoint(pointer: Point | undefined, view: {
  minimap: Rect; world: WorldSize; camera: Point; viewport: WorldSize; zoom: number;
}, previous?: Point): Point {
  if (!pointer && previous) return previous;
  const point = pointer && isInsideRect(pointer, view.minimap)
    ? minimapPointToWorld(pointer, view.minimap, view.world)
    : { x: view.camera.x + (pointer?.x ?? view.viewport.width / 2) / view.zoom,
      y: view.camera.y + (pointer?.y ?? view.viewport.height / 2) / view.zoom };
  return { x: Math.max(0, Math.min(view.world.width, point.x)), y: Math.max(0, Math.min(view.world.height, point.y)) };
}

export function isInsideRect(point: Point, rect: Rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function shouldDragMinimap(button: number, point: Point, rect: Rect) {
  return button === 0 && isInsideRect(point, rect);
}

export function minimapPointToWorld(point: Point, rect: Rect, world: WorldSize): Point {
  return {
    x: ((point.x - rect.x) / rect.width) * world.width,
    y: ((point.y - rect.y) / rect.height) * world.height,
  };
}

export function minimapViewportRectFor(rect: Rect, camera: Point, viewport: WorldSize, world: WorldSize): Rect {
  return {
    x: rect.x + (camera.x / world.width) * rect.width,
    y: rect.y + (camera.y / world.height) * rect.height,
    width: Math.max(12, (viewport.width / world.width) * rect.width),
    height: Math.max(12, (viewport.height / world.height) * rect.height),
  };
}
