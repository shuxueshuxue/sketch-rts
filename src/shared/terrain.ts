import type { GameMap } from "./types";

// @@@terrain - Ground that a unit cannot cross, as on a Warcraft III map: forest, rock (cliffs and outcrops) and deep
// water, on a grid of square cells laid over the map. A unit is a point to the terrain: it stands on a walkable cell, walks
// round what blocks it, and is never pushed into it (see sim moveToward). A map without terrain is open everywhere, as
// every map was before, and plays exactly as it did.
// - cells: one character a cell, row by row from the top-left: "." ground, "," shallow water (walkable, a ford), "T"
//   forest, "#" rock, "~" deep water.
// - levels: for the eye only, every cell's ground: "0" low ground, "1" a plateau (a main above its natural, a cliff at its
//   rim), "2" the ramp between them.
export type Terrain = {
  cell: number;
  cols: number;
  rows: number;
  cells: string;
  levels?: string;
};

export type TerrainCellKind = "ground" | "shallow" | "forest" | "rock" | "water";

type Point = { x: number; y: number };

const WALKABLE = new Set([".", ","]);
const UNREACHED = 0x3fffffff;
// Orthogonal and diagonal steps of the flow fields, in fifths of a cell (7/5 for the square root of two).
const STRAIGHT = 5;
const DIAGONAL = 7;
// A walk looks this many cells along its flow for the farthest cell it can see, and heads there.
const LOOKAHEAD = 16;
// Fields kept per terrain; the least recently used goes first.
const FIELD_CACHE = 96;

export function terrainCellKind(char: string | undefined): TerrainCellKind {
  if (char === ",") return "shallow";
  if (char === "T") return "forest";
  if (char === "#") return "rock";
  if (char === "~") return "water";
  return "ground";
}

export function isWalkableChar(char: string | undefined) {
  return char !== undefined && WALKABLE.has(char);
}

// Whether a unit may stand at the point: always on a map without terrain; on one with terrain, on a walkable cell inside
// the map.
export function isWalkable(map: Pick<GameMap, "terrain">, x: number, y: number) {
  const terrain = map.terrain;
  if (!terrain) return true;
  return walkableIndex(runtime(terrain), cellIndexAt(terrain, x, y));
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

// Whether a building of the given radius may stand at the point: every cell its footprint touches is walkable (a map
// without terrain has nothing to refuse).
export function isFootprintWalkable(map: Pick<GameMap, "terrain">, x: number, y: number, radius: number) {
  const terrain = map.terrain;
  if (!terrain) return true;
  const state = runtime(terrain);
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
      if (!state.walkable[row * terrain.cols + col]) return false;
    }
  }
  return true;
}

// The point a unit heading for (x, y) should stop at: the point itself when it is walkable, otherwise the center of the
// walkable cell nearest the point's cell (a move into a forest ends at its edge, as on any Warcraft III map).
export function walkableGoal(map: Pick<GameMap, "terrain" | "width" | "height">, x: number, y: number): Point {
  const terrain = map.terrain;
  if (!terrain) return { x, y };
  const state = runtime(terrain);
  const cx = Math.min(Math.max(x, 0), map.width);
  const cy = Math.min(Math.max(y, 0), map.height);
  const index = cellIndexAt(terrain, Math.min(cx, terrain.cols * terrain.cell - 0.001), Math.min(cy, terrain.rows * terrain.cell - 0.001));
  if (walkableIndex(state, index)) return { x: cx, y: cy };
  const nearest = nearestWalkableCell(terrain, state, index);
  return nearest < 0 ? { x: cx, y: cy } : cellCenter(terrain, nearest);
}

// Whether a unit could walk the straight segment from a to b without touching a blocked cell.
export function segmentWalkable(map: Pick<GameMap, "terrain">, a: Point, b: Point) {
  const terrain = map.terrain;
  if (!terrain) return true;
  return clearSegment(terrain, runtime(terrain), a.x, a.y, b.x, b.y);
}

// Where a unit at `from` walking to `goal` should head this tick: the goal itself when it sees it, otherwise the farthest
// cell it sees along the flow toward the goal. `goal` should be walkable (see walkableGoal).
export function steerPoint(map: Pick<GameMap, "terrain">, from: Point, goal: Point): Point {
  const terrain = map.terrain;
  if (!terrain) return goal;
  const state = runtime(terrain);
  if (clearSegment(terrain, state, from.x, from.y, goal.x, goal.y)) return goal;
  const start = cellIndexAt(terrain, from.x, from.y);
  const target = cellIndexAt(terrain, goal.x, goal.y);
  if (start < 0 || target < 0 || !state.walkable[target]) return goal;
  if (!state.walkable[start]) {
    // Standing where it cannot (nothing puts a unit there but a seeded scenario): out by the nearest way.
    const out = nearestWalkableCell(terrain, state, start);
    return out < 0 ? goal : cellCenter(terrain, out);
  }
  const field = flowField(terrain, state, target);
  if (field[start]! >= UNREACHED) return goal;
  const chain: number[] = [];
  let at = start;
  for (let step = 0; step < LOOKAHEAD && at !== target; step += 1) {
    const next = downhill(terrain, state, field, at);
    if (next < 0) break;
    chain.push(next);
    at = next;
  }
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const cell = chain[index]!;
    const center = cell === target ? goal : cellCenter(terrain, cell);
    if (index === 0 || clearSegment(terrain, state, from.x, from.y, center.x, center.y)) return center;
  }
  return goal;
}

