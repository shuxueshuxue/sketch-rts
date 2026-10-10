import { hypot2 } from "../../shared/hypot";

export type Point = { x: number; y: number };

export function nearestEntity<T extends Point>(entities: T[], from: Point): T | undefined {
  return entities.sort((a, b) => distance(a, from) - distance(b, from))[0];
}

export function nearestEntities<T extends Point>(entities: T[], from: Point): T[] {
  return [...entities].sort((a, b) => distance(a, from) - distance(b, from));
}

export function averagePoint(points: Point[]): Point {
  const total = { x: 0, y: 0 };
  // Divide each coordinate before adding, in input order, to retain the same
  // floating-point result. Like reduce, forEach skips empty array slots.
  points.forEach((point) => {
    total.x += point.x / points.length;
    total.y += point.y / points.length;
  });
  return total;
}

export function distance(a: Point, b: Point) {
  return hypot2(a.x - b.x, a.y - b.y);
}

export function distanceSquared(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

const RANGE_GRID_MIN_ITEMS = 32;

// @@@range-grid - items.filter((item) => distance(item, point) <= range) for many points against the same items, without
// testing every item every time: with big armies a planner asking "who is near this unit" once per unit made a think grow
// with the square of the unit count. The items sit in a grid of cells one range (plus 1) wide, built on the first question,
// so any item within range of a point lies in the 3x3 cells around it (the 1 absorbs rounding in the distance). Those items
// get the same distance test and come back in the items' own order: the result is the filter's, element for element, and
// sums over it (averagePoint) come out the same. Short lists are simply filtered; an item or point off the grid (a
// coordinate that is not finite) is tested the plain way.
export function withinRangeOf<T extends Point>(items: T[], range: number): (point: Point) => T[] {
  const plain = (point: Point) => items.filter((item) => distance(item, point) <= range);
  if (items.length < RANGE_GRID_MIN_ITEMS) return plain;
  const cell = range + 1;
  let grid: PointGrid<number> | undefined;
  return (point) => {
    const cx = Math.floor(point.x / cell);
    const cy = Math.floor(point.y / cell);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return plain(point);
    grid ??= pointGrid(items.map((_, index) => index), (index) => items[index]!, cell);
    const hits: number[] = [];
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let y = cy - 1; y <= cy + 1; y += 1) {
        for (const index of grid.cells.get(gridCellKey(x, y)) ?? []) if (distance(items[index]!, point) <= range) hits.push(index);
      }
    }
    for (const index of grid.offGrid) if (distance(items[index]!, point) <= range) hits.push(index);
    return hits.sort((a, b) => a - b).map((index) => items[index]!);
  };
}

// Whether some item is within range of a point, as !items.every((item) => distance(item, point) > range), for many points
// against the same items (see @@@range-grid). It keeps the items rather than their places in the array, so a reordering of
// the array meanwhile (shared snapshot lists get sorted in place here and there) does not matter; the items must stay the
// same ones.
export function anyWithinRangeOf(items: Point[], range: number): (point: Point) => boolean {
  const near = (item: Point, point: Point) => !(distance(item, point) > range);
  if (items.length < RANGE_GRID_MIN_ITEMS) return (point) => items.some((item) => near(item, point));
  const cell = range + 1;
  let grid: PointGrid<Point> | undefined;
  return (point) => {
    const cx = Math.floor(point.x / cell);
    const cy = Math.floor(point.y / cell);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return items.some((item) => near(item, point));
    grid ??= pointGrid(items, (item) => item, cell);
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let y = cy - 1; y <= cy + 1; y += 1) {
        if (grid.cells.get(gridCellKey(x, y))?.some((item) => near(item, point))) return true;
      }
    }
    return grid.offGrid.some((item) => near(item, point));
  };
}

type PointGrid<T> = { cells: Map<number, T[]>; offGrid: T[] };

function pointGrid<T>(entries: T[], at: (entry: T) => Point, cell: number): PointGrid<T> {
  const cells = new Map<number, T[]>();
  const offGrid: T[] = [];
  for (const entry of entries) {
    const x = Math.floor(at(entry).x / cell);
    const y = Math.floor(at(entry).y / cell);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      offGrid.push(entry);
      continue;
    }
    const key = gridCellKey(x, y);
    const bucket = cells.get(key);
    if (bucket) bucket.push(entry);
    else cells.set(key, [entry]);
  }
  return { cells, offGrid };
}

function gridCellKey(x: number, y: number) {
  return x * 4096 + y;
}

export function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
