import type { Brush } from './art/kit';
import { createScratchCanvas } from './art/scratch-canvas';
import type { Terrain } from '../shared/terrain';
import { environmentField, sampleEnvironment } from '../shared/environment/fields';
import { groundCover } from '../shared/environment/ecology';
import { coordinateRandom } from '../shared/environment/noise';

type Material = keyof ReturnType<typeof groundCover>;
const colours: Record<Material, readonly number[]> = { grass: [113, 139, 83], earth: [173, 151, 114], sand: [201, 184, 143], gravel: [157, 156, 140] };
const covers = new WeakMap<Terrain, HTMLCanvasElement>();
const textures = new Map<Material, HTMLCanvasElement>();
const TILE = 128;

/** Shared low-resolution colour field for the world and minimap. No winner-takes-all biome edges. */
export function terrainCover(terrain: Terrain): HTMLCanvasElement {
  const cached = covers.get(terrain);
  if (cached) return cached;
  const cover = createScratchCanvas(terrain.cols, terrain.rows), brush = cover.getContext('2d')!;
  const field = environmentField(terrain);
  const pixels = brush.createImageData(terrain.cols, terrain.rows), layers = field.layers;
  for (let i = 0; i < terrain.cols * terrain.rows; i++) {
    const weights = groundCover({ fertility: layers.fertility[i]!, salinity: layers.salinity[i]!, rockiness: layers.rockiness[i]! });
    const shade = 1 - layers.canopy[i]! * .1;
    for (let channel = 0; channel < 3; channel++) {
      pixels.data[i * 4 + channel] = Math.round((colours.grass[channel]! * weights.grass + colours.earth[channel]! * weights.earth + colours.sand[channel]! * weights.sand + colours.gravel[channel]! * weights.gravel) * shade);
    }
    pixels.data[i * 4 + 3] = 255;
  }
  brush.putImageData(pixels, 0, 0);
  covers.set(terrain, cover);
  return cover;
}

/** Original static material strokes, drawn once at 2x. They are transparent overlays,
 * so habitat weights can blend their texture without four competing colour plates. */
function texture(material: Material): HTMLCanvasElement {
  const cached = textures.get(material);
  if (cached) return cached;
  const canvas = createScratchCanvas(TILE * 2, TILE * 2), b = canvas.getContext('2d')!;
  b.scale(2, 2); b.lineCap = 'round';
  for (let i = 0; i < 190; i++) {
    const random = (channel: number) => coordinateRandom(7159 + material.length, i, 0, channel);
    const originalX = random(1) * TILE, originalY = random(2) * TILE;
    for (const offsetY of [-TILE, 0, TILE]) for (const offsetX of [-TILE, 0, TILE]) {
      const x = originalX + offsetX, y = originalY + offsetY;
      b.lineWidth = .6 + random(3) * .7;
      if (material === 'grass') {
        b.strokeStyle = i % 3 ? '#3f582e60' : '#d1ce8d80';
        b.beginPath(); b.moveTo(x, y); b.quadraticCurveTo(x - 1, y - 2, x + random(4) * 4 - 2, y - 3 - random(5) * 3); b.stroke();
      } else if (material === 'sand') {
        b.strokeStyle = i % 2 ? '#8d754134' : '#f7e5b566';
        b.beginPath(); b.moveTo(x, y); b.quadraticCurveTo(x + 3, y - 1, x + 6, y); b.stroke();
      } else {
        b.fillStyle = i % 2 ? '#75634755' : '#e8dab175';
        b.beginPath(); b.ellipse(x, y, material === 'gravel' ? 1.6 : .8, .6, 0, 0, Math.PI * 2); b.fill();
      }
    }
  }
  textures.set(material, canvas);
  return canvas;
}

/** Texture density follows continuous material weights; world-anchored UVs stay stable when panning or recaching. */
export function paintGroundTextures(b: Brush, terrain: Terrain, low: { col: number; row: number }, high: { col: number; row: number }) {
  const field = environmentField(terrain), size = terrain.cell;
  b.save();
  for (let row = low.row; row <= high.row; row++) for (let col = low.col; col <= high.col; col++) {
    if (!'.m'.includes(terrain.cells[row * terrain.cols + col]!)) continue;
    const x = col * size, y = row * size;
    const weights = groundCover(sampleEnvironment(field, x + size / 2, y + size / 2));
    for (const material of Object.keys(weights) as Material[]) {
      if (weights[material] < .03) continue;
      b.globalAlpha = weights[material];
      // A cell can straddle a texture boundary on maps whose cell size does not divide TILE.
      for (let dy = 0; dy < size;) {
        const sy = (y + dy) % TILE, h = Math.min(size - dy, TILE - sy);
        for (let dx = 0; dx < size;) {
          const sx = (x + dx) % TILE, w = Math.min(size - dx, TILE - sx);
          b.drawImage(texture(material), sx * 2, sy * 2, w * 2, h * 2, x + dx, y + dy, w, h);
          dx += w;
        }
        dy += h;
      }
    }
  }
  b.restore();
}
