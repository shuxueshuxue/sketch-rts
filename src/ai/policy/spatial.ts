export type Point = { x: number; y: number };

export function nearestEntity<T extends Point>(entities: T[], from: Point): T | undefined {
  return entities.sort((a, b) => distance(a, from) - distance(b, from))[0];
}

export function nearestEntities<T extends Point>(entities: T[], from: Point): T[] {
  return [...entities].sort((a, b) => distance(a, from) - distance(b, from));
}

export function averagePoint(points: Point[]): Point {
  return points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }), { x: 0, y: 0 });
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  let grid: { cells: Map<number, number[]>; offGrid: number[] } | undefined;
  return (point) => {
    const cx = Math.floor(point.x / cell);
    const cy = Math.floor(point.y / cell);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return plain(point);
    grid ??= indexCells(items, cell);
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

function indexCells(items: Point[], cell: number) {
  const cells = new Map<number, number[]>();
  const offGrid: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const x = Math.floor(items[index]!.x / cell);
    const y = Math.floor(items[index]!.y / cell);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      offGrid.push(index);
      continue;
    }
    const key = gridCellKey(x, y);
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
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