// The walking distance (in world units, along the flow) from a point to a goal, or undefined when no walk joins them. A
// map without terrain measures the straight line.
export function walkingDistance(map: Pick<GameMap, "terrain">, from: Point, goal: Point): number | undefined {
  const terrain = map.terrain;
  if (!terrain) return Math.sqrt((from.x - goal.x) ** 2 + (from.y - goal.y) ** 2);
  const state = runtime(terrain);
  const start = cellIndexAt(terrain, from.x, from.y);
  const target = cellIndexAt(terrain, goal.x, goal.y);
  if (start < 0 || target < 0 || !state.walkable[start] || !state.walkable[target]) return undefined;
  const cost = flowField(terrain, state, target)[start]!;
  return cost >= UNREACHED ? undefined : (cost * terrain.cell) / STRAIGHT;
}

type TerrainRuntime = {
  walkable: Uint8Array;
  // Chebyshev distance in cells to the nearest blocked cell (or the map's edge): 0 on a blocked cell.
  clearance: Uint16Array;
  fields: Map<number, Int32Array>;
  nearest: Map<number, number>;
};

// @@@terrain-runtime - What the terrain's queries need, built once per terrain and kept beside it (never in the game's
// state): the walkable cells, their clearance, and the flow fields and nearest cells asked for so far. Every one is a pure
// function of the terrain, so whether it was cached changes nothing a unit does.
const runtimes = new WeakMap<Terrain, TerrainRuntime>();

function runtime(terrain: Terrain): TerrainRuntime {
  const known = runtimes.get(terrain);
  if (known) return known;
  const count = terrain.cols * terrain.rows;
  const walkable = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) walkable[index] = WALKABLE.has(terrain.cells[index]!) ? 1 : 0;
  const state: TerrainRuntime = { walkable, clearance: clearanceOf(terrain, walkable), fields: new Map(), nearest: new Map() };
  runtimes.set(terrain, state);
  return state;
}

function walkableIndex(state: TerrainRuntime, index: number) {
  return index >= 0 && state.walkable[index] === 1;
}

function clearanceOf(terrain: Terrain, walkable: Uint8Array) {
  const { cols, rows } = terrain;
  const clearance = new Uint16Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < cols * rows; index += 1) {
    const col = index % cols;
    const row = (index - col) / cols;
    if (!walkable[index]) continue;
    // The map's edge blocks like a wall: a border cell is one cell from it.
    if (col === 0 || row === 0 || col === cols - 1 || row === rows - 1) {
      clearance[index] = 1;
      queue[tail++] = index;
    }
  }
  for (let index = 0; index < cols * rows; index += 1) {
    if (walkable[index] || clearance[index]) continue;
    // Blocked cells seed their walkable neighbours at 1.
    const col = index % cols;
    const row = (index - col) / cols;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (walkable[next] && !clearance[next]) {
          clearance[next] = 1;
          queue[tail++] = next;
        }
      }
    }
  }
  while (head < tail) {
    const index = queue[head++]!;
    const col = index % cols;
    const row = (index - col) / cols;
    const value = clearance[index]! + 1;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (walkable[next] && !clearance[next]) {
          clearance[next] = value;
          queue[tail++] = next;
        }
      }
    }
  }
  return clearance;
}

// Whether the segment crosses only walkable cells. It steps from cell to cell, but across open ground it leaps: a cell
// whose clearance is k has every cell within k - 1 of it walkable, so the walk jumps to the edge of that square.
function clearSegment(terrain: Terrain, state: TerrainRuntime, ax: number, ay: number, bx: number, by: number) {
  const size = terrain.cell;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  let index = cellIndexAt(terrain, ax, ay);
  if (!walkableIndex(state, index)) return false;
  const end = cellIndexAt(terrain, bx, by);
  if (!walkableIndex(state, end)) return false;
  if (length === 0 || index === end) return true;
  const ux = dx / length;
  const uy = dy / length;
  let t = 0;
  for (let guard = 0; guard < 2 * (terrain.cols + terrain.rows) + 8; guard += 1) {
    const col = index % terrain.cols;
    const row = (index - col) / terrain.cols;
    const reach = state.clearance[index]! - 1;
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
    // The cell the segment enters as it leaves the square (both across a corner it passes exactly).
    const qx = ax + ux * t;
    const qy = ay + uy * t;
    let nextCol = Math.floor(qx / size);
    let nextRow = Math.floor(qy / size);
    if (leaveX) nextCol = ux > 0 ? Math.max(nextCol, col + reach + 1) : Math.min(nextCol, col - reach - 1);
    if (leaveY) nextRow = uy > 0 ? Math.max(nextRow, row + reach + 1) : Math.min(nextRow, row - reach - 1);
    // Through a corner exactly: both cells beside it must be open, or the walk would squeeze between two blocks.
    if (leaveX && leaveY && (!walkableAt(terrain, state, ux > 0 ? col + reach : col - reach, nextRow) || !walkableAt(terrain, state, nextCol, uy > 0 ? row + reach : row - reach))) return false;
    if (!insideGrid(terrain, nextCol, nextRow)) return false;
    index = nextRow * terrain.cols + nextCol;
    if (!state.walkable[index]) return false;
    if (index === end) return true;
  }
  return false;
}

