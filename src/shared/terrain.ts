import { recordNativeRouting } from './navigation-audit';
import type { GameMap } from "./types";

// @@@terrain - Ground that a unit cannot cross, or crosses slowly, as on a Warcraft III map: forest, rock (cliffs and
// outcrops) and deep water, shallows and mud, on a grid of square cells laid over the map. A unit is a point to the
// terrain: it stands on a walkable cell, walks round what blocks it, and is never pushed into it (see sim moveToward). A
// map without terrain is open everywhere, as every map was before, and plays exactly as it did.
// - cells: one character a cell, row by row from the top-left (what each is to whoever crosses it: see CELL_GROUND):
//   "." ground; "," shallow water (a ford, a beach, a flooded valley floor); "m" mud (a bog, a marsh, a snowdrift: how it
//   looks is the map's theme's); "=" a bridge, ground laid over water; "T" forest; "#" rock; "~" deep water.
// - levels: every cell's ground: "0" low ground, "1" a plateau (a main above its natural, a temple's or a hill's top, a
//   cliff at its rim), "2" a ramp up to it. Drawn for the eye; and no building stands on a ramp (see isFootprintBuildable).
export type Terrain = {
  cell: number;
  cols: number;
  rows: number;
  cells: string;
  levels?: string;
  /** g grass, d earth, s sand, r gravel; visual cover only. */
  surfaces?: string;
  palette?: 'coastal';
  /** Reproducible environment recipe. Runtime float fields stay out of savegames/network snapshots. */
  ecology?: { version: 1; seed: string; seaOutlet?: { x: number; y: number } };
};

export type TerrainCellKind = "ground" | "shallow" | "mud" | "bridge" | "forest" | "rock" | "water";

// @@@terrain-ground - What a cell is to whoever crosses it: whether a land unit walks it and a ship sails it (see
// @@@terrain-movers), the share of its full pace a land unit keeps on it (a ship sails at its full pace wherever it
// sails), and how many times bare ground's PUSH_FRICTION brakes a slide on it (a shove, a charge, a lunge: see @@@push).
// Water drags and mud drags harder, so a charge through a ford or a bog stops short; a bridge is ground a ship cannot pass
// under. A character not listed is ground.
export const CELL_GROUND: Readonly<Record<string, { land: boolean; sea: boolean; pace: number; drag: number }>> = {
  ".": { land: true, sea: false, pace: 1, drag: 1 },
  ",": { land: true, sea: true, pace: 0.75, drag: 1.6 },
  m: { land: true, sea: false, pace: 0.6, drag: 2 },
  "=": { land: true, sea: false, pace: 1, drag: 1 },
  T: { land: false, sea: false, pace: 0, drag: 1 },
  "#": { land: false, sea: false, pace: 0, drag: 1 },
  "~": { land: false, sea: true, pace: 0, drag: 1 },
};

// @@@terrain-movers - Who crosses a cell: a land unit walks ground and shallow water, a ship sails deep and shallow water
// (see @@@naval). The shallows are both's, as on a Warcraft III coast: a ship that comes in to the beach is in the reach of
// soldiers who wade out to it, and out on deep water it is not. Every query below takes the mover (land when not said) and
// works on that mover's own runtime: the sea's is built the first time a ship asks, so a game without ships never builds
// it.
export type Mover = "land" | "sea";

type Point = { x: number; y: number };

const PASSABLE: Record<Mover, ReadonlySet<string>> = {
  land: new Set(Object.keys(CELL_GROUND).filter((char) => CELL_GROUND[char]!.land)),
  sea: new Set(Object.keys(CELL_GROUND).filter((char) => CELL_GROUND[char]!.sea)),
};
const UNREACHED = 0x3fffffff;
const UNKNOWN = -2;
// Orthogonal and diagonal steps of the flow fields, in fifths of a cell (7/5 for the square root of two).
const STRAIGHT = 5;
const DIAGONAL = 7;
// @@@terrain-steering - A walk that cannot see its goal follows a flow field down to it: it looks this many cells along
// the flow and heads for that cell if it sees it (one sight line, not one a cell), else for the cell a few steps along.
const LOOKAHEAD = 16;
const SHORT_LOOK = 3;
// Fields kept per terrain for the AIs' walking distances and routes; the least recently used goes first and its arrays
// serve the next one.
const FIELD_CACHE = 128;
// 8K local 30x30 fields cap their typed arrays at about 56 MiB per routing layer.
// Evict one old goal, never flush every soldier's route at once.
const GOAL_FIELD_CACHE = 8192;
// The flow tiles' squares (see @@@flow-tiles), and the regions one square may hold (a square split by a cliff or a wall).
const SECTOR = 10;
const MAX_REGIONS = 64;
// A cell's cost to cross in quarters of bare ground's (round(4 / pace): a shallow 5, mud 7), and the buckets of the tiles'
// growing, more than the dearest step (a diagonal into mud, 7 × 7).
const GROUND_WEIGHT = 4;
const BUCKETS = 64;
// Cells round a goal a building covers that a walk to it may end on (see goalSeeds).
const GOAL_REACH = 3;

export function terrainCellKind(char: string | undefined): TerrainCellKind {
  if (char === ",") return "shallow";
  if (char === "m") return "mud";
  if (char === "=") return "bridge";
  if (char === "T") return "forest";
  if (char === "#") return "rock";
  if (char === "~") return "water";
  return "ground";
}

export function isWalkableChar(char: string | undefined) {
  return char !== undefined && PASSABLE.land.has(char);
}

// Whether a unit may stand at the point: always on a map without terrain; on one with terrain, on a cell of its mover's
// inside the map.
export function isWalkable(map: Pick<GameMap, "terrain">, x: number, y: number, mover: Mover = "land") {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = runtime(terrain, mover);
  return state.walk[padAt(state, x, y)] === 1;
}

// Whether a unit's center may be at the point: on its mover's ground and, for a land unit, on no building's footprint
// (see @@@building-footprint). The sim keeps every unit on open ground as it keeps it out of a wood.
export function isOpenGround(map: Pick<GameMap, "terrain">, x: number, y: number, mover: Mover = "land") {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = routing(map, terrain, mover);
  return state.walk[padAt(state, x, y)] === 1;
}

// Where a unit's step from `from` toward `to` ends: there when it is open ground (see isOpenGround), else as far along one
// axis as is, sliding along the wall, else where it stands. A unit a footprint has come down on (a site laid where it
// stood) steps the same way across its mover's ground, footprints aside, so it can walk out; a unit standing on no
// ground of its mover at all (only a seeded scenario puts it there) steps anywhere (see @@@terrain-walk). Walking,
// parting and slides all step so: parted all at once or not at all, a unit by a wall never gave way to a friend walking
// down a passage one cell wide, and the friend stood behind it for good. A unit under a fresh foundation used to step
// anywhere too, and a crowd parting by a wood pushed a summoner into the trees, where nothing ever moved it again.
export function openStep(map: Pick<GameMap, "terrain">, from: Point, to: Point, mover: Mover = "land"): Point {
  const stands = isOpenGround(map, from.x, from.y, mover) ? isOpenGround : isWalkable(map, from.x, from.y, mover) ? isWalkable : undefined;
  if (!stands || stands(map, to.x, to.y, mover)) return to;
  if (stands(map, to.x, from.y, mover)) return { x: to.x, y: from.y };
  if (stands(map, from.x, to.y, mover)) return { x: from.x, y: to.y };
  return { x: from.x, y: from.y };
}

// The center of the open cell nearest the point's, for a unit a footprint has come down on; undefined on a map without
// terrain or with no open cell.
export function openGroundNear(map: Pick<GameMap, "terrain">, point: Point, mover: Mover = "land"): Point | undefined {
  const terrain = map.terrain;
  if (!terrain) return undefined;
  const state = routing(map, terrain, mover);
  const at = padAt(state, point.x, point.y);
  const near = at < 0 ? -1 : nearestWalkable(state, at);
  return near < 0 ? undefined : centerOf(state, near);
}

// The ground under a point as it slows whoever crosses it (see @@@terrain-ground): a land unit keeps `pace` of its speed
// there and a slide brakes `drag` times as hard; a ship sails and slides at full pace everywhere, and a map without
// terrain is bare ground.
const BARE_GROUND = { pace: 1, drag: 1 };

export function groundUnder(map: Pick<GameMap, "terrain">, x: number, y: number, mover: Mover = "land"): { pace: number; drag: number } {
  const terrain = map.terrain;
  if (!terrain || mover === "sea") return BARE_GROUND;
  const index = cellIndexAt(terrain, x, y);
  const ground = index < 0 ? undefined : CELL_GROUND[terrain.cells[index]!];
  return ground && ground.land ? ground : BARE_GROUND;
}

export function cellIndexAt(terrain: Terrain, x: number, y: number) {
  const col = Math.floor(x / terrain.cell);
  const row = Math.floor(y / terrain.cell);
  if (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows) return -1;
  return row * terrain.cols + col;
}

export function cellCenter(terrain: Terrain, index: number): Point {
  const col = index % terrain.cols;
  const row = (index - col) / terrain.cols;
  return { x: (col + 0.5) * terrain.cell, y: (row + 0.5) * terrain.cell };
}

// Whether an ordinary foundation may stand here: every footprint cell is dry, walkable and none is
// a ramp (a map without terrain has nothing to refuse). @@@ramp-unbuildable - A ramp is a main's one way out, as on a
// Warcraft III map, where ramps take no building: once buildings are bodies (see @@@building-body) a tower or a farm on
// it would shut its owner in.
export function isFootprintBuildable(map: Pick<GameMap, "terrain">, x: number, y: number, radius: number) {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = runtime(terrain, "land");
  return everyFootprintCell(terrain, x, y, radius, (at, cell) => state.walk[at] === 1 && terrain.cells[cell] !== "," && terrain.levels?.[cell] !== "2");
}

// @@@shore-footprint - Whether a shipyard of the given radius may stand at the point, on the shore: at least one cell of
// its footprint where a worker walks (ground or shallows), so it builds and repairs it from there and a soldier can strike
// it; at least one cell open water (see @@@open-water), for its ships to put out from; and no part of it in a forest, on
// rock, on a ramp (see @@@ramp-unbuildable) or off the map. Its center may stand anywhere in it, as in Warcraft III: in
// the shallows' middle or over deep water by them. Wherever the water is (a sea, a lake, a river), this is the whole
// rule: no map is told it has water. A map without terrain has none.
export function isShoreFootprint(map: Pick<GameMap, "terrain">, x: number, y: number, radius: number) {
  const terrain = map.terrain;
  if (!terrain) return false;
  const land = runtime(terrain, "land");
  const sea = runtime(terrain, "sea");
  const { labels, deep } = wholesOf(sea);
  let dry = false;
  let wet = false;
  const fits = everyFootprintCell(terrain, x, y, radius, (at, cell) => {
    if (land.walk[at] === 1) dry = true;
    if (sea.walk[at] === 1 && deep[labels[at]!]! >= OPEN_WATER) wet = true;
    return (sea.walk[at] === 1 || land.walk[at] === 1) && terrain.levels?.[cell] !== "2";
  });
  return fits && dry && wet;
}

// @@@open-water - The water a ship has room on: a whole of the sea's (see @@@ground-wholes) with at least OPEN_WATER cells
// of deep water in it, a lake's, a sea's, or a river's three cells wide and thirty long, and not a pond or a ford's
// shallows. Only on it does a shipyard stand.
export const OPEN_WATER = 64;

// Every point a shipyard of the given radius may stand at by the terrain alone (see @@@shore-footprint), one a cell at the
// cell's center, row by row: worked out once per terrain and radius. Whether a building stands there already is the
// asker's to see.
export function shoreSpots(map: Pick<GameMap, "terrain">, radius: number): readonly Point[] {
  const terrain = map.terrain;
  if (!terrain) return [];
  const sea = runtime(terrain, "sea");
  const known = (sea.shores ??= new Map()).get(radius);
  if (known) return known;
  const spots: Point[] = [];
  const { labels, deep } = wholesOf(sea);
  if (deep.some((cells) => cells >= OPEN_WATER)) {
    // A shipyard footprint is a rectangular grid query. Three summed-area
    // fields replace a nested footprint scan at every cell in the whole map.
    const land = runtime(terrain, "land"), width = terrain.cols + 1;
    const dry = new Uint32Array(width * (terrain.rows + 1));
    const wet = new Uint32Array(dry.length), blocked = new Uint32Array(dry.length);
    for (let row = 0; row < terrain.rows; row++) {
      let d = 0, w = 0, b = 0;
      for (let col = 0; col < terrain.cols; col++) {
        const cell = row * terrain.cols + col, at = (row + 1) * (terrain.cols + 2) + col + 1;
        d += land.walk[at] === 1 ? 1 : 0;
        w += sea.walk[at] === 1 && deep[labels[at]!]! >= OPEN_WATER ? 1 : 0;
        b += (land.walk[at] !== 1 && sea.walk[at] !== 1) || terrain.levels?.[cell] === "2" ? 1 : 0;
        const out = (row + 1) * width + col + 1;
        dry[out] = dry[out - width]! + d;
        wet[out] = wet[out - width]! + w;
        blocked[out] = blocked[out - width]! + b;
      }
    }
    const half = footprintHalf(radius, terrain.cell);
    const first = Math.ceil((terrain.cell / 2 - half) / terrain.cell - .5);
    const last = Math.ceil((terrain.cell / 2 + half) / terrain.cell - .5) - 1;
    const total = (field: Uint32Array, left: number, top: number, right: number, bottom: number) =>
      field[bottom * width + right]! - field[top * width + right]! - field[bottom * width + left]! + field[top * width + left]!;
    for (let index = 0; index < terrain.cols * terrain.rows; index += 1) {
      const col = index % terrain.cols, row = Math.floor(index / terrain.cols);
      const left = col + first, top = row + first, right = col + last + 1, bottom = row + last + 1;
      if (left < 0 || top < 0 || right > terrain.cols || bottom > terrain.rows) continue;
      if (!total(blocked, left, top, right, bottom) && total(dry, left, top, right, bottom) && total(wet, left, top, right, bottom))
        spots.push(cellCenter(terrain, index));
    }
  }
  sea.shores.set(radius, spots);
  return spots;
}

