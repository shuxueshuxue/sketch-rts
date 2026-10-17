import { type Brush, type Point, ellipse, line, polygon } from "./art/kit";
import { createScratchCanvas } from "./art/scratch-canvas";
// The atlas's tree, from its own module: a chunk painter thread (see @@@terrain-chunk-thread) loads no other art.
import { paintTree as drawAtlasTree } from "./art/environment";
import { GROUND, GROUND_LAYERS, cellJitter, groundMaterial, groundTexture, terrainCover, type Tone } from './terrain-materials';
import type { Terrain } from "../shared/terrain";
import { environmentField, sampleEnvironment } from "../shared/environment/fields";
import { waterCover, waterLightMask, paintWaterRipples, shoreMask } from './water-art';
import { WATER_DEEP, waterField } from './water-field';

// @@@terrain-art - The ground as an inked atlas after HoMM3's adventure map (docs/art-direction-variants.zh.md, part
// one): dirt under everything with grass, sand and gravel laid over it in patches with drawn edges; the coast in bands of
// beach, foam and water; rock as boulders with a cliff face to the south; forest as a mass of trees with bigger ones at its
// edge; open ground carrying only small, low things. Nothing here changes what a unit may cross (see @@@terrain). The map
// is painted in square chunks once and kept, so a frame only lays down the chunks in view.

const CHUNK = 512;
const MAX_CHUNKS = 48;
const INK = "#293c35";
const SHADOW = "#1d261b";
const FOREST_FLOOR: Tone = { base: "#5d6c4a", dark: "#41573a", light: "#5a7449" };
const FOREST_FLOOR_DARK = "#41573a";
const ROCK: Tone = { base: "#bdb6a0", dark: "#8c856f", light: "#dcd5bd" };
const CLIFF: Tone = { base: "#94866a", dark: "#6d614b", light: "#b3a585" };
const MUD: Tone = { base: "#8f8462", dark: "#6f6549", light: "#a99d79" };
const SHALLOWS = "#93b7ae";
const DEEP = `rgb(${WATER_DEEP.join(",")})`;
const FOAM = "#ece6cf";
const DECK = "#c7a472";
const DECK_INK = "#916e44";

// A chunk's pictures: canvases painted here, or bitmaps a chunk painter thread sent.
export type PaintedTerrainChunk = { ground: HTMLCanvasElement | ImageBitmap; water?: HTMLCanvasElement | ImageBitmap };
type TerrainChunk = PaintedTerrainChunk & { ripples?: HTMLCanvasElement; waterPhase?: number };
type Cache = { chunks: Map<string, TerrainChunk>; requested?: Set<string>; minimap?: HTMLCanvasElement;
  waterView?: { canvas:HTMLCanvasElement; x:number; y:number; width:number; height:number; phase:number } };

// @@@terrain-chunk-thread - Painting one chunk takes tens of milliseconds, four times that at a Retina density, and a
// chunk painted while the camera brings it into view holds that frame. With a chunk painter (a worker, see
// terrain-thread/browser) a missing chunk is painted there and the map's coarse picture (terrainMinimap) stands in its
// place until it arrives. Without one (tests, the headless recorder) a chunk is painted where it is needed.
export type TerrainChunkPainter = (terrain: Terrain, cx: number, cy: number, density: number) => Promise<PaintedTerrainChunk>;
let chunkPainter: TerrainChunkPainter | undefined;
export function setTerrainChunkPainter(painter: TerrainChunkPainter | undefined) {
  chunkPainter = painter;
}
const caches = new WeakMap<Terrain, Cache>();

function cacheFor(terrain: Terrain): Cache {
  let cache = caches.get(terrain);
  if (!cache) {
    cache = { chunks: new Map() };
    caches.set(terrain, cache);
  }
  return cache;
}

