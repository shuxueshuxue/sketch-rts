// A place a script talks about: a circle or a box on the map, as a value it can pass around and test units against.
export type Point = { x: number; y: number };

export type Region = {
  readonly center: Point;
  contains(point: Point): boolean;
  // A point inside, `index` of `count` spread around the middle (for placing a group).
  spot(index: number, count: number): Point;
};

export function circle(x: number, y: number, radius: number): Region {
  const center = { x, y };
  return {
    center,
    contains: (point) => Math.hypot(point.x - x, point.y - y) <= radius,
    spot: (index, count) => ring(center, Math.min(radius * 0.6, 26 * Math.sqrt(count)), index, count),
  };
}

export function box(left: number, top: number, right: number, bottom: number): Region {
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  return {
    center,
    contains: (point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom,
    spot: (index, count) => ring(center, Math.min((right - left) * 0.3, (bottom - top) * 0.3, 26 * Math.sqrt(count)), index, count),
  };
}

// `count` points on a sunflower spiral around `center`, no farther than `radius`: a crowd, not a grid.
export function ring(center: Point, radius: number, index: number, count: number): Point {
  if (count <= 1) return { ...center };
  const r = radius * Math.sqrt((index + 0.5) / count);
  const angle = index * 2.399963;
  return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function toward(from: Point, to: Point, step: number): Point {
  const gap = distance(from, to);
  if (gap <= step || gap === 0) return { ...to };
  return { x: from.x + ((to.x - from.x) / gap) * step, y: from.y + ((to.y - from.y) / gap) * step };
}

export function centerOf(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}
