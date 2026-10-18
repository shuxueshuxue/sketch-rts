import { type Brush, polygon } from "./art/kit";
import { paintTree, type TreeKind } from "./art/environment";
import { cellJitter } from "./terrain-materials";
import { createScratchCanvas } from "./art/scratch-canvas";
import type { Terrain } from "../shared/terrain";
import { environmentField, sampleEnvironment } from "../shared/environment/fields";

// @@@standing-terrain - The terrain's standing objects (see docs/art/render-contract.zh.md): the forest's trees and the
// rock fields' boulders, each with its foot (the point where it meets the ground) and a look shared by every object
// painted alike. They are no part of the painted ground (see @@@terrain-art), which keeps only what lies flat: standing
// up, they hide what stands behind them and are hidden by what stands before, in
// the 3D world as cards (see @@@standing-field) and in the Canvas world in its depth-sorted pass (see standingDepth).
export type StandingTerrainObject = { x: number; y: number; scale: number; look: string };

const INK = "#293c35";
const ROCK = { base: "#bdb6a0", dark: "#8c856f", light: "#dcd5bd" };
// A boulder's look is one of these shapes, scaled to its size: every boulder its own would be a picture each.
export const STONE_SHAPES = 16;
// The radius a stone look is painted at; a boulder's scale is its radius over this.
export const STONE_RADIUS = 24;

const objects = new WeakMap<Terrain, StandingTerrainObject[]>();

/** The terrain's trees and boulders, in no particular order. */
export function standingTerrain(terrain: Terrain): StandingTerrainObject[] {
  let found = objects.get(terrain);
  if (!found) objects.set(terrain, found = [...trees(terrain), ...stones(terrain)]);
  return found;
}

const at = (terrain: Terrain, col: number, row: number) => terrain.cells[Math.max(0, Math.min(terrain.rows - 1, row)) * terrain.cols + Math.max(0, Math.min(terrain.cols - 1, col))]!;

// Forest (rules 5 and 6 of @@@terrain-art): trees on a wood's edge stand bigger and lighter; inside they crowd darker,
// two a cell. Pines and broadleaves mix, pines more where the ground is colder.
function trees(terrain: Terrain): StandingTerrainObject[] {
  const size = terrain.cell, out: StandingTerrainObject[] = [];
  const field = terrain.ecology ? environmentField(terrain) : undefined;
  for (let row = 0; row < terrain.rows; row++) for (let col = 0; col < terrain.cols; col++) {
    if (at(terrain, col, row) !== "T") continue;
    const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(terrain, col + dx!, row + dy!) !== "T");
    const cold = field ? Math.max(0, Math.min(1, (20 - sampleEnvironment(field, (col + .5) * size, (row + .5) * size).temperatureC) / 12)) : .55;
    for (let k = 0; k < (rim ? 1 : 2); k++) {
      const kind: TreeKind = cellJitter(col, row, 187 + k) < .25 + cold * .5 ? "pine" : "broadleaf";
      out.push({
        x: (col + .5 + (cellJitter(col, row, 181 + k) - .5) * .7) * size, y: (row + .65 + (cellJitter(col, row, 183 + k) - .5) * .5) * size,
        scale: (rim ? 1.05 : .82) * (.85 + cellJitter(col, row, 185 + k) * .3),
        look: `tree:${kind}:${rim}:${(col + row) % 3}`,
      });
    }
  }
  return out;
}

