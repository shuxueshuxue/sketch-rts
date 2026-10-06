import { describe, it, expect } from 'vitest';
import { capsuleClearsBodies, capsuleClearsCircles, diskInConvex, segmentDistanceSquared } from './navigation-math';
import { supportSurface } from './support-surface';
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const bounds = { left: -20, top: -20, right: 220, bottom: 220 };
describe('configuration-space geometry', () => {
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