// @@@building-footprint - A building, a rock pile or a gate takes the cells of its footprint, as in Warcraft III: a square
// of whole cells, the fewest across that hold its round body (two for a farm or a tower, three for a hall or a barracks,
// four for a gate), the cells whose centers fall within it. Routing and walking read the same cells (see
// @@@building-pathing, isOpenGround): a unit walks round a footprint and stands outside it as it does a wood, and a gap
// between two footprints is open exactly when a cell lies between them. A building is laid on whole cells (see
// snapToFootprint); a body laid elsewhere (a generated rock pile) still takes a square of that many cells.
export function footprintHalf(radius: number, cell: number) {
  return (Math.ceil((2 * radius) / cell) * cell) / 2;
}

// Where a body of this radius stands on the grid: its center on a cell's corner when its footprint is an even number of
// cells across, on a cell's center when an odd one. A map without terrain takes the point as it is.
export function snapToFootprint(map: Pick<GameMap, "terrain">, radius: number, point: Point): Point {
  const terrain = map.terrain;
  if (!terrain) return { x: point.x, y: point.y };
  const cell = terrain.cell;
  const offset = Math.ceil((2 * radius) / cell) % 2 === 1 ? cell / 2 : 0;
  return { x: Math.round((point.x - offset) / cell) * cell + offset, y: Math.round((point.y - offset) / cell) * cell + offset };
}

// The columns and rows of the cells a footprint of this radius round the point takes: those whose centers fall within it.
export function footprintCells(cell: number, x: number, y: number, radius: number) {
  const half = footprintHalf(radius, cell);
  const first = (from: number) => Math.ceil(from / cell - 0.5);
  return { left: first(x - half), right: first(x + half) - 1, top: first(y - half), bottom: first(y + half) - 1 };
}

// How far a point stands from a body's footprint, the cells it covers (see footprintCells): 0 on or inside them. On a map
// without terrain the body is its round radius.
export function footprintGap(map: Pick<GameMap, "terrain">, point: Point, body: Point & { radius: number }) {
  if (!map.terrain) return Math.max(0, Math.hypot(point.x - body.x, point.y - body.y) - body.radius);
  const bounds = footprintBounds(map.terrain.cell, body);
  return Math.hypot(Math.max(0, bounds.left - point.x, point.x - bounds.right), Math.max(0, bounds.top - point.y, point.y - bounds.bottom));
}

// The edges of the cells a body's footprint covers (see footprintCells), in map units.
export function footprintBounds(cell: number, body: Point & { radius: number }) {
  const cells = footprintCells(cell, body.x, body.y, body.radius);
  return { left: cells.left * cell, right: (cells.right + 1) * cell, top: cells.top * cell, bottom: (cells.bottom + 1) * cell };
}

// Whether every cell of a footprint passes the test (by its padded index and its index in the terrain); a cell off the map
// never does.
function everyFootprintCell(terrain: Terrain, x: number, y: number, radius: number, passes: (at: number, cell: number) => boolean) {
  const size = terrain.cell;
  const width = terrain.cols + 2;
  const { left, right, top, bottom } = footprintCells(size, x, y, radius);
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) {
      if (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows) return false;
      if (!passes((row + 1) * width + col + 1, row * terrain.cols + col)) return false;
    }
  }
  return true;
}

// The point a unit heading for (x, y) should stop at: the point itself when it is walkable, otherwise the center of the
// walkable cell nearest the point's cell (a move into a forest ends at its edge, as on any Warcraft III map; a ship sent
// inland stops at the shore).
export function walkableGoal(map: Pick<GameMap, "terrain" | "width" | "height">, x: number, y: number, mover: Mover = "land"): Point {
  const terrain = map.terrain;
  if (!terrain) return { x, y };
  const state = runtime(terrain, mover);
  const cx = Math.min(Math.max(x, 0), map.width);
  const cy = Math.min(Math.max(y, 0), map.height);
  const at = padAt(state, Math.min(cx, terrain.cols * terrain.cell - 0.001), Math.min(cy, terrain.rows * terrain.cell - 0.001));
  if (state.walk[at] === 1) return { x: cx, y: cy };
  const nearest = nearestWalkable(state, at);
  return nearest < 0 ? { x: cx, y: cy } : centerOf(state, nearest);
}

// Whether a unit could walk the straight segment from a to b without touching a blocked cell (a building's among them).
export function segmentWalkable(map: Pick<GameMap, "terrain">, a: Point, b: Point, mover: Mover = "land") {
  const terrain = map.terrain;
  if (!terrain) return true;
  return clearSegment(routing(map, terrain, mover), a.x, a.y, b.x, b.y);
}

// Where a unit at `from` walking to `goal` should head this tick: the goal itself when it sees it, otherwise a cell down
// the flow tiles toward it (see @@@flow-tiles, @@@terrain-steering). `goal` should be walkable (see walkableGoal); a goal
// the unit's ground does not reach is walked to as near as that ground comes (see reachableTarget).
export function steerPoint(map: Pick<GameMap, "terrain">, from: Point, goal: Point, mover: Mover = "land"): Point {
  recordNativeRouting('steerPoint');
  const terrain = map.terrain;
  if (!terrain) return goal;
  const ground = runtime(terrain, mover);
  const state = routing(map, terrain, mover);
  const start = padAt(state, from.x, from.y);
  const target = padAt(state, goal.x, goal.y);
  if (start < 0 || target < 0 || ground.walk[target] !== 1) return goal;
  if (clearSegment(state, from.x, from.y, goal.x, goal.y)) return goal;
  // A unit stands on open ground (see isOpenGround); one standing where nothing walks (only a seeded scenario puts it there)
  // heads out to the walkable cell nearest it.
  const near = nearestWalkable(state, start);
  if (near < 0) return goal;
  if (near !== start && ground.walk[start] !== 1) return centerOf(state, near);
  const tiles = tilesOf(state);
  const aim = reachableTarget(state, ground, tiles, near, target);
  return walkAhead(state, ground, tiles, from, near, aim, aim === target ? goal : centerOf(state, aim));
}

// Where a walk from `from` to `goal` ends: the goal when the walker's ground (and the buildings in its way) let it reach
// it, else the point nearest it that they do (see reachableTarget); for a goal in a building's cells, the bottom of the
// goal's field the walker comes down to, by the building (see goalSeeds). `goal` should be walkable (see walkableGoal).
export function walkDestination(map: Pick<GameMap, "terrain">, from: Point, goal: Point, mover: Mover = "land"): Point {
  recordNativeRouting('walkDestination');
  const terrain = map.terrain;
  if (!terrain) return goal;
  const ground = runtime(terrain, mover);
  const state = routing(map, terrain, mover);
  const start = padAt(state, from.x, from.y);
  const target = padAt(state, goal.x, goal.y);
  if (start < 0 || target < 0 || ground.walk[target] !== 1) return goal;
  const near = nearestWalkable(state, start);
  if (near < 0) return goal;
  const wholes = state === ground ? ground.wholes : undefined;
  if (wholes && wholes.labels[near]! > 0 && wholes.labels[near] === wholes.labels[target]) return goal;
  const tiles = tilesOf(state);
  const aim = reachableTarget(state, ground, tiles, near, target);
  if (state.walk[aim] === 1) return aim === target ? goal : centerOf(state, aim);
  const field = goalFieldOf(state, ground, tiles, aim).field;
  const index = local(field.box, near, state.width);
  if (index < 0 || field.dist[index]! >= UNREACHED) return goal;
  let at = near;
  for (let next = downhill(state, field, at); next >= 0; next = downhill(state, field, at)) at = next;
  return centerOf(state, at);
}

// @@@terrain-steering - Where a unit at `from`, in cell `near`, heads down the tiles to `target`, the cell of `goal`: the
// cell LOOKAHEAD steps on when it sees it, else the one SHORT_LOOK on. The steps go down its square's field to the window
// it leaves by, across into the next square and on down that square's, or down the goal's field near the goal.
function walkAhead(state: TerrainRuntime, ground: TerrainRuntime, tiles: Tiles, from: Point, near: number, target: number, goal: Point): Point {
  let at = near;
  let short = -1;
  let way = wayAt(state, ground, tiles, at, target);
  for (let step = 1; step <= LOOKAHEAD && way; step += 1) {
    let next = downhill(state, way.field, at);
    if (next < 0) {
      // At the bottom of a square's field: the window it leads to; the goal's field takes over there when it reaches the
      // cell, else the walk crosses into the next square.
      if (!way.exit) break;
      const nearer = wayAt(state, ground, tiles, at, target);
      if (nearer && !nearer.exit) {
        way = nearer;
        next = downhill(state, way.field, at);
        if (next < 0) break;
      } else {
        next = at + way.exit.across;
        if (state.walk[next] !== 1) break;
        way = wayAt(state, ground, tiles, next, target);
      }
    }
    at = next;
    if (step === SHORT_LOOK) short = at;
    if (way && !way.exit && way.field.dist[local(way.field.box, at, state.width)] === 0) break;
  }
  // Nowhere further down: at the goal, or at the bottom of a field that ends by a building or a wood, a cell beside it,
  // where the walk ends (a worker by its hall drops its gold there). Heading on straight at a goal behind it, three casters
  // stood pressed against the trees for minutes, and a builder whose site's middle lay on a cell's edge stepped across it
  // and back every tick.
  if (at === near) return near === target ? goal : centerOf(state, near);
  const far = at === target ? goal : centerOf(state, at);
  if (short < 0 || clearSegment(state, from.x, from.y, far.x, far.y)) return far;
  return short === target ? goal : centerOf(state, short);
}

// The field a walk to `target` follows from cell `at`: the goal's when it reaches the cell, else the field of the window
// the cell's region leaves its square by (see exitFor); undefined when the tiles join neither.
function wayAt(state: TerrainRuntime, ground: TerrainRuntime, tiles: Tiles, at: number, target: number): { field: BoxField; exit?: TileNode } | undefined {
  const goal = goalFieldOf(state, ground, tiles, target);
  const index = local(goal.field.box, at, state.width);
  if (index >= 0 && goal.field.dist[index]! < UNREACHED) return { field: goal.field };
  const exit = exitFor(state, tiles, tiles.region[at]!, target, goal.field);
  // A square with more regions than MAX_REGIONS shares the last label among them: its exit may not be this cell's.
  if (!exit || exit.field.dist[local(exit.field.box, at, state.width)]! >= UNREACHED) return undefined;
  return { field: exit.field, exit };
}

// ---- @@@flow-tiles - Routing as Supreme Commander 2 does it: Elijah Emerson, "Crowd Pathfinding and Steering Using Flow
// Field Tiles" (Game AI Pro, 2013, chapter 23). The map is cut into SECTOR-cell squares. Where a square's edge can be
// crossed, each run of open cells beside it is a window, a node for each of its two sides; each side has a field over its
// square (the cost from every cell of the square to that side's cells), which both prices the graph's edges (from one
// window of a square to another) and is the way a unit walks to that window. A walk asks the graph (A*, from every window
// of its square's region, the region's answer kept until the copy changes) which window to leave its square by and
// follows that window's field across; within a square of its goal's it follows the goal's own field. A building laid or
// felled redoes the windows and fields of the squares whose cells changed and of the squares beside them (Emerson's dirty
// sectors), never the map's, and every answer is a function of the cells alone: a client that rebuilds the tiles after a
// checkpoint walks exactly as the server. Ground prices a step by its pace (see CELL_GROUND): a walk goes round a bog
// when round is quicker, and a field is all downhill, so a unit never turns back on its way.
type Box = { left: number; top: number; width: number; height: number };
// `next`: each cell's next cell down the field, worked out when first asked (see downhill).
type BoxField = { box: Box; dist: Int32Array; next: Int32Array };
// A window's side: its cells in its square, the padded offset across to the other side's, and its field over the square.
// Its key is its window's first cell on the left or upper side × 4, + 2 for a window on a square's lower edge, + 1 for
// the right or lower side (key ^ 1 is the other side): the same whatever order the tiles were built in.
type TileNode = { key: number; sector: number; cells: number[]; across: number; field: BoxField; edges: { to: number; cost: number }[] };
type Tiles = {
  columns: number;
  rows: number;
  nodes: Map<number, TileNode>;
  // Per square edge (the left or upper square × 2, + 1 for its lower edge): its windows' left or upper side keys.
  borders: Map<number, number[]>;
  // Per cell: its square's region (square × MAX_REGIONS + its number in the square) and its island, the area of the whole
  // copy it walks in; -1 on a blocked cell.
  region: Int32Array;
  island: Int32Array;
  goals: Map<number, { field: BoxField; seeds: number[] }>;
  exits: Map<number, number>;
  nearest: Map<number, number>;
};

function tilesOf(state: TerrainRuntime): Tiles {
  if (state.tiles) return state.tiles;
  const { terrain } = state;
  const columns = Math.ceil(terrain.cols / SECTOR);
  const rows = Math.ceil(terrain.rows / SECTOR);
  const tiles: Tiles = {
    columns,
    rows,
    nodes: new Map(),
    borders: new Map(),
    region: new Int32Array(state.walk.length).fill(-1),
    island: new Int32Array(state.walk.length).fill(-1),
    goals: new Map(),
    exits: new Map(),
    nearest: new Map(),
  };
  state.tiles = tiles;
  const all = Array.from({ length: columns * rows }, (_, sector) => sector);
  for (const sector of all) labelRegions(state, tiles, sector);
  for (const sector of all) for (const lower of [0, 1]) layWindows(state, tiles, sector * 2 + lower);
  for (const sector of all) linkSector(state, tiles, sector);
  labelIslands(state, tiles);
  return tiles;
}

