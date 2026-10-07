import type { Terrain } from '../shared/terrain';
import { environmentField } from '../shared/environment/fields';
import { spatialNoise } from '../shared/environment/noise';

export type WaterField = { depth: Float32Array; coverage: Float32Array; wet: Uint8Array; hasWater: boolean };
const fields = new WeakMap<Terrain, WaterField>();

/** A presentation-only shore distance. Built in O(cells), shared by Canvas and GPU;
 * it never changes navigation, water level or the authoritative simulation. */
export function waterField(terrain: Terrain): WaterField {
  const cached = fields.get(terrain);
  if (cached) return cached;
  const { cols, rows, cells } = terrain, count = cols * rows;
  const wet = new Uint8Array(count), depth = new Float32Array(count), coverage = new Float32Array(count);
  let hasWater = false;
  for (let i = 0; i < count; i++) {
    wet[i] = cells[i] === '~' || cells[i] === ',' ? 1 : 0;
    hasWater ||= Boolean(wet[i]);
  }
  // Chamfer distance: axial edges cost 3, diagonals 4. Out-of-world is open sea,
  // so the map border never acquires an artificial beach.
  const distances = (source: (i: number) => boolean) => {
    const distance = Uint16Array.from({ length: count }, (_, i) => source(i) ? 0 : 96);
    const d = (x: number, y: number) => x < 0 || y < 0 || x >= cols || y >= rows ? 96 : distance[y * cols + x]!;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      distance[i] = Math.min(distance[i]!, d(x - 1, y) + 3, d(x, y - 1) + 3, d(x - 1, y - 1) + 4, d(x + 1, y - 1) + 4);
    }
    for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      distance[i] = Math.min(distance[i]!, d(x + 1, y) + 3, d(x, y + 1) + 3, d(x + 1, y + 1) + 4, d(x - 1, y + 1) + 4);
    }
    return distance;
  };
  const shore = distances(i => !wet[i]), shallows = distances(i => cells[i] === ',');
  const deepen = (distance: number) => { const t = Math.min(1, distance / 24); return t * t * (3 - 2 * t); };
  for (let i = 0; i < count; i++) {
    // Shallows seed a gently descending shelf, rather than a constant colour
    // next to an unrelated deep-water colour. Both distances remain continuous.
    depth[i] = wet[i] ? Math.min(deepen(shore[i]!), .16 + .84 * deepen(shallows[i]!)) : 0;
  }
  // One continuous coast for the bed and both surface renderers. Clamp at the
  // world boundary: a sea touching the edge must not grow a rectangular beach.
  const weights = [1, 2, 1];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const col = Math.max(0, Math.min(cols - 1, x + dx)), row = Math.max(0, Math.min(rows - 1, y + dy));
      sum += wet[row * cols + col]! * weights[dx + 1]! * weights[dy + 1]!;
    }
    coverage[y * cols + x] = sum / 16;
  }
  const field = { wet, depth, coverage, hasWater };
  fields.set(terrain, field);
  return field;
}

type WaterCover = { width: number; height: number; pixels: Uint8Array };
const covers = new WeakMap<Terrain, WaterCover>();

/** Static submerged terrain + depth-dependent absorption. Both renderers use
 * these pixels: sand, rocky shelves and seabed relief do not drift with
 * surface waves. Bounded at 1024² and generated once per immutable map. */
