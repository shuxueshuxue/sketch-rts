import type { GameMap } from "./types";

// @@@terrain - Ground that a unit cannot cross, as on a Warcraft III map: forest, rock (cliffs and outcrops) and deep
// water, on a grid of square cells laid over the map. A unit is a point to the terrain: it stands on a walkable cell, walks
// round what blocks it, and is never pushed into it (see sim moveToward). A map without terrain is open everywhere, as
// every map was before, and plays exactly as it did.
// - cells: one character a cell, row by row from the top-left: "." ground, "," shallow water (walked and sailed both: a
//   ford, a beach), "T" forest, "#" rock, "~" deep water (sailed only).
// - levels: every cell's ground: "0" low ground, "1" a plateau (a main above its natural, a cliff at its rim), "2" the
//   ramp between them. Drawn for the eye; and no building stands on a ramp (see isFootprintBuildable).
export type Terrain = {
  cell: number;
  cols: number;
  rows: number;
  cells: string;
  levels?: string;
};

export type TerrainCellKind = "ground" | "shallow" | "forest" | "rock" | "water";

// @@@terrain-movers - Who crosses a cell: a land unit walks ground and shallow water, a ship sails deep and shallow water
// (see @@@naval). The shallows are both's, as on a Warcraft III coast: a ship that comes in to the beach is in the reach of
// soldiers who wade out to it, and out on deep water it is not. Every query below takes the mover (land when not said) and
// works on that mover's own runtime: the sea's is built the first time a ship asks, so a game without ships never builds
// it.
export type Mover = "land" | "sea";

type Point = { x: number; y: number };

const PASSABLE: Record<Mover, ReadonlySet<string>> = { land: new Set([".", ","]), sea: new Set(["~", ","]) };
const UNREACHED = 0x3fffffff;
const UNKNOWN = -2;
// Orthogonal and diagonal steps of the flow fields, in fifths of a cell (7/5 for the square root of two).
const STRAIGHT = 5;
const DIAGONAL = 7;
// @@@terrain-steering - A walk that cannot see its goal follows a flow field down to it: it looks this many cells along
// the flow and heads for that cell if it sees it (one sight line, not one a cell), else for the cell a few steps along.
const LOOKAHEAD = 16;
const SHORT_LOOK = 3;
// A goal within NEAR cells gets a field of its own, grown no farther than LOCAL cells round it (a way round that leaves
// that square takes the whole map's field); a farther goal shares the field of its BLOCK-cell square, which brings the
// walk within NEAR of it just as well.
const NEAR = 12;
const LOCAL = 24;
const BLOCK = 4;
// Fields kept per terrain; the least recently used goes first and its arrays serve the next one.
const FIELD_CACHE = 128;

