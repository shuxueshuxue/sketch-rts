import { describe, expect, it } from 'vitest';
import type { Terrain } from '../terrain';
import { ecologicalDressing, prepareEcology } from '../map-dressing';
import { ecologicalHabitat, groundCover, suitability, VEGETATION_NICHES } from './ecology';
import { environmentField, sampleEnvironment } from './fields';
import { spatialNoise } from './noise';

function landscape(coastal = false): Terrain {
  const cols = 40, rows = 30;
  const terrain: Terrain = { cell: 32, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) => {
    const x = i % cols, y = Math.floor(i / cols);
    return x < 5 ? '~' : x === 5 ? ',' : x > 30 ? '#' : y < 6 && x > 10 ? 'T' : '.';
  }).join(''), ...(coastal ? { palette: 'coastal' as const } : {}) };
  prepareEcology(terrain, 'ecology-review');
  return terrain;
}

describe('continuous ecological generation', () => {
  it('reconstructs identical fields and scenery from the compact recipe, independent of query order', () => {
    const terrain = landscape(true), copy = JSON.parse(JSON.stringify(terrain)) as Terrain;
    const points = [[510, 511], [200, 720], [960, 200]];
    const values = points.map(([x, y]) => sampleEnvironment(environmentField(terrain), x!, y!));
    for (const [index, [x, y]] of points.entries()) expect(sampleEnvironment(environmentField(copy), x!, y!)).toEqual(values[index]);
    expect(ecologicalDressing(copy, [], 'ecology-review')).toEqual(ecologicalDressing(terrain, [], 'ecology-review'));
    expect(JSON.stringify(terrain.ecology).length).toBeLessThan(100);
    expect(terrain.surfaces).toBeUndefined();
  });
  it('has no seams at noise lattice or rendering chunk boundaries', () => {
    const field = environmentField(landscape(true));
    for (const x of [32, 112, 512, 1024]) {
      const left = sampleEnvironment(field, x - .001, 500), right = sampleEnvironment(field, x + .001, 500);
      for (const key of Object.keys(left) as (keyof typeof left)[]) expect(Math.abs(left[key] - right[key])).toBeLessThan(.02);
      expect(Math.abs(spatialNoise(42, x - .001, 100, 512) - spatialNoise(42, x + .001, 100, 512))).toBeLessThan(.001);
    }
  });
  it('keeps inland ponds fresh and reduces coastal salt inland, with bounded environmental channels', () => {
    const coast = landscape(true), inland = landscape();
    const field = environmentField(coast);
    expect(sampleEnvironment(environmentField(inland), 100, 500).salinity).toBe(0);
    expect(sampleEnvironment(field, 220, 500).salinity).toBeGreaterThan(sampleEnvironment(field, 550, 500).salinity);
    for (let y = 0; y < 960; y += 53) for (let x = 0; x < 1280; x += 57) {
      const e = sampleEnvironment(field, x, y);
      for (const value of [e.moisture, e.salinity, e.fertility, e.canopy, e.rockiness, e.water]) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
      const weights = groundCover(e);
      expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });
  it('tapers estuary salt away from the declared sea outlet', () => {
    const terrain = landscape(true);
    prepareEcology(terrain, 'ecology-review', {x:0,y:960});
    const field = environmentField(terrain);
    expect(sampleEnvironment(field, 190, 800).salinity).toBeGreaterThan(sampleEnvironment(field, 190, 100).salinity);
  });
  it('uses temperature as a limiting factor rather than placing flowers in an incompatible climate', () => {
    const field = environmentField(landscape()), sample = sampleEnvironment(field, 600, 600);
    const flowers = VEGETATION_NICHES.find(profile => profile.kind === 'flowers')!;
    expect(suitability({...sample, temperatureC:22}, flowers.niche)).toBeGreaterThan(0);
    expect(suitability({...sample, temperatureC:-10}, flowers.niche)).toBe(0);
  });
  it('assigns existing creep families to water, woodland, rocks and open ground using the shared fields', () => {
    const terrain = landscape(true);
    expect(ecologicalHabitat(terrain, 192, 500)).toBe('water');
    expect(ecologicalHabitat(terrain, 650, 80)).toBe('forest');
    expect(ecologicalHabitat(terrain, 1100, 600)).toBe('hill');
    expect(ecologicalHabitat(terrain, 600, 650)).toBe('open');
  });
  it('places separated habitat-compatible vegetation and respects strategic clearings', () => {
    const terrain = landscape(true), protectedPoint = { x: 600, y: 500 };
    const marks = ecologicalDressing(terrain, [protectedPoint], 'ecology-review'), field = environmentField(terrain);
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(Math.hypot(mark.x - protectedPoint.x, mark.y - protectedPoint.y)).toBeGreaterThanOrEqual(190);
      const profile = VEGETATION_NICHES.find(profile => profile.kind === mark.kind)!;
      const cell = terrain.cells[Math.floor(mark.y / terrain.cell) * terrain.cols + Math.floor(mark.x / terrain.cell)]!;
      expect(profile.cells).toContain(cell);
      expect(suitability(sampleEnvironment(field, mark.x, mark.y), profile.niche)).toBeGreaterThan(0);
      for (const other of marks) if (mark !== other) expect(Math.hypot(mark.x - other.x, mark.y - other.y)).toBeGreaterThan(60);
    }
  });
});
