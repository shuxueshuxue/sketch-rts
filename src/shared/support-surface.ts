import { clipToConvex, diskInConvex, pointSegmentDistanceSquared, segmentDistanceSquared, type Point } from './navigation-math';
type Segment = {
  a: Point;
  b: Point;
  left: number;
  top: number;
  right: number;
  bottom: number;
};
type Ground = {
  cell: number;
  cols: number;
  rows: number;
  open: (col: number, row: number) => boolean;
};
type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
const at = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const edge = (a: Point, b: Point): Segment => ({ a, b, left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
/** The exposed boundary of a union, not the boundaries of its overlapping pieces. */
export function supportSurface(polygons: readonly (readonly Point[])[], ground: Ground | undefined, bounds: Bounds) {
  const boundary: Segment[] = [], landBoundary: Segment[] = [];
  const land = (p: Point) => !!ground && ground.open(Math.floor(p.x / ground.cell), Math.floor(p.y / ground.cell));
  const exposed = (a: Point, b: Point, owner: number, allowGround: boolean) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len)
      return;
    // Test the outward side: coincident exterior edges stay exterior, while
    // a seam backed by another floor disappears from the union boundary.
    const shift = { x: (b.y - a.y) / len * 1e-5, y: -(b.x - a.x) / len * 1e-5 };
    const aa = { x: a.x + shift.x, y: a.y + shift.y }, bb = { x: b.x + shift.x, y: b.y + shift.y };
    const cuts: [
      number,
      number
    ][] = [];
    for (let i = 0; i < polygons.length; i++)
      if (i !== owner) {
        const interval = clipToConvex(aa, bb, polygons[i]!);
        if (interval)
          cuts.push(interval);
      }
    if (allowGround && ground) {
      const split = [0, 1];
      for (const axis of ['x', 'y'] as const)
        if (aa[axis] !== bb[axis]) {
          for (let line = (Math.floor(Math.min(aa[axis], bb[axis]) / ground.cell) + 1) * ground.cell; line < Math.max(aa[axis], bb[axis]); line += ground.cell)
            split.push((line - aa[axis]) / (bb[axis] - aa[axis]));
        }
      split.sort((a, b) => a - b);
      for (let i = 1; i < split.length; i++)
        if (land(at(aa, bb, (split[i - 1]! + split[i]!) / 2)))
          cuts.push([split[i - 1]!, split[i]!]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    let start = 0;
    for (const [low, high] of cuts) {
      if (low > start + 1e-9)
        boundary.push(edge(at(a, b, start), at(a, b, low)));
      start = Math.max(start, high);
    }
    if (start < 1 - 1e-9)
      boundary.push(edge(at(a, b, start), b));
  };
  for (let owner = 0; owner < polygons.length; owner++) {
    const poly = polygons[owner]!;
    for (let i = 0; i < poly.length; i++)
      exposed(poly[i]!, poly[(i + 1) % poly.length]!, owner, true);
  }
  if (ground) {
    const { cell } = ground;
    for (let row = Math.max(0, Math.floor(bounds.top / cell)); row < Math.min(ground.rows, Math.ceil(bounds.bottom / cell)); row++)
      for (let col = Math.max(0, Math.floor(bounds.left / cell)); col < Math.min(ground.cols, Math.ceil(bounds.right / cell)); col++)
        if (ground.open(col, row)) {
          const x = col * cell, y = row * cell;
          for (const [dx, dy, a, b] of [[0, -1, { x, y }, { x: x + cell, y }], [1, 0, { x: x + cell, y }, { x: x + cell, y: y + cell }], [0, 1, { x: x + cell, y: y + cell }, { x, y: y + cell }], [-1, 0, { x, y: y + cell }, { x, y }]] as const)
            if (!ground.open(col + dx, row + dy)) {
              landBoundary.push(edge(a, b));
              exposed(a, b, -1, false);
            }
        }
  }
  const supported = (p: Point) => land(p) || polygons.some(poly => diskInConvex(p, 0, poly));
  const diskClear = (p: Point, r: number, edges: Segment[]) => {
    const left = p.x - r, right = p.x + r, top = p.y - r, bottom = p.y + r, rr = r * r - 1e-7;
    for (const e of edges)
      if (e.right >= left && e.left <= right && e.bottom >= top && e.top <= bottom && pointSegmentDistanceSquared(p, e.a, e.b) < rr)
        return false;
    return true;
  };
  const capsuleClear = (a: Point, b: Point, r: number) => {
    const left = Math.min(a.x, b.x) - r, right = Math.max(a.x, b.x) + r, top = Math.min(a.y, b.y) - r, bottom = Math.max(a.y, b.y) + r, rr = r * r - 1e-7;
    for (const e of boundary)
      if (e.right >= left && e.left <= right && e.bottom >= top && e.top <= bottom && segmentDistanceSquared(a, b, e.a, e.b) < rr)
        return false;
    return true;
  };
  return {
    boundary,
    diskFits: (p: Point, r: number) => supported(p) && diskClear(p, r, boundary),
    diskOnLand: (p: Point, r: number) => land(p) && diskClear(p, r, landBoundary),
    capsuleFits: (a: Point, b: Point, r: number) => supported(a) && supported(b) && capsuleClear(a, b, r),
  };
}
