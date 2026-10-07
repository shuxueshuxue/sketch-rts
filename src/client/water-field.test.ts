import { describe, expect, it } from 'vitest';
import { waterField, waterSlope, waterCoverPixels } from './water-field';
import type { Terrain } from '../shared/terrain';

describe('shared water presentation field', () => {
  it('deepens smoothly away from shore, preserving shallows and leaving dry land dry', () => {
    const terrain: Terrain = { cols: 8, rows: 3, cell: 32, cells: '.,~~~~~~'.repeat(3) };
    const field = waterField(terrain);
    expect(field.wet[8]).toBe(0);
    expect(field.depth[9]).toBeLessThan(field.depth[10]!);
    expect(field.depth[10]).toBeLessThan(field.depth[14]!);
    expect(waterField(terrain)).toBe(field);
    expect(terrain.cells).toBe('.,~~~~~~'.repeat(3));
  });
  it('descends gradually at a shallow/deep boundary even far from dry land', () => {
    const terrain: Terrain = { cols: 40, rows: 3, cell: 32, cells: ','.repeat(10).concat('~'.repeat(30)).repeat(3) };
    const field = waterField(terrain);
    expect(field.depth[9]).toBeCloseTo(.08);
    for (let x = 10; x < 24; x++) {
      expect(field.depth[x]! - field.depth[x - 1]!).toBeLessThan(.12);
      expect(field.depth[x]).toBeGreaterThanOrEqual(field.depth[x - 1]!);
    }
    expect(field.depth[25]).toBe(1);
  });
  it('keeps a stationary textured seabed visible in shallows, fading its contrast at depth', () => {
    const make = (kind: string): Terrain => ({ cols: 12, rows: 12, cell: 32, cells: kind.repeat(144), ecology: { version: 1, seed: 'seabed' } });
    const shallow = make(','), deep = make('~');
    const a = waterCoverPixels(shallow), b = waterCoverPixels(deep);
    const contrast = (pixels: Uint8Array) => {
      const values = Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4]!);
      return Math.max(...values) - Math.min(...values);
    };
    expect(contrast(a.pixels)).toBeGreaterThan(10);
    expect(contrast(b.pixels)).toBeLessThan(contrast(a.pixels) / 5);
    expect(waterCoverPixels(shallow)).toBe(a);
    expect(waterCoverPixels(make(',')).pixels).toEqual(a.pixels);
    const large = waterCoverPixels({ cols: 400, rows: 2, cell: 32, cells: '~'.repeat(800) });
    expect(large.width).toBeLessThanOrEqual(1024);
    expect(large.height).toBeLessThanOrEqual(1024);
  });
  it('does not invent beaches along map boundaries or retain water on a new map', () => {
    expect([...waterField({ cols: 4, rows: 4, cell: 32, cells: '~'.repeat(16) }).depth].every(d => d > .99)).toBe(true);
    expect(waterField({ cols: 4, rows: 4, cell: 32, cells: '.'.repeat(16) }).hasWater).toBe(false);
  });
  it('keeps normals seamless, world anchored and animated in seconds', () => {
    for (const t of [0, .17, 18.25]) {
      expect(waterSlope(.32, .76, t).x).toBeCloseTo(waterSlope(1.32, .76, t).x, 10);
      expect(waterSlope(.32, .76, t).y).toBeCloseTo(waterSlope(.32, 1.76, t).y, 10);
    }
    expect(waterSlope(.32, .76, 0)).not.toEqual(waterSlope(.32, .76, 1));
  });
});
