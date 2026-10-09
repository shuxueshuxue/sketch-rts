import { describe, it, expect } from 'vitest';
import { convexHull, expandConvex, minkowskiSum, polygonPlanes, polygonRadius, capsuleClearsBodies, capsuleClearsCircles, diskInConvex, segmentDistanceSquared, type Point } from './navigation-math';
import { createUnit } from './map';
import { SHIP_KINDS, shipProfile } from './ship-geometry';
import { detCos,detSin } from './det-math';
import nearCoincidentHull from './test-fixtures/near-coincident-hull.json';
import { supportSurface } from './support-surface';
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const bounds = { left: -20, top: -20, right: 220, bottom: 220 };
function expectExactPlanes(polygon: readonly Point[]) {
  const actual = polygonPlanes(polygon);
  expect(actual).toHaveLength(polygon.length);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, x = a.y - b.y, y = b.x - a.x;
    let min = Infinity, max = -Infinity;
    // Independent complete projection reference, including signed zero and NaN.
    for (const p of polygon) {
      const value = p.x * x + p.y * y;
      min = Math.min(min, value); max = Math.max(max, value);
    }
    for (const key of ['x', 'y', 'min', 'max'] as const) {
      const reference = {x, y, min, max}[key];
      if (!Object.is(actual[i]![key], reference)) throw new Error(`plane ${i} ${key} changed: ${actual[i]![key]} != ${reference}`);
    }
  }
  expect(polygonPlanes(polygon)).toBe(actual);
}
describe('configuration-space geometry', () => {
  it('preserves every exact projection over the actual rotated, swept and padded fleet hulls', () => {
    const hulls = SHIP_KINDS.map(kind => shipProfile(createUnit(kind, 'player', kind, 0, 0))!.hull);
    const rotate = (hull: readonly Point[], angle: number) => {
      const c = detCos(angle), s = detSin(angle);
      return hull.map(p => ({x: p.x*c-p.y*s, y: p.x*s+p.y*c}));
    };
    for (let kind = 0; kind < hulls.length; kind++) {
      const hull = hulls[kind]!, radius = polygonRadius(hull);
      for (let i = 0; i < 16; i++) for (const turn of [0, Math.PI/4, Math.PI/2]) {
        const heading = i*Math.PI/8, steps = Math.max(1, Math.ceil(turn*radius/4));
        let sweep = convexHull(Array.from({length: steps+1}, (_, sample) => rotate(hull, heading+turn*sample/steps)).flat());
        if (turn) sweep = expandConvex(sweep, radius*(turn/steps)**2/8+1e-7);
        expectExactPlanes(sweep);
        const body = rotate(hulls[(kind+1)%hulls.length]!, heading+.37);
        const base = minkowskiSum(body, sweep.map(p => ({x: -p.x, y: -p.y})));
        expectExactPlanes(base);
        for (const padding of [1e-7, .1, radius*.2]) expectExactPlanes(expandConvex(base, padding));
      }
    }
  });

  it('retains exact extrema for thin rings, difficult scales, signed zero and invalid convex candidates', () => {
    let seed = 123456789;
    const random = () => { seed = (Math.imul(seed, 1664525)+1013904223)>>>0; return seed/4294967296; };
    for (const scale of [1e-110, 1e-90, 1e-8, 1, 1e8, 1e90, 1e110]) {
      for (const thin of [1, 1e-4, 1e-9, 1e-14]) for (let i = 0; i < 30; i++) {
        const angle = random()*Math.PI*2, c = Math.cos(angle), s = Math.sin(angle);
        const hull = convexHull(Array.from({length: 48}, () => {
          const theta = random()*Math.PI*2, radius = .3+random();
          return {x: Math.cos(theta)*radius, y: Math.sin(theta)*radius};
        }));
        for (const p of hull) {
          const x = p.x*scale, y = p.y*scale*thin;
          p.x = x*c-y*s+scale*30; p.y = x*s+y*c-scale*20;
        }
        expectExactPlanes(hull);
        if (hull.length > 2) expectExactPlanes(expandConvex(hull, scale*.1));
      }
    }
    const zero = convexHull([{x: -0, y: -0}, ...Array.from({length: 17}, (_, i) =>
      ({x: Math.cos(i*Math.PI/32)*100, y: Math.sin(i*Math.PI/32)*100}))]);
    expectExactPlanes(zero);
    const circle = () => convexHull(Array.from({length: 15}, (_, i) =>
      ({x: Math.cos(i*2*Math.PI/15), y: Math.sin(i*2*Math.PI/15)})));
    const winding = circle(), ordered = [...winding];
    winding.forEach((_, i) => { winding[i] = ordered[(i*2)%ordered.length]!; });
    expectExactPlanes(winding);
    const concave = circle(); concave[5] = {x: 0, y: 0}; expectExactPlanes(concave);
    const repeated = circle(); repeated[5] = repeated[4]!; expectExactPlanes(repeated);
    const invalid = circle(); invalid[5] = {x: NaN, y: Infinity}; expectExactPlanes(invalid);
    expectExactPlanes([{x: -0, y: -0}, {x: 0, y: 0}, {x: 1, y: -0}, {x: 1, y: 1}]);
  });

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
