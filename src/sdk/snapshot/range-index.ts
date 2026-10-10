import type { EntityPoint } from "./query";
import { hypot2 } from "../../shared/hypot";

const RANGE_CELL = 256;
const RANGE_INDEX_MIN_ITEMS = 32;

export type RangeQuery<T extends EntityPoint> = (point: EntityPoint, range: number, matches?: (item: T) => boolean) => T[];

// @@@range-index - items.filter((item) => distance(item, point) <= range) for many points and ranges against the same
// items. With big armies a planner asks "which enemies are near this unit" once per unit, and a filter over every unit each
// time made a think grow with the square of the army. The items go into a grid of RANGE_CELL cells on the first question; a
// question visits the cells within ceil((range + 1) / RANGE_CELL) of its point's cell, which hold every item the filter could
// take (the 1 absorbs rounding in the distance), gives each the same distance test and returns the hits in the items' own
// order. A short list, a range so wide that its cells outnumber the items, or a point, range or item whose coordinates are
// not finite get the plain test.
export function createRangeIndex<T extends EntityPoint>(items: T[]): RangeQuery<T> {
  const plain: RangeQuery<T> = (point, range, matches) => matches
    ? items.filter((item) => withinRange(item, point, range) && matches(item))
    : items.filter((item) => withinRange(item, point, range));
  if (items.length < RANGE_INDEX_MIN_ITEMS) return plain;
  let grid: { cells: Map<number, number[]>; offGrid: number[] } | undefined;
  return (point, range, matches) => {
    const span = Math.ceil((range + 1) / RANGE_CELL);
    const cx = Math.floor(point.x / RANGE_CELL);
    const cy = Math.floor(point.y / RANGE_CELL);
    if (!Number.isFinite(span) || !Number.isFinite(cx) || !Number.isFinite(cy) || (2 * span + 1) ** 2 > items.length) return plain(point, range, matches);
    grid ??= indexCells(items);
    const hits: number[] = [];
    for (let x = cx - span; x <= cx + span; x += 1) {
      for (let y = cy - span; y <= cy + span; y += 1) {
        for (const index of grid.cells.get(cellKey(x, y)) ?? []) if (withinRange(items[index]!, point, range)) hits.push(index);
      }
    }
    for (const index of grid.offGrid) if (withinRange(items[index]!, point, range)) hits.push(index);
    hits.sort((a, b) => a - b);
    if (!matches) return hits.map((index) => items[index]!);
    // Apply the final predicate in source order, just like filtering a query
    // result, while allocating only the selected output array.
    const selected: T[] = [];
    for (const index of hits) {
      const item = items[index]!;
      if (matches(item)) selected.push(item);
    }
    return selected;
  };
}

function indexCells(items: EntityPoint[]) {
  const cells = new Map<number, number[]>();
  const offGrid: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const x = Math.floor(items[index]!.x / RANGE_CELL);
    const y = Math.floor(items[index]!.y / RANGE_CELL);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      offGrid.push(index);
      continue;
    }
    const key = cellKey(x, y);
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
  }
  return { cells, offGrid };
}

function cellKey(x: number, y: number) {
  return x * 4096 + y;
}

function withinRange(a: EntityPoint, b: EntityPoint, range: number) {
  const dx = a.x - b.x, dy = a.y - b.y;
  if (Math.abs(dx) > range || Math.abs(dy) > range) return false;
  return hypot2(dx, dy) <= range;
}
