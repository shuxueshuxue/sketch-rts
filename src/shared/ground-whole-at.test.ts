import { describe, expect, it } from 'vitest';
import { groundWholeAt, groundWholes, sameGround, type Terrain } from './terrain';

describe('groundWholeAt', () => {
  const terrain: Terrain = { cell: 32, cols: 5, rows: 3, cells: ['..~..', '..~..', '..~..'].join('') };
  const map = { terrain };
  const west = { x: 16, y: 16 }, east = { x: 144, y: 16 }, water = { x: 80, y: 16 };

  it('shares the existing terrain-only connectivity labels without reindexing', () => {
    const westId = groundWholeAt(map, west), eastId = groundWholeAt(map, east);
    expect(westId).toBeGreaterThan(0);
    expect(eastId).toBeGreaterThan(0);
    expect(westId).not.toBe(eastId);
    expect(groundWholeAt(map, { x: 48, y: 80 })).toBe(westId);
    expect(sameGround(map, west, east)).toBe(false);
    expect(groundWholes(map)).toBe(2);
    expect(groundWholeAt(map, water)).toBeUndefined();
    expect(groundWholeAt(map, water, 'sea')).toBeGreaterThan(0);
    expect(groundWholeAt(map, west, 'sea')).toBeUndefined();
    expect(groundWholeAt(map, { x: -1, y: 16 })).toBeUndefined();
    expect(groundWholeAt(map, { x: 999, y: 16 })).toBeUndefined();
    // Land and sea labels are separate namespaces, even if both begin at 1.
    expect(groundWholeAt(map, water, 'sea')).toBe(1);
    expect(groundWholeAt(map, west)).toBe(1);
  });

  it('retains the terrain-less single-whole convention', () => {
    expect(groundWholeAt({}, west)).toBe(1);
    expect(groundWholeAt({}, water, 'sea')).toBe(1);
  });
});
