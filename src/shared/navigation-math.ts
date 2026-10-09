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
type PlaneState = {
  result: Plane[];
  scale: number | undefined;
  minIndex: number;
  maxIndex: number;
  index: number;
  /** Maxima have been completed only through this prefix. */
  maxima: number;
};
const planes = new WeakMap<readonly Point[], PlaneState>();
const supportCandidates = new WeakSet<readonly Point[]>();

/** Only generated, numerically strict convex rings use support walking. The
 * robust turns and one angular wrap exclude flat, concave and winding rings.
 * Difficult scales keep the original complete projection scan. */
function supportScale(polygon: readonly Point[]) {
  if (!supportCandidates.has(polygon) || polygon.length < 12) return;
  let scale = 0;
  for (const p of polygon) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
  }
  if (scale < 1e-100 || scale > 1e100) return;
  let wraps = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, c = polygon[(i + 2) % polygon.length]!;
    const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y;
    const left = ax * by, right = ay * bx;
    // This also bounds rounding the coordinate differences, rather than
    // assuming a floating-point cross product has the exact real sign.
    const error = 16 * Number.EPSILON * (Math.abs(left) + Math.abs(right)
      + scale * (Math.abs(ax) + Math.abs(ay) + Math.abs(bx) + Math.abs(by))) + 16 * Number.MIN_VALUE;
    if (!(left - right > error)) return;
    const upperA = ay > 0 || ay === 0 && ax > 0;
    const upperB = by > 0 || by === 0 && bx > 0;
    if (!upperA && upperB) wraps++;
  }
  if (wraps !== 1) return;
  return scale;
}

/** A real linear projection on a convex ring has one minimum and maximum.
 * Walk both sides of the previous support until a drop exceeds twice the
 * whole-ring dot-product rounding bound. Every omitted value then lies below
 * that drop on the same monotone arc. Ambiguous plateaus remain fully scanned;
 * the original products and Math.min/max preserve even signed-zero extrema. */
function projectionSupport(polygon: readonly Point[], x: number, y: number, start: number,
  scale: number, minimum: boolean, state: { index: number }) {
  const first = polygon[start]!;
  let index = start, value = first.x * x + first.y * y;
  const error = 8 * Number.EPSILON * scale * (Math.abs(x) + Math.abs(y)) + 32 * Number.MIN_VALUE;
  for (let direction = -1; direction <= 1; direction += 2) {
    let cursor = start;
    for (let visited = 1; visited < polygon.length; visited++) {
      cursor += direction;
      if (cursor < 0) cursor += polygon.length;
      else if (cursor === polygon.length) cursor = 0;
      const point = polygon[cursor]!, projection = point.x * x + point.y * y;
      if (minimum) {
        if (projection < value) index = cursor;
        value = Math.min(value, projection);
        if (projection > value + error) break;
      } else {
        if (projection > value) index = cursor;
        value = Math.max(value, projection);
        if (projection < value - error) break;
      }
    }
  }
  state.index = index;
  return value;
}
const radii = new WeakMap<readonly Point[], number>();
/** Local hull polygons are immutable. A new scale/profile receives a new
 * polygon, so its conservative circumscribed radius cannot reuse old data. */
export function polygonRadius(polygon: readonly Point[]) {
  const cached = radii.get(polygon);
  if (cached !== undefined) return cached;
  let radius = 0;
  for (const point of polygon) radius = Math.max(radius, Math.hypot(point.x, point.y));
  radii.set(polygon, radius);
  return radius;
}
function polygonPlaneState(polygon: readonly Point[]) {
  let state = planes.get(polygon);
  if (!state) {
    state = { result: [], scale: supportScale(polygon), minIndex: 0, maxIndex: 0, index: 0, maxima: 0 };
    planes.set(polygon, state);
  }
  return state;
}
/** Immutable polygons share the exact projection sequence, including a clip
 * that stops partway through it and a later request for every supporting line. */
