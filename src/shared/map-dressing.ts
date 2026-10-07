import type { Terrain } from './terrain';
import type { TerrainLandmark } from './types';
import { environmentField, sampleEnvironment } from './environment/fields';
import { suitability, VEGETATION_NICHES } from './environment/ecology';
import { coordinateRandom, spatialNoise } from './environment/noise';

/** One recipe feeds the ground renderer, vegetation placement and creep habitat scoring. */
export function prepareEcology(terrain: Terrain, seed: string, seaOutlet?: { x: number; y: number }): void {
  terrain.ecology = { version: 1, seed, ...(seaOutlet ? { seaOutlet } : {}) };
}

/** Jittered, separated candidates with shared low-frequency patch density.
 * Species compete for each candidate through habitat suitability, not independent random stamps.
 * Scenery never changes collision, resource access or path costs. */
export function ecologicalDressing(terrain: Terrain, protectedPoints: readonly { x: number; y: number }[], seed: string): TerrainLandmark[] {
  if (!terrain.ecology) terrain.ecology = { version: 1, seed };
  const field = environmentField(terrain), spacing = 112, marks: TerrainLandmark[] = [];
  const width = terrain.cols * terrain.cell, height = terrain.rows * terrain.cell;
  for (let row = 0; row * spacing < height; row++) for (let col = 0; col * spacing < width; col++) {
    const random = (channel: number) => coordinateRandom(field.seed, col, row, channel);
    const x = Math.round((col + .5 + (random(60) - .5) * .4) * spacing);
    const y = Math.round((row + .5 + (random(61) - .5) * .4) * spacing);
    if (x < 48 || y < 48 || x > width - 48 || y > height - 48 || protectedPoints.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 < 190 ** 2)) continue;
    const cell = terrain.cells[Math.floor(y / terrain.cell) * terrain.cols + Math.floor(x / terrain.cell)]!;
    const environment = sampleEnvironment(field, x, y);
    const candidates = VEGETATION_NICHES.map(profile => ({ profile, weight: profile.cells.includes(cell) ? suitability(environment, profile.niche) * profile.density : 0 }));
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    const cluster = spatialNoise(field.seed, x, y, 560, 80);
    if (random(62) > Math.min(.5, total * .35) * (.25 + cluster * 1.1)) continue;
    let choice = random(63) * total;
    const chosen = candidates.find(candidate => { choice -= candidate.weight; return choice < 0; });
    if (!chosen) continue;
    marks.push({ id: `eco-decor-${row}-${col}`, kind: chosen.profile.kind, x: Math.round(x), y: Math.round(y), size: Math.round(34 + random(64) * 22), rotation: Math.round(random(65) * 628) / 100 });
  }
  return marks;
}
