import { createScratchCanvas } from './art/scratch-canvas';
import { waterCoverPixels, waterSlope } from './water-field';
import type { Terrain } from '../shared/terrain';

const covers = new WeakMap<Terrain, HTMLCanvasElement>();
let ripple: HTMLCanvasElement | undefined;
const TILE = 256;

/** Shared seabed/absorption pixels, baked once into the existing terrain chunks
 * and clipped by their coast contours. Surface lighting stays in its own cache. */
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

/** A small cached surface-normal lighting tile for devices without WebGL.
 * Several wave directions are baked together; no per-frame pixel work. */
function rippleTile() {
  if (ripple) return ripple;
  ripple = createScratchCanvas(TILE, TILE);
  const ctx = ripple.getContext('2d')!, pixels = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const slope = waterSlope(x / TILE, y / TILE, 0);
    const light = Math.min(1, Math.max(0, .258 * slope.x + .833 - .489 * slope.y) / Math.sqrt(1 + slope.x * slope.x + slope.y * slope.y));
    const specular = Math.pow(light, 48);
    const i = (y * TILE + x) * 4;
    pixels.data[i] = 200; pixels.data[i + 1] = 225; pixels.data[i + 2] = 214;
    pixels.data[i + 3] = Math.round(specular * .075 * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return ripple;
}

/** Called on a cached, coast-clipped water mask only, beneath ground actors.
 * Work scales with the visible chunk, never the size of the full map. */
export function paintWaterRipples(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seconds: number) {
  const tile = rippleTile();
  const ox = ((seconds * 7 - x) % TILE + TILE) % TILE - TILE;
  const oy = ((seconds * 3 - y) % TILE + TILE) % TILE - TILE;
  ctx.globalAlpha = .7;
  for (let py = oy; py < size; py += TILE) for (let px = ox; px < size; px += TILE) ctx.drawImage(tile, px, py, TILE, TILE);
  ctx.globalAlpha = 1;
}
