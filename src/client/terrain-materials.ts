import { createScratchCanvas } from './art/scratch-canvas';
import type { Terrain } from '../shared/terrain';
import { environmentField, sampleEnvironment } from '../shared/environment/fields';
import { groundCover } from '../shared/environment/ecology';

// @@@ground-materials - What open ground is painted as (see docs/art-direction-variants.zh.md, rules 1 and 4): dirt is
// the base; grass, sand and rough gravel lie over it in patches. A cell takes the cover its environment clearly favours,
// not a blend of all four, so the patch edges can be drawn rather than faded. The minimap shows the same choice.
export type GroundMaterial = 'dirt' | 'sand' | 'rough' | 'grass';
export type Tone = { base: string; dark: string; light: string };
export const GROUND: Record<GroundMaterial, Tone> = {
  grass: { base: '#a2aa72', dark: '#808c57', light: '#bfc38c' },
  dirt: { base: '#bba783', dark: '#9b8865', light: '#d0c19c' },
  sand: { base: '#dccb9f', dark: '#bca97b', light: '#ede0b8' },
  rough: { base: '#aca78f', dark: '#8b8772', light: '#c5c1aa' },
};
/** The order patches are laid: each over the ones before it. */
export const GROUND_LAYERS: readonly GroundMaterial[] = ['rough', 'sand', 'grass'];

export function groundMaterial(terrain: Terrain, col: number, row: number): GroundMaterial {
  if (terrain.ecology) {
    const w = groundCover(sampleEnvironment(environmentField(terrain), (col + .5) * terrain.cell, (row + .5) * terrain.cell));
    // Thresholds, not the largest weight: open ground stays dirt unless another cover clearly wins.
    return w.grass > .35 ? 'grass' : w.sand > .45 ? 'sand' : w.gravel > .5 ? 'rough' : 'dirt';
  }
  const surface = terrain.surfaces?.[row * terrain.cols + col];
  return surface === 'd' ? 'dirt' : surface === 's' ? 'sand' : surface === 'r' ? 'rough' : 'grass';
}

const covers = new WeakMap<Terrain, HTMLCanvasElement>();
/** The ground at one pixel a cell, each cell its material's colour: the minimap's open ground. */
export function terrainCover(terrain: Terrain): HTMLCanvasElement {
  const cached = covers.get(terrain);
  if (cached) return cached;
  const cover = createScratchCanvas(terrain.cols, terrain.rows), brush = cover.getContext('2d')!;
  for (let row = 0; row < terrain.rows; row++) for (let col = 0; col < terrain.cols; col++) {
    brush.fillStyle = GROUND[groundMaterial(terrain, col, row)].base;
    brush.fillRect(col, row, 1, 1);
  }
  covers.set(terrain, cover);
  return cover;
}

export function cellJitter(col: number, row: number, salt: number) {
  let hash = Math.imul(col, 374_761_393) ^ Math.imul(row, 668_265_263) ^ Math.imul(salt, 2_246_822_519);
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_296;
}

// A material's texture: a few broad, low-contrast blotches, then its own marks (grass blades, pebbles, sand ripples,
// stones) at a middle frequency, tiled seamlessly and laid in world coordinates. Quiet enough that units read over it.
const TILE = 256;
const textures = new Map<string, HTMLCanvasElement>();
export function groundTexture(kind: GroundMaterial | 'floor' | 'rock' | 'mud', tone: Tone): HTMLCanvasElement {
  let canvas = textures.get(kind);
  if (canvas) return canvas;
  canvas = createScratchCanvas(TILE, TILE);
  const b = canvas.getContext('2d')!;
  b.fillStyle = tone.base; b.fillRect(0, 0, TILE, TILE);
  const each = (count: number, salt: number, draw: (x: number, y: number, r: (k: number) => number) => void) => {
    for (let i = 0; i < count; i++) {
      const r = (k: number) => cellJitter(i, salt, k);
      for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) draw(r(1) * TILE + ox, r(2) * TILE + oy, r);
    }
  };
  b.globalAlpha = .1;
  each(46, 1, (x, y, r) => { b.fillStyle = r(3) < .5 ? tone.dark : tone.light; b.beginPath(); b.ellipse(x, y, 14 + r(4) * 40, 9 + r(5) * 26, r(6) * 3, 0, Math.PI * 2); b.fill(); });
  b.lineCap = 'round'; b.lineWidth = 1;
  if (kind === 'grass' || kind === 'floor') each(kind === 'grass' ? 150 : 60, 3, (x, y, r) => {
    b.strokeStyle = r(3) < .62 ? tone.dark : tone.light; b.globalAlpha = .55;
    for (const dx of [-2.5, 0, 2.5]) { b.beginPath(); b.moveTo(x + dx, y); b.lineTo(x + dx * 1.6 + (r(4) - .5) * 2, y - 3 - r(5) * 3.5); b.stroke(); }
  });
  else if (kind === 'dirt' || kind === 'mud') each(90, 4, (x, y, r) => {
    b.globalAlpha = .6; b.fillStyle = r(3) < .6 ? tone.dark : tone.light;
    b.beginPath(); b.ellipse(x, y, 1.2 + r(4) * 2.2, .9 + r(5) * 1.4, 0, 0, Math.PI * 2); b.fill();
    if (r(6) < .12) { b.strokeStyle = tone.dark; b.beginPath(); b.moveTo(x, y); b.lineTo(x + 8 * r(7), y + 4 * r(8) - 2); b.lineTo(x + 14 * r(9), y + 6 * r(7) - 3); b.stroke(); }
  });
  else if (kind === 'sand') each(70, 5, (x, y, r) => {
    b.globalAlpha = .55; b.strokeStyle = r(3) < .5 ? tone.light : tone.dark;
    b.beginPath(); b.arc(x, y, 6 + r(4) * 6, Math.PI * 1.15, Math.PI * 1.85); b.stroke();
  });
  else each(70, 6, (x, y, r) => {
    b.globalAlpha = .75; const s = 2 + r(3) * 4;
    b.fillStyle = tone.dark; b.beginPath(); b.ellipse(x + 1, y + 1, s, s * .7, 0, 0, Math.PI * 2); b.fill();
    b.fillStyle = r(4) < .5 ? tone.light : tone.base; b.beginPath(); b.ellipse(x, y, s, s * .7, 0, 0, Math.PI * 2); b.fill();
  });
  b.globalAlpha = 1;
  textures.set(kind, canvas);
  return canvas;
}