// After the copy's cells changed in `dirty` squares: their regions, the windows on their edges, and the fields and edges of
// every square beside them, as a fresh build would make them.
function redoTiles(state: TerrainRuntime, tiles: Tiles, dirty: Set<number>) {
  const sectors = [...dirty].sort((a, b) => a - b);
  const touched = new Set<number>();
  const borders = new Set<number>();
  for (const sector of sectors) {
    labelRegions(state, tiles, sector);
    const col = sector % tiles.columns;
    const row = Math.floor(sector / tiles.columns);
    touched.add(sector);
    for (const lower of [0, 1]) borders.add(sector * 2 + lower);
    if (col > 0) {
      borders.add((sector - 1) * 2);
      touched.add(sector - 1);
    }
    if (row > 0) {
      borders.add((sector - tiles.columns) * 2 + 1);
      touched.add(sector - tiles.columns);
    }
    if (col + 1 < tiles.columns) touched.add(sector + 1);
    if (row + 1 < tiles.rows) touched.add(sector + tiles.columns);
  }
  for (const border of [...borders].sort((a, b) => a - b)) {
    for (const key of tiles.borders.get(border) ?? []) {
      tiles.nodes.delete(key);
      tiles.nodes.delete(key ^ 1);
    }
    layWindows(state, tiles, border);
  }
  for (const sector of [...touched].sort((a, b) => a - b)) linkSector(state, tiles, sector);
  labelIslands(state, tiles);
  // A goal's field reads the cells of its square and those round it (and one cell beyond): only the goals within two
  // squares of a changed one are grown again.
  for (const target of [...tiles.goals.keys()]) {
    const sector = sectorOf(state, tiles, target);
    const near = sectors.some((dirty) => Math.abs((dirty % tiles.columns) - (sector % tiles.columns)) <= 2 && Math.abs(Math.floor(dirty / tiles.columns) - Math.floor(sector / tiles.columns)) <= 2);
    if (near) tiles.goals.delete(target);
  }
  tiles.exits.clear();
  tiles.nearest.clear();
}

function sectorBox(state: TerrainRuntime, tiles: Tiles, sector: number): Box {
  const col = (sector % tiles.columns) * SECTOR;
  const row = Math.floor(sector / tiles.columns) * SECTOR;
  return { left: col + 1, top: row + 1, width: Math.min(SECTOR, state.terrain.cols - col), height: Math.min(SECTOR, state.terrain.rows - row) };
}

function sectorOf(state: TerrainRuntime, tiles: Tiles, at: number) {
  const col = (at % state.width) - 1;
  const row = Math.floor(at / state.width) - 1;
  return Math.floor(row / SECTOR) * tiles.columns + Math.floor(col / SECTOR);
}

// The index of a padded cell in a box's field, or -1 outside it.
function local(box: Box, at: number, width: number) {
  const col = at % width;
  const row = (at - col) / width;
  if (col < box.left || row < box.top || col >= box.left + box.width || row >= box.top + box.height) return -1;
  return (row - box.top) * box.width + (col - box.left);
}

// A square's regions: the parts of it a walk joins without leaving it, numbered in cell order.
function labelRegions(state: TerrainRuntime, tiles: Tiles, sector: number) {
  const { walk, offsets, width } = state;
  const box = sectorBox(state, tiles, sector);
  for (let row = box.top; row < box.top + box.height; row += 1) for (let col = box.left; col < box.left + box.width; col += 1) tiles.region[row * width + col] = -1;
  let count = 0;
  for (let row = box.top; row < box.top + box.height; row += 1) {
    for (let col = box.left; col < box.left + box.width; col += 1) {
      const seed = row * width + col;
      if (walk[seed] !== 1 || tiles.region[seed] !== -1) continue;
      const label = sector * MAX_REGIONS + Math.min(count, MAX_REGIONS - 1);
      count += 1;
      tiles.region[seed] = label;
      for (let index = 0, queue = [seed]; index < queue.length; index += 1) {
        const at = queue[index]!;
        for (let direction = 0; direction < 8; direction += 1) {
          const next = at + offsets[direction]!;
          if (walk[next] !== 1 || tiles.region[next] !== -1 || local(box, next, width) < 0 || !stepAllowed(state, at, direction)) continue;
          tiles.region[next] = label;
          queue.push(next);
        }
      }
    }
  }
}

// The copy's islands: the areas a walk joins at all, numbered in cell order.
function labelIslands(state: TerrainRuntime, tiles: Tiles) {
  const { walk, offsets } = state;
  tiles.island.fill(-1);
  const queue = new Int32Array(walk.length);
  for (let seed = 0; seed < walk.length; seed += 1) {
    if (walk[seed] !== 1 || tiles.island[seed] !== -1) continue;
    tiles.island[seed] = seed;
    let tail = 0;
    queue[tail++] = seed;
    for (let head = 0; head < tail; head += 1) {
      const at = queue[head]!;
      for (let direction = 0; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1 || tiles.island[next] !== -1 || !stepAllowed(state, at, direction)) continue;
        tiles.island[next] = seed;
        queue[tail++] = next;
      }
    }
  }
}

// The windows on one square edge: every run of cells open on both sides of it, with its two sides' nodes (their fields
// and edges come with their squares, see linkSector).
function layWindows(state: TerrainRuntime, tiles: Tiles, border: number) {
  const sector = border >> 1;
  const lower = border & 1;
  const col = sector % tiles.columns;
  const row = Math.floor(sector / tiles.columns);
  const keys: number[] = [];
  tiles.borders.set(border, keys);
  if (lower ? row + 1 >= tiles.rows : col + 1 >= tiles.columns) return;
  const { walk, width } = state;
  const box = sectorBox(state, tiles, sector);
  const across = lower ? width : 1;
  const span = lower ? box.width : box.height;
  const first = lower ? (box.top + box.height - 1) * width + box.left : box.top * width + box.left + box.width - 1;
  const along = lower ? 1 : width;
  let run: number[] = [];
  const close = () => {
    if (run.length === 0) return;
    const key = run[0]! * 4 + lower * 2;
    keys.push(key);
    const blank = (): BoxField => ({ box, dist: new Int32Array(0), next: new Int32Array(0) });
    tiles.nodes.set(key, { key, sector, cells: run, across, field: blank(), edges: [] });
    const other = lower ? sector + tiles.columns : sector + 1;
    tiles.nodes.set(key + 1, { key: key + 1, sector: other, cells: run.map((cell) => cell + across), across: -across, field: blank(), edges: [] });
    run = [];
  };
  for (let step = 0; step < span; step += 1) {
    const at = first + step * along;
    if (walk[at] === 1 && walk[at + across] === 1) run.push(at);
    else close();
  }
  close();
}

// A square's window sides, in key order: those on its right and lower edges and those of the squares left of and above it.
function sectorNodes(tiles: Tiles, sector: number): TileNode[] {
  const col = sector % tiles.columns;
  const row = Math.floor(sector / tiles.columns);
  const keys = [...(tiles.borders.get(sector * 2) ?? []), ...(tiles.borders.get(sector * 2 + 1) ?? [])];
  if (col > 0) keys.push(...(tiles.borders.get((sector - 1) * 2) ?? []).map((key) => key + 1));
  if (row > 0) keys.push(...(tiles.borders.get((sector - tiles.columns) * 2 + 1) ?? []).map((key) => key + 1));
  return keys.sort((a, b) => a - b).map((key) => tiles.nodes.get(key)!);
}

// Every window side of a square: its field over the square, and its edges to the square's other sides (the cheapest way
// from that side's cells to its own).
function linkSector(state: TerrainRuntime, tiles: Tiles, sector: number) {
  const box = sectorBox(state, tiles, sector);
  const nodes = sectorNodes(tiles, sector);
  for (const node of nodes) node.field = growBox(state, box, node.cells);
  for (const from of nodes) {
    from.edges = [];
    for (const to of nodes) {
      if (to === from) continue;
      let cost = UNREACHED;
      for (const cell of from.cells) cost = Math.min(cost, to.field.dist[local(box, cell, state.width)]!);
      if (cost < UNREACHED) from.edges.push({ to: to.key, cost });
    }
  }
}

// @@@terrain-flow - The cost from every cell of a box to the nearest seed, each seed starting at its cost (none: 0), by
// Dial's algorithm over eight neighbours with no corner cut, a step priced by the ground it enters (see GROUND_WEIGHT).
// Each direction's step in columns and rows, in the order of a runtime's offsets.
const STEP_COLS = [1, 0, -1, 0, 1, -1, -1, 1];
const STEP_ROWS = [0, 1, 0, -1, 1, 1, -1, -1];

function growBox(state: TerrainRuntime, box: Box, seeds: number[], costs?: number[]): BoxField {
  const size = box.width * box.height;
  return growBoxInto(state, box, seeds, costs, { dist: new Int32Array(size), next: new Int32Array(size) });
}

type BoxFlow = { state: TerrainRuntime; box: Box; dist: Int32Array; next: Int32Array; buckets: number[][];
  order: number[]; seeds: number[]; costs: number[] | undefined; seeded: number; pending: number; cost: number; work: number };
function beginBoxFlow(state: TerrainRuntime, box: Box, seeds: number[], costs: number[] | undefined,
  arrays: Pick<Field, 'dist' | 'next'>, buckets: number[][]): BoxFlow {
  arrays.dist.fill(UNREACHED); arrays.next.fill(UNKNOWN);
  const order = seeds.map((_, index) => index);
  if (costs) order.sort((a, b) => costs[a]! - costs[b]! || a - b);
  return { state, box, ...arrays, buckets, order, seeds, costs, seeded: 0, pending: 0, work: 0,
    cost: costs && order.length ? costs[order[0]!]! : 0 };
}
function growBoxInto(state: TerrainRuntime, box: Box, seeds: number[], costs: number[] | undefined, arrays: Pick<Field, 'dist' | 'next'>, resume?: BoxFlow, workBudget = Infinity): BoxField {
  recordNativeRouting('growBoxInto');
  const { walk, offsets, width, weight } = state;
  const columns = box.width;
  const rows = box.height;
  const localOffsets = [1, columns, -1, -columns, columns + 1, columns - 1, -columns - 1, -columns + 1];
  const origin = box.top * width + box.left;
  const { dist, next } = arrays;
  if (!resume) { dist.fill(UNREACHED); next.fill(UNKNOWN); }
  const buckets = resume?.buckets ?? state.boxBuckets;
  const order = resume?.order ?? seeds.map((_, index) => index);
  if (costs && !resume) order.sort((a, b) => costs[a]! - costs[b]! || a - b);
  const costOf = (index: number) => (costs ? costs[order[index]!]! : 0);
  let seeded = resume?.seeded ?? 0, pending = resume?.pending ?? 0, work = 0;
  let cost = resume?.cost ?? (order.length > 0 ? costOf(0) : 0);
  flow: for (; pending > 0 || seeded < order.length; cost += 1) {
    if (resume && work >= workBudget) break;
    if (pending === 0) cost = costOf(seeded);
    for (; seeded < order.length && costOf(seeded) === cost; seeded += 1) {
      const index = local(box, seeds[order[seeded]!]!, width);
      if (index < 0 || cost >= dist[index]!) continue;
      dist[index] = cost;
      buckets[cost % BUCKETS]!.push(index);
      pending += 1;
    }
    const bucket = buckets[cost % BUCKETS]!;
    while (bucket.length > 0) {
      if (resume && work >= workBudget) break flow;
      if (resume) work++;
      const index = bucket.pop()!;
      pending -= 1;
      if (dist[index] !== cost) continue;
      const col = index % columns;
      const row = (index - col) / columns;
      const at = origin + row * width + col;
      // Box boundaries remove the same directions for every neighbour of this cell.
      let directions = 0xff;
      if (col === 0) directions &= ~0x64; // W, SW, NW
      if (col === columns - 1) directions &= ~0x91; // E, SE, NE
      if (row === 0) directions &= ~0xc8; // N, NW, NE
      if (row === rows - 1) directions &= ~0x32; // S, SE, SW
      let sides = 0;
      for (let direction = 0; direction < 4; direction += 1) {
        if ((directions & (1 << direction)) === 0) continue;
        const step = at + offsets[direction]!;
        if (walk[step] !== 1) continue;
        sides |= 1 << direction;
        const there = index + localOffsets[direction]!;
        const reached = cost + STRAIGHT * weight[step]!;
        if (reached >= dist[there]!) continue;
        dist[there] = reached;
        buckets[reached % BUCKETS]!.push(there);
        pending += 1;
      }
      for (let direction = 4; direction < 8; direction += 1) {
        if ((directions & (1 << direction)) === 0) continue;
        const step = at + offsets[direction]!;
        if (walk[step] !== 1) continue;
        const there = index + localOffsets[direction]!;
        const reached = cost + DIAGONAL * weight[step]!;
        const required = direction === 4 ? 0x3 : direction === 5 ? 0x6 : direction === 6 ? 0xc : 0x9;
        if (reached >= dist[there]! || (sides & required) !== required) continue;
        dist[there] = reached;
        buckets[reached % BUCKETS]!.push(there);
        pending += 1;
      }
    }
  }
  if (resume) { resume.seeded = seeded; resume.pending = pending; resume.cost = cost; resume.work = work; }
  return { box, dist, next };
}

// The neighbour one step down a box field (the fixed order of directions breaks ties), or -1 at its bottom; remembered.
function downhill(state: TerrainRuntime, field: BoxField, at: number) {
  const { offsets, width } = state;
  const { box } = field;
  const index = local(box, at, width);
  if (index < 0) return -1;
  const known = field.next[index]!;
  if (known !== UNKNOWN) return known;
  const direction = downhillDirection(state, box, field.dist, at, index);
  const best = direction < 0 ? -1 : at + offsets[direction]!;
  field.next[index] = best;
  return best;
}

// Both native steering and compact observation fields use this exact descent
// and tie order. Only their memoized representation differs: cell id or direction.
function downhillDirection(state: TerrainRuntime, box: Box, dist: Int32Array | Uint16Array, at: number, index: number) {
  const { walk, offsets } = state;
  const col = index % box.width;
  const row = (index - col) / box.width;
  let best = -1;
  let bestCost = dist[index]!;
  for (let direction = 0; direction < 8; direction += 1) {
    const stepCol = col + STEP_COLS[direction]!;
    const stepRow = row + STEP_ROWS[direction]!;
    if (stepCol < 0 || stepRow < 0 || stepCol >= box.width || stepRow >= box.height) continue;
    const step = at + offsets[direction]!;
    const there = stepRow * box.width + stepCol;
    if (walk[step] !== 1 || dist[there]! >= bestCost || !stepAllowed(state, at, direction)) continue;
    bestCost = dist[there]!;
    best = direction;
  }
  return best;
}

// The goal's own field, over its square and the squares round it, from its seeds (see goalSeeds).
function goalFieldOf(state: TerrainRuntime, ground: TerrainRuntime, tiles: Tiles, target: number) {
  const known = tiles.goals.get(target);
  if (known) {
    tiles.goals.delete(target);
    tiles.goals.set(target, known);
    return known;
  }
  const sector = sectorOf(state, tiles, target);
  const col = (sector % tiles.columns) * SECTOR;
  const row = Math.floor(sector / tiles.columns) * SECTOR;
  const left = Math.max(0, col - SECTOR);
  const top = Math.max(0, row - SECTOR);
  const box = { left: left + 1, top: top + 1, width: Math.min(state.terrain.cols, col + 2 * SECTOR) - left, height: Math.min(state.terrain.rows, row + 2 * SECTOR) - top };
  const { seeds, costs } = goalSeeds(state, ground, target, box);
  const goal = { field: growBox(state, box, seeds, costs), seeds };
  if (tiles.goals.size >= GOAL_FIELD_CACHE) tiles.goals.delete(tiles.goals.keys().next().value!);
  tiles.goals.set(target, goal);
  return goal;
}

