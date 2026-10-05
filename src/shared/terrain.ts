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
  palette?: 'coastal';
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
// axis as is, sliding along the wall, else where it stands; a unit standing where nothing is open steps anywhere (it is
// walking out). Walking, parting and slides all step so: parted all at once or not at all, a unit by a wall never gave
// way to a friend walking down a passage one cell wide, and the friend stood behind it for good.
export function openStep(map: Pick<GameMap, "terrain">, from: Point, to: Point, mover: Mover = "land"): Point {
  if (isOpenGround(map, to.x, to.y, mover) || !isOpenGround(map, from.x, from.y, mover)) return to;
  if (isOpenGround(map, to.x, from.y, mover)) return { x: to.x, y: from.y };
  if (isOpenGround(map, from.x, to.y, mover)) return { x: from.x, y: to.y };
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

// Whether a building of the given radius may stand at the point: every cell of its footprint is walkable and none is
// a ramp (a map without terrain has nothing to refuse). @@@ramp-unbuildable - A ramp is a main's one way out, as on a
// Warcraft III map, where ramps take no building: once buildings are bodies (see @@@building-body) a tower or a farm on
// it would shut its owner in.
export function isFootprintBuildable(map: Pick<GameMap, "terrain">, x: number, y: number, radius: number) {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = runtime(terrain, "land");
  return everyFootprintCell(terrain, x, y, radius, (at, cell) => state.walk[at] === 1 && terrain.levels?.[cell] !== "2");
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
  if (wholesOf(sea).deep.some((cells) => cells >= OPEN_WATER)) {
    for (let index = 0; index < terrain.cols * terrain.rows; index += 1) {
      const spot = cellCenter(terrain, index);
      if (isShoreFootprint(map, spot.x, spot.y, radius)) spots.push(spot);
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
  const terrain = map.terrain;
  if (!terrain) return goal;
  const ground = runtime(terrain, mover);
  const state = routing(map, terrain, mover);
  const start = padAt(state, from.x, from.y);
  const target = padAt(state, goal.x, goal.y);
  if (start < 0 || target < 0 || ground.walk[target] !== 1) return goal;
  const near = nearestWalkable(state, start);
  if (near < 0) return goal;
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
  const { walk, offsets, width, weight } = state;
  const columns = box.width;
  const rows = box.height;
  const origin = box.top * width + box.left;
  const size = columns * rows;
  const dist = new Int32Array(size).fill(UNREACHED);
  const next = new Int32Array(size).fill(UNKNOWN);
  const buckets = state.boxBuckets;
  const order = seeds.map((_, index) => index);
  if (costs) order.sort((a, b) => costs[a]! - costs[b]! || a - b);
  const costOf = (index: number) => (costs ? costs[order[index]!]! : 0);
  let seeded = 0;
  let pending = 0;
  for (let cost = order.length > 0 ? costOf(0) : 0; pending > 0 || seeded < order.length; cost += 1) {
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
      const index = bucket.pop()!;
      pending -= 1;
      if (dist[index] !== cost) continue;
      const col = index % columns;
      const row = (index - col) / columns;
      const at = origin + row * width + col;
      for (let direction = 0; direction < 8; direction += 1) {
        const stepCol = col + STEP_COLS[direction]!;
        const stepRow = row + STEP_ROWS[direction]!;
        if (stepCol < 0 || stepRow < 0 || stepCol >= columns || stepRow >= rows) continue;
        const step = at + offsets[direction]!;
        if (walk[step] !== 1) continue;
        const there = stepRow * columns + stepCol;
        const reached = cost + (direction < 4 ? STRAIGHT : DIAGONAL) * weight[step]!;
        if (reached >= dist[there]! || !stepAllowed(state, at, direction)) continue;
        dist[there] = reached;
        buckets[reached % BUCKETS]!.push(there);
        pending += 1;
      }
    }
  }
  return { box, dist, next };
}

// The neighbour one step down a box field (the fixed order of directions breaks ties), or -1 at its bottom; remembered.
function downhill(state: TerrainRuntime, field: BoxField, at: number) {
  const { walk, offsets, width } = state;
  const { box } = field;
  const index = local(box, at, width);
  if (index < 0) return -1;
  const known = field.next[index]!;
  if (known !== UNKNOWN) return known;
  const col = index % box.width;
  const row = (index - col) / box.width;
  let best = -1;
  let bestCost = field.dist[index]!;
  for (let direction = 0; direction < 8; direction += 1) {
    const stepCol = col + STEP_COLS[direction]!;
    const stepRow = row + STEP_ROWS[direction]!;
    if (stepCol < 0 || stepRow < 0 || stepCol >= box.width || stepRow >= box.height) continue;
    const step = at + offsets[direction]!;
    const there = stepRow * box.width + stepCol;
    if (walk[step] !== 1 || field.dist[there]! >= bestCost || !stepAllowed(state, at, direction)) continue;
    bestCost = field.dist[there]!;
    best = step;
  }
  field.next[index] = best;
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
  for (let ring = 1; ring <= Math.max(terrain.cols, terrain.rows) && ring * ring <= bestDistance; ring += 1) {
    for (let r = row - ring; r <= row + ring; r += 1) {
      for (let c = col - ring; c <= col + ring; c += 1) {
        if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== ring || c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows) continue;
        const at = pad(state, c, r);
        if (tiles.island[at] !== island) continue;
        const gap = (c - col) ** 2 + (r - row) ** 2;
        if (gap < bestDistance || (gap === bestDistance && at < best)) {
          bestDistance = gap;
          best = at;
        }
      }
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
  const terrain = map.terrain;
  if (!terrain) return Math.sqrt((from.x - goal.x) ** 2 + (from.y - goal.y) ** 2);
  const state = runtime(terrain, mover);
  const start = padAt(state, from.x, from.y);
  const target = padAt(state, goal.x, goal.y);
  if (state.walk[start] !== 1 || state.walk[target] !== 1) return undefined;
  const cost = exactField(state, target).dist[start]!;
  return cost >= UNREACHED ? undefined : (cost * terrain.cell) / STRAIGHT;
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

function wholesOf(state: TerrainRuntime) {
  if (state.wholes) return state.wholes;
  const { walk, offsets, terrain, width } = state;
  const labels = new Int32Array(walk.length);
  const queue = new Int32Array(walk.length);
  let count = 0;
  for (let seed = 0; seed < walk.length; seed += 1) {
    if (walk[seed] !== 1 || labels[seed] !== 0) continue;
    count += 1;
    labels[seed] = count;
    let tail = 0;
    queue[tail++] = seed;
    for (let head = 0; head < tail; head += 1) {
      const at = queue[head]!;
      for (let direction = 0; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1 || labels[next] !== 0 || !stepAllowed(state, at, direction)) continue;
        labels[next] = count;
        queue[tail++] = next;
      }
    }
  }
  // Each whole's deep water (see @@@open-water), by its label.
  const deep = new Int32Array(count + 1);
  for (let index = 0; index < terrain.cols * terrain.rows; index += 1) {
    if (terrain.cells[index] !== "~") continue;
    const col = index % terrain.cols;
    deep[labels[((index - col) / terrain.cols + 1) * width + col + 1]!]! += 1;
  }
  deep[0] = 0;
  state.wholes = { labels, count, deep };
  return state.wholes;
}

// The cells a walk from `from` to `goal` passes, down the whole map's field toward the goal (every `every`-th cell's
// center, the goal last), or undefined when no walk joins them. A map without terrain walks the straight line. It reads
// the terrain alone (see @@@building-pathing).
export function walkRoute(map: Pick<GameMap, "terrain">, from: Point, goal: Point, every = 2): Point[] | undefined {
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
type Overlay = { terrain: Terrain; state: TerrainRuntime; previous: Uint8Array };
const overlays = new WeakMap<object, Overlay>();

export function setBuildingBodies(map: Pick<GameMap, "terrain">, bodies: readonly Body[]) {
  const terrain = map.terrain;
  if (!terrain) return;
  if (bodies.length === 0) {
    overlays.delete(map);
    return;
  }
  const ground = runtime(terrain, "land");
  let overlay = overlays.get(map);
  if (!overlay || overlay.terrain !== terrain) {
    const fresh = createRuntime(terrain, "land");
    overlay = { terrain, state: fresh, previous: new Uint8Array(fresh.walk.length) };
    overlays.set(map, overlay);
  }
  const state = overlay.state;
  overlay.previous.set(state.walk);
  state.walk.set(ground.walk);
  const size = terrain.cell;
  for (const body of bodies) {
    const { left, right, top, bottom } = footprintCells(size, body.x, body.y, body.radius);
    for (let row = Math.max(0, top); row <= Math.min(terrain.rows - 1, bottom); row += 1) {
      for (let col = Math.max(0, left); col <= Math.min(terrain.cols - 1, right); col += 1) state.walk[pad(state, col, row)] = 0;
    }
  }
  const dirty = new Set<number>();
  for (let at = 0; at < state.walk.length; at += 1) {
    if (state.walk[at] === overlay.previous[at]) continue;
    const col = (at % state.width) - 1;
    const row = Math.floor(at / state.width) - 1;
    dirty.add(Math.floor(row / SECTOR) * Math.ceil(terrain.cols / SECTOR) + Math.floor(col / SECTOR));
  }
  if (dirty.size === 0) return;
  state.clearance.fill(0);
  fillClearance(state);
  state.nearest.clear();
  if (state.tiles) redoTiles(state, state.tiles, dirty);
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
  clearance: Uint16Array;
  fields: Map<number, Field>;
  spare: Field[];
  clock: number;
  nearest: Map<number, number>;
  // Dial's buckets, kept between fields: the whole map's (see grow) and the boxes' (see growBox).
  buckets: Int32Array[];
  tops: Int32Array;
  boxBuckets: number[][];
  offsets: Int32Array;
  // The routing of walks (see @@@flow-tiles), built when first asked for.
  tiles?: Tiles | undefined;
  // Which whole of the mover's ground every cell belongs to (see @@@ground-wholes), worked out the first time it is asked.
  wholes?: { labels: Int32Array; count: number; deep: Int32Array };
  // The sea's shore spots by a shipyard's radius (see shoreSpots), worked out the first time each is asked.
  shores?: Map<number, Point[]>;
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
    clearance: new Uint16Array(count),
    fields: new Map(),
    clock: 0,
    spare: [],
    nearest: new Map(),
    buckets: Array.from({ length: 8 }, () => new Int32Array(count)),
    tops: new Int32Array(8),
    boxBuckets: Array.from({ length: BUCKETS }, () => []),
    offsets,
  };
  fillClearance(state);
  return state;
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
  const { walk, clearance, offsets } = state;
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
  const { terrain, walk, clearance, width } = state;
  const size = terrain.cell;
  let at = padAt(state, ax, ay);
  const end = padAt(state, bx, by);
  if (at < 0 || end < 0 || walk[at] !== 1 || walk[end] !== 1) return false;
  if (at === end) return true;
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
  const { walk, offsets, buckets, tops } = state;
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
      for (let direction = 0; direction < 8; direction += 1) {
        const next = at + offsets[direction]!;
        if (walk[next] !== 1) continue;
        const reached = cost + (direction < 4 ? STRAIGHT : DIAGONAL);
        if (reached >= dist[next]! || !stepAllowed(state, at, direction)) continue;
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
