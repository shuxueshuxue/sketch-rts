import type { Terrain } from '../shared/terrain';

export type WaterField = { depth: Float32Array; wet: Uint8Array; hasWater: boolean };
const fields = new WeakMap<Terrain, WaterField>();

/** A presentation-only shore distance. Built in O(cells), shared by Canvas and GPU;
 * it never changes navigation, water level or the authoritative simulation. */
export function waterField(terrain: Terrain): WaterField {
  const cached = fields.get(terrain);
  if (cached) return cached;
  const { cols, rows, cells } = terrain, count = cols * rows;
  const wet = new Uint8Array(count), distance = new Uint16Array(count), depth = new Float32Array(count);
  let hasWater = false;
  for (let i = 0; i < count; i++) {
    wet[i] = cells[i] === '~' || cells[i] === ',' ? 1 : 0;
    distance[i] = wet[i] ? 96 : 0;
    hasWater ||= Boolean(wet[i]);
  }
  // Chamfer distance: axial edges cost 3, diagonals 4. Out-of-world is open sea,
  // so the map border never acquires an artificial beach.
  const d = (x: number, y: number) => x < 0 || y < 0 || x >= cols || y >= rows ? 96 : distance[y * cols + x]!;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (wet[i]) distance[i] = Math.min(distance[i]!, d(x - 1, y) + 3, d(x, y - 1) + 3, d(x - 1, y - 1) + 4, d(x + 1, y - 1) + 4);
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (wet[i]) distance[i] = Math.min(distance[i]!, d(x + 1, y) + 3, d(x, y + 1) + 3, d(x + 1, y + 1) + 4, d(x - 1, y + 1) + 4);
    depth[i] = wet[i] ? cells[i] === ',' ? .035 : 1 - Math.exp(-distance[i]! / 12) : 0;
  }
  const field = { wet, depth, hasWater };
  fields.set(terrain, field);
  return field;
}

export const WATER_SHALLOW = [107, 164, 151] as const;
export const WATER_DEEP = [30, 76, 95] as const;
export function waterDepthColour(depth: number): readonly number[] {
  const t = Math.max(0, Math.min(1, depth));
  return WATER_SHALLOW.map((value, i) => Math.round(value + (WATER_DEEP[i]! - value) * t));
}

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
  [2, 1, .065, .65, 0],
  [3, -2, .028, 1.05, 1.7],
  [7, 2, .012, 1.65, 3.1],
  [11, -3, .006, 2.1, .8],
  [5, 3, .009, 1.3, 2.4],
  [13, 4, .004, 2.4, 4.2],
  [17, -5, .0025, 2.8, 1.1],
  [23, 7, .0014, 3.2, 5.7],
  [29, -9, .001, 3.6, 3.8],
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