function insideGrid(terrain: Terrain, col: number, row: number) {
  return col >= 0 && row >= 0 && col < terrain.cols && row < terrain.rows;
}

function walkableAt(terrain: Terrain, state: TerrainRuntime, col: number, row: number) {
  return insideGrid(terrain, col, row) && state.walkable[row * terrain.cols + col] === 1;
}

// The neighbour one step down the field (the fixed neighbour order breaks ties), or -1 at the bottom.
const NEIGHBOURS = [
  [1, 0, STRAIGHT],
  [0, 1, STRAIGHT],
  [-1, 0, STRAIGHT],
  [0, -1, STRAIGHT],
  [1, 1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
  [1, -1, DIAGONAL],
] as const;

function downhill(terrain: Terrain, state: TerrainRuntime, field: Int32Array, index: number) {
  const col = index % terrain.cols;
  const row = (index - col) / terrain.cols;
  let best = -1;
  let bestCost = field[index]!;
  for (const [dx, dy] of NEIGHBOURS) {
    const c = col + dx;
    const r = row + dy;
    if (!walkableAt(terrain, state, c, r)) continue;
    // No cutting a corner between two blocked cells.
    if (dx !== 0 && dy !== 0 && (!walkableAt(terrain, state, col + dx, row) || !walkableAt(terrain, state, col, row + dy))) continue;
    const next = r * terrain.cols + c;
    if (field[next]! < bestCost) {
      bestCost = field[next]!;
      best = next;
    }
  }
  return best;
}

// @@@terrain-flow - The walking cost from every cell to one goal cell (Dial's algorithm over eight neighbours, no corner
// cut), kept per goal; a walk goes downhill on it.
function flowField(terrain: Terrain, state: TerrainRuntime, goal: number): Int32Array {
  const known = state.fields.get(goal);
  if (known) {
    state.fields.delete(goal);
    state.fields.set(goal, known);
    return known;
  }
  const { cols, rows } = terrain;
  const field = new Int32Array(cols * rows).fill(UNREACHED);
  const buckets: number[][] = Array.from({ length: 8 }, () => []);
  field[goal] = 0;
  buckets[0]!.push(goal);
  let pending = 1;
  for (let cost = 0; pending > 0; cost += 1) {
    const bucket = buckets[cost & 7]!;
    while (bucket.length > 0) {
      const index = bucket.pop()!;
      pending -= 1;
      if (field[index] !== cost) continue;
      const col = index % cols;
      const row = (index - col) / cols;
      for (const [dx, dy, step] of NEIGHBOURS) {
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (!state.walkable[next]) continue;
        if (dx !== 0 && dy !== 0 && (!state.walkable[row * cols + c] || !state.walkable[r * cols + col])) continue;
        const reached = cost + step;
        if (reached < field[next]!) {
          field[next] = reached;
          buckets[reached & 7]!.push(next);
          pending += 1;
        }
      }
    }
  }
  state.fields.set(goal, field);
  if (state.fields.size > FIELD_CACHE) state.fields.delete(state.fields.keys().next().value!);
  return field;
}

// The walkable cell whose center is nearest the given cell's center (the lowest index among equals), or -1 when none is.
function nearestWalkableCell(terrain: Terrain, state: TerrainRuntime, index: number): number {
  if (index >= 0 && state.walkable[index]) return index;
  const known = state.nearest.get(index);
  if (known !== undefined) return known;
  const { cols, rows } = terrain;
  const col = index < 0 ? 0 : index % cols;
  const row = index < 0 ? 0 : (index - col) / cols;
  let best = -1;
  let bestDistance = Infinity;
  const limit = Math.max(cols, rows);
  for (let ring = 1; ring <= limit; ring += 1) {
    // A cell on this ring is at least `ring` cells away; stop once none can beat the best.
    if (ring * ring > bestDistance) break;
    for (let r = row - ring; r <= row + ring; r += 1) {
      for (let c = col - ring; c <= col + ring; c += 1) {
        if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== ring) continue;
        if (!walkableAt(terrain, state, c, r)) continue;
        const gap = (c - col) * (c - col) + (r - row) * (r - row);
        const at = r * cols + c;
        if (gap < bestDistance || (gap === bestDistance && at < best)) {
          bestDistance = gap;
          best = at;
        }
      }
    }
  }
  if (state.nearest.size > 4_096) state.nearest.clear();
  state.nearest.set(index, best);
  return best;
}