// The open cells of the copy a walk to `target` may end at, each with its straight cost to it, within `box`: the target
// itself when it is open; where a building covers it (a site to build, a hall to bring gold to, one to strike), the open
// cells beside that building (or the buildings it stands against) within GOAL_REACH that the land joins to the target
// without the buildings, so the walk ends at the wall on the walker's side. Taken by distance alone, the cells on a
// plateau above a farm built under its cliff were the farm's: a worker up there stood at its walk's end and walked
// straight at the cliff (V8's on the open ladder). Every open cell within GOAL_REACH was one: a worker sent to a farm two
// cells beyond the corner of its hall stood at the hall's foot for good, a cell there its walk's end and nowhere near the
// farm (pool-pineshade-10).
function goalSeeds(state: TerrainRuntime, ground: TerrainRuntime, target: number, box: Box) {
  if (state.walk[target] === 1) return { seeds: [target], costs: [0] };
  const { width, offsets } = state;
  const targetCol = target % width;
  const targetRow = Math.floor(target / width);
  const square = { left: targetCol - GOAL_REACH, top: targetRow - GOAL_REACH, width: 2 * GOAL_REACH + 1, height: 2 * GOAL_REACH + 1 };
  const seeds: number[] = [];
  const costs: number[] = [];
  const joined = new Set([target]);
  for (let index = 0, queue = [target]; index < queue.length; index += 1) {
    const at = queue[index]!;
    if (state.walk[at] === 1) {
      if (local(box, at, width) >= 0) {
        seeds.push(at);
        costs.push(Math.round(STRAIGHT * GROUND_WEIGHT * Math.sqrt(((at % width) - targetCol) ** 2 + (Math.floor(at / width) - targetRow) ** 2)));
      }
      continue;
    }
    for (let direction = 0; direction < 8; direction += 1) {
      const next = at + offsets[direction]!;
      if (joined.has(next) || ground.walk[next] !== 1 || !stepAllowed(ground, at, direction) || local(square, next, width) < 0) continue;
      joined.add(next);
      queue.push(next);
    }
  }
  return { seeds, costs };
}

// The cell a walk from `near` to `target` heads for: the target when the unit's island reaches it (one of its seeds is on
// the island), else the island's cell nearest it, so a walk to a point it cannot reach (across a cliff, inside a wall of
// buildings) goes as near as it can and stands there instead of pressing against what is in its way.
function reachableTarget(state: TerrainRuntime, ground: TerrainRuntime, tiles: Tiles, near: number, target: number) {
  const island = tiles.island[near]!;
  // An open target is its own sole seed; connectivity alone answers this query.
  if (state.walk[target] === 1 && tiles.island[target] === island) return target;
  if (goalFieldOf(state, ground, tiles, target).seeds.some((seed) => tiles.island[seed] === island)) return target;
  const key = target * state.walk.length + island;
  const known = tiles.nearest.get(key);
  if (known !== undefined) return known;
  const { terrain, width } = state;
  const col = (target % width) - 1;
  const row = Math.floor(target / width) - 1;
  let best = near;
  let bestDistance = Infinity;
  const consider = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows) return;
    const at = pad(state, c, r);
    if (tiles.island[at] !== island) return;
    const gap = (c - col) ** 2 + (r - row) ** 2;
    if (gap < bestDistance || (gap === bestDistance && at < best)) {
      bestDistance = gap;
      best = at;
    }
  };
  for (let ring = 1; ring <= Math.max(terrain.cols, terrain.rows) && ring * ring <= bestDistance; ring += 1) {
    // Only the 8r border cells belong to this ring; the interior was visited in earlier rings.
    // The minimum (squared distance, padded index) is independent of traversal order.
    const top = row - ring, bottom = row + ring;
    for (let c = col - ring; c <= col + ring; c += 1) {
      consider(c, top);
      consider(c, bottom);
    }
    for (let r = top + 1; r < bottom; r += 1) {
      consider(col - ring, r);
      consider(col + ring, r);
    }
  }
  if (tiles.nearest.size > 4_096) tiles.nearest.clear();
  tiles.nearest.set(key, best);
  return best;
}

// The window side the region's walk to `target` leaves its square by: A* over the windows from every side of the region
// (one answer for the whole region, kept), to the goal's field wherever a side's cells lie in it.
function exitFor(state: TerrainRuntime, tiles: Tiles, region: number, target: number, goal: BoxField): TileNode | undefined {
  const key = target * tiles.columns * tiles.rows * MAX_REGIONS + region;
  let exit = tiles.exits.get(key);
  if (exit === undefined) {
    exit = searchExit(state, tiles, region, target, goal);
    if (tiles.exits.size > 65_536) tiles.exits.clear();
    tiles.exits.set(key, exit);
  }
  return exit < 0 ? undefined : tiles.nodes.get(exit);
}

function searchExit(state: TerrainRuntime, tiles: Tiles, region: number, target: number, goal: BoxField): number {
  const width = state.width;
  const targetCol = target % width;
  const targetRow = Math.floor(target / width);
  // Octile cells to the target at bare ground's price from the window's cell nearest it: no walk is cheaper. Taken from
  // the window's first cell, it priced a long window up to nine cells too dear, the search came out the wrong way, and the
  // two sides of a strip on a squares' border each sent the walk across to the other: units stood on it for good, the
  // walk crossing and crossing back within one look ahead (pool-stillwater-2, a strip at x 3840, eight soldiers in a row).
  // A window reached again more cheaply is searched on from there again.
  const estimate = (node: TileNode) => {
    let least = UNREACHED;
    for (const cell of node.cells) {
      const dx = Math.abs((cell % width) - targetCol);
      const dy = Math.abs(Math.floor(cell / width) - targetRow);
      least = Math.min(least, (DIAGONAL * Math.min(dx, dy) + STRAIGHT * (Math.max(dx, dy) - Math.min(dx, dy))) * GROUND_WEIGHT);
    }
    return least;
  };
  const sector = Math.floor(region / MAX_REGIONS);
  const cost = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new Frontier();
  for (const node of sectorNodes(tiles, sector)) {
    if (tiles.region[node.cells[0]!] !== region) continue;
    cost.set(node.key, 0);
    parent.set(node.key, -1);
    heap.push(estimate(node), node.key);
  }
  let finish = -1;
  let finishCost = UNREACHED;
  const relax = (from: number, to: number, through: number) => {
    const node = tiles.nodes.get(to);
    if (!node || through >= (cost.get(to) ?? UNREACHED)) return;
    cost.set(to, through);
    parent.set(to, from);
    heap.push(through + estimate(node), to);
  };
  for (;;) {
    const key = heap.pop();
    if (key === undefined) return -1;
    if (key === -1) break;
    const node = tiles.nodes.get(key)!;
    const here = cost.get(key)!;
    let end = UNREACHED;
    for (const cell of node.cells) {
      const index = local(goal.box, cell, width);
      if (index >= 0) end = Math.min(end, goal.dist[index]!);
    }
    if (end < UNREACHED && here + end < finishCost) {
      finishCost = here + end;
      finish = key;
      heap.push(finishCost, -1);
    }
    const pair = tiles.nodes.get(key ^ 1);
    if (pair) relax(key, key ^ 1, here + STRAIGHT * GROUND_WEIGHT);
    for (const edge of node.edges) relax(key, edge.to, here + edge.cost);
  }
  // The side the way leaves the region's square by: the last of the square's before the first crossing.
  const path: number[] = [];
  for (let at = finish; at !== -1; at = parent.get(at)!) path.push(at);
  path.reverse();
  for (let index = 0; index + 1 < path.length; index += 1) if (path[index + 1] === (path[index]! ^ 1)) return path[index]!;
  return path[path.length - 1]!;
}

// A binary heap of (priority, key), the lower key first among equal priorities, so a search goes the same way every time.
class Frontier {
  private items: [number, number][] = [];
  push(priority: number, key: number) {
    const items = this.items;
    items.push([priority, key]);
    for (let at = items.length - 1; at > 0; ) {
      const up = (at - 1) >> 1;
      if (!before(items[at]!, items[up]!)) break;
      [items[at], items[up]] = [items[up]!, items[at]!];
      at = up;
    }
  }
  pop(): number | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]![1];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      for (let at = 0; ; ) {
        const left = 2 * at + 1;
        const right = left + 1;
        let least = at;
        if (left < items.length && before(items[left]!, items[least]!)) least = left;
        if (right < items.length && before(items[right]!, items[least]!)) least = right;
        if (least === at) break;
        [items[at], items[least]] = [items[least]!, items[at]!];
        at = least;
      }
    }
    return top;
  }
}

function before(a: [number, number], b: [number, number]) {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

// The walking distance (in world units, along the flow) from a point to a goal, or undefined when no walk joins them. A
// map without terrain measures the straight line. It reads the terrain alone (see @@@building-pathing).
export function walkingDistance(map: Pick<GameMap, "terrain">, from: Point, goal: Point, mover: Mover = "land"): number | undefined {
  recordNativeRouting('walkingDistance');
  const terrain = map.terrain;
  if (!terrain) return Math.sqrt((from.x - goal.x) ** 2 + (from.y - goal.y) ** 2);
  const state = runtime(terrain, mover);
  const start = padAt(state, from.x, from.y);
  const target = padAt(state, goal.x, goal.y);
  if (state.walk[start] !== 1 || state.walk[target] !== 1) return undefined;
  const cost = exactField(state, target).dist[start]!;
  return cost >= UNREACHED ? undefined : (cost * terrain.cell) / STRAIGHT;
}

// @@@guarded-field - The land walk from one point to every cell that stays out of guarded disks (an enemy's reach), on the
// building-aware land (see @@@building-pathing) with each cell's ground cost (see GROUND_WEIGHT): Dial's algorithm over
// eight neighbours, as the flow fields grow. A step is the straight segment between two cell centers, taken only when it
// keeps out of every disk; a walker that starts inside disks may leave them, each step moving away from the center of
// every disk it is in (as routeLeavesDisks admits a road). One field answers the cost of every goal a planner weighs; only
// the road it takes is traced (cells).
export type GuardDisk = Point & { radius: number };
export type GuardedField = {
  // Bare-ground units of walking to the goal, or undefined when no guarded walk reaches it.
  cost(goal: Point): number | undefined;
  // The centers of the cells walked, from the walker's cell to the one the goal is reached from.
  cells(goal: Point): Point[] | undefined;
};

// A map without terrain is open ground all over: its guarded walks run on an open grid of its size.
const openGrounds = new Map<string, Terrain>();
function openGround(width: number, height: number): Terrain {
  const cell = 32, cols = Math.ceil(width / cell), rows = Math.ceil(height / cell), key = `${cols}x${rows}`;
  let terrain = openGrounds.get(key);
  if (!terrain) openGrounds.set(key, terrain = { cell, cols, rows, cells: ".".repeat(cols * rows) });
  return terrain;
}

export function guardedField(map: Pick<GameMap, "terrain" | "width" | "height">, from: Point, disks: readonly GuardDisk[]): GuardedField | undefined {
  recordNativeRouting('guardedField');
  const terrain = map.terrain ?? openGround(map.width, map.height);
  const state = routing(map, terrain, "land");
  const { walk, weight, offsets } = state;
  const cell = terrain.cell, margin = cell * Math.SQRT1_2;
  let start = padAt(state, from.x, from.y);
  if (start < 0) return undefined;
  if (walk[start] !== 1) start = nearestWalkable(state, start);
  if (start < 0) return undefined;
  // Cells whose center is within a disk's reach and half a cell's diagonal: only a step touching one can meet a disk, so
  // only those steps are measured against the disks over their coarse square of the map.
  const SQUARE = 8;
  const squareCols = Math.ceil(terrain.cols / SQUARE);
  const squares = new Map<number, GuardDisk[]>();
  const near = new Uint8Array(walk.length);
  for (const disk of disks) {
    const reach = disk.radius + margin;
    const left = Math.max(0, Math.floor((disk.x - reach) / cell)), right = Math.min(terrain.cols - 1, Math.floor((disk.x + reach) / cell));
    const top = Math.max(0, Math.floor((disk.y - reach) / cell)), bottom = Math.min(terrain.rows - 1, Math.floor((disk.y + reach) / cell));
    for (let row = top; row <= bottom; row += 1) for (let col = left; col <= right; col += 1) {
      const dx = (col + 0.5) * cell - disk.x, dy = (row + 0.5) * cell - disk.y;
      if (dx * dx + dy * dy <= reach * reach) near[pad(state, col, row)] = 1;
    }
    for (let row = Math.floor(top / SQUARE); row <= Math.floor(bottom / SQUARE); row += 1) for (let col = Math.floor(left / SQUARE); col <= Math.floor(right / SQUARE); col += 1) {
      const key = row * squareCols + col, list = squares.get(key);
      if (list) list.push(disk); else squares.set(key, [disk]);
    }
  }
  const disksAt = (point: Point) => squares.get(Math.floor(point.y / cell / SQUARE) * squareCols + Math.floor(point.x / cell / SQUARE)) ?? [];
  // The straight segment keeps out of every disk, or, from inside a disk, moves away from its center.
  const segmentClear = (a: Point, b: Point) => {
    const listed = disksAt(a), other = disksAt(b);
    return (other === listed ? listed : [...listed, ...other]).every((disk) => {
      const dx = b.x - a.x, dy = b.y - a.y, inside = (a.x - disk.x) ** 2 + (a.y - disk.y) ** 2 <= disk.radius * disk.radius;
      if (inside) return (a.x - disk.x) * dx + (a.y - disk.y) * dy >= 0;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((disk.x - a.x) * dx + (disk.y - a.y) * dy) / length));
      return (a.x + t * dx - disk.x) ** 2 + (a.y + t * dy - disk.y) ** 2 > disk.radius * disk.radius;
    });
  };
  const dist = new Int32Array(walk.length).fill(UNREACHED);
  // The direction of the step each cell was reached by.
  const came = new Uint8Array(walk.length);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  dist[start] = 0;
  buckets[0]!.push(start);
  let pending = 1;
  for (let cost = 0; pending > 0; cost += 1) {
    const bucket = buckets[cost % BUCKETS]!;
    while (bucket.length > 0) {
      const at = bucket.pop()!;
      pending -= 1;
      if (dist[at] !== cost) continue;
      let sides = 0;
      for (let direction = 0; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1) continue;
        if (direction < 4) sides |= 1 << direction;
        else {
          const corner = direction === 4 ? 3 : direction === 5 ? 6 : direction === 6 ? 12 : 9;
          if ((sides & corner) !== corner) continue;
        }
        const reached = cost + (direction < 4 ? STRAIGHT : DIAGONAL) * weight[next]!;
        if (reached >= dist[next]!) continue;
        if ((near[at] === 1 || near[next] === 1) && !segmentClear(centerOf(state, at), centerOf(state, next))) continue;
        dist[next] = reached;
        came[next] = direction;
        buckets[reached % BUCKETS]!.push(next);
        pending += 1;
      }
    }
  }
  // The cell a walk to the goal ends on and what the last stretch to the goal adds: the goal's own cell or a neighbour of
  // it the field reaches, whose straight way to the goal is walkable and keeps out of the disks, the cheapest.
  const entry = (goal: Point): { at: number; extra: number } | undefined => {
    const at = padAt(state, goal.x, goal.y);
    if (at < 0 || walk[at] !== 1) return undefined;
    let best: { at: number; extra: number } | undefined;
    for (let direction = -1; direction < 8; direction += 1) {
      const beside = direction < 0 ? at : at + offsets[direction]!;
      if (walk[beside] !== 1 || dist[beside]! >= UNREACHED) continue;
      const center = centerOf(state, beside);
      if (!segmentClear(center, goal) || !clearSegment(state, center.x, center.y, goal.x, goal.y)) continue;
      const extra = Math.round((Math.hypot(goal.x - center.x, goal.y - center.y) / cell) * STRAIGHT * weight[at]!);
      if (!best || dist[beside]! + extra < dist[best.at]! + best.extra) best = { at: beside, extra };
    }
    return best;
  };
  return {
    cost(goal) {
      const end = entry(goal);
      return end === undefined ? undefined : ((dist[end.at]! + end.extra) * cell) / (STRAIGHT * GROUND_WEIGHT);
    },
    cells(goal) {
      let at = entry(goal)?.at;
      if (at === undefined) return undefined;
      const cells = [centerOf(state, at)];
      while (at !== start) {
        at -= offsets[came[at]!]!;
        cells.push(centerOf(state, at));
      }
      return cells.reverse();
    },
  };
}