/** Lays the terrain's chunks in view under everything else; `camera` is the world point at the view's top-left. */
export function drawTerrain(c: Brush, terrain: Terrain, camera: Point, width: number, height: number, waterSeconds?: number) {
  const cache = cacheFor(terrain);
  const density = Math.max(1, Math.min(2, Math.ceil(brushZoom(c) - 0.05)));
  const worldWidth = terrain.cols * terrain.cell;
  const worldHeight = terrain.rows * terrain.cell;
  const phase = waterSeconds === undefined ? undefined : Math.floor(waterSeconds * 12);
  let waterView = cache.waterView;
  const reuseWater = phase !== undefined && waterView && waterView.phase === phase && waterView.width === width && waterView.height === height && waterView.x === camera.x && waterView.y === camera.y;
  let waterBrush: CanvasRenderingContext2D | undefined;
  if (phase !== undefined && !reuseWater && waterField(terrain).hasWater) {
    const scale = Math.min(1, Math.sqrt(1_000_000 / (width * height)));
    const canvas = waterView?.canvas ?? createScratchCanvas(Math.ceil(width * scale), Math.ceil(height * scale));
    if (canvas.width !== Math.ceil(width * scale) || canvas.height !== Math.ceil(height * scale)) { canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale); }
    waterBrush = canvas.getContext('2d')!;
    waterBrush.setTransform(1, 0, 0, 1, 0, 0); waterBrush.clearRect(0, 0, canvas.width, canvas.height); waterBrush.scale(scale, scale);
    waterView = cache.waterView = { canvas, ...camera, width, height, phase };
  }
  const first = { x: Math.max(0, Math.floor(camera.x / CHUNK)), y: Math.max(0, Math.floor(camera.y / CHUNK)) };
  const last = { x: Math.min(Math.ceil(worldWidth / CHUNK) - 1, Math.floor((camera.x + width) / CHUNK)), y: Math.min(Math.ceil(worldHeight / CHUNK) - 1, Math.floor((camera.y + height) / CHUNK)) };
  for (let cy = first.y; cy <= last.y; cy += 1) {
    for (let cx = first.x; cx <= last.x; cx += 1) {
      const key = `${cx},${cy},${density}`;
      let chunk = cache.chunks.get(key);
      if (chunk) {
        cache.chunks.delete(key);
      } else if (chunkPainter) {
        requestChunk(chunkPainter, terrain, cache, key, cx, cy, density);
        // Until it arrives: the chunk at the other density when the zoom just crossed over, else its coarse colours.
        const other = cache.chunks.get(`${cx},${cy},${3 - density}`);
        if (other) c.drawImage(other.ground, cx * CHUNK - camera.x, cy * CHUNK - camera.y, CHUNK, CHUNK);
        else drawCoarseChunk(c, terrain, cx, cy, camera);
        continue;
      } else {
        chunk = paintChunk(terrain, cx, cy, density);
        if (cache.chunks.size >= MAX_CHUNKS) evictChunk(cache);
      }
      cache.chunks.set(key, chunk);
      c.drawImage(chunk.ground, cx * CHUNK - camera.x, cy * CHUNK - camera.y, CHUNK, CHUNK);
      const mask = chunk.water;
      if (mask && phase !== undefined && waterBrush) {
        chunk.ripples ??= createScratchCanvas(CHUNK / 2, CHUNK / 2);
        if (phase !== chunk.waterPhase) {
          const ctx = chunk.ripples.getContext('2d')!;
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, CHUNK / 2, CHUNK / 2);
          ctx.scale(.5, .5); paintWaterRipples(ctx, cx * CHUNK, cy * CHUNK, CHUNK, phase / 12);
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0);
          ctx.globalCompositeOperation = 'source-over'; chunk.waterPhase = phase;
        }
        waterBrush.drawImage(chunk.ripples, cx * CHUNK - camera.x, cy * CHUNK - camera.y, CHUNK, CHUNK);
      }
    }
  }
  if (phase !== undefined && waterView) c.drawImage(waterView.canvas, 0, 0, width, height);
}

