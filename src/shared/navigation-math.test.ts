import { describe, it, expect } from 'vitest';
import { convexHull, expandConvex, minkowskiSum, polygonPlanes, capsuleClearsBodies, capsuleClearsCircles, diskInConvex, segmentDistanceSquared } from './navigation-math';
import { createUnit } from './map';
import { shipProfile } from './ship-geometry';
import { detCos,detSin } from './det-math';
import nearCoincidentHull from './test-fixtures/near-coincident-hull.json';
import { supportSurface } from './support-surface';
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const bounds = { left: -20, top: -20, right: 220, bottom: 220 };
describe('configuration-space geometry', () => {
  it('keeps offset swept hulls finite when rotated endpoints almost coincide',()=>{
    const reproduced=expandConvex(convexHull(nearCoincidentHull),1e-7);
    expect(reproduced.every(p=>Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    const hull=shipProfile(createUnit('ship','player','transport',0,0))!.hull;
    for(let i=0;i<128;i++)for(const difference of [0,1e-15,1e-14,1e-13,1e-12,1e-9]){
      const angle=i*Math.PI/32;
      const points=[angle,angle+difference].flatMap(theta=>hull.map(p=>({x:p.x*detCos(theta)-p.y*detSin(theta),y:p.x*detSin(theta)+p.y*detCos(theta)})));
      const polygon=expandConvex(convexHull(points),1e-7);
      expect(polygon.every(p=>Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(minkowskiSum(polygon,polygon).every(p=>Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
    expect(()=>minkowskiSum(rect(0,0,10,10),[{x:NaN,y:0},{x:0,y:1},{x:1,y:0}])).toThrow(/finite/);
  });
  it('erodes a convex floor by the actual circular body radius', () => {
    expect(diskInConvex({ x: 10, y: 50 }, 10, rect(0, 0, 100, 100))).toBe(true);
    expect(diskInConvex({ x: 9, y: 50 }, 10, rect(0, 0, 100, 100))).toBe(false);
    expect(capsuleClearsCircles({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, [{ x: 50, y: 9, radius: 5 }])).toBe(false);
    expect(capsuleClearsCircles({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, [{ x: 50, y: 10, radius: 5 }])).toBe(true);
  });
  it('lets a resolved body leave existing overlap without entering or deepening it', () => {
    const body = { x: 0, y: 0, radius: 10 };
    expect(capsuleClearsBodies({ x: 18, y: 0 }, { x: 30, y: 0 }, 10, [body])).toBe(true);
    expect(capsuleClearsBodies({ x: 18, y: 0 }, { x: -30, y: 0 }, 10, [body])).toBe(false);
    expect(capsuleClearsBodies({ x: 18, y: 0 }, { x: 19, y: 0 }, 10, [body, { x: 33, y: 0, radius: 5 }])).toBe(false);
  });
  it('removes internal seams while preserving coincident exterior boundaries', () => {
    const surface = supportSurface([rect(0, 0, 100, 100), rect(100, 0, 100, 100), rect(50, 0, 100, 100)], undefined, bounds);
    expect(surface.capsuleFits({ x: 20, y: 50 }, { x: 180, y: 50 }, 10)).toBe(true);
    expect(surface.diskFits({ x: 90, y: 5 }, 10)).toBe(false);
  });
  it('cannot skip a thin water gap or cut across a concave corner', () => {
    const gap = supportSurface([rect(0, 0, 100, 100), rect(100.1, 0, 100, 100)], undefined, bounds);
    expect(gap.capsuleFits({ x: 20, y: 50 }, { x: 180, y: 50 }, 10)).toBe(false);
    const corner = supportSurface([rect(0, 0, 100, 30), rect(70, 0, 30, 100)], undefined, bounds);
    expect(corner.capsuleFits({ x: 10, y: 15 }, { x: 85, y: 90 }, 5)).toBe(false);
    expect(corner.capsuleFits({ x: 10, y: 15 }, { x: 85, y: 15 }, 5)).toBe(true);
    expect(corner.capsuleFits({ x: 85, y: 15 }, { x: 85, y: 90 }, 5)).toBe(true);
  });
  it('checks shore holes and supports a continuous hull-to-shore crossing', () => {
    const ground = { cell: 10, cols: 20, rows: 20, open: (col: number, row: number) => col >= 0 && row >= 0 && col < 10 && row < 20 && !(col === 5 && row === 5) };
    const surface = supportSurface([rect(100, 0, 100, 200)], ground, bounds);
    expect(surface.capsuleFits({ x: 90, y: 90 }, { x: 150, y: 90 }, 5)).toBe(true);
    expect(surface.diskFits({ x: 55, y: 45 }, 8)).toBe(false);
    expect(segmentDistanceSquared({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(0);
  });
});

it('matches convex Minkowski sums to the vertex-pair reference over rotated hulls',()=>{
  for(let angle=0;angle<64;angle++){
    const theta=angle*Math.PI/32,c=Math.cos(theta),s=Math.sin(theta);
    const a=convexHull([{x:-5,y:-3},{x:4,y:-2},{x:7,y:0},{x:3,y:4},{x:-5,y:3}]);
    const b=convexHull([{x:-2,y:-1},{x:3,y:-1},{x:2,y:2},{x:-2,y:2}].map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})));
    const merged=minkowskiSum(a,b),reference=convexHull(a.flatMap(p=>b.map(q=>({x:p.x+q.x,y:p.y+q.y}))));
    for(const [points,polygon] of [[merged,reference],[reference,merged]])for(const p of points!)
      expect(polygonPlanes(polygon!).every(axis=>p.x*axis.x+p.y*axis.y>=axis.min-1e-6)).toBe(true);
    expect(merged.length).toBeLessThanOrEqual(a.length+b.length);
  }
});