// Rock fields: a boulder or two a cell at the rim; inside, a few big crags strewn across cell lines.
function stones(terrain: Terrain): StandingTerrainObject[] {
  const size = terrain.cell, out: StandingTerrainObject[] = [];
  const rock = (col: number, row: number) => at(terrain, col, row) === "#";
  const deep = (col: number, row: number) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => rock(col + dx, row + dy)));
  const stone = (x: number, y: number, r: number, seed: number) => out.push({ x, y, scale: r / STONE_RADIUS, look: `stone:${seed % STONE_SHAPES}` });
  for (let row = 0; row < terrain.rows; row++) for (let col = 0; col < terrain.cols; col++) {
    if (!rock(col, row)) continue;
    if (deep(col, row)) {
      if (cellJitter(col, row, 146) > .55) continue;
      stone((col + .5 + (cellJitter(col, row, 147) - .5) * 1.6) * size, (row + .5 + (cellJitter(col, row, 148) - .5) * 1.6) * size,
        size * (.55 + cellJitter(col, row, 149) * .35), col * 131 + row);
      continue;
    }
    for (let k = 0; k < 2; k++) {
      if (k && cellJitter(col, row, 144) < .4) continue;
      stone((col + .5 + (cellJitter(col, row, 141 + k * 9) - .5) * .7) * size, (row + .45 + (cellJitter(col, row, 142 + k * 9) - .5) * .5) * size,
        size * (.3 + cellJitter(col, row, 143 + k * 9) * .2), col * 131 + row + k * 7);
    }
  }
  return out;
}

// A stone of the given shape, its centre at the origin, at STONE_RADIUS: a lit face over a dark side, one ink line.
function stonePoints(shape: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = i / 6 * Math.PI * 2 + (cellJitter(shape, i, 150) - .5) * .7, q = STONE_RADIUS * (.75 + cellJitter(shape, i, 160) * .35);
    return [Math.cos(a) * q, Math.sin(a) * q * .8];
  });
}

/** Paints a look standing on the origin (its foot), at scale one, without a painted shadow (the sun casts its shadow). */
export function paintStandingLook(b: Brush, look: string) {
  const [kind, a, b2, c] = look.split(":");
  if (kind === "tree") { paintTree(b, 0, 0, 1, Number(c), a as TreeKind, b2 === "true", "body"); return; }
  const points = stonePoints(Number(a));
  polygon(b, points, ROCK.base, INK, 1);
  polygon(b, [points[3]!, points[4]!, points[5]!, [0, 0]], ROCK.light, "transparent", 0);
}

/** The Canvas world's drawing order for whatever stands (see the render contract's third rule): back to front by the
 * depth of each one's foot, its world y unless `depth` says otherwise (a troop on a tower's top), ties by x. */
export function byFoot<T extends { x: number; y: number }>(items: T[], depth: (item: T) => number = item => item.y) {
  return items.sort((a, b) => depth(a) - depth(b) || a.x - b.x);
}

// A look's picture: painted once at LOOK_DENSITY pixels a world unit in a LOOK_WIDTH × LOOK_HEIGHT tile, its foot at
// LOOK_FOOT. The Canvas world stamps it; the 3D world uploads it as a card (see @@@standing-field).
export const LOOK_WIDTH = 160, LOOK_HEIGHT = 192, LOOK_DENSITY = 2;
export const LOOK_FOOT = { x: 80, y: 140 };
const lookCanvases = new Map<string, HTMLCanvasElement>();
export function standingLookCanvas(look: string): HTMLCanvasElement {
  let canvas = lookCanvases.get(look);
  if (!canvas) {
    canvas = createScratchCanvas(LOOK_WIDTH, LOOK_HEIGHT);
    const b = canvas.getContext("2d")!;
    b.translate(LOOK_FOOT.x, LOOK_FOOT.y); b.scale(LOOK_DENSITY, LOOK_DENSITY); b.lineJoin = b.lineCap = "round";
    paintStandingLook(b, look);
    lookCanvases.set(look, canvas);
  }
  return canvas;
}

/** Stamps an object in the Canvas world with its foot on `point` (screen units, the brush already zoomed). */
export function drawStandingObject(b: CanvasRenderingContext2D, object: StandingTerrainObject, point: { x: number; y: number }) {
  const k = object.scale / LOOK_DENSITY;
  b.drawImage(standingLookCanvas(object.look), point.x - LOOK_FOOT.x * k, point.y - LOOK_FOOT.y * k, LOOK_WIDTH * k, LOOK_HEIGHT * k);
}
