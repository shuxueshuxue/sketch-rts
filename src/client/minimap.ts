export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type WorldSize = { width: number; height: number };

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
