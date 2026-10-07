import type { Terrain } from '../terrain';
import { fractalNoise, seedHash } from './noise';

/** Physical units for climate/height; the other channels are fractions in [0,1]. */
export type EnvironmentSample = {
  temperatureC: number;
  elevationMeters: number;
  moisture: number;
  salinity: number;
  fertility: number;
  canopy: number;
  rockiness: number;
  water: number;
};
export type EnvironmentField = { terrain: Terrain; seed: number; layers: Record<keyof EnvironmentSample, Float32Array> };
const cache = new WeakMap<Terrain, EnvironmentField>();
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const proximity = (distance: number, reach: number) => {
  const t = clamp01(1 - distance / reach);
  return t * t * (3 - 2 * t);
};

/** Linear-time chamfer distance: continuous shore/wood/rock influences, not per-cell random decisions. */
function distanceField(terrain: Terrain, source: (index: number) => boolean): Float32Array {
  const { cols, rows, cell } = terrain, count = cols * rows;
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) result[i] = source(i) ? 0 : (cols + rows) * cell;
  const diagonal = cell * 1.4142135623730951;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (x) result[i] = Math.min(result[i]!, result[i - 1]! + cell);
    if (y) {
      result[i] = Math.min(result[i]!, result[i - cols]! + cell);
      if (x) result[i] = Math.min(result[i]!, result[i - cols - 1]! + diagonal);
      if (x + 1 < cols) result[i] = Math.min(result[i]!, result[i - cols + 1]! + diagonal);
    }
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (x + 1 < cols) result[i] = Math.min(result[i]!, result[i + 1]! + cell);
    if (y + 1 < rows) {
      result[i] = Math.min(result[i]!, result[i + cols]! + cell);
      if (x) result[i] = Math.min(result[i]!, result[i + cols - 1]! + diagonal);
      if (x + 1 < cols) result[i] = Math.min(result[i]!, result[i + cols + 1]! + diagonal);
    }
  }
  return result;
}

/** Salt reaches only open water connected to a map boundary. Inland ponds stay fresh. */
function marineWater(terrain: Terrain): Uint8Array {
  if (terrain.palette !== "coastal") return new Uint8Array(terrain.cols * terrain.rows);
  const { cols, rows, cells } = terrain, marine = new Uint8Array(cols * rows), queue = new Int32Array(marine.length);
  let read = 0, write = 0;
  const add = (i: number) => {
    if (!marine[i] && (cells[i] === '~' || cells[i] === ',')) { marine[i] = 1; queue[write++] = i; }
  };
  for (let x = 0; x < cols; x++) { add(x); add((rows - 1) * cols + x); }
  for (let y = 1; y + 1 < rows; y++) { add(y * cols); add(y * cols + cols - 1); }
  while (read < write) {
    const i = queue[read++]!, x = i % cols, y = Math.floor(i / cols);
    if (x) add(i - 1); if (x + 1 < cols) add(i + 1);
    if (y) add(i - cols); if (y + 1 < rows) add(i + cols);
  }
  return marine;
}

/** Built once per immutable terrain, shared by cover, vegetation and creep habitat queries.
 * Only the recipe (version + seed) is serialized, not eight large float grids. */
export function environmentField(terrain: Terrain): EnvironmentField {
  const previous = cache.get(terrain);
  if (previous) return previous;
  const seed = seedHash(terrain.ecology?.seed ?? 'temperate'), count = terrain.cols * terrain.rows;
  const wet = distanceField(terrain, i => '~,m'.includes(terrain.cells[i]!));
  const marine = marineWater(terrain), salt = distanceField(terrain, i => marine[i] === 1);
  const trees = distanceField(terrain, i => terrain.cells[i] === 'T');
  const rock = distanceField(terrain, i => terrain.cells[i] === '#' || terrain.levels?.[i] === '1');
  const layers = Object.fromEntries(['temperatureC', 'elevationMeters', 'moisture', 'salinity', 'fertility', 'canopy', 'rockiness', 'water']
    .map(key => [key, new Float32Array(count)])) as EnvironmentField['layers'];
  for (let i = 0; i < count; i++) {
    const x = (i % terrain.cols + .5) * terrain.cell, y = (Math.floor(i / terrain.cols) + .5) * terrain.cell;
    const water = proximity(wet[i]!, 400), canopy = proximity(trees[i]!, 230), rockiness = proximity(rock[i]!, 240);
    const relief = fractalNoise(seed, x, y, 1800, 10);
    const elevation = '~,'.includes(terrain.cells[i]!) ? 0 : 10 + relief * 55 + rockiness * 100;
    const outlet = terrain.ecology?.seaOutlet;
    const tidalReach = outlet ? proximity(Math.hypot(x - outlet.x, y - outlet.y), Math.max(terrain.cols, terrain.rows) * terrain.cell * .45) : 1;
    const salinity = proximity(salt[i]!, 180) * .75 * tidalReach;
    const rain = fractalNoise(seed, x, y, 2200, 20);
    const moisture = clamp01(.2 + rain * .46 + water * .4 + canopy * .14 - rockiness * .16);
    const fertility = clamp01(.25 + moisture * .52 + canopy * .16 - salinity * .48 - rockiness * .4);
    layers.temperatureC[i] = 23 - elevation * .0065 + (fractalNoise(seed, x, y, 3400, 30) - .5) * 7;
    layers.elevationMeters[i] = elevation;
    layers.moisture[i] = moisture; layers.salinity[i] = salinity; layers.fertility[i] = fertility;
    layers.canopy[i] = canopy; layers.rockiness[i] = rockiness; layers.water[i] = water;
  }
  const field = { terrain, seed, layers };
  cache.set(terrain, field);
  return field;
}

/** Bilinear samples at arbitrary world coordinates, including across rendering chunk edges. */
export function sampleEnvironment(field: EnvironmentField, x: number, y: number): EnvironmentSample {
  const { terrain, layers } = field;
  const px = Math.max(0, Math.min(terrain.cols - 1, x / terrain.cell - .5));
  const py = Math.max(0, Math.min(terrain.rows - 1, y / terrain.cell - .5));
  const col = Math.floor(px), row = Math.floor(py), nextCol = Math.min(col + 1, terrain.cols - 1), nextRow = Math.min(row + 1, terrain.rows - 1);
  const u = px - col, v = py - row;
  const sample = {} as EnvironmentSample;
  for (const key of Object.keys(layers) as (keyof EnvironmentSample)[]) {
    const layer = layers[key];
    const a = layer[row * terrain.cols + col]!, b = layer[row * terrain.cols + nextCol]!;
    const c = layer[nextRow * terrain.cols + col]!, d = layer[nextRow * terrain.cols + nextCol]!;
    sample[key] = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  return sample;
}