// @@@nearest-field - Which of several points is the nearest walk from a goal: one field grown from all of them at once,
// each cell keeping its walking cost to the nearest and that one's index (the lower index among equals), as many goals
// ask of the same few points (each injured fighter its nearest healer, each worker its nearest hall). A walk is as long
// either way (the steps and their costs are the same both ways), so the answer is the one a field grown from each goal
// gives, without a field per goal: goals move every think, and their fields were grown afresh each time; a set of
// points that stays (halls, posts) keeps its one field from think to think. It reads the terrain alone, as
// walkingDistance does.
const NEAREST_FIELD_CACHE = 16;

export function nearestByWalk(map: Pick<GameMap, "terrain">, candidates: readonly Point[], goal: Point, mover: Mover = "land"): number | undefined {
  recordNativeRouting('nearestByWalk');
  const terrain = map.terrain!;
  const state = runtime(terrain, mover);
  const target = padAt(state, goal.x, goal.y);
  if (target < 0 || state.walk[target] !== 1) return undefined;
  const cells = candidates.map((candidate) => padAt(state, candidate.x, candidate.y));
  const key = cells.join(",");
  const fields = state.nearestFields ??= new Map();
  let field = fields.get(key);
  if (field) fields.delete(key);
  else {
    if (fields.size >= NEAREST_FIELD_CACHE) fields.delete(fields.keys().next().value!);
    field = growNearest(state, cells);
  }
  fields.set(key, field);
  return field.dist[target]! >= UNREACHED ? undefined : field.label[target]!;
}

// Dial's algorithm from every candidate's cell, as grow, ordering (cost, candidate index): an equal cost from a lower index
// takes a cell over and passes on through it.
function growNearest(state: TerrainRuntime, cells: readonly number[]) {
  const { walk, offsets } = state;
  const dist = new Int32Array(walk.length).fill(UNREACHED), label = new Int32Array(walk.length).fill(-1);
  const buckets: number[][] = Array.from({ length: 8 }, () => []);
  let pending = 0;
  cells.forEach((cell, index) => {
    if (cell < 0 || walk[cell] !== 1 || dist[cell] === 0) return;
    dist[cell] = 0;
    label[cell] = index;
    buckets[0]!.push(cell);
    pending += 1;
  });
  const reach = (next: number, reached: number, from: number) => {
    if (reached > dist[next]! || (reached === dist[next] && label[from]! >= label[next]!)) return;
    dist[next] = reached;
    label[next] = label[from]!;
    buckets[reached & 7]!.push(next);
    pending += 1;
  };
  for (let cost = 0; pending > 0; cost += 1) {
    const bucket = buckets[cost & 7]!;
    while (bucket.length > 0) {
      const at = bucket.pop()!;
      pending -= 1;
      if (dist[at] !== cost) continue;
      let sides = 0;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1) continue;
        sides |= 1 << direction;
        reach(next, cost + STRAIGHT, at);
      }
      for (let direction = 4; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1) continue;
        const corner = direction === 4 ? 3 : direction === 5 ? 6 : direction === 6 ? 12 : 9;
        if ((sides & corner) !== corner) continue;
        reach(next, cost + DIAGONAL, at);
      }
    }
  }
  return { dist, label };
}

/** Continuous travel cost of a clear land segment, in equivalent bare-ground units.
 * The caller supplies walkable terrain; status, arrival tolerance and per-tick
 * boundary rounding belong to actual movement. */
export function groundSegmentTravelCost(map: Pick<GameMap, 'terrain'>, from: Point, goal: Point): number {
  return groundSegmentProgress(map, from, goal, Infinity).cost;
}

/** Continuous position on a clear segment after spending equivalent bare-ground distance. */
export function groundSegmentAdvance(map: Pick<GameMap, 'terrain'>, from: Point, goal: Point, budget: number): Point {
  const { fraction } = groundSegmentProgress(map, from, goal, budget);
  return fraction === 1 ? goal : { x: from.x + (goal.x - from.x) * fraction, y: from.y + (goal.y - from.y) * fraction };
}

function groundSegmentProgress(map: Pick<GameMap, 'terrain'>, from: Point, goal: Point, budget: number) {
  const dx = goal.x - from.x, dy = goal.y - from.y, length = Math.hypot(dx, dy), terrain = map.terrain;
  if (!terrain || length === 0) return { cost: Math.min(length, budget), fraction: length === 0 ? 1 : Math.min(1, budget / length) };
  const cell = terrain.cell, stepX = Math.sign(dx), stepY = Math.sign(dy);
  let col = Math.floor(from.x / cell), row = Math.floor(from.y / cell);
  if (dx < 0 && from.x === col * cell) col--;
  if (dy < 0 && from.y === row * cell) row--;
  let nextX = dx === 0 ? Infinity : ((col + Number(dx > 0)) * cell - from.x) / dx;
  let nextY = dy === 0 ? Infinity : ((row + Number(dy > 0)) * cell - from.y) / dy;
  const spanX = cell / Math.abs(dx), spanY = cell / Math.abs(dy);
  // Boundary additions round the segment parameter; endpoint coordinates also
  // round in world space. A short road far from the origin can clip a corner
  // by several parameter ulps even after only a few crossings. Include both
  // scales, and ignore only zero-pace slivers within this numerical bound.
  // Ordinary finite pace contributions retain their exact arithmetic.
  const coordinateScale = Math.abs(from.x) + Math.abs(from.y) + Math.abs(goal.x) + Math.abs(goal.y);
  const cornerEpsilon = Number.EPSILON * (2 + Math.ceil(Math.abs(dx) / cell) + Math.ceil(Math.abs(dy) / cell)
    + coordinateScale / length);
  let at = 0, cost = 0;
  while (at < 1) {
    const end = Math.min(1, nextX, nextY);
    const pace = CELL_GROUND[terrain.cells[row * terrain.cols + col]!]!.pace;
    const next = pace === 0 && end - at <= cornerEpsilon ? cost : cost + (end - at) * length / pace;
    if (next >= budget) return { cost: budget, fraction: at + (budget - cost) * pace / length };
    cost = next;
    if (end === nextX) { col += stepX; nextX += spanX; }
    if (end === nextY) { row += stepY; nextY += spanY; }
    at = end;
  }
  return { cost, fraction: 1 };
}

/** Ground travel cost in equivalent bare-ground units. A clear straight segment
 * uses actual terrain pace; a detour uses the steering grid's quantized weights.
 * Excludes body detours and status effects. */
export function groundTravelCost(map: Pick<GameMap, 'terrain'>, from: Point, goal: Point): number | undefined {
  recordNativeRouting('groundTravelCost');
  const terrain = map.terrain;
  if (!terrain) return Math.hypot(from.x - goal.x, from.y - goal.y);
  const state = runtime(terrain, 'land'), start = padAt(state, from.x, from.y), target = padAt(state, goal.x, goal.y);
  if (state.walk[start] !== 1 || state.walk[target] !== 1) return undefined;
  if (clearSegment(state, from.x, from.y, goal.x, goal.y)) return groundSegmentTravelCost(map, from, goal);
  const field = cached(state, -target - 1, () => {
    const arrays = state.spare.pop() ?? { dist: new Int32Array(state.walk.length), next: new Int32Array(state.walk.length), used: 0 };
    const box = { left: 0, top: 0, width: state.width, height: state.walk.length / state.width };
    growBoxInto(state, box, [target], undefined, arrays);
    return arrays;
  });
  const cost = field.dist[start]!;
  return cost >= UNREACHED ? undefined : cost * terrain.cell / (STRAIGHT * GROUND_WEIGHT);
}

export type GroundDistanceField = Readonly<{
  /** Weighted eight-neighbour grid forecast, not a traced/smoothed steering road. */
  cost(from: Point): number | undefined;
  /** Smoothed descent of this same field; does not start a second route search. */
  road(from: Point, goal: Point): readonly Point[] | undefined;
}>;
type GoalFieldCache = {
  revision: number;
  fields: Map<number, GroundDistanceField>;
  leases: Map<string, { tick: number; targets: ReadonlySet<number> }>;
  evictions: number;
  overflowInsertions: number;
  overflowThinks: number;
  peakFields: number;
  peakOverflow: number;
};
const distanceFields = new WeakMap<TerrainRuntime, GoalFieldCache>();
const distanceFieldWork = new WeakMap<GroundDistanceField, number>();
const pendingDistanceFields = new WeakMap<TerrainRuntime, { revision: number; jobs: Map<number, { flow: BoxFlow; progress: number }> }>();
// Eleven complete maps and the 25-minute archipelago peak at 25 land / 30 sea
// fields, including old/new target overlap. Pins count against these limits.
export const GOAL_DISTANCE_FIELD_LIMIT: Readonly<Record<Mover, number>> = { land: 32, sea: 32 };
export const PENDING_GOAL_DISTANCE_FIELD_LIMIT = 8;
export const GOAL_DISTANCE_FIELD_LEASE_TICKS = 30;
type GoalFieldLease = { cache: GoalFieldCache; mover: Mover; targets: Set<number> };
let currentGoalFieldLease: { owner: string; tick: number; fields: Map<TerrainRuntime, GoalFieldLease> } | undefined;

function goalFieldCache(state: TerrainRuntime, revision: number): GoalFieldCache {
  let cache = distanceFields.get(state);
  if (cache?.revision !== revision) distanceFields.set(state, cache = { revision, fields: new Map(), leases: new Map(),
    evictions: 0, overflowInsertions: 0, overflowThinks: 0, peakFields: 0, peakOverflow: 0 });
  return cache;
}
function trimGoalFields(cache: GoalFieldCache, mover: Mover, protect?: number) {
  const limit = GOAL_DISTANCE_FIELD_LIMIT[mover];
  if (cache.fields.size <= limit) { cache.peakFields = Math.max(cache.peakFields, cache.fields.size); return; }
  const active = currentGoalFieldLease;
  const current = active && [...active.fields.values()].find(entry => entry.cache === cache)?.targets;
  const pinned = (target: number) => current?.has(target)
    || [...cache.leases.values()].some(lease => lease.targets.has(target));
  for (const target of cache.fields.keys()) {
    if (cache.fields.size <= limit) break;
    if (target === protect || pinned(target)) continue;
    cache.fields.delete(target); cache.evictions++;
  }
  cache.peakFields = Math.max(cache.peakFields, cache.fields.size);
  if (cache.fields.size > limit) {
    if (protect !== undefined) cache.overflowInsertions++;
    cache.peakOverflow = Math.max(cache.peakOverflow, cache.fields.size - limit);
  }
}

/** Cache residency only: keep each owner's most recent successful requests,
 * including the previous set until the current synchronous think completes.
 * No publication state, snapshot, memory or field array is retained here.
 * An owner absent for two default think intervals releases its lease. */
export function withGoalDistanceFieldLease<T>(map: Pick<GameMap, 'terrain'>, owner: string, tick: number, run: () => T): T {
  if (!map.terrain) return run();
  const previous = currentGoalFieldLease;
  // The control transaction contains assessment, action targets and executor
  // queries. Nested assessments must extend the outer owner's live set rather
  // than replacing it on return and unpinning fields still used by that think.
  if (previous?.owner === owner && previous.tick === tick
    && (['land', 'sea'] as const).every(mover => previous.fields.has(routing(map, map.terrain!, mover)))) return run();
  const scope = { owner, tick, fields: new Map<TerrainRuntime, GoalFieldLease>() };
  for (const mover of ['land', 'sea'] as const) {
    const state = routing(map, map.terrain, mover), revision = mover === 'land' ? groundRevision(map) : 0;
    const cache = goalFieldCache(state, revision);
    for (const [id, lease] of cache.leases) if (tick < lease.tick || tick - lease.tick > GOAL_DISTANCE_FIELD_LEASE_TICKS) cache.leases.delete(id);
    scope.fields.set(state, { cache, mover, targets: new Set() });
  }
  currentGoalFieldLease = scope;
  try { return run(); }
  finally {
    for (const { cache, targets } of scope.fields.values()) {
      if (targets.size) cache.leases.set(owner, { tick, targets });
      else cache.leases.delete(owner);
    }
    currentGoalFieldLease = previous;
    for (const { cache, mover } of scope.fields.values()) {
      trimGoalFields(cache, mover);
      if (cache.fields.size > GOAL_DISTANCE_FIELD_LIMIT[mover]) cache.overflowThinks++;
    }
  }
}

