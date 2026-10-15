import { describe, expect, it } from 'vitest';
import { convexHull, insideSupportingPlanes, minkowskiSum, polygonPlanes } from './navigation-math';
import type { Point } from './ship-geometry';

// ---- Reference: convexHull and minkowskiSum as they were before the hull's sort and chains lost their closures
// (0364fc82), verbatim but for names. The new code must return the same points, in the same order, with the same bits.
function referenceConvexHull(points: readonly Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (first: number, limit: number, step: number) => { const out: Point[] = []; for (let i=first;i!==limit;i+=step) {
    const p=sorted[i]!;
    const last=out[out.length-1];
    if(last && (p.x-last.x)**2+(p.y-last.y)**2<1e-16)continue;
    while (out.length > 1) {
      const a=out[out.length-2]!,b=out[out.length-1]!;
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
  return result;
}
function referenceMinkowskiSum(a:readonly Point[],b:readonly Point[]):Point[] {
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
  return referenceConvexHull(out);
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
// Clouds with the awkward cases a hull meets in play: repeated and nearly repeated points, collinear runs, signed zeros,
// rotated hull corners that differ in the last bits, and more points than the insertion sort takes.
function cloud(next: () => number, size: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < size; i++) {
    const kind = next();
    if (kind < 0.15 && points.length) { const p = points[Math.floor(next() * points.length)]!; points.push({ x: p.x, y: p.y }); }
    else if (kind < 0.3 && points.length) { const p = points[Math.floor(next() * points.length)]!; points.push({ x: p.x + (next() - 0.5) * 1e-9, y: p.y + (next() - 0.5) * 1e-9 }); }
    else if (kind < 0.4) { const t = next(); points.push({ x: -50 + 100 * t, y: 20 + 40 * t }); }
    else if (kind < 0.45) points.push({ x: next() < 0.5 ? 0 : -0, y: next() < 0.5 ? 0 : -0 });
    else { const angle = next() * Math.PI * 2, radius = 10 + next() * 90; points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }); }
  }
  return points;
}
function sameBits(a: readonly Point[], b: readonly Point[]) {
  expect(a.length).toBe(b.length);
  a.forEach((p, i) => { expect(Object.is(p.x, b[i]!.x) && Object.is(p.y, b[i]!.y), `point ${i}`).toBe(true); });
}

describe('convex hull kernels without closures', () => {
  it('return the original hull points in the original order', () => {
    const next = random(17);
    for (let round = 0; round < 400; round++) {
      const points = cloud(next, 1 + Math.floor(next() * 90));
      const hull = convexHull(points), reference = referenceConvexHull(points);
      expect(hull.length).toBe(reference.length);
      hull.forEach((p, i) => expect(p).toBe(reference[i]));
    }
  });

  it('sum convex polygons into the same vertices with the same bits', () => {
    const next = random(29);
    for (let round = 0; round < 300; round++) {
      const a = referenceConvexHull(cloud(next, 3 + Math.floor(next() * 20))), b = referenceConvexHull(cloud(next, 3 + Math.floor(next() * 20)));
      const shift = { x: (next() - 0.5) * 4000, y: (next() - 0.5) * 4000 };
      const moved = b.map((p) => ({ x: shift.x - p.x, y: shift.y - p.y }));
      sameBits(minkowskiSum(a, moved), referenceMinkowskiSum(a, moved));
    }
  });

  it('test a point against the supporting lines as the full plane list does', () => {
    const next = random(43);
    for (let round = 0; round < 300; round++) {
      const a = referenceConvexHull(cloud(next, 3 + Math.floor(next() * 20))), b = referenceConvexHull(cloud(next, 3 + Math.floor(next() * 20)));
      for (let probe = 0; probe < 8; probe++) {
        const x = (next() - 0.5) * 300, y = (next() - 0.5) * 300;
        const full = polygonPlanes(minkowskiSum(a, b)).every((p) => x * p.x + y * p.y > p.min + 1e-6);
        expect(insideSupportingPlanes(minkowskiSum(a, b), x, y)).toBe(full);
      }
    }
  });
});