// Asks the painter once for a missing chunk; a painter that fails is dropped and chunks are painted here again.
function requestChunk(painter: TerrainChunkPainter, terrain: Terrain, cache: Cache, key: string, cx: number, cy: number, density: number) {
  const requested = cache.requested ??= new Set();
  if (requested.has(key)) return;
  requested.add(key);
  painter(terrain, cx, cy, density).then((painted) => {
    requested.delete(key);
    if (cache.chunks.has(key)) { closeChunk(painted); return; }
    if (cache.chunks.size >= MAX_CHUNKS) evictChunk(cache);
    cache.chunks.set(key, painted);
  }, (error) => {
    requested.delete(key);
    if (chunkPainter === painter) chunkPainter = undefined;
    console.error("Terrain chunk painter failed; painting chunks on this thread", error);
  });
}

// The chunk's cells from the map's one-pixel-a-cell picture, smoothed: its colours in place until its painting arrives.
function drawCoarseChunk(c: Brush, terrain: Terrain, cx: number, cy: number, camera: Point) {
  const cells = CHUNK / terrain.cell, col = cx * cells, row = cy * cells;
  const cols = Math.min(cells, terrain.cols - col), rows = Math.min(cells, terrain.rows - row);
  if (cols <= 0 || rows <= 0) return;
  const smoothing = c.imageSmoothingEnabled;
  c.imageSmoothingEnabled = true;
  c.drawImage(terrainMinimap(terrain), col, row, cols, rows, cx * CHUNK - camera.x, cy * CHUNK - camera.y, cols * terrain.cell, rows * terrain.cell);
  c.imageSmoothingEnabled = smoothing;
}

function evictChunk(cache: Cache) {
  const oldest = cache.chunks.keys().next().value!;
  const chunk = cache.chunks.get(oldest)!;
  cache.chunks.delete(oldest);
  closeChunk(chunk);
}

// A bitmap's pixels are freed when it is closed, not when it is collected.
function closeChunk(chunk: PaintedTerrainChunk) {
  for (const picture of [chunk.ground, chunk.water]) if (picture && "close" in picture) picture.close();
}

/** One chunk's ground and water mask, as drawTerrain paints it; a chunk painter thread runs this (see @@@terrain-chunk-thread). */
export function paintTerrainChunk(terrain: Terrain, cx: number, cy: number, density: number): PaintedTerrainChunk {
  return paintChunk(terrain, cx, cy, density);
}


/** The terrain at one pixel a cell, for the minimap, in the colours the world is drawn in (rule 10). */
export function terrainMinimap(terrain: Terrain): HTMLCanvasElement {
  const cache = cacheFor(terrain);
  if (cache.minimap) return cache.minimap;
  const canvas = createScratchCanvas(terrain.cols, terrain.rows);
  const b = canvas.getContext("2d")!;
  b.drawImage(terrainCover(terrain), 0, 0);
  for (let row = 0; row < terrain.rows; row += 1) {
    let start = 0;
    for (let col = 1; col <= terrain.cols; col += 1) {
      const kind = terrain.cells[row * terrain.cols + start];
      const next = col < terrain.cols ? terrain.cells[row * terrain.cols + col] : undefined;
      if (next === kind) continue;
      const color = kind === "T" ? FOREST_FLOOR.light : kind === "#" ? ROCK.base : kind === "~" ? DEEP : kind === "," ? SHALLOWS : kind === "m" ? MUD.base : kind === "=" ? DECK : undefined;
      if (color) {
        b.fillStyle = color;
        b.fillRect(start, row, col - start, 1);
      }
      start = col;
    }
  }
  cache.minimap = canvas;
  return canvas;
}