/** Called only after deterministic publication admitted the field. */
export function retainGoalDistanceField(map: Pick<GameMap, 'terrain'>, goal: Point, mover: Mover) {
  if (!currentGoalFieldLease || !map.terrain) return;
  const state = routing(map, map.terrain, mover), lease = currentGoalFieldLease.fields.get(state);
  if (lease) lease.targets.add(padAt(state, goal.x, goal.y));
}

/** On-demand diagnostic counters and native storage; never serialized as facts. */
export function goalDistanceFieldCacheStats(map: Pick<GameMap, 'terrain'>, mover: Mover) {
  const cache = map.terrain && distanceFields.get(routing(map, map.terrain, mover));
  let distanceBytes = 0, descentBytes = 0;
  if (cache) for (const field of cache.fields.values()) {
    const storage = fieldStorage.get(field)!; distanceBytes += storage.distanceBytes; descentBytes += storage.descentBytes;
  }
  return { fields: cache?.fields.size ?? 0, evictions: cache?.evictions ?? 0,
    overflowInsertions: cache?.overflowInsertions ?? 0, overflowThinks: cache?.overflowThinks ?? 0,
    peakFields: cache?.peakFields ?? 0, peakOverflow: cache?.peakOverflow ?? 0, distanceBytes, descentBytes };
}
type GoalScratch = { dist: Int32Array; buckets: number[][] };
const goalScratch = new WeakMap<TerrainRuntime, GoalScratch[]>();
const emptyGoalNext = new Int32Array(0);
function takeGoalScratch(state: TerrainRuntime, cells: number): GoalScratch {
  const pool = goalScratch.get(state), index = pool?.findIndex(value => value.dist.length === cells) ?? -1;
  return index >= 0 ? pool!.splice(index, 1)[0]! : { dist: new Int32Array(cells), buckets: Array.from({ length: BUCKETS }, () => []) };
}
function releaseGoalScratch(state: TerrainRuntime, value: GoalScratch) {
  let pool = goalScratch.get(state);
  if (!pool) goalScratch.set(state, pool = []);
  for (const bucket of value.buckets) bucket.length = 0;
  if (pool.length >= 2) pool.shift();
  pool.push(value);
}
const fieldStorage = new WeakMap<GroundDistanceField, { cells: number; distanceBytes: number; descentBytes: number }>();
/** Diagnostic byte counts only; no array or mutable cache is exposed. */
export function goalDistanceFieldStorage(field: GroundDistanceField) {
  const value = fieldStorage.get(field); return value && { ...value };
}

// A walk cannot leave its terrain component. Buildings may only remove cells
// from it, so restricting the flow to this bounding box preserves every route,
// seed, queue removal and cost while avoiding arrays for other islands/basins.
function goalDistanceBox(ground: TerrainRuntime, target: number): Box {
  const wholes = wholesOf(ground);
  return wholes.bounds[wholes.labels[target]! - 1]!;
}

/** One building-aware goal field serves every actor. Uses the same footprint
 * overlay, goal seeds, no-corner-cut steps and pace weights as native steering.
 * A geometry revision discards the old field; peek never builds one. */
export function groundDistanceField(map: Pick<GameMap, 'terrain'>, goal: Point, peek = false): GroundDistanceField | undefined {
  return moverDistanceField(map, goal, 'land', peek);
}
export function moverDistanceField(map: Pick<GameMap, 'terrain'>, goal: Point, mover: Mover, peek = false): GroundDistanceField | undefined {
  recordNativeRouting('moverDistanceField');
  const terrain = map.terrain;
  if (!terrain) return { cost: from => Math.hypot(from.x - goal.x, from.y - goal.y), road: (from, goal) => [from, goal] };
  const state = routing(map, terrain, mover), ground = runtime(terrain, mover);
  const target = padAt(state, goal.x, goal.y), revision = mover === 'land' ? groundRevision(map) : 0;
  if (target < 0 || ground.walk[target] !== 1) return undefined;
  const cache = goalFieldCache(state, revision);
  const known = cache.fields.get(target);
  if (known || peek) return known;
  const box = goalDistanceBox(ground, target);
  const { seeds, costs } = goalSeeds(state, ground, target, box);
  const scratch = takeGoalScratch(state, box.width * box.height);
  const field = beginBoxFlow(state, box, seeds, costs, { dist: scratch.dist, next: emptyGoalNext }, scratch.buckets);
  growBoxInto(state, box, seeds, costs, field, field);
  const scale = terrain.cell / (STRAIGHT * GROUND_WEIGHT);
  const answer = distanceFieldAnswer(state, ground, field, scale);
  // Never recycle an answer's own array: old callers may still hold it. Only
  // the detached Int32 work buffer of a compact answer can re-enter the pool.
  if (fieldStorage.get(answer)!.distanceBytes < field.dist.byteLength) releaseGoalScratch(state, scratch);
  distanceFieldWork.set(answer, field.work);
  cache.fields.set(target, answer);
  trimGoalFields(cache, mover, target);
  return answer;
}
function distanceFieldAnswer(state: TerrainRuntime, ground: TerrainRuntime, source: Pick<BoxField, 'box' | 'dist'>, scale: number): GroundDistanceField {
  const { box } = source;
  let maximum = 0;
  for (let index = 0; index < source.dist.length; index++) {
    const value = source.dist[index]!;
    if (value < UNREACHED && value > maximum) maximum = value;
  }
  // Exact integers, no quantization or saturation. An unusually long maze
  // retains Int32; 65535 is reserved only in the compact representation.
  let dist: Int32Array | Uint16Array = source.dist;
  if (maximum < 65535) {
    const packed = new Uint16Array(source.dist.length);
    for (let index = 0; index < source.dist.length; index++) {
      const value = source.dist[index]!;
      packed[index] = value >= UNREACHED ? 65535 : value;
    }
    dist = packed;
  }
  const unreached = dist instanceof Uint16Array ? 65535 : UNREACHED;
  const storage = { cells: dist.length, distanceBytes: dist.byteLength, descentBytes: 0 };
  const cellOf = (from: Point) => {
    let at = padAt(state, from.x, from.y);
    if (at < 0 || ground.walk[at] !== 1) return -1;
    if (state.walk[at] !== 1) at = nearestWalkable(state, at);
    const index = at < 0 ? -1 : local(box, at, state.width);
    return index < 0 || dist[index]! >= unreached ? -1 : at;
  };
  let directions: Int8Array | undefined;
  const answer: GroundDistanceField = { cost(from) {
    const at = cellOf(from);
    return at < 0 ? undefined : dist[local(box, at, state.width)]! * scale;
  }, road(from, goal) {
    let at = cellOf(from);
    if (at < 0) return undefined;
    if (clearSegment(state, from.x, from.y, goal.x, goal.y)) return [from, goal];
    if (!directions) { directions = new Int8Array(dist.length).fill(UNKNOWN); storage.descentBytes = directions.byteLength; }
    const cells: Point[] = [from];
    for (let step = 0; step < dist.length; step++) {
      const index = local(box, at, state.width);
      let direction = directions[index]!;
      if (direction === UNKNOWN) directions[index] = direction = downhillDirection(state, box, dist, at, index);
      if (direction < 0) break;
      at += state.offsets[direction]!; cells.push(centerOf(state, at));
    }
    if (clearSegment(state, cells.at(-1)!.x, cells.at(-1)!.y, goal.x, goal.y)) cells.push(goal);
    const road = [from];
    for (let index = 0; index < cells.length - 1;) {
      let next = Math.min(cells.length - 1, index + LOOKAHEAD);
      while (next > index + 1 && !clearSegment(state, cells[index]!.x, cells[index]!.y, cells[next]!.x, cells[next]!.y)) next--;
      road.push(cells[next]!); index = next;
    }
    return road;
  } };
  fieldStorage.set(answer, storage); return answer;
}

/** Reconstruct the answer after an absolute, deterministic number of queue removals.
 * A warm cache may avoid computation, but cannot publish a field before that work
 * allowance completes the native search. A cold fork rebuilds the same prefix. */
export function prepareMoverDistanceField(map: Pick<GameMap, 'terrain'>, goal: Point, mover: Mover, throughWork: number):
  { field: GroundDistanceField | undefined; work: number; complete: boolean } {
  recordNativeRouting('prepareMoverDistanceField');
  const known = moverDistanceField(map, goal, mover, true);
  if (known) {
    const required = distanceFieldWork.get(known) ?? 0;
    return { field: required <= throughWork ? known : undefined, work: Math.min(required, throughWork), complete: required <= throughWork };
  }
  if (!map.terrain) return { field: known, work: 0, complete: true };
  const terrain = map.terrain, state = routing(map, terrain, mover), ground = runtime(terrain, mover);
  const target = padAt(state, goal.x, goal.y), revision = mover === 'land' ? groundRevision(map) : 0;
  if (target < 0 || ground.walk[target] !== 1) return { field: undefined, work: 0, complete: true };
  if (throughWork <= 0) return { field: undefined, work: 0, complete: false };
  let pending = pendingDistanceFields.get(state);
  if (pending?.revision !== revision) pendingDistanceFields.set(state, pending = { revision, jobs: new Map() });
  let retained = pending.jobs.get(target);
  if (!retained) {
    const box = goalDistanceBox(ground, target);
    const { seeds, costs } = goalSeeds(state, ground, target, box);
    // Limit abandoned candidates' sidecar geometry, independently of game state.
    if (pending.jobs.size >= PENDING_GOAL_DISTANCE_FIELD_LIMIT) {
      const oldest = pending.jobs.keys().next().value!, abandoned = pending.jobs.get(oldest)!;
      pending.jobs.delete(oldest); releaseGoalScratch(state, abandoned.flow);
    }
    const scratch = takeGoalScratch(state, box.width * box.height);
    const flow = beginBoxFlow(state, box, seeds, costs, { dist: scratch.dist, next: emptyGoalNext }, scratch.buckets);
    pending.jobs.set(target, retained = { flow, progress: 0 });
  }
  const job = retained.flow;
  if (retained.progress < throughWork) {
    growBoxInto(state, job.box, job.seeds, job.costs, job, job, throughWork - retained.progress);
    retained.progress += job.work;
  }
  if (job.pending || job.seeded < job.order.length) return { field: undefined, work: throughWork, complete: false };
  pending.jobs.delete(target);
  const field = distanceFieldAnswer(state, ground, job, terrain.cell / (STRAIGHT * GROUND_WEIGHT));
  if (fieldStorage.get(field)!.distanceBytes < job.dist.byteLength) releaseGoalScratch(state, job);
  distanceFieldWork.set(field, retained.progress);
  const cache = distanceFields.get(state)!;
  cache.fields.set(target, field);
  trimGoalFields(cache, mover, target);
  return { field: retained.progress <= throughWork ? field : undefined,
    work: Math.min(retained.progress, throughWork), complete: retained.progress <= throughWork };
}

// @@@ground-wholes - A mover's cells fall into wholes, each joined by its walks and cut off from every other: an island's
// land is a whole of its own, and so is a lake's water. Whether two points stand in one whole is sameGround; how many
// wholes there are, groundWholes (a ladder map's land is one: the generator keeps no open ground a start cannot reach).
// Terrain only: a building in the way cuts no whole (see @@@building-pathing). A map without terrain is one whole.
export function sameGround(map: Pick<GameMap, "terrain">, a: Point, b: Point, mover: Mover = "land") {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = runtime(terrain, mover);
  const { labels } = wholesOf(state);
  const from = padAt(state, a.x, a.y);
  const to = padAt(state, b.x, b.y);
  return from >= 0 && to >= 0 && labels[from] !== 0 && labels[from] === labels[to];
}

export function groundWholes(map: Pick<GameMap, "terrain">, mover: Mover = "land") {
  return map.terrain ? wholesOf(runtime(map.terrain, mover)).count : 1;
}

/** Terrain-only connected component, shared by read-only strategic/observation tools. */
export function groundWholeAt(map: Pick<GameMap, "terrain">, point: Point, mover: Mover = 'land'): number | undefined {
  if (!map.terrain) return 1;
  const state = runtime(map.terrain, mover), at = padAt(state, point.x, point.y);
  if (at < 0) return undefined;
  return wholesOf(state).labels[at] || undefined;
}

/** Anchors recorded while labeling the existing components; no second scan or numbering. */
export function groundWholeAnchors(map: Pick<GameMap, 'terrain'>, mover: Mover = 'land') {
  if (!map.terrain) return [{ label: 1, point: { x: 0, y: 0 } }];
  return wholesOf(runtime(map.terrain, mover)).anchors.map((point, index) => ({ label: index + 1, point: { ...point } }));
}

/** Land/water contacts from the original component labels. Shallow cells can
 * belong to both movers; sea-only cells meet land through cardinal neighbours.
 * This is landing geometry, not a shipyard footprint or a hull passage test. */
export function groundShoreContacts(map: Pick<GameMap, 'terrain'>, firstRow: number, endRow: number) {
  const contacts: { land: number; sea: number; ground: Point; water: Point }[] = [];
  if (!map.terrain) return contacts;
  const land = runtime(map.terrain, 'land'), sea = runtime(map.terrain, 'sea');
  const lands = wholesOf(land).labels, seas = wholesOf(sea).labels, { width, terrain } = land;
  for (let row = Math.max(0, firstRow); row < Math.min(endRow, terrain.rows); row++) for (let col = 0; col < terrain.cols; col++) {
    const at = (row + 1) * width + col + 1, seaLabel = seas[at]!;
    if (!seaLabel) continue;
    const water = { x: (col + .5) * terrain.cell, y: (row + .5) * terrain.cell };
    if (lands[at]) contacts.push({ land: lands[at]!, sea: seaLabel, ground: water, water });
    else for (const step of [-1, 1, -width, width]) if (lands[at + step]) contacts.push({
      land: lands[at + step]!, sea: seaLabel, ground: centerOf(land, at + step), water });
  }
  return contacts;
}