export function terrainCellKind(char: string | undefined): TerrainCellKind {
  if (char === ",") return "shallow";
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

// Whether a building of the given radius may stand at the point: every cell its footprint touches is walkable and none is
// a ramp (a map without terrain has nothing to refuse). @@@ramp-unbuildable - A ramp is a main's one way out, as on a
// Warcraft III map, where ramps take no building: once buildings are bodies (see @@@building-body) a tower or a farm on
// it would shut its owner in.
export function isFootprintBuildable(map: Pick<GameMap, "terrain">, x: number, y: number, radius: number) {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = runtime(terrain, "land");
  const size = terrain.cell;
  const low = { col: Math.floor((x - radius) / size), row: Math.floor((y - radius) / size) };
  const high = { col: Math.floor((x + radius) / size), row: Math.floor((y + radius) / size) };
  for (let row = low.row; row <= high.row; row += 1) {
    for (let col = low.col; col <= high.col; col += 1) {
      if (col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows) return false;
      // Only the cells the circle reaches: the corner cells of its bounding square may lie outside it.
      const nearX = Math.max(col * size, Math.min(x, (col + 1) * size));
      const nearY = Math.max(row * size, Math.min(y, (row + 1) * size));
      if ((nearX - x) * (nearX - x) + (nearY - y) * (nearY - y) >= radius * radius) continue;
      if (state.walk[pad(state, col, row)] !== 1 || terrain.levels?.[row * terrain.cols + col] === "2") return false;
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
// the flow toward the goal (see @@@terrain-steering). `goal` should be walkable (see walkableGoal).
export function steerPoint(map: Pick<GameMap, "terrain">, from: Point, goal: Point, mover: Mover = "land"): Point {
  const terrain = map.terrain;
  if (!terrain) return goal;
  const ground = runtime(terrain, mover);
  const state = routing(map, terrain, mover);
  // The copy blocks all the land does and more, so a line the land blocks the copy blocks too.
  const seen = clearSegment(ground, from.x, from.y, goal.x, goal.y);
  if (seen && (state === ground || clearPastBodies(state, from, goal, true))) return goal;
  const start = padAt(ground, from.x, from.y);
  const target = padAt(ground, goal.x, goal.y);
  if (start < 0 || ground.walk[target] !== 1) return goal;
  if (ground.walk[start] !== 1) {
    // Standing where it cannot (nothing puts a unit there but a seeded scenario): out by the nearest way.
    const out = nearestWalkable(ground, start);
    return out < 0 ? goal : centerOf(ground, out);
  }
  const way = seen ? goal : follow(ground, fieldToward(ground, start, target), from, start, target, goal);
  // Only the goal is a place to stop at a wall: a point further down the flow inside a building is a building in the way.
  if (state === ground || (!seen && clearPastBodies(state, from, way, way === goal))) return way;
  // A building stands between the unit and where the terrain's way leads next (see @@@building-pathing).
  const near = routeCell(state, padAt(state, from.x, from.y), from, way);
  const aim = routeCell(state, padAt(state, way.x, way.y), way, from);
  if (near < 0 || aim < 0) return way;
  const local = cached(state, aim + state.walk.length, () => grow(state, [aim], aim, LOCAL));
  const field = local.dist[near]! < UNREACHED ? local : exactField(state, aim);
  if (field.dist[near]! >= UNREACHED) return way;
  return follow(state, field, from, near, aim, way);
}

// Whether a unit at `from` walks straight to `to` on the copy (see @@@building-pathing): the line is open but for where
// it starts and ends in a building's blocked cells. A unit pressed against a wall stands in the BODY_MARGIN band round
// it, and so may a walk's end, and the line leaves the band within a cell; a walk may end inside a building (a site to
// build, a hall to bring gold to, one to strike), and ends at its wall, the line leaving its cells within GOAL_BODY. A
// line that runs on into another building is not open: the unit is walked round that one.
const GOAL_BODY = 3;

function clearPastBodies(state: TerrainRuntime, from: Point, to: Point, isGoal: boolean) {
  const start = openEnd(state, from, to, 1);
  const end = start && openEnd(state, to, from, isGoal && state.walk[padAt(state, to.x, to.y)] === INSIDE ? GOAL_BODY : 1);
  return end !== undefined && clearSegment(state, start!.x, start!.y, end.x, end.y);
}

// The first point on the line from `point` toward `toward`, within `cells` cells, whose cell is open on the copy.
function openEnd(state: TerrainRuntime, point: Point, toward: Point, cells: number): Point | undefined {
  if (state.walk[padAt(state, point.x, point.y)] === 1) return point;
  const dx = toward.x - point.x;
  const dy = toward.y - point.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const cell = state.terrain.cell;
  for (let travelled = cell / 2; travelled <= cells * cell && travelled < length; travelled += cell / 2) {
    const x = point.x + (dx / length) * travelled;
    const y = point.y + (dy / length) * travelled;
    if (state.walk[padAt(state, x, y)] === 1) return { x, y };
  }
  return undefined;
}

// Where a unit at `from` (in cell `start`) heads down `field` toward `target`, the cell of `goal`: the cell LOOKAHEAD
// steps along when it sees it, else the one SHORT_LOOK along (see @@@terrain-steering).
function follow(state: TerrainRuntime, field: Field | undefined, from: Point, start: number, target: number, goal: Point): Point {
  if (!field) return goal;
  let at = start;
  let short = -1;
  for (let step = 1; step <= LOOKAHEAD; step += 1) {
    const next = nextStep(state, field, at);
    if (next < 0) break;
    at = next;
    if (step === SHORT_LOOK) short = at;
    if (field.dist[at] === 0) break;
  }
  if (at === start) return goal;
  const far = at === target ? goal : centerOf(state, at);
  if (short < 0 || clearSegment(state, from.x, from.y, far.x, far.y)) return far;
  return short === target ? goal : centerOf(state, short);
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
// land's cells with every cell whose center lies within BODY_MARGIN of a building blocked, with its own clearance, fields
// and nearest cells. A walk goes in two levels: the terrain's own fields, which never change, say where it heads next (as
// they did before buildings counted), and only when a building stands between the unit and that point does it find its way
// round on the copy, on a small field grown round the point (LOCAL cells) that is cheap to grow again. Building on the copy
// alone, every site laid and every building felled threw away every field the armies and the AIs' distances stood on, and
// a game ran a quarter slower a tick, the fields' growing ten times what it was. The AIs' walking distances and routes read
// the terrain alone: what a building adds to a walk is a few steps round it.
//
// The margin shuts the slits a unit's body cannot pass: farms laid 4 apart left a row of open cells between them, and
// units routed into the slit and stood pressed in it; with half a cell more round each building no gap under about 32
// stays open, and a unit is 30 to 36 wide. So a unit at a wall stands in blocked cells, and so does a walk's end at a
// building: a line counts as open when it leaves those cells soon enough (see clearPastBodies), else every worker going
// to its hall and every unit at a wall took the detour every tick. A walk from or to a blocked cell that does need a
// detour routes from or to the first open cell on the line toward the walk's other end: a worker bringing gold to its
// hall comes to the side it walks from, not round the hall to whichever open cell lies nearest its center.
//
// The copy hangs on the game's map object (a snapshot shares it), never on the terrain, which games may share. A map
// without terrain has no routing to take a unit round anything, and its buildings stand in nobody's way (see
// @@@building-body). Whether a point may be stood on (isWalkable, walkableGoal, isFootprintBuildable) stays the terrain's
// alone: a building's round body is the sim's to keep units out of. Ships keep the sea's own routing: no building stands
// in deep water.
type Body = { x: number; y: number; radius: number };
const BODY_MARGIN = 16;
// A blocked cell whose center a building covers (not only its margin): a walk that ends there ends at the wall.
const INSIDE = 2;
// `previous`: the cells as they were before the last change, kept to tell which fields that change reached.
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
    const fresh = createRuntime(terrain, PASSABLE.land);
    overlay = { terrain, state: fresh, previous: new Uint8Array(fresh.walk.length) };
    overlays.set(map, overlay);
  }
  const state = overlay.state;
  overlay.previous.set(state.walk);
  state.walk.set(ground.walk);
  const size = terrain.cell;
  for (const body of bodies) {
    const reach = body.radius + BODY_MARGIN;
    const low = { col: Math.max(0, Math.floor((body.x - reach) / size)), row: Math.max(0, Math.floor((body.y - reach) / size)) };
    const high = { col: Math.min(terrain.cols - 1, Math.floor((body.x + reach) / size)), row: Math.min(terrain.rows - 1, Math.floor((body.y + reach) / size)) };
    for (let row = low.row; row <= high.row; row += 1) {
      for (let col = low.col; col <= high.col; col += 1) {
        const dx = (col + 0.5) * size - body.x;
        const dy = (row + 0.5) * size - body.y;
        const at = pad(state, col, row);
        if (dx * dx + dy * dy < body.radius * body.radius) state.walk[at] = INSIDE;
        else if (dx * dx + dy * dy < reach * reach && state.walk[at] !== INSIDE) state.walk[at] = 0;
      }
    }
  }
  // Only the cells that changed matter: the fields grown round a point (see steerPoint's detours) whose square they miss
  // stand as they were; the rest are grown again when asked for.
  let low = { col: Infinity, row: Infinity };
  let high = { col: -Infinity, row: -Infinity };
  for (let at = 0; at < state.walk.length; at += 1) {
    if (state.walk[at] === overlay.previous[at]) continue;
    const col = (at % state.width) - 1;
    const row = Math.floor(at / state.width) - 1;
    low = { col: Math.min(low.col, col), row: Math.min(low.row, row) };
    high = { col: Math.max(high.col, col), row: Math.max(high.row, row) };
  }
  if (high.col < low.col) return;
  state.clearance.fill(0);
  fillClearance(state);
  const count = state.walk.length;
  for (const [key, field] of state.fields) {
    const local = key >= count && key < 2 * count;
    const center = key - count;
    const col = (center % state.width) - 1;
    const row = Math.floor(center / state.width) - 1;
    const untouched = local && (col + LOCAL + 1 < low.col || col - LOCAL - 1 > high.col || row + LOCAL + 1 < low.row || row - LOCAL - 1 > high.row);
    if (untouched) continue;
    state.spare.push(field);
    state.fields.delete(key);
  }
  state.nearest.clear();
}

// The runtime a mover's routing runs on: the land's with this game's buildings when it has any.
function routing(map: object, terrain: Terrain, mover: Mover): TerrainRuntime {
  if (mover === "land") {
    const overlay = overlays.get(map);
    if (overlay && overlay.terrain === terrain) return overlay.state;
  }
  return runtime(terrain, mover);
}

// The cell a walk from or to a point routes by (`at` its cell): the cell itself when open, else the first open cell on the
// line from the point toward `other` (the walk's other end), else the open cell nearest it.
function routeCell(state: TerrainRuntime, at: number, point: Point, other: Point) {
  if (state.walk[at] === 1) return at;
  const dx = other.x - point.x;
  const dy = other.y - point.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const step = state.terrain.cell / 2;
  for (let travelled = step; travelled < length; travelled += step) {
    const on = padAt(state, point.x + (dx / length) * travelled, point.y + (dy / length) * travelled);
    if (on >= 0 && state.walk[on] === 1) return on;
  }
  return nearestWalkable(state, at);
}

// `used`: when the field was last asked for, by the runtime's clock (the least recently used goes first). `reached`: the
// cells a field grown within a square reached (see grow).
type Field = { dist: Int32Array; next: Int32Array; used: number; reached?: number[] | undefined };

type TerrainRuntime = {
  terrain: Terrain;
  // The grid with a blocked border cell all round (cols + 2 wide), so no step ever needs a bounds check.
  width: number;
  // 1 on a cell the runtime's mover may cross (see @@@terrain-movers).
  walk: Uint8Array;
  // Chebyshev distance in cells to the nearest blocked cell (or the map's edge): 0 on a blocked cell.
  clearance: Uint16Array;
  fields: Map<number, Field>;
  spare: Field[];
  clock: number;
  nearest: Map<number, number>;
  // Dial's buckets, kept between fields.
  buckets: Int32Array[];
  tops: Int32Array;
  offsets: Int32Array;
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
  return mover === "land" ? (lastRuntimes.land ??= createRuntime(terrain, PASSABLE.land)) : (lastRuntimes.sea ??= createRuntime(terrain, PASSABLE.sea));
}

function createRuntime(terrain: Terrain, passable: ReadonlySet<string>): TerrainRuntime {
  const width = terrain.cols + 2;
  const count = width * (terrain.rows + 2);
  const walk = new Uint8Array(count);
  for (let row = 0; row < terrain.rows; row += 1) {
    for (let col = 0; col < terrain.cols; col += 1) if (passable.has(terrain.cells[row * terrain.cols + col]!)) walk[(row + 1) * width + col + 1] = 1;
  }
  const offsets = Int32Array.from([1, width, -1, -width, width + 1, width - 1, -width - 1, -width + 1]);
  const state: TerrainRuntime = {
    terrain,
    width,
    walk,
    clearance: new Uint16Array(count),
    fields: new Map(),
    clock: 0,
    spare: [],
    nearest: new Map(),
    buckets: Array.from({ length: 8 }, () => new Int32Array(count)),
    tops: new Int32Array(8),
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

// The field a walk from `start` to `target` follows (see NEAR, LOCAL, BLOCK): undefined when no walk joins them.
function fieldToward(state: TerrainRuntime, start: number, target: number): Field | undefined {
  const width = state.width;
  const gap = Math.max(Math.abs((start % width) - (target % width)), Math.abs(Math.floor(start / width) - Math.floor(target / width)));
  if (gap > NEAR) {
    const coarse = blockField(state, target);
    if (coarse.dist[start]! < UNREACHED) return coarse;
  } else {
    const local = cached(state, target + state.walk.length, () => grow(state, [target], target, LOCAL));
    if (local.dist[start]! < UNREACHED) return local;
  }
  const exact = exactField(state, target);
  return exact.dist[start]! < UNREACHED ? exact : undefined;
}

function exactField(state: TerrainRuntime, target: number): Field {
  return cached(state, target, () => grow(state, [target], target, Infinity));
}

// The field down to every walkable cell of the BLOCK-cell square the target stands in.
function blockField(state: TerrainRuntime, target: number): Field {
  const width = state.width;
  const col = Math.floor(((target % width) - 1) / BLOCK) * BLOCK;
  const row = Math.floor((Math.floor(target / width) - 1) / BLOCK) * BLOCK;
  return cached(state, 2 * state.walk.length + row * width + col, () => {
    const sources: number[] = [];
    for (let r = row; r < row + BLOCK && r < state.terrain.rows; r += 1) {
      for (let c = col; c < col + BLOCK && c < state.terrain.cols; c += 1) if (state.walk[pad(state, c, r)] === 1) sources.push(pad(state, c, r));
    }
    return grow(state, sources, target, Infinity);
  });
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

// @@@terrain-flow - The walking cost from every cell to the nearest source (Dial's algorithm over eight neighbours, no
// corner cut), grown no farther than `reach` cells from `center` in either direction.
function grow(state: TerrainRuntime, sources: number[], center: number, reach: number): Field {
  const { walk, offsets, buckets, tops, width } = state;
  const field: Field = state.spare.pop() ?? { dist: new Int32Array(walk.length), next: new Int32Array(walk.length), used: 0 };
  const dist = field.dist;
  // A field grown within a square reached only the cells it lists (and steps are taken only from those, see nextStep):
  // they alone are cleared, where clearing the whole map's cells for a square of a few hundred cost more than the growing.
  if (field.reached) {
    for (const at of field.reached) {
      dist[at] = UNREACHED;
      field.next[at] = UNKNOWN;
    }
  } else {
    dist.fill(UNREACHED);
    field.next.fill(UNKNOWN);
  }
  const reachedCells = reach === Infinity ? undefined : [...sources];
  field.reached = reachedCells;
  tops.fill(0);
  const centerCol = center % width;
  const centerRow = Math.floor(center / width);
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
        if (reach !== Infinity && (Math.abs((next % width) - centerCol) > reach || Math.abs(Math.floor(next / width) - centerRow) > reach)) continue;
        if (reachedCells && dist[next] === UNREACHED) reachedCells.push(next);
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