function paintChunk(terrain: Terrain, cx: number, cy: number, density: number): TerrainChunk {
  const canvas = createScratchCanvas(CHUNK * density, CHUNK * density);
  let waterMask: HTMLCanvasElement | undefined;
  const b = canvas.getContext("2d")!;
  b.scale(density, density);
  b.translate(-cx * CHUNK, -cy * CHUNK);
  b.lineJoin = b.lineCap = "round";
  const size = terrain.cell;
  const margin = 3;
  const low = { col: Math.max(0, Math.floor((cx * CHUNK) / size) - margin), row: Math.max(0, Math.floor((cy * CHUNK) / size) - margin) };
  const high = { col: Math.min(terrain.cols - 1, Math.floor(((cx + 1) * CHUNK) / size) + margin), row: Math.min(terrain.rows - 1, Math.floor(((cy + 1) * CHUNK) / size) + margin) };
  const at = (col: number, row: number) => terrain.cells[Math.max(0, Math.min(terrain.rows - 1, row)) * terrain.cols + Math.max(0, Math.min(terrain.cols - 1, col))]!;
  const level = (col: number, row: number) => (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows ? "0" : terrain.levels?.[row * terrain.cols + col] ?? "0");
  const wet = (col: number, row: number) => at(col, row) === "~" || at(col, row) === ",";
  const collect = (keep: (col: number, row: number) => boolean) => {
    const out: Cells = [];
    for (let row = low.row; row <= high.row; row++) for (let col = low.col; col <= high.col; col++) if (keep(col, row)) out.push([col, row]);
    return out;
  };
  const fill = (style: string | CanvasPattern, alpha = 1) => { b.globalAlpha = alpha; b.fillStyle = style; b.fill("nonzero"); b.globalAlpha = 1; };
  const texture = (kind: Parameters<typeof groundTexture>[0], tone: Tone) => b.createPattern(groundTexture(kind, tone), "repeat")!;
  const x0 = low.col * size, y0 = low.row * size, w = (high.col - low.col + 1) * size, h = (high.row - low.row + 1) * size;

  // Ground: dirt under everything, then rough, sand and grass in patches, each over a fringe a step darker and a faint
  // ink line (see @@@ground-materials).
  b.fillStyle = texture("dirt", GROUND.dirt); b.fillRect(x0, y0, w, h);
  for (const material of GROUND_LAYERS) {
    const cells = collect((col, row) => !wet(col, row) && at(col, row) !== "m" && groundMaterial(terrain, col, row) === material);
    if (!cells.length) continue;
    patch(b, cells, size, 2.4, 40); fill(INK, .28);
    patch(b, cells, size, 1.4, 40); fill(GROUND[material].dark, .85);
    patch(b, cells, size, 0, 40); fill(texture(material, GROUND[material]));
  }
  // Mud: a dark wet patch, puddles in it.
  const mud = collect((col, row) => at(col, row) === "m");
  if (mud.length) {
    patch(b, mud, size, 1.5, 60); fill(MUD.dark);
    patch(b, mud, size, 0, 60); fill(texture("mud", MUD));
    for (const [col, row] of mud) if (cellJitter(col, row, 61) < .35) { b.beginPath(); b.ellipse((col + cellJitter(col, row, 62)) * size, (row + cellJitter(col, row, 63)) * size, 7, 3.5, 0, 0, Math.PI * 2); fill(SHALLOWS, .8); }
  }
  // Plateau tops a shade lighter, ramps lighter still; painted as one patch each, never cell by cell (cells overlapping
  // at their edges once drew the plateaus as a grid).
  for (const [ramp, alpha] of [[false, .16], [true, .1]] as const) {
    const cells = collect((col, row) => (ramp ? level(col, row) === "2" : level(col, row) === "1") && !wet(col, row) && at(col, row) !== "#" && at(col, row) !== "T");
    if (cells.length) { patch(b, cells, size, 0, ramp ? 105 : 100); fill(GROUND.dirt.light, alpha); }
  }

  // The coast in drawn bands over one continuous seabed (see @@@shore-bands): beach, ink line, foam, water.
  if (waterField(terrain).hasWater) {
    const band = (threshold: number, style: string | CanvasPattern, alpha = 1) => {
      const layer = createScratchCanvas(CHUNK * density, CHUNK * density), l = layer.getContext("2d")!;
      l.setTransform(b.getTransform());
      l.imageSmoothingEnabled = true;
      l.drawImage(shoreMask(terrain, threshold), 0, 0, terrain.cols * size, terrain.rows * size);
      l.globalCompositeOperation = "source-in"; l.fillStyle = style; l.fillRect(x0, y0, w, h);
      b.save(); b.setTransform(1, 0, 0, 1, 0, 0); b.globalAlpha = alpha; b.drawImage(layer, 0, 0); b.restore();
    };
    band(.06, GROUND.sand.dark, .9);
    band(.09, texture("sand", GROUND.sand));
    band(.33, INK, .3);
    band(.35, FOAM, .95);
    b.imageSmoothingEnabled = true;
    b.drawImage(waterCover(terrain), 0, 0, terrain.cols * size, terrain.rows * size);
    waterMask = createScratchCanvas(CHUNK / 2, CHUNK / 2);
    const mask = waterMask.getContext('2d')!;
    mask.scale(.5, .5); mask.translate(-cx * CHUNK, -cy * CHUNK);
    mask.drawImage(waterLightMask(terrain), 0, 0, terrain.cols * size, terrain.rows * size);
  }

  // A bridge: planks laid across the way it carries (the way runs where its neighbours are dry).
  for (const [col, row] of collect((col, row) => at(col, row) === "=")) {
    const x = (col + .5) * size, y = (row + .5) * size;
    let wayX = 0, wayY = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      if (wet(col + dx, row + dy)) continue;
      // Folded onto one half, so the neighbours either end of the way add up instead of cancelling.
      const flip = dx < 0 || (dx === 0 && dy < 0) ? -1 : 1;
      wayX += dx * flip; wayY += dy * flip;
    }
    const length = Math.hypot(wayX, wayY) || 1, ux = wayX / length, uy = wayY / length, half = size * .56;
    polygon(b, [[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]], DECK, INK, 1);
    for (const offset of [-.33, 0, .33]) {
      const px = x + ux * offset * size, py = y + uy * offset * size;
      line(b, [[px - uy * half, py + ux * half], [px + uy * half, py - ux * half]], DECK_INK, 1);
    }
  }

  // Rock (see docs/art-direction-variants.zh.md, rule 7): a cliff face below each rock cell whose southern neighbour is
  // not rock, its contact shadow, then boulders with a lit top, a dark side and an ink line.
  const rock = collect((col, row) => at(col, row) === "#");
  if (rock.length) {
    const faces = rock.filter(([col, row]) => at(col, row + 1) !== "#");
    patch(b, faces, size, 1, 110, 0, size * .55); fill(CLIFF.dark);
    patch(b, faces, size, -1, 110, 0, size * .45); fill(CLIFF.base);
    for (const [col, row] of faces) for (let i = 0; i < 3; i++) {
      const x = (col + .2 + i * .3 + (cellJitter(col, row, 120 + i) - .5) * .1) * size, y = (row + .75) * size;
      line(b, [[x, y], [x - 1, y + size * .45]], CLIFF.dark, 1);
    }
    patch(b, rock, size, -5, 130, 3, 4); fill(SHADOW, .18);
    for (const [col, row] of rock) for (let k = 0; k < 2; k++) {
      if (k && cellJitter(col, row, 144) < .4) continue;
      const x = (col + .5 + (cellJitter(col, row, 141 + k * 9) - .5) * .7) * size, y = (row + .45 + (cellJitter(col, row, 142 + k * 9) - .5) * .5) * size;
      const r = size * (.3 + cellJitter(col, row, 143 + k * 9) * .2);
      const points = Array.from({ length: 6 }, (_, i) => {
        const a = i / 6 * Math.PI * 2 + (cellJitter(col, row, 150 + i + k * 20) - .5) * .7, q = r * (.75 + cellJitter(col, row, 160 + i + k * 20) * .35);
        return [x + Math.cos(a) * q, y + Math.sin(a) * q * .8];
      });
      polygon(b, points.map(([px, py]) => [px! + 1, py! + r * .45]), CLIFF.dark, "transparent", 0);
      polygon(b, points, ROCK.base, INK, 1);
      polygon(b, [points[3]!, points[4]!, points[5]!, [x, y]], ROCK.light, "transparent", 0);
    }
  }

  // Forest (rules 5 and 6): a dark floor, then trees from the back row forward. Trees on a wood's edge stand bigger and
  // lighter; inside they crowd darker. Pines and broadleaves mix, pines more where the ground is colder.
  const forest = collect((col, row) => at(col, row) === "T");
  if (forest.length) {
    patch(b, forest, size, 5, 170); fill(FOREST_FLOOR_DARK, .55);
    patch(b, forest, size, 2, 170); fill(texture("floor", FOREST_FLOOR));
    const edge = (col: number, row: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(col + dx!, row + dy!) !== "T");
    const field = terrain.ecology ? environmentField(terrain) : undefined;
    for (const [col, row] of forest) {
      const cold = field ? Math.max(0, Math.min(1, (20 - sampleEnvironment(field, (col + .5) * size, (row + .5) * size).temperatureC) / 12)) : .55;
      const rim = edge(col, row);
      for (let k = 0; k < (rim ? 1 : 2); k++) {
        const x = (col + .5 + (cellJitter(col, row, 181 + k) - .5) * .7) * size, y = (row + .65 + (cellJitter(col, row, 183 + k) - .5) * .5) * size;
        drawAtlasTree(b, x, y, (rim ? 1.05 : .82) * (.85 + cellJitter(col, row, 185 + k) * .3), col + row, cellJitter(col, row, 187 + k) < .25 + cold * .5 ? "pine" : "broadleaf", rim);
      }
    }
  }

  // Small things on open ground (rule 4): grass tufts and stones on no more than one cell in eight, all low.
  for (const [col, row] of collect((col, row) => at(col, row) === "." && level(col, row) !== "2")) {
    const pick = cellJitter(col, row, 200);
    if (pick > .12) continue;
    const x = (col + cellJitter(col, row, 201)) * size, y = (row + cellJitter(col, row, 202)) * size;
    if (pick < .04) {
      ellipse(b, x + 1, y + 1.5, 3.4, 2.2, ROCK.dark);
      ellipse(b, x, y, 3.2, 2, ROCK.light, INK);
    } else for (const dx of [-3, -1, 1, 3]) line(b, [[x + dx, y], [x + dx * 1.5, y - 5 - Math.abs(dx)]], GROUND.grass.dark, 1);
  }
  return { ground: canvas, ...(waterMask ? { water: waterMask } : {}) };
}

type Cells = [number, number][];
// A union of jittered discs over the cells: an organic patch whose edge wanders like a drawn line, the same in every
// chunk (the jitter is per cell, not per chunk).
function patch(b: Brush, cells: Cells, size: number, grow: number, salt: number, dx = 0, dy = 0) {
  b.beginPath();
  for (const [col, row] of cells) for (let k = 0; k < 3; k++) {
    const x = (col + .5 + (cellJitter(col, row, salt + k) - .5) * .55) * size + dx, y = (row + .5 + (cellJitter(col, row, salt + 7 + k) - .5) * .55) * size + dy;
    const r = size * (.5 + cellJitter(col, row, salt + 13 + k) * .2) + grow;
    if (r <= 0) continue;
    b.moveTo(x + r, y); b.arc(x, y, r, 0, Math.PI * 2);
  }
}

function brushZoom(c: Brush) {
  const transform = c.getTransform();
  return Math.hypot(transform.a, transform.b);
}