export type GroundShore = Readonly<{
  landId: `land:${number}`; seaId: `sea:${number}`; ground: Point; water: Point;
}>;
export type GroundRegionIndex = Readonly<{
  lands: ReadonlyMap<`land:${number}`, Point>;
  seas: ReadonlyMap<`sea:${number}`, Point>;
  shores: readonly GroundShore[];
  shoresByLand: ReadonlyMap<`land:${number}`, ReadonlyMap<`sea:${number}`, readonly GroundShore[]>>;
  /** Row-ordered native boarding candidate cells, indexed during the existing
   * geographic warmup. Dynamic placement remains a per-candidate check. */
  boardingCellsByLand?: ReadonlyMap<`land:${number}`, ReadonlyMap<`sea:${number}`, readonly number[]>>;
  scannedRows: number; totalRows: number; scannedAtTick: number;
}>;
type MutableRegionIndex = {
  lands: Map<`land:${number}`, Point>; seas: Map<`sea:${number}`, Point>;
  shores: GroundShore[];
  shoresByLand: Map<`land:${number}`, Map<`sea:${number}`, GroundShore[]>>;
  boardingCellsByLand: Map<`land:${number}`, Map<`sea:${number}`, number[]>>;
  scannedRows: number; totalRows: number; scannedAtTick: number;
};
const groundRegionIndices = new WeakMap<Terrain, MutableRegionIndex>();

/** Static geographic facts from the same mover labels used by sameGround.
 * Warm these with the map; no owner, planning request or publication state is read. */
export function groundRegionIndex(map: Pick<GameMap, 'terrain'>, rowBudget = Infinity, tick = 0): GroundRegionIndex {
  const terrain = map.terrain;
  if (!terrain) return { lands: new Map([['land:1', { x: 0, y: 0 }]]),
    seas: new Map([['sea:1', { x: 0, y: 0 }]]), shores: [], shoresByLand: new Map(), boardingCellsByLand: new Map(),
    scannedRows: 0, totalRows: 0, scannedAtTick: tick };
  let result = groundRegionIndices.get(terrain);
  if (!result) groundRegionIndices.set(terrain, result = {
    lands: new Map(groundWholeAnchors(map).map(({ label, point }) => [`land:${label}` as const, point])),
    seas: new Map(groundWholeAnchors(map, 'sea').map(({ label, point }) => [`sea:${label}` as const, point])),
    shores: [], shoresByLand: new Map(), boardingCellsByLand: new Map(), scannedRows: 0, totalRows: terrain.rows, scannedAtTick: tick,
  });
  if (result.scannedRows === terrain.rows) return result;
  const end = Math.min(terrain.rows, result.scannedRows + rowBudget);
  if (end > result.scannedRows) result.scannedAtTick = tick;
  for (const contact of groundShoreContacts(map, result.scannedRows, end)) {
    const shore: GroundShore = { landId: `land:${contact.land}`, seaId: `sea:${contact.sea}`,
      ground: contact.ground, water: contact.water };
    result.shores.push(shore);
    let seas = result.shoresByLand.get(shore.landId);
    if (!seas) result.shoresByLand.set(shore.landId, seas = new Map());
    let contacts = seas.get(shore.seaId);
    if (!contacts) seas.set(shore.seaId, contacts = []);
    contacts.push(shore);
    if (contact.ground.x === contact.water.x && contact.ground.y === contact.water.y) {
      const index = Math.floor(contact.water.y / terrain.cell) * terrain.cols + Math.floor(contact.water.x / terrain.cell);
      if (terrain.cells[index] === ',') {
        let seas = result.boardingCellsByLand.get(shore.landId);
        if (!seas) result.boardingCellsByLand.set(shore.landId, seas = new Map());
        let cells = seas.get(shore.seaId);
        if (!cells) seas.set(shore.seaId, cells = []);
        cells.push(index);
      }
    }
  }
  result.scannedRows = end;
  return result;
}

function wholesOf(state: TerrainRuntime) {
  if (state.wholes) return state.wholes;
  const { walk, offsets, terrain, width } = state;
  const labels = new Int32Array(walk.length);
  const queue = new Int32Array(walk.length);
  const anchors: Point[] = [];
  const bounds: Box[] = [];
  let count = 0;
  for (let seed = 0; seed < walk.length; seed += 1) {
    if (walk[seed] !== 1 || labels[seed] !== 0) continue;
    count += 1;
    anchors.push(centerOf(state, seed));
    let left = seed % width, right = left, top = Math.floor(seed / width), bottom = top;
    labels[seed] = count;
    let tail = 0;
    queue[tail++] = seed;
    for (let head = 0; head < tail; head += 1) {
      const at = queue[head]!;
      const col = at % width, row = Math.floor(at / width);
      left = Math.min(left, col); right = Math.max(right, col); top = Math.min(top, row); bottom = Math.max(bottom, row);
      for (let direction = 0; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1 || labels[next] !== 0 || !stepAllowed(state, at, direction)) continue;
        labels[next] = count;
        queue[tail++] = next;
      }
    }
    bounds.push({ left, top, width: right - left + 1, height: bottom - top + 1 });
  }
  // Each whole's deep water (see @@@open-water), by its label.
  const deep = new Int32Array(count + 1);
  for (let index = 0; index < terrain.cols * terrain.rows; index += 1) {
    if (terrain.cells[index] !== "~") continue;
    const col = index % terrain.cols;
    deep[labels[((index - col) / terrain.cols + 1) * width + col + 1]!]! += 1;
  }
  deep[0] = 0;
  state.wholes = { labels, count, deep, anchors, bounds };
  return state.wholes;
}

// The cells a walk from `from` to `goal` passes, down the whole map's field toward the goal (every `every`-th cell's
// center, the goal last), or undefined when no walk joins them. A map without terrain walks the straight line. It reads
// the terrain alone (see @@@building-pathing).
export function walkRoute(map: Pick<GameMap, "terrain">, from: Point, goal: Point, every = 2): Point[] | undefined {
  recordNativeRouting('walkRoute');
  const terrain = map.terrain;
  if (!terrain) return [goal];
  const state = runtime(terrain, "land");
  const start = padAt(state, from.x, from.y);
  const target = padAt(state, goal.x, goal.y);
  if (state.walk[start] !== 1 || state.walk[target] !== 1) return undefined;
  const field = exactField(state, target);
  if (field.dist[start]! >= UNREACHED) return undefined;
  const route: Point[] = [];
  let at = start;
  for (let step = 1; at !== target && step < state.walk.length; step += 1) {
    at = nextStep(state, field, at);
    if (at < 0) return undefined;
    if (step % every === 0) route.push(centerOf(state, at));
  }
  route.push(goal);
  return route;
}

// @@@building-pathing - Buildings stand in the land's way as forest does, but they are each game's own and they come and
// go: the sim hands the map its buildings whenever they change (see setBuildingBodies), and they are kept on a copy of the
// land's cells with every cell of their footprints blocked (see @@@building-footprint), with its own clearance, flow tiles
// and nearest cells. A building laid or felled redoes the tiles of the squares it changed and of those beside them (see
// @@@flow-tiles). The AIs' walking distances and routes read the terrain alone: what a building adds to a walk is a few
// steps round it.
//
// Routing and walking read the copy alike (see isOpenGround): a unit's center never stands on a footprint, so a walk
// starts from the cell under it and every gap routing takes is one a unit walks. Whether a building may be laid
// (isFootprintBuildable) and where a goal may lie (walkableGoal) stay the terrain's alone: a goal on a footprint is walked
// to the edge of it.
//
// The copy hangs on the game's map object (a snapshot shares it), never on the terrain, which games may share. A map
// without terrain has no routing to take a unit round anything, and its buildings stand in nobody's way but by their
// round bodies (see @@@building-body). Ships keep the sea's own routing: no building stands in deep water.
type Body = { x: number; y: number; radius: number };
// `previous`: the cells as they were before the last change, kept to tell which squares that change reached.
type Overlay = { terrain: Terrain; state: TerrainRuntime; previous: Uint8Array; revision:number; bodies: Body[]; shared: boolean };
const overlays = new WeakMap<object, Overlay>();
let nextGroundRevision=1;
/** Identity of the current building obstruction field, for geometry-only caches. */
export function groundRevision(map:object){return overlays.get(map)?.revision ?? 0;}

/** A snapshot reads this geometry; later construction must leave that snapshot's field intact. */
export function shareBuildingBodies(source: object, target: object) {
  const overlay = overlays.get(source);
  if (overlay) {
    overlay.shared = true;
    overlays.set(target, overlay);
  }
}

export function setBuildingBodies(map: Pick<GameMap, "terrain">, bodies: readonly Body[]) {
  const terrain = map.terrain;
  if (!terrain) return;
  if (bodies.length === 0) {
    overlays.delete(map);
    return;
  }
  const current = overlays.get(map);
  if (current?.terrain === terrain && current.bodies.length === bodies.length
    && bodies.every((body, index) => body.x === current.bodies[index]!.x
      && body.y === current.bodies[index]!.y && body.radius === current.bodies[index]!.radius)) return;
  const ground = runtime(terrain, "land");
  let overlay = current;
  if (!overlay || overlay.terrain !== terrain) {
    // A copy warmed for this map (see @@@terrain-warmup) holds the bodies it was built with; the diff below redoes what
    // differs, exactly as for any unshared copy.
    const warmed = warmedOverlays.get(map);
    warmedOverlays.delete(map);
    if (warmed?.terrain === terrain) overlay = warmed;
    else {
      const fresh = createRuntime(terrain, "land");
      overlay = { terrain, state: fresh, previous: new Uint8Array(fresh.walk.length), revision:nextGroundRevision++, bodies: [], shared: false };
    }
    overlays.set(map, overlay);
  } else if (overlay.shared) {
    // The snapshot keeps the shared copy. This map continues from a private
    // copy of it and redoes only the squares the change reaches, as an unshared
    // copy would, instead of rebuilding every square on its next walk.
    const copy = copyRouting(overlay.state);
    overlay = { terrain, state: copy, previous: new Uint8Array(copy.walk.length), revision:nextGroundRevision++, bodies: [], shared: false };
    overlays.set(map, overlay);
  }
  overlay.bodies = bodies.map(({ x, y, radius }) => ({ x, y, radius }));
  const state = overlay.state;
  overlay.previous.set(state.walk);
  state.walk.set(ground.walk);
  blockFootprints(state, bodies);
  const dirty = new Set<number>();
  for (let at = 0; at < state.walk.length; at += 1) {
    if (state.walk[at] === overlay.previous[at]) continue;
    const col = (at % state.width) - 1;
    const row = Math.floor(at / state.width) - 1;
    dirty.add(Math.floor(row / SECTOR) * Math.ceil(terrain.cols / SECTOR) + Math.floor(col / SECTOR));
  }
  if (dirty.size === 0) return;
  overlay.revision=nextGroundRevision++;
  // A connectivity-only runtime has not needed clearance yet. Its first
  // segment query will build it from the current, updated walkable cells.
  if (state.clearance) { state.clearance.fill(0); fillClearance(state); }
  state.nearest.clear();
  if (state.tiles) redoTiles(state, state.tiles, dirty);
}

// @@@terrain-warmup - What a game's first walks would build from its terrain and the buildings it starts with, built
// before its first tick instead: each mover's wholes and their static coast index, the sea's clearance and tiles (they first served a ship's launch
// steer at minute eight, 33 ms inside one tick), the sea's shore spots for the given radii, and the building copy with
// its tiles and clearance. Each is a cache of a pure function of the cells (see @@@terrain-runtime). The copy waits beside
// the map until the first setBuildingBodies hands it these bodies: until then walks read the bare land, as they would cold.
const warmedOverlays = new WeakMap<object, Overlay>();
export function warmTerrainRouting(map: Pick<GameMap, "terrain">, bodies: readonly Body[], shoreRadii: readonly number[] = []) {
  const terrain = map.terrain;
  if (!terrain) return;
  wholesOf(runtime(terrain, "land"));
  const sea = runtime(terrain, "sea");
  wholesOf(sea);
  groundRegionIndex(map);
  if (!sea.clearance) fillClearance(sea);
  tilesOf(sea);
  for (const radius of shoreRadii) shoreSpots(map, radius);
  if (bodies.length === 0 || overlays.get(map)?.terrain === terrain) return;
  const state = createRuntime(terrain, "land");
  blockFootprints(state, bodies);
  fillClearance(state);
  tilesOf(state);
  warmedOverlays.set(map, { terrain, state, previous: new Uint8Array(state.walk.length), revision: nextGroundRevision++, bodies: bodies.map(({ x, y, radius }) => ({ x, y, radius })), shared: false });
}

function blockFootprints(state: TerrainRuntime, bodies: readonly Body[]) {
  const { terrain } = state, size = terrain.cell;
  for (const body of bodies) {
    const { left, right, top, bottom } = footprintCells(size, body.x, body.y, body.radius);
    for (let row = Math.max(0, top); row <= Math.min(terrain.rows - 1, bottom); row += 1) {
      for (let col = Math.max(0, left); col <= Math.min(terrain.cols - 1, right); col += 1) state.walk[pad(state, col, row)] = 0;
    }
  }
}

// The runtime a mover's routing runs on: the land's with this game's buildings when it has any.
function routing(map: object, terrain: Terrain, mover: Mover): TerrainRuntime {
  if (mover === "land") {
    const overlay = overlays.get(map);
    if (overlay && overlay.terrain === terrain) return overlay.state;
  }
  return runtime(terrain, mover);
}

// `used`: when the field was last asked for, by the runtime's clock (the least recently used goes first).
type Field = { dist: Int32Array; next: Int32Array; used: number };

