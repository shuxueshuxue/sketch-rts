import { describe, expect, it } from 'vitest';
import { waterField, waterSlope, waterCoverPixels, waterCoverage, waterLightStrength } from './water-field';
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
    expect(field.depth[9]).toBeCloseTo(.16);
    for (let x = 10; x < 24; x++) {
      expect(field.depth[x]! - field.depth[x - 1]!).toBeLessThan(.17);
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
    expect(contrast(a.pixels)).toBeGreaterThan(2);
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
  it('uses a continuous, symmetric bank mask and quiets waves before they reach dry ground', () => {
    const horizontal: Terrain = { cols: 8, rows: 8, cell: 32, cells: '.'.repeat(32) + '~'.repeat(32) };
    const vertical: Terrain = { ...horizontal, cells: '....~~~~'.repeat(8) };
    const a = waterField(horizontal), b = waterField(vertical);
    for (let x = 0; x < 8; x++) expect(a.coverage[x * 8 + 2]).toBe(b.coverage[2 * 8 + x]);
    expect(waterCoverage(a.coverage[3 * 8]!)).toBe(0);
    expect(waterCoverage(a.coverage[4 * 8]!)).toBe(1);
    expect(waterCoverage(.5)).toBe(.5);
    expect(waterLightStrength(1, 0)).toBe(0);
    expect(waterLightStrength(1, .1)).toBeLessThan(waterLightStrength(1, .2));
    expect(waterLightStrength(0, 1)).toBe(0);
    const open = waterField({ ...horizontal, cells: '~'.repeat(64) });
    expect([...open.coverage].every(c => c === 1)).toBe(true);
    expect(waterCoverPixels({ ...horizontal, cells: '.'.repeat(64) }).pixels.filter((_, i) => i % 4 === 3).every(a => a === 0)).toBe(true);
  });
  it('keeps normals seamless, world anchored and animated in seconds', () => {
    for (const t of [0, .17, 18.25]) {
      expect(waterSlope(.32, .76, t).x).toBeCloseTo(waterSlope(1.32, .76, t).x, 10);
      expect(waterSlope(.32, .76, t).y).toBeCloseTo(waterSlope(.32, 1.76, t).y, 10);
    }
    expect(waterSlope(.32, .76, 0)).not.toEqual(waterSlope(.32, .76, 1));
  });
});
