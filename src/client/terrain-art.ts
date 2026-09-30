import { type Brush, type Point, ellipse, line, polygon } from "./art/kit";
import { createScratchCanvas } from "./art/scratch-canvas";
import { drawAtlasTree } from "./atlas-art";
import type { Terrain } from "../shared/terrain";

// @@@terrain-art - The ground a unit cannot cross (see @@@terrain), painted in the atlas's ink over its paper: forest as
// tree crowns packed on a dark floor, rock as inked stones with a shaded face where a plateau drops away, deep water as
// a wash inside a sandy shore, a plateau a shade lighter than the ground below with steps on its ramp. The map is painted
// in square chunks once (a few hundred trees each) and kept, so a frame only lays down the chunks in view.

const CHUNK = 512;
const MAX_CHUNKS = 48;
const FOREST_FLOOR = "#6f8a67";
const FOREST_EDGE = "#56705a";
const ROCK = "#b3b097";
const ROCK_LIGHT = "#cfcbb0";
const ROCK_INK = "#7d8570";
const CLIFF_FACE = "#8e8a72";
const SHORE = "#d9cda4";
const WATER = "#8db4ad";
const WATER_DEEP = "#7aa39f";
const PLATEAU = "#f4efd9";
const RAMP = "#e6dcc0";

type Cache = { chunks: Map<string, HTMLCanvasElement>; minimap?: HTMLCanvasElement };
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
export function drawTerrain(c: Brush, terrain: Terrain, camera: Point, width: number, height: number) {
  const cache = cacheFor(terrain);
  const density = Math.max(1, Math.min(2, Math.ceil(brushZoom(c) - 0.05)));
  const worldWidth = terrain.cols * terrain.cell;
  const worldHeight = terrain.rows * terrain.cell;
  const first = { x: Math.max(0, Math.floor(camera.x / CHUNK)), y: Math.max(0, Math.floor(camera.y / CHUNK)) };
  const last = { x: Math.min(Math.ceil(worldWidth / CHUNK) - 1, Math.floor((camera.x + width) / CHUNK)), y: Math.min(Math.ceil(worldHeight / CHUNK) - 1, Math.floor((camera.y + height) / CHUNK)) };
  for (let cy = first.y; cy <= last.y; cy += 1) {
    for (let cx = first.x; cx <= last.x; cx += 1) {
      const key = `${cx},${cy},${density}`;
      let chunk = cache.chunks.get(key);
      if (chunk) {
        cache.chunks.delete(key);
      } else {
        chunk = paintChunk(terrain, cx, cy, density);
        if (cache.chunks.size >= MAX_CHUNKS) cache.chunks.delete(cache.chunks.keys().next().value!);
      }
      cache.chunks.set(key, chunk);
      c.drawImage(chunk, cx * CHUNK - camera.x, cy * CHUNK - camera.y, CHUNK, CHUNK);
    }
  }
}

