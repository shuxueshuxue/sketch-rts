import { type Brush, type Point, ellipse, line, polygon } from "./art/kit";
import { createScratchCanvas } from "./art/scratch-canvas";
import { drawAtlasTree } from "./atlas-art";
import { terrainCover, paintGroundTextures } from './terrain-materials';
import type { Terrain } from "../shared/terrain";

// @@@terrain-art - The ground a unit cannot cross or crosses slowly (see @@@terrain), painted in the atlas's ink over its
// paper: forest as tree crowns packed on a dark floor, rock as inked stones with a shaded face where a plateau drops away,
// deep water as a wash inside a sandy shore, mud as a brown wash flecked darker, a bridge as planked deck over the water
// laid across its way, a plateau a shade lighter than the ground below with steps on its ramp. The map is painted in
// square chunks once (a few hundred trees each) and kept, so a frame only lays down the chunks in view.

const CHUNK = 512;
const MAX_CHUNKS = 48;
const FOREST_FLOOR = "#6e805b";
const ROCK = "#bfc0ac";
const ROCK_INK = "#989f89";
const CLIFF_FACE = "#a0a58f";
const WATER = "#91b5b7";
const PLATEAU = "#e4ddc2";
const RAMP = "#d0c4a4";
const MUD = "#958d6b";
const MUD_DARK = "#b79e74";
const DECK = "#c7a472";
const DECK_INK = "#916e44";

