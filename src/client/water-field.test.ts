import { describe, expect, it } from 'vitest';
import { waterField, waterSlope, waterDepthColour } from './water-field';
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
    const luminance = (depth: number) => waterDepthColour(depth).reduce((sum, c) => sum + c, 0);
    expect(luminance(field.depth[14]!)).toBeLessThan(luminance(field.depth[9]!));
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