/** The terrain at one pixel a cell, for the minimap: walkable ground left clear, the rest in its colour. */
export function terrainMinimap(terrain: Terrain): HTMLCanvasElement {
  const cache = cacheFor(terrain);
  if (cache.minimap) return cache.minimap;
  const canvas = createScratchCanvas(terrain.cols, terrain.rows);
  const b = canvas.getContext("2d")!;
  for (let row = 0; row < terrain.rows; row += 1) {
    let start = 0;
    for (let col = 1; col <= terrain.cols; col += 1) {
      const kind = terrain.cells[row * terrain.cols + start];
      const next = col < terrain.cols ? terrain.cells[row * terrain.cols + col] : undefined;
      const level = terrain.levels?.[row * terrain.cols + start];
      const nextLevel = col < terrain.cols ? terrain.levels?.[row * terrain.cols + col] : undefined;
      if (next === kind && nextLevel === level) continue;
      const color = kind === "T" ? "#4d6b50" : kind === "#" ? "#8b8a74" : kind === "~" ? "#6f9c9a" : kind === "," ? "#a9c6bd" : level === "1" ? "#ece6c9" : undefined;
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

function paintChunk(terrain: Terrain, cx: number, cy: number, density: number): HTMLCanvasElement {
  const canvas = createScratchCanvas(CHUNK * density, CHUNK * density);
  const b = canvas.getContext("2d")!;
  b.scale(density, density);
  b.translate(-cx * CHUNK, -cy * CHUNK);
  b.lineJoin = b.lineCap = "round";
  const size = terrain.cell;
  const margin = 3;
  const low = { col: Math.max(0, Math.floor((cx * CHUNK) / size) - margin), row: Math.max(0, Math.floor((cy * CHUNK) / size) - margin) };
  const high = { col: Math.min(terrain.cols - 1, Math.floor(((cx + 1) * CHUNK) / size) + margin), row: Math.min(terrain.rows - 1, Math.floor(((cy + 1) * CHUNK) / size) + margin) };
  const kindAt = (col: number, row: number) => (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows ? "T" : terrain.cells[row * terrain.cols + col]!);
  const levelAt = (col: number, row: number) => (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows ? "0" : terrain.levels?.[row * terrain.cols + col] ?? "0");
  const walkable = (col: number, row: number) => {
    const kind = kindAt(col, row);
    return kind === "." || kind === ",";
  };
  const cells = (visit: (col: number, row: number, x: number, y: number) => void) => {
    for (let row = low.row; row <= high.row; row += 1) for (let col = low.col; col <= high.col; col += 1) visit(col, row, (col + 0.5) * size, (row + 0.5) * size);
  };

  // Plateaus: a lighter ground flecked with grass, the ramp paved, and steps where the ramp meets the plateau.
  cells((col, row, x, y) => {
    if (!walkable(col, row) || levelAt(col, row) === "0") return;
    b.fillStyle = levelAt(col, row) === "2" ? RAMP : PLATEAU;
    b.fillRect(col * size - 1, row * size - 1, size + 2, size + 2);
    if (levelAt(col, row) === "1" && jitter(col, row, 5) < 0.35) line(b, [[x - 3, y + 2], [x - 1, y - 3], [x + 1, y + 2], [x + 3, y - 2]], "#a9b58a66", 0.9);
    if (levelAt(col, row) === "2") line(b, [[x - size * 0.4, y - size * 0.2], [x + size * 0.4, y - size * 0.2]], "#b8a98266", 1);
  });
  cells((col, row, x, y) => {
    if (!walkable(col, row) || levelAt(col, row) !== "1") return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!walkable(col + dx, row + dy) || levelAt(col + dx, row + dy) === "1") continue;
      // A step, drawn across the way down.
      const ex = x + dx * size * 0.5;
      const ey = y + dy * size * 0.5;
      for (const offset of [-0.3, 0, 0.3]) line(b, [[ex - dy * size * 0.45 + dx * offset * size, ey - dx * size * 0.45 + dy * offset * size], [ex + dy * size * 0.45 + dx * offset * size, ey + dx * size * 0.45 + dy * offset * size]], "#a99d7a88", 1.2);
    }
  });

  // Water: a sandy shore, the wash, a few ripples.
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "~") return;
    ellipse(b, x, y, size * 0.95, size * 0.95, SHORE);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "~") return;
    ellipse(b, x, y, size * 0.78, size * 0.78, WATER);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "~") return;
    const deep = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => kindAt(col + dx!, row + dy!) === "~");
    if (deep) ellipse(b, x, y, size * 0.62, size * 0.62, WATER_DEEP);
    if (jitter(col, row, 3) < 0.28) line(b, [[x - 7, y], [x - 2, y - 2], [x + 3, y], [x + 8, y - 2]], "#e3ead899", 1);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== ",") return;
    ellipse(b, x, y, size * 0.7, size * 0.7, "#b9d0c299");
  });

  // Rock: stones, with a shaded face on the side a plateau drops away (and on the south side of any outcrop).
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "#") return;
    const faces = walkable(col, row + 1) && levelAt(col, row + 1) !== "1";
    if (faces) polygon(b, [[x - size * 0.62, y], [x + size * 0.62, y], [x + size * 0.55, y + size * 0.72], [x - size * 0.58, y + size * 0.7]], CLIFF_FACE, ROCK_INK, 1);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "#") return;
    const j = (salt: number) => (jitter(col, row, salt) - 0.5) * size * 0.3;
    const r = size * 0.62;
    polygon(b, [[x - r + j(1), y - r * 0.7 + j(2)], [x - r * 0.2 + j(3), y - r + j(4)], [x + r + j(5), y - r * 0.55 + j(6)], [x + r * 0.9 + j(7), y + r * 0.6 + j(8)], [x - r * 0.4 + j(9), y + r * 0.75 + j(10)], [x - r * 1.05 + j(11), y + r * 0.2 + j(12)]], ROCK, ROCK_INK, 1);
    polygon(b, [[x - r * 0.8, y - r * 0.5], [x - r * 0.15, y - r * 0.85], [x + r * 0.1, y - r * 0.1], [x - r * 0.5, y + r * 0.1]], ROCK_LIGHT, "transparent", 0);
  });

  // Forest: a dark floor under the trees so it reads as one mass, then the trees back to front.
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "T") return;
    ellipse(b, x, y, size * 0.9, size * 0.9, FOREST_EDGE);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "T") return;
    ellipse(b, x, y, size * 0.72, size * 0.72, FOREST_FLOOR);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "T") return;
    // Deep inside a forest one tree a cell; at its edge the trees stand a little apart.
    const tx = x + (jitter(col, row, 21) - 0.5) * size * 0.5;
    const ty = y + (jitter(col, row, 22) - 0.5) * size * 0.45 + size * 0.35;
    drawAtlasTree(b, tx, ty, 0.72 + jitter(col, row, 23) * 0.25, col + row);
  });
  return canvas;
}

function brushZoom(c: Brush) {
  const transform = c.getTransform();
  return Math.hypot(transform.a, transform.b);
}

// A fixed draw per cell and salt, between 0 and 1: the same trees and stones in every chunk and every frame.
function jitter(col: number, row: number, salt: number) {
  let hash = Math.imul(col, 374_761_393) ^ Math.imul(row, 668_265_263) ^ Math.imul(salt, 2_246_822_519);
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_296;
}