type Cache = { chunks: Map<string, HTMLCanvasElement>; minimap?: HTMLCanvasElement; surfaces?:HTMLCanvasElement };
const SURFACE_COLORS:Record<string,string>={g:'#7c94674a',d:'#af936445',s:'#d3bd8f60',r:'#87958650'};
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
  if (terrain.ecology) b.drawImage(terrainCover(terrain), 0, 0);
  for (let row = 0; row < terrain.rows; row += 1) {
    let start = 0;
    for (let col = 1; col <= terrain.cols; col += 1) {
      const kind = terrain.cells[row * terrain.cols + start];
      const next = col < terrain.cols ? terrain.cells[row * terrain.cols + col] : undefined;
      const level = terrain.levels?.[row * terrain.cols + start];
      const nextLevel = col < terrain.cols ? terrain.levels?.[row * terrain.cols + col] : undefined;
      if (next === kind && nextLevel === level) continue;
      const color = kind === "T" ? "#46574b" : kind === "#" ? "#939688" : kind === "~" ? "#678487" : kind === "," ? "#a9c6bd" : kind === "m" ? "#c4ad86" : kind === "=" ? "#a8835a" : !terrain.ecology && level === "1" ? "#e4ddc2" : terrain.ecology ? undefined : terrain.palette==='coastal'?'#a5ab91':undefined;
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
    return kind === "." || kind === "," || kind === "m" || kind === "=";
  };
  const wet = (col: number, row: number) => {
    const kind = kindAt(col, row);
    return kind === "~" || kind === ",";
  };
  const cells = (visit: (col: number, row: number, x: number, y: number) => void) => {
    for (let row = low.row; row <= high.row; row += 1) for (let col = low.col; col <= high.col; col += 1) visit(col, row, (col + 0.5) * size, (row + 0.5) * size);
  };
  if (terrain.ecology) {
    const cache = cacheFor(terrain);
    cache.surfaces ??= terrainCover(terrain);
    b.imageSmoothingEnabled = true;
    b.drawImage(cache.surfaces, 0, 0, terrain.cols * size, terrain.rows * size);
    paintGroundTextures(b, terrain, low, high);
  } else if (terrain.surfaces) {
    const cache = cacheFor(terrain);
    if (!cache.surfaces) {
      const cover = createScratchCanvas(terrain.cols, terrain.rows), brush = cover.getContext('2d')!;
      [...terrain.surfaces].forEach((kind, index) => { const colour = SURFACE_COLORS[kind]; if (colour) { brush.fillStyle = colour; brush.fillRect(index % terrain.cols, Math.floor(index / terrain.cols), 1, 1); } });
      cache.surfaces = cover;
    }
    b.imageSmoothingEnabled = true;
    b.drawImage(cache.surfaces, 0, 0, terrain.cols * size, terrain.rows * size);
  }
  // Plateaus: a lighter ground flecked with grass, the ramp paved, and steps where the ramp meets the plateau.
  cells((col, row, x, y) => {
    if (!walkable(col, row) || levelAt(col, row) === "0") return;
    b.fillStyle = terrain.ecology ? (levelAt(col, row) === "2" ? "#c5bda443" : "#f7e8bc12") : levelAt(col, row) === "2" ? RAMP : PLATEAU;
    b.fillRect(col * size - 1, row * size - 1, size + 2, size + 2);
    for(let i=0;i<7;i++) {
      const px=x+(jitter(col,row,110+i)-.5)*size, py=y+(jitter(col,row,130+i)-.5)*size;
      line(b,[[px,py],[px+2+jitter(col,row,140+i)*3,py-.5]],i%2?"#e4dec221":"#72785f15",.7);
    }
    if (levelAt(col, row) === "1" && jitter(col, row, 5) < 0.35) line(b, [[x - 3, y + 2], [x - 1, y - 3], [x + 1, y + 2], [x + 3, y - 2]], "#78806244", 0.65);
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

  // Marching-squares coast contours connect cell centres. The simulation grid
  // remains unchanged; diagonal shore segments avoid a staircase silhouette.
  const contours:number[][][]=[[],[[0,4,7]],[[1,5,4]],[[0,1,5,7]],[[2,6,5]],[[0,4,7],[2,6,5]],[[1,2,6,4]],[[0,1,2,6,7]],[[3,7,6]],[[0,4,6,3]],[[1,5,4],[3,7,6]],[[0,1,5,6,3]],[[2,3,7,5]],[[0,4,5,2,3]],[[4,1,2,3,7]],[[0,1,2,3]]];
  const contourLayer=(inside:(col:number,row:number)=>boolean,color:string,shore:boolean)=>{
    for(let row=low.row-1;row<=high.row;row++)for(let col=low.col-1;col<=high.col;col++){
      const mask=(inside(col,row)?1:0)|(inside(col+1,row)?2:0)|(inside(col+1,row+1)?4:0)|(inside(col,row+1)?8:0);
      if(!mask)continue;const x=(col+.5)*size,y=(row+.5)*size;
      const points=[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x+size*.5,y],[x+size,y+size*.5],[x+size*.5,y+size],[x,y+size*.5]];
      for(const shape of contours[mask]!){polygon(b,shape.map(i=>points[i]!),color,'transparent',0);
        if(shore&&mask!==15){const edge=shape.filter(i=>i>=4).map(i=>points[i]!);if(edge.length===2){line(b,edge,'#d5c69d38',10);line(b,edge,'#e8dfbd80',1.1);}}
      }
    }
  };
  contourLayer(wet,'#8eaaa5',true);
  contourLayer((col,row)=>kindAt(col,row)==='~','#486773',false);
  cells((col,row,x,y)=>{
    if(!wet(col,row)||jitter(col,row,3)>.18)return;
    const px=x+(jitter(col,row,7)-.5)*size*.5,py=y+(jitter(col,row,8)-.5)*size*.5;
    line(b,[[px-9,py],[px,py-1],[px+8,py]],'#c4d7d33d',.7);
  });

  // Marshes form connected contours; individual cells must not leave circular stamps.
  contourLayer((col, row) => kindAt(col, row) === 'm', MUD, false);
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "m") return;
    for (let fleck = 0; fleck < 3; fleck += 1) {
      if (jitter(col, row, 30 + fleck) < 0.4) continue;
      ellipse(b, x + (jitter(col, row, 40 + fleck) - 0.5) * size * 0.8, y + (jitter(col, row, 50 + fleck) - 0.5) * size * 0.8, size * 0.14, size * 0.08, MUD_DARK);
    }
  });

  // A bridge: water under it, then its deck, the planks laid across the way it carries (the way runs where its neighbours
  // are dry, not over the water either side).
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "=") return;
    ellipse(b, x, y, size * 0.8, size * 0.8, WATER);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "=") return;
    let wayX = 0;
    let wayY = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      if (wet(col + dx, row + dy)) continue;
      // Folded onto one half, so the neighbours either end of the way add up instead of cancelling.
      const flip = dx < 0 || (dx === 0 && dy < 0) ? -1 : 1;
      wayX += dx * flip;
      wayY += dy * flip;
    }
    const length = Math.hypot(wayX, wayY) || 1;
    const ux = wayX / length;
    const uy = wayY / length;
    const half = size * 0.56;
    polygon(b, [[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]], DECK, "transparent", 0);
    for (const offset of [-0.33, 0, 0.33]) {
      const cx = x + ux * offset * size;
      const cy = y + uy * offset * size;
      line(b, [[cx - uy * half, cy + ux * half], [cx + uy * half, cy - ux * half]], DECK_INK, 1);
    }
  });

  // Rock: stones, with a shaded face on the side a plateau drops away (and on the south side of any outcrop).
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "#") return;
    const faces = walkable(col, row + 1) && levelAt(col, row + 1) !== "1";
    if (faces) polygon(b, [[x - size * 0.62, y], [x + size * 0.62, y], [x + size * 0.55, y + size * 0.72], [x - size * 0.58, y + size * 0.7]], CLIFF_FACE, ROCK_INK, 1);
  });
  cells((col, row, x, y) => {
    if (kindAt(col, row) !== "#") return;
    const r = size * .52;
    const exposed = walkable(col,row+1);
    b.fillStyle=ROCK;b.fillRect(x-size*.51,y-size*.51,size*1.02,size*1.02);
    const h=3+jitter(col,row,1)*4;
    const skew=(jitter(col,row,9)-.5)*r;
    if(jitter(col,row,2)<.6) polygon(b, [[x-r*.8,y-r*.8],[x+skew,y-r-h],[x+r*.7,y+skew],[x+skew,y+r*.4]], "#b3b19f55", "transparent", 0);
    if(exposed) {
      polygon(b,[[x-r,y+r*.25],[x-r*.4,y+r*.7],[x+r*.9,y+r*.35],[x+r*.85,y+r*.7+8],[x-r*.3,y+r+8],[x-r,y+r*.7]],CLIFF_FACE,ROCK_INK,.55);
      line(b,[[x-r*.3,y+r*.65],[x-r*.25,y+r+6]],"#626d6266",.8);
    }
    if(jitter(col,row,7)<.55) line(b,[[x-r*.8,y-r*.7],[x-r*.3,y-r*.1],[x+r*.3,y+r*.15]],"#777f714d",.6);
    for(let i=0;i<5;i++){
      const px=x+(jitter(col,row,80+i)-.5)*size,py=y+(jitter(col,row,90+i)-.5)*size;
      line(b,[[px,py],[px+2,py-.6]],i%2?"#efe4c533":"#72786626",.6);
    }
  });

  // Connected woodland floor, with a forest edge rather than overlapping circular stamps.
  contourLayer((col, row) => kindAt(col, row) === 'T', FOREST_FLOOR, false);
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
