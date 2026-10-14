import { createScratchCanvas } from './art/scratch-canvas';
import { waterCoverPixels, waterSlope, waterField, waterLightStrength } from './water-field';
import type { Terrain } from '../shared/terrain';

const covers = new WeakMap<Terrain, HTMLCanvasElement>();
let ripple: HTMLCanvasElement | undefined;
const TILE = 256;

/** Shared seabed/absorption pixels, baked once into the existing terrain chunks
 * and blended through the same continuous coast coverage. Surface lighting stays in its own cache. */
export function waterCover(terrain: Terrain): HTMLCanvasElement {
  const old = covers.get(terrain);
  if (old) return old;
  const cover = waterCoverPixels(terrain);
  const canvas = createScratchCanvas(cover.width, cover.height), ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(cover.width, cover.height);
  image.data.set(cover.pixels);
  ctx.putImageData(image, 0, 0); covers.set(terrain, canvas);
  return canvas;
}

const lightMasks = new WeakMap<Terrain, HTMLCanvasElement>();
/** Depth suppresses surface light at the bank; masks are global, not rebuilt
 * with a different contour or origin at each chunk edge. */
export function waterLightMask(terrain: Terrain): HTMLCanvasElement {
  const old = lightMasks.get(terrain); if (old) return old;
  const canvas = createScratchCanvas(terrain.cols, terrain.rows), ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(terrain.cols, terrain.rows), field = waterField(terrain);
  for (let i = 0; i < field.depth.length; i++) {
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
    pixels.data[i * 4 + 3] = Math.round(waterLightStrength(field.coverage[i]!, field.depth[i]!) * 255);
  }
  ctx.putImageData(pixels, 0, 0); lightMasks.set(terrain, canvas); return canvas;
}

/** A small cached surface-normal lighting tile for devices without WebGL.
 * Several wave directions are baked together; no per-frame pixel work. */
function rippleTile() {
  if (ripple) return ripple;
  ripple = createScratchCanvas(TILE, TILE);
  const ctx = ripple.getContext('2d')!, pixels = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const slope = waterSlope(x / TILE, y / TILE, 0);
    const light = Math.min(1, Math.max(0, .258 * slope.x + .833 - .489 * slope.y) / Math.sqrt(1 + slope.x * slope.x + slope.y * slope.y));
    const specular = Math.pow(light, 12);
    const i = (y * TILE + x) * 4;
    pixels.data[i] = 191; pixels.data[i + 1] = 217; pixels.data[i + 2] = 213;
    pixels.data[i + 3] = Math.round((.004 + specular * .22) * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return ripple;
}

/** Called on a cached, coast-clipped water mask only, beneath ground actors.
 * Work scales with the visible chunk, never the size of the full map. */
export function paintWaterRipples(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seconds: number) {
  const tile = rippleTile();
  // Two independent flows, fixed in world coordinates across all chunks.
  for (const [period, vx, vy] of [[256, 7, 3], [384, -3, 5]]) {
    const ox = ((seconds * vx! - x) % period! + period!) % period! - period!;
    const oy = ((seconds * vy! - y) % period! + period!) % period! - period!;
    ctx.globalAlpha = .5;
    for (let py = oy; py < size; py += period!) for (let px = ox; px < size; px += period!) ctx.drawImage(tile, px, py, period!, period!);
  }
  ctx.globalAlpha = 1;
}