function appendSupportingPlane(polygon: readonly Point[], state: PlaneState) {
  const i = state.result.length;
  const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, x = a.y - b.y, y = b.x - a.x;
  let min = Infinity;
  if (state.scale !== undefined && i) {
    min = projectionSupport(polygon, x, y, state.minIndex, state.scale, true, state); state.minIndex = state.index;
  } else if (state.scale !== undefined) {
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j]!, v = p.x * x + p.y * y;
      if (v < min) state.minIndex = j;
      min = Math.min(min, v);
    }
  } else {
    for (const p of polygon) {
      const v = p.x * x + p.y * y;
      min = Math.min(min, v);
    }
  }
  // Maxima are outside the supporting-lines contract; the public full
  // query completes them before returning every projection.
  const plane = { x, y, min, max: NaN };
  state.result.push(plane);
  return plane;
}
/** Clipping, offsets and interior tests use only the supporting minima.
 * SAT consumers request every maximum through polygonPlanes instead. */
export function polygonSupportingPlanes(polygon: readonly Point[]): readonly Readonly<Pick<Plane, "x" | "y" | "min">>[] {
  const state = polygonPlaneState(polygon);
  while (state.result.length < polygon.length) appendSupportingPlane(polygon, state);
  return state.result;
}
export function polygonPlanes(polygon: readonly Point[]) {
  const state = polygonPlaneState(polygon);
  polygonSupportingPlanes(polygon);
  while (state.maxima < polygon.length) {
    const i = state.maxima, plane = state.result[i]!, x = plane.x, y = plane.y;
    let max = -Infinity;
    if (state.scale !== undefined && i) {
      max = projectionSupport(polygon, x, y, state.maxIndex, state.scale, false, state); state.maxIndex = state.index;
    } else if (state.scale !== undefined) {
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j]!, v = p.x * x + p.y * y;
        if (v > max) state.maxIndex = j;
        max = Math.max(max, v);
      }
    } else {
      for (const p of polygon) {
        const v = p.x * x + p.y * y;
        max = Math.max(max, v);
      }
    }
    plane.max = max; state.maxima++;
  }
  return state.result;
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
  const half = (first: number, limit: number, step: number) => { const out: Point[] = []; for (let i=first;i!==limit;i+=step) {
    const p=sorted[i]!;
    const last=out[out.length-1];
    if(last && (p.x-last.x)**2+(p.y-last.y)**2<1e-16)continue;
    while (out.length > 1) {
      const a=out[out.length-2]!,b=out[out.length-1]!;
      // Nearly identical rotated endpoints can leave a zero-length edge or
      // parallel offset planes. Remove numerical corners before offsetting.
      const turn=cross(a,b,p),abX=b.x-a.x,abY=b.y-a.y,bpX=p.x-b.x,bpY=p.y-b.y;
      if(turn>0 && turn*turn>1e-20*(abX*abX+abY*abY)*(bpX*bpX+bpY*bpY))break;
      out.pop();
    }
    out.push(p);
  } return out; };
  const lower = half(0,sorted.length,1), upper = half(sorted.length-1,-1,-1);
  lower.pop();
  upper.pop();
  const result=lower;
  for(const point of upper)result.push(point);
  if(result.length>1 && (result[0]!.x-result[result.length-1]!.x)**2+(result[0]!.y-result[result.length-1]!.y)**2<1e-16)result.pop();
  supportCandidates.add(result);
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
  const dx = b.x - a.x, dy = b.y - a.y;
  const state = polygonPlaneState(polygon);
  for (let i = 0; i < polygon.length; i++) {
    const plane = state.result[i] ?? appendSupportingPlane(polygon, state);
    const d = dx * plane.x + dy * plane.y, need = plane.min - a.x * plane.x - a.y * plane.y;
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
  const ps = polygonSupportingPlanes(polygon);
  if (!ps.length) return [];
  const result: Point[] = [];
  let a = ps[ps.length - 1]!, am = a.min - amount * Math.hypot(a.x, a.y);
  for (const b of ps) {
    // The next corner uses this same supporting line. Preserve its exact
    // offset instead of evaluating the same edge length a second time.
    const bm = b.min - amount * Math.hypot(b.x, b.y), det = a.x * b.y - a.y * b.x;
    result.push({ x: (am * b.y - a.y * bm) / det, y: (a.x * bm - am * b.x) / det });
    a = b; am = bm;
  }
  if (amount >= 0 && Number.isFinite(amount)) supportCandidates.add(result);
  return result;
}