type TerrainRuntime = {
  terrain: Terrain;
  // The grid with a blocked border cell all round (cols + 2 wide), so no step ever needs a bounds check.
  width: number;
  // 1 on a cell the runtime's mover may cross (see @@@terrain-movers).
  walk: Uint8Array;
  // What a step onto the cell costs, in quarters of bare ground's (see GROUND_WEIGHT): its ground's for a land unit, bare
  // ground's everywhere for a ship.
  weight: Uint8Array;
  // Chebyshev distance in cells to the nearest blocked cell (or the map's edge): 0 on a blocked cell.
  clearance?: Uint16Array;
  fields: Map<number, Field>;
  spare: Field[];
  clock: number;
  nearest: Map<number, number>;
  // Dial's buckets, kept between fields: the whole map's (see grow) and the boxes' (see growBox).
  buckets?: Int32Array[];
  tops: Int32Array;
  boxBuckets: number[][];
  offsets: Int32Array;
  // The routing of walks (see @@@flow-tiles), built when first asked for.
  tiles?: Tiles | undefined;
  // Which whole of the mover's ground every cell belongs to (see @@@ground-wholes), worked out the first time it is asked.
  wholes?: { labels: Int32Array; count: number; deep: Int32Array; anchors: Point[]; bounds: Box[] };
  // The sea's shore spots by a shipyard's radius (see shoreSpots), worked out the first time each is asked.
  shores?: Map<number, Point[]>;
  // Nearest-of fields by their candidates' cells, the least recently used first (see @@@nearest-field).
  nearestFields?: Map<string, { dist: Int32Array; label: Int32Array }>;
};

// @@@terrain-runtime - What the terrain's queries need, built once per terrain and mover and kept beside the terrain (never
// in the game's state): the cells the mover may cross, their clearance, and the flow fields and nearest cells asked for so
// far. Every one is a pure function of the terrain, so whether it was cached changes nothing a unit does.
type Runtimes = { land?: TerrainRuntime; sea?: TerrainRuntime };
const runtimes = new WeakMap<Terrain, Runtimes>();
let lastTerrain: Terrain | undefined;
let lastRuntimes: Runtimes = {};

function runtime(terrain: Terrain, mover: Mover): TerrainRuntime {
  if (terrain !== lastTerrain) {
    lastTerrain = terrain;
    lastRuntimes = runtimes.get(terrain) ?? {};
    runtimes.set(terrain, lastRuntimes);
  }
  return mover === "land" ? (lastRuntimes.land ??= createRuntime(terrain, "land")) : (lastRuntimes.sea ??= createRuntime(terrain, "sea"));
}

function createRuntime(terrain: Terrain, mover: Mover): TerrainRuntime {
  const width = terrain.cols + 2;
  const count = width * (terrain.rows + 2);
  const walk = new Uint8Array(count);
  const weight = new Uint8Array(count);
  const passable = PASSABLE[mover];
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) {
      const char = terrain.cells[row * terrain.cols + col]!;
      if (!passable.has(char)) continue;
      const at = (row + 1) * width + col + 1;
      walk[at] = 1;
      weight[at] = mover === "sea" ? GROUND_WEIGHT : Math.round(GROUND_WEIGHT / (CELL_GROUND[char]?.pace ?? 1));
    }
  }
  const offsets = Int32Array.from([1, width, -1, -width, width + 1, width - 1, -width - 1, -width + 1]);
  const state: TerrainRuntime = {
    terrain,
    width,
    walk,
    weight,
    fields: new Map(),
    clock: 0,
    spare: [],
    nearest: new Map(),
    tops: new Int32Array(8),
    boxBuckets: Array.from({ length: BUCKETS }, () => []),
    offsets,
  };
  return state;
}

// A private copy of a building copy's routing (see @@@building-pathing), for a map that changes its buildings while a
// snapshot still reads the original: its own cells, clearance, nearest cells and tiles. A redo (see redoTiles) hands the
// copy's window sides new fields and edges and never writes into the old ones; a field both copies keep belongs to a square
// whose cells neither changed, so the steps it remembers (see downhill) are the same for both.
function copyRouting(state: TerrainRuntime): TerrainRuntime {
  return {
    terrain: state.terrain,
    width: state.width,
    walk: state.walk.slice(),
    weight: state.weight,
    ...(state.clearance ? { clearance: state.clearance.slice() } : {}),
    fields: new Map(),
    spare: [],
    clock: 0,
    nearest: new Map(state.nearest),
    tops: new Int32Array(8),
    boxBuckets: Array.from({ length: BUCKETS }, () => []),
    offsets: state.offsets,
    ...(state.tiles ? { tiles: copyTiles(state.tiles) } : {}),
  };
}

function copyTiles(tiles: Tiles): Tiles {
  const nodes = new Map<number, TileNode>();
  for (const [key, node] of tiles.nodes) nodes.set(key, { ...node });
  return {
    columns: tiles.columns,
    rows: tiles.rows,
    nodes,
    borders: new Map(tiles.borders),
    region: tiles.region.slice(),
    island: tiles.island.slice(),
    goals: new Map(tiles.goals),
    exits: new Map(tiles.exits),
    nearest: new Map(tiles.nearest),
  };
}

function pad(state: TerrainRuntime, col: number, row: number) {
  return (row + 1) * state.width + col + 1;
}

// The padded index of the cell under a point, or -1 off the map.
function padAt(state: TerrainRuntime, x: number, y: number) {
  const { terrain } = state;
  const col = Math.floor(x / terrain.cell);
  const row = Math.floor(y / terrain.cell);
  if (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows) return -1;
  return (row + 1) * state.width + col + 1;
}

function centerOf(state: TerrainRuntime, at: number): Point {
  const col = (at % state.width) - 1;
  const row = Math.floor(at / state.width) - 1;
  return { x: (col + 0.5) * state.terrain.cell, y: (row + 0.5) * state.terrain.cell };
}

// Diagonal steps (offsets 4 to 7) never cut a corner: both cells beside the step must be walkable.
function stepAllowed(state: TerrainRuntime, at: number, direction: number) {
  if (direction < 4) return true;
  const { walk, width } = state;
  const dx = direction === 4 || direction === 7 ? 1 : -1;
  const dy = direction === 4 || direction === 5 ? width : -width;
  return walk[at + dx] === 1 && walk[at + dy] === 1;
}

function fillClearance(state: TerrainRuntime) {
  const { walk, offsets } = state;
  const clearance = state.clearance ??= new Uint16Array(walk.length);
  const queue = new Int32Array(walk.length);
  let tail = 0;
  // Blocked cells (the border among them) seed their walkable neighbours at 1.
  for (let at = 0; at < walk.length; at += 1) {
    if (walk[at] !== 1) continue;
    for (let direction = 0; direction < 8; direction += 1) {
      if (walk[at + offsets[direction]!] === 1) continue;
      clearance[at] = 1;
      queue[tail++] = at;
      break;
    }
  }
  for (let head = 0; head < tail; head += 1) {
    const at = queue[head]!;
    const value = clearance[at]! + 1;
    for (let direction = 0; direction < 8; direction += 1) {
      const next = at + offsets[direction]!;
      if (walk[next] !== 1 || clearance[next] !== 0) continue;
      clearance[next] = value;
      queue[tail++] = next;
    }
  }
}

// Whether the segment crosses only walkable cells. It steps from cell to cell, but across open ground it leaps: a cell
// whose clearance is k has every cell within k - 1 of it walkable, so the walk jumps to the edge of that square.

function clearSegment(state: TerrainRuntime, ax: number, ay: number, bx: number, by: number) {
  const { terrain, walk, width } = state;
  const size = terrain.cell;
  let at = padAt(state, ax, ay);
  const end = padAt(state, bx, by);
  if (at < 0 || end < 0 || walk[at] !== 1 || walk[end] !== 1) return false;
  if (at === end) return true;
  if (!state.clearance) fillClearance(state);
  const clearance = state.clearance!;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / length;
  const uy = dy / length;
  let t = 0;
  for (let guard = 0; guard < 2 * (terrain.cols + terrain.rows) + 8; guard += 1) {
    const col = (at % width) - 1;
    const row = Math.floor(at / width) - 1;
    const reach = clearance[at]! - 1;
    // The walkable square around the cell, and where the segment leaves it.
    const left = (col - reach) * size;
    const right = (col + reach + 1) * size;
    const top = (row - reach) * size;
    const bottom = (row + reach + 1) * size;
    const px = ax + ux * t;
    const py = ay + uy * t;
    const exitX = ux > 0 ? (right - px) / ux : ux < 0 ? (left - px) / ux : Infinity;
    const exitY = uy > 0 ? (bottom - py) / uy : uy < 0 ? (top - py) / uy : Infinity;
    const exit = Math.min(exitX, exitY);
    if (t + exit >= length) return true;
    const leaveX = exitX <= exitY;
    const leaveY = exitY <= exitX;
    t += exit;
    // The cell the segment enters as it leaves the square (across a corner it passes exactly, the diagonal one).
    let nextCol = Math.floor((ax + ux * t) / size);
    let nextRow = Math.floor((ay + uy * t) / size);
    if (leaveX) nextCol = ux > 0 ? Math.max(nextCol, col + reach + 1) : Math.min(nextCol, col - reach - 1);
    if (leaveY) nextRow = uy > 0 ? Math.max(nextRow, row + reach + 1) : Math.min(nextRow, row - reach - 1);
    if (nextCol < 0 || nextRow < 0 || nextCol >= terrain.cols || nextRow >= terrain.rows) return false;
    // Through a corner exactly: both cells beside it must be open, or the walk would squeeze between two blocks.
    if (leaveX && leaveY && (walk[pad(state, ux > 0 ? col + reach : col - reach, nextRow)] !== 1 || walk[pad(state, nextCol, uy > 0 ? row + reach : row - reach)] !== 1)) return false;
    at = pad(state, nextCol, nextRow);
    if (walk[at] !== 1) return false;
    if (at === end) return true;
  }
  return false;
}

// The neighbour one step down the field (the fixed order of directions breaks ties), or -1 at the bottom; remembered in
// the field, so a cell is worked out once.
function nextStep(state: TerrainRuntime, field: Field, at: number) {
  const known = field.next[at]!;
  if (known !== UNKNOWN) return known;
  const { walk, offsets } = state;
  const dist = field.dist;
  let best = -1;
  let bestCost = dist[at]!;
  for (let direction = 0; direction < 8; direction += 1) {
    const next = at + offsets[direction]!;
    if (walk[next] !== 1 || dist[next]! >= bestCost || !stepAllowed(state, at, direction)) continue;
    bestCost = dist[next]!;
    best = next;
  }
  field.next[at] = best;
  return best;
}

function exactField(state: TerrainRuntime, target: number): Field {
  recordNativeRouting('exactField');
  return cached(state, target, () => grow(state, [target]));
}

function cached(state: TerrainRuntime, key: number, build: () => Field): Field {
  state.clock += 1;
  const known = state.fields.get(key);
  if (known) {
    known.used = state.clock;
    return known;
  }
  // Only a new field looks for the one to drop (a hit is one write, not a reorder of the map).
  if (state.fields.size >= FIELD_CACHE) {
    let oldest: number | undefined;
    let oldestUse = Infinity;
    for (const [candidate, field] of state.fields) {
      if (field.used < oldestUse) {
        oldestUse = field.used;
        oldest = candidate;
      }
    }
    state.spare.push(state.fields.get(oldest!)!);
    state.fields.delete(oldest!);
  }
  const field = build();
  field.used = state.clock;
  state.fields.set(key, field);
  return field;
}

// The walking cost over the whole map from every cell to the nearest source, on the terrain alone (Dial's algorithm over
// eight neighbours, no corner cut): the AIs' walking distances and routes (see walkingDistance, walkRoute).
function grow(state: TerrainRuntime, sources: number[]): Field {
  recordNativeRouting('grow');
  const { walk, offsets, tops } = state;
  const buckets = state.buckets ??= Array.from({ length: 8 }, () => new Int32Array(walk.length));
  const field = state.spare.pop() ?? { dist: new Int32Array(walk.length), next: new Int32Array(walk.length), used: 0 };
  const dist = field.dist;
  dist.fill(UNREACHED);
  field.next.fill(UNKNOWN);
  tops.fill(0);
  let pending = 0;
  for (const source of sources) {
    dist[source] = 0;
    buckets[0]![tops[0]!++] = source;
    pending += 1;
  }
  for (let cost = 0; pending > 0; cost += 1) {
    const slot = cost & 7;
    const bucket = buckets[slot]!;
    while (tops[slot]! > 0) {
      const at = bucket[--tops[slot]!]!;
      pending -= 1;
      if (dist[at] !== cost) continue;
      // The first four offsets are right, down, left, up. Keep their original
      // walk reads for the later corner tests, including rejected relaxations.
      let sides = 0;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1) continue;
        sides |= 1 << direction;
        const reached = cost + STRAIGHT;
        if (reached >= dist[next]!) continue;
        dist[next] = reached;
        const into = reached & 7;
        buckets[into]![tops[into]!++] = next;
        pending += 1;
      }
      // Continue in the same 4..7 order. A diagonal needs the two adjoining
      // cardinal bits: right/down, down/left, left/up, up/right.
      for (let direction = 4; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1) continue;
        const reached = cost + DIAGONAL;
        if (reached >= dist[next]!) continue;
        const corner = direction === 4 ? 3 : direction === 5 ? 6 : direction === 6 ? 12 : 9;
        if ((sides & corner) !== corner) continue;
        dist[next] = reached;
        const into = reached & 7;
        buckets[into]![tops[into]!++] = next;
        pending += 1;
      }
    }
  }
  return field;
}

// The walkable cell whose center is nearest the given cell's center (the lowest index among equals), or -1 when none is.
function nearestWalkable(state: TerrainRuntime, at: number): number {
  if (at >= 0 && state.walk[at] === 1) return at;
  const known = state.nearest.get(at);
  if (known !== undefined) return known;
  const { terrain, width } = state;
  const col = at < 0 ? 0 : (at % width) - 1;
  const row = at < 0 ? 0 : Math.floor(at / width) - 1;
  let best = -1;
  let bestDistance = Infinity;
  const limit = Math.max(terrain.cols, terrain.rows);
  for (let ring = 1; ring <= limit; ring += 1) {
    // A cell on this ring is at least `ring` cells away; stop once none can beat the best.
    if (ring * ring > bestDistance) break;
    for (let r = row - ring; r <= row + ring; r += 1) {
      for (let c = col - ring; c <= col + ring; c += 1) {
        if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== ring) continue;
        if (c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows) continue;
        const index = pad(state, c, r);
        if (state.walk[index] !== 1) continue;
        const gap = (c - col) * (c - col) + (r - row) * (r - row);
        if (gap < bestDistance || (gap === bestDistance && index < best)) {
          bestDistance = gap;
          best = index;
        }
      }
    }
  }
  if (state.nearest.size > 4_096) state.nearest.clear();
  state.nearest.set(at, best);
  return best;
}