export function waterCoverPixels(terrain: Terrain): WaterCover {
  const old = covers.get(terrain);
  if (old) return old;
  const scale = Math.min(4, 1024 / Math.max(terrain.cols, terrain.rows));
  const width = Math.max(1, Math.ceil(terrain.cols * scale)), height = Math.max(1, Math.ceil(terrain.rows * scale));
  const pixels = new Uint8Array(width * height * 4), field = waterField(terrain);
  const environment = environmentField(terrain), { rockiness } = environment.layers;
  const sand = [183, 178, 148], stoneColour = [140, 149, 141], absorption = [6, 4, 3];
  const sample = (layer: Float32Array, x: number, y: number) => {
    const px = Math.max(0, Math.min(terrain.cols - 1, x / terrain.cell - .5));
    const py = Math.max(0, Math.min(terrain.rows - 1, y / terrain.cell - .5));
    const col = Math.floor(px), row = Math.floor(py), nx = Math.min(col + 1, terrain.cols - 1), ny = Math.min(row + 1, terrain.rows - 1);
    const a = layer[row * terrain.cols + col]!, b = layer[row * terrain.cols + nx]!;
    const c = layer[ny * terrain.cols + col]!, d = layer[ny * terrain.cols + nx]!;
    return (a + (b - a) * (px - col)) * (1 - py + row) + (c + (d - c) * (px - col)) * (py - row);
  };
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const x = (col + .5) * terrain.cols * terrain.cell / width, y = (row + .5) * terrain.rows * terrain.cell / height;
    const depth = sample(field.depth, x, y), rock = sample(rockiness, x, y);
    const relief = spatialNoise(environment.seed, x, y, 180, 71);
    const stone = spatialNoise(environment.seed, x, y, 28, 72);
    const rocky = Math.min(1, rock * .85);
    const shade = .97 + (relief - .5) * .07 + (stone - .5) * (.03 + rocky * .06);
    const i = (row * width + col) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const bed = (sand[channel]! * (1 - rocky) + stoneColour[channel]! * rocky) * shade;
      const transmission = Math.exp(-depth * absorption[channel]!);
      pixels[i + channel] = Math.round(bed * transmission + WATER_DEEP[channel]! * (1 - transmission));
    }
    pixels[i + 3] = Math.round(waterCoverage(sample(field.coverage, x, y)) * 255);
  }
  const cover = { width, height, pixels }; covers.set(terrain, cover); return cover;
}

export const WATER_DEEP = [57, 102, 113] as const;
export const WATER_SHORE_FADE = [.25, .75] as const;
export const WATER_DEPTH_FADE = [.045, .22] as const;
const smooth = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t);
};
export const waterCoverage = (coverage: number) => smooth(...WATER_SHORE_FADE, coverage);
export const waterLightStrength = (coverage: number, depth: number) => waterCoverage(coverage) * smooth(...WATER_DEPTH_FADE, depth);

/** Periodic analytical height gradients, rather than random sparkle dots. The
 * integer wave vectors make the texture seamless in both directions.
 * Model: GPU Gems 1, ch. 1 (Mark Finch), sum-of-sines normal derivation. */
export function waterSlope(u: number, v: number, seconds: number): { x: number; y: number } {
  let x = 0, y = 0;
  for (const [kx, ky, amplitude, speed, phase] of WATER_WAVES) {
    const slope = amplitude * Math.cos((kx * u + ky * v) * Math.PI * 2 - speed * seconds + phase);
    x += kx * slope;
    y += ky * slope;
  }
  return { x, y };
}
export const WATER_WAVES = [
  [5, 2, .015, .65, 0],
  [7, -3, .008, 1.05, 1.7],
  [11, 2, .004, 1.65, 3.1],
  [13, -4, .0025, 2.1, .8],
  [17, 5, .0015, 2.4, 4.2],
  [23, -7, .0008, 2.8, 1.1],
] as const;

let normals: Uint8Array | undefined;
export const WATER_NORMAL_SIZE = 128;
/** The normal spectrum is synthesized once; surface animation subsequently
 * samples it with two independent world-space flows instead of evaluating a
 * large spectrum for every screen pixel. */
export function waterNormalPixels(): Uint8Array {
  if (normals) return normals;
  normals = new Uint8Array(WATER_NORMAL_SIZE * WATER_NORMAL_SIZE * 4);
  for (let y = 0; y < WATER_NORMAL_SIZE; y++) for (let x = 0; x < WATER_NORMAL_SIZE; x++) {
    const slope = waterSlope(x / WATER_NORMAL_SIZE, y / WATER_NORMAL_SIZE, 0), i = (y * WATER_NORMAL_SIZE + x) * 4;
    normals[i] = Math.round(128 + slope.x * 127);
    normals[i + 1] = Math.round(128 + slope.y * 127);
    normals[i + 2] = normals[i + 3] = 255;
  }
  return normals;
}
