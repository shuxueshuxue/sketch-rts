/** Configuration-space geometry. No units, orders, clocks or rendering. */
export type Point = {
  x: number;
  y: number;
};
export type Plane = {
  x: number;
  y: number;
  min: number;
  max: number;
};
const planes = new WeakMap<readonly Point[], Plane[]>();
export function polygonPlanes(polygon: readonly Point[]) {
  let result = planes.get(polygon);
  if (!result) {
    result = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, x = a.y - b.y, y = b.x - a.x;
      let min = Infinity, max = -Infinity;
      for (const p of polygon) {
        const v = p.x * x + p.y * y;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      result.push({ x, y, min, max });
    }
    planes.set(polygon, result);
  }
  return result;
}
/** SAT projections are computed once per polygon, rather than once per cell. */
export function polygonTouchesCell(axes: readonly Plane[], left: number, top: number, cell: number) {
  for (const p of axes) {
    const min = (p.x >= 0 ? left : left + cell) * p.x + (p.y >= 0 ? top : top + cell) * p.y;
    const max = min + cell * (Math.abs(p.x) + Math.abs(p.y));
    if (p.max <= min + 1e-7 || max <= p.min + 1e-7)
      return false;
  }
  return true;
}
export function pointSegmentDistanceSquared(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2;
}
/** A disk translated along a segment is a capsule; circle obstacles inflate by its radius. */
export function capsuleClearsCircles(a: Point, b: Point, radius: number, obstacles: readonly (Point & {
  radius: number;
})[]) {
  return obstacles.every(o => pointSegmentDistanceSquared(o, a, b) >= (o.radius + radius) ** 2 - 1e-7);
}
/** Contact resolution may begin with overlap; only monotonically separating motion may leave it. */
export function capsuleClearsBodies(a: Point, b: Point, radius: number, bodies: readonly (Point & {
  radius: number;
})[]) {
  return bodies.every(o => {
    const rr = (o.radius + radius) ** 2;
    if (pointSegmentDistanceSquared(o, a, b) >= rr - 1e-7)
      return true;
    const start = (a.x - o.x) ** 2 + (a.y - o.y) ** 2, end = (b.x - o.x) ** 2 + (b.y - o.y) ** 2;
    return start < rr && end > start + 1e-7 && (a.x - o.x) * (b.x - a.x) + (a.y - o.y) * (b.y - a.y) >= -1e-7;
  });
}
/** Convex erosion: endpoints in P ⊖ disk(r) imply the entire segment is in it. */
export function diskInConvex(p: Point, radius: number, polygon: readonly Point[]) {
  return polygonPlanes(polygon).every(axis => p.x * axis.x + p.y * axis.y >= axis.min + radius * Math.hypot(axis.x, axis.y) - 1e-6);
}
export function convexHull(points: readonly Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: readonly Point[]) => { const out: Point[] = []; for (const p of list) {
    const last=out.at(-1);
    if(last && Math.hypot(p.x-last.x,p.y-last.y)<1e-8)continue;
    while (out.length > 1) {
      const a=out[out.length-2]!,b=out[out.length-1]!;
      // Nearly identical rotated endpoints can leave a zero-length edge or
      // parallel offset planes. Remove numerical corners before offsetting.
      const tolerance=1e-10*Math.hypot(b.x-a.x,b.y-a.y)*Math.hypot(p.x-b.x,p.y-b.y);
      if(cross(a,b,p)>tolerance)break;
      out.pop();
    }
    out.push(p);
  } return out; };
  const lower = half(sorted), upper = half([...sorted].reverse());
  lower.pop();
  upper.pop();
  const result=[...lower,...upper];
  if(result.length>1 && Math.hypot(result[0]!.x-result.at(-1)!.x,result[0]!.y-result.at(-1)!.y)<1e-8)result.pop();
  return result;
}
/** Merge CCW edge directions, then remove numerical corners. This avoids
 * generating and sorting every pair of vertices for a convex Minkowski sum. */
export function minkowskiSum(a:readonly Point[],b:readonly Point[]):Point[] {
  if(!a.length || !b.length)return[];
  const first=(p:readonly Point[])=>p.reduce((best,point,i)=>point.y<p[best]!.y || point.y===p[best]!.y && point.x<p[best]!.x ? i:best,0);
  const ai=first(a),bi=first(b),at=(p:readonly Point[],start:number,i:number)=>p[(start+i)%p.length]!;
  let i=0,j=0;const out:Point[]=[];
  while(i<a.length || j<b.length){
    const aa=at(a,ai,i),bb=at(b,bi,j);out.push({x:aa.x+bb.x,y:aa.y+bb.y});
    const an=at(a,ai,i+1),bn=at(b,bi,j+1),cross=(an.x-aa.x)*(bn.y-bb.y)-(an.y-aa.y)*(bn.x-bb.x);
    if(!Number.isFinite(cross))throw new Error('Convex sums require finite polygon vertices');
    const takeA=i<a.length && (j===b.length || cross>=-1e-9),takeB=j<b.length && (i===a.length || cross<=1e-9);
    if(takeA)i++;if(takeB)j++;
  }
  return convexHull(out);
}
export function segmentDistanceSquared(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
    && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
    && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)))
    return 0;
  return Math.min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d), pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b));
}
export function clipToConvex(a: Point, b: Point, polygon: readonly Point[]): [
  number,
  number
] | undefined {
  let low = 0, high = 1;
  for (const plane of polygonPlanes(polygon)) {
    const d = (b.x - a.x) * plane.x + (b.y - a.y) * plane.y, need = plane.min - a.x * plane.x - a.y * plane.y;
    if (Math.abs(d) < 1e-10) {
      if (need > 1e-7)
        return;
      continue;
    }
    if (d > 0)
      low = Math.max(low, need / d);
    else
      high = Math.min(high, need / d);
    if (low > high + 1e-9)
      return;
  }
  return [low, high];
}
/** Parallel supporting lines intersect to offset a convex footprint exactly. */
export function expandConvex(polygon: readonly Point[], amount: number) {
  const ps = polygonPlanes(polygon);
  return ps.map((b, i) => {
    const a = ps[(i + ps.length - 1) % ps.length]!, am = a.min - amount * Math.hypot(a.x, a.y), bm = b.min - amount * Math.hypot(b.x, b.y), det = a.x * b.y - a.y * b.x;
    return { x: (am * b.y - a.y * bm) / det, y: (a.x * bm - am * b.x) / det };
  });
}
