import { detCos, detSin } from "./det-math";
import { shipProfile, type Point } from "./ship-geometry";
import { CELL_GROUND, isWalkable, sameGround, walkableGoal } from "./terrain";
import type { GameMap, Unit } from "./types";
import { convexHull, expandConvex, polygonPlanes, polygonTouchesCell } from './navigation-math';
import preparedMasks from './generated/ship-navigation-masks.json';
import { buildNavigationMasks, type OccupancyMask } from './navigation-masks';
import { shipScale, DEFAULT_SHIP_SCALE } from './ship-geometry';
export type ShipPose = Point & {
  heading: number;
};
type SeaMap = Pick<GameMap, "terrain" | "width" | "height">;
const waterFields = new WeakMap<object, {
  cells: string;
  cols: number;
  rows: number;
  sums: Uint32Array;
}>();
/** Integral occupancy field: a conservative swept bounding box proves open water in O(1). */
function openWaterBox(map: SeaMap, left: number, top: number, right: number, bottom: number) {
  if (left < 0 || top < 0 || right > map.width || bottom > map.height)
    return false;
  const t = map.terrain;
  if (!t)
    return true;
  let field = waterFields.get(t);
  if (!field || field.cells !== t.cells || field.cols !== t.cols || field.rows !== t.rows) {
    const w = t.cols + 1, sums = new Uint32Array(w * (t.rows + 1));
    for (let y = 0; y < t.rows; y++) {
      let row = 0;
      for (let x = 0; x < t.cols; x++) {
        row += CELL_GROUND[t.cells[y * t.cols + x] ?? '.']?.sea ? 0 : 1;
        sums[(y + 1) * w + x + 1] = sums[y * w + x + 1]! + row;
      }
    }
    field = { cells: t.cells, cols: t.cols, rows: t.rows, sums };
    waterFields.set(t, field);
  }
  const x0 = Math.max(0, Math.floor(left / t.cell)), y0 = Math.max(0, Math.floor(top / t.cell));
  const x1 = Math.min(t.cols, Math.ceil(right / t.cell)), y1 = Math.min(t.rows, Math.ceil(bottom / t.cell)), w = t.cols + 1, s = field.sums;
  return s[y1 * w + x1]! - s[y0 * w + x1]! - s[y1 * w + x0]! + s[y0 * w + x0]! === 0;
}
const DIRECTIONS = 8;
const ANGLE = Math.PI / 4;
const STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
export function headingDifference(from: number, to: number) {
  return ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}
function outline(hull: readonly Point[], pose: ShipPose) {
  const c = detCos(pose.heading), s = detSin(pose.heading);
  return hull.map(p => ({ x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c }));
}
/** Exact convex polygon / cell intersection, including edges crossing a cell without a vertex inside it. */
function clearOutline(map: SeaMap, polygon: readonly Point[]) {
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  if (left < -1e-7 || top < -1e-7 || right > map.width + 1e-7 || bottom > map.height + 1e-7)
    return false;
  const terrain = map.terrain;
  if (!terrain)
    return true;
  if (openWaterBox(map, left, top, right, bottom))
    return true;
  const cell = terrain.cell;
  let axes: ReturnType<typeof polygonPlanes> | undefined;
  for (let row = Math.floor(top / cell); row <= Math.floor((bottom - 1e-7) / cell); row++)
    for (let col = Math.floor(left / cell); col <= Math.floor((right - 1e-7) / cell); col++) {
      const char = col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows ? undefined : terrain.cells[row * terrain.cols + col];
      if (!CELL_GROUND[char ?? "."]?.sea && polygonTouchesCell(axes ??= polygonPlanes(polygon), col * cell, row * cell, cell))
        return false;
    }
  return true;
}
export function hullFits(map: SeaMap, ship: Unit, pose: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 }) {
  const profile = shipProfile(ship);
  return Boolean(profile && clearOutline(map, outline(profile.hull, pose)));
}
/** Continuous sweep: bounded rotational curvature expands each endpoint envelope. */
export function hullPassageClear(map: SeaMap, ship: Unit, from: ShipPose, to: ShipPose) {
  const hull = shipProfile(ship)!.hull;
  const turn = headingDifference(from.heading, to.heading);
  const radius = Math.max(...hull.map(p => Math.hypot(p.x, p.y)));
  if (openWaterBox(map, Math.min(from.x, to.x) - radius, Math.min(from.y, to.y) - radius, Math.max(from.x, to.x) + radius, Math.max(from.y, to.y) + radius))
    return true;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * radius / 2));
  // Linear interpolation error of a rotating vertex is at most R Δθ² / 8.
  // The expanded convex envelope contains the entire intermediate hull.
  const error = turn ? radius * (turn / steps) ** 2 / 8 + 1e-7 : 0;
  for (let i = 0; i < steps; i++) {
    const a = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, heading: from.heading + turn * i / steps };
    const b = { x: from.x + (to.x - from.x) * (i + 1) / steps, y: from.y + (to.y - from.y) * (i + 1) / steps, heading: from.heading + turn * (i + 1) / steps };
    const envelope = convexHull([...outline(hull, a), ...outline(hull, b)]);
    if (!clearOutline(map, error ? expandConvex(envelope, error) : envelope))
      return false;
  }
  return true;
}
/** Physical separation and shove movement stop at the coast instead of sliding a ship sideways through land. */
export function hullStep(map: SeaMap, ship: Unit, point: Point): Point {
  const from = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 }, to = { ...point, heading: from.heading };
  if (hullPassageClear(map, ship, from, to))
    return point;
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    const at = { x: from.x + (to.x - from.x) * mid, y: from.y + (to.y - from.y) * mid, heading: from.heading };
    if (hullPassageClear(map, ship, from, at))
      low = mid;
    else
      high = mid;
  }
  return { x: from.x + (to.x - from.x) * low, y: from.y + (to.y - from.y) * low };
}
/** Only creation / old authored placements relocate: normal sailing always follows a swept, continuous passage. */
export function nearestShipPose(map: SeaMap, ship: Unit, point: Point, seaOrigin: Point = ship, accepts:(pose:ShipPose)=>boolean=()=>true): ShipPose | undefined {
  const preferred = ship.sailing?.heading ?? 0;
  const seaStart = isWalkable(map, seaOrigin.x, seaOrigin.y, "sea") ? seaOrigin : walkableGoal(map, seaOrigin.x, seaOrigin.y, "sea");
  const headings = [preferred, ...Array.from({ length: DIRECTIONS }, (_, i) => i * ANGLE)];
  if (!map.terrain) {
    const hull = outline(shipProfile(ship)!.hull, { x: 0, y: 0, heading: preferred });
    const x = Math.max(-Math.min(...hull.map(p => p.x)), Math.min(map.width - Math.max(...hull.map(p => p.x)), point.x));
    const y = Math.max(-Math.min(...hull.map(p => p.y)), Math.min(map.height - Math.max(...hull.map(p => p.y)), point.y));
    return hullFits(map, ship, { x, y, heading: preferred }) && accepts({x,y,heading:preferred}) ? { x, y, heading: preferred } : undefined;
  }
  for (const heading of headings)
    if (hullFits(map, ship, { ...point, heading }) && accepts({...point,heading}) && sameGround(map, seaStart, point, "sea"))
      return { ...point, heading };
  const t = map.terrain, col = Math.max(0, Math.min(t.cols - 1, Math.floor(point.x / t.cell))), row = Math.max(0, Math.min(t.rows - 1, Math.floor(point.y / t.cell)));
  for (let ring = 0; ring <= Math.max(t.cols, t.rows); ring++) {
    let best: ShipPose | undefined, score = Infinity;
    for (let y = Math.max(0, row - ring); y <= Math.min(t.rows - 1, row + ring); y++)
      for (let x = Math.max(0, col - ring); x <= Math.min(t.cols - 1, col + ring); x++) {
        if (ring && Math.max(Math.abs(x - col), Math.abs(y - row)) !== ring)
          continue;
        const at = { x: (x + .5) * t.cell, y: (y + .5) * t.cell };
        if (!CELL_GROUND[t.cells[y * t.cols + x] ?? "."]?.sea || !sameGround(map, seaStart, at, "sea"))
          continue;
        for (const heading of headings) {
          const value = Math.hypot(at.x - point.x, at.y - point.y) + Math.abs(headingDifference(preferred, heading)) * .001;
          if (value < score && hullFits(map, ship, { ...at, heading }) && accepts({...at,heading})) {
            best = { ...at, heading };
            score = value;
          }
        }
      }
    if (best)
      return best;
  }
  return undefined;
}
// All caches are geometry-only and recomputable. The active route is serialized with the ship, preserving replay order.
type NavGrid = {
  cells: string;
  cell: number;
  cols: number;
  rows: number;
  fits: Int8Array;
  turns: Int8Array;
  moves: Int8Array;
  masks: OccupancyMask[][];
};
const grids = new WeakMap<object, Map<string, NavGrid>>();
// Searches are synchronous. A generation stamp gives untouched states an
// infinite cost without allocating and clearing a map-sized array per order.
let search = { costs: new Float64Array(0), parents: new Int32Array(0), stamps: new Uint32Array(0), generation: 0 };
function searchWorkspace(size: number) {
  if (search.costs.length < size)
    search = { costs: new Float64Array(size), parents: new Int32Array(size), stamps: new Uint32Array(size), generation: 0 };
  if (++search.generation === 0xffffffff) {
    search.stamps.fill(0);
    search.generation = 1;
  }
  return search;
}
function gridFor(map: SeaMap, ship: Unit) {
  const t = map.terrain!, key = `${ship.kind}:${shipProfile(ship)!.length}:${map.width}:${map.height}:${t.cell}:${t.cols}:${t.rows}`;
  let group = grids.get(t);
  if (!group) {
    group = new Map();
    grids.set(t, group);
  }
  let grid = group.get(key);
  if (!grid || grid.cells !== t.cells) {
    // Full terrain resolution: the vessel's swept footprints are independent
    // of map position and can be reused as exact occupancy stencils.
    const stride = 1;
    const cell = t.cell * stride, cols = Math.ceil(map.width / cell), rows = Math.ceil(map.height / cell);
    const size = cols * rows * DIRECTIONS;
    const masks = t.cell === 32 && shipScale(ship) === DEFAULT_SHIP_SCALE ? preparedMasks[ship.kind as keyof typeof preparedMasks] as OccupancyMask[][] : buildNavigationMasks(shipProfile(ship)!.hull, t.cell);
    grid = { cells: t.cells, cell, cols, rows, masks, fits: new Int8Array(size), turns: new Int8Array(size * 2), moves: new Int8Array(size * 4) };
    if (group.size >= 32)
      group.delete(group.keys().next().value!);
    group.set(key, grid);
  }
  return grid;
}
function maskFits(map: SeaMap, grid: NavGrid, id: number, mask: OccupancyMask) {
  const tile = Math.floor(id / DIRECTIONS), col = tile % grid.cols, row = Math.floor(tile / grid.cols), x = col * grid.cell, y = row * grid.cell;
  const [left, top, right, bottom] = mask.bounds;
  if (x + left < -1e-7 || y + top < -1e-7 || x + right > map.width + 1e-7 || y + bottom > map.height + 1e-7)
    return false;
  const t = map.terrain!;
  for (let i = 0; i < mask.cells.length; i += 2) {
    const xx = col + mask.cells[i]!, yy = row + mask.cells[i + 1]!;
    if (xx < 0 || yy < 0 || xx >= t.cols || yy >= t.rows || !CELL_GROUND[t.cells[yy * t.cols + xx] ?? '.']?.sea)
      return false;
  }
  return true;
}
class Frontier {
  items: {
    id: number;
    cost: number;
    score: number;
  }[] = [];
  push(value: {
    id: number;
    cost: number;
    score: number;
  }) {
    let i = this.items.length;
    this.items.push(value);
    while (i) {
      const parent = (i - 1) >> 1;
      if (!this.less(value, this.items[parent]!))
        break;
      this.items[i] = this.items[parent]!;
      i = parent;
    }
    this.items[i] = value;
  }
  less(a: {
    id: number;
    score: number;
  }, b: {
    id: number;
    score: number;
  }) { return a.score < b.score || (a.score === b.score && a.id < b.id); }
  pop() {
    const result = this.items[0]!, tail = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.less(this.items[child + 1]!, this.items[child]!))
          child++;
        if (!this.less(this.items[child]!, tail))
          break;
        this.items[i] = this.items[child]!;
        i = child;
      }
      this.items[i] = tail;
    }
    return result;
  }
}
/** Heading-aware water routing. A long, narrow hull can pass a channel that it cannot turn inside. */
export function shipRoute(map: SeaMap, ship: Unit, goal: Point, trafficClear: (from:ShipPose,to:ShipPose)=>boolean = ()=>true): ShipPose[] {
  return planShipRoute(map,ship,goal,trafficClear).points;
}
/** A deterministic expansion budget bounds temporary traffic searches. Partial
 * routes remain journeys, never arrivals at the requested destination. */
export function planShipRoute(map: SeaMap, ship: Unit, goal: Point, trafficClear: (from:ShipPose,to:ShipPose)=>boolean = ()=>true, budget=Infinity): {points:ShipPose[];partial:boolean} {
  const t = map.terrain;
  if (!t)
    return {points:[{ ...goal, heading: Math.round(Math.atan2(goal.y - ship.y, goal.x - ship.x) * 1e9) / 1e9 }],partial:false};
  const grid = gridFor(map, ship), size = grid.fits.length;
  const lattice = grid;
  const trafficFits=new Int8Array(size);
  const pose = (id: number): ShipPose => { const cell = Math.floor(id / DIRECTIONS); return { x: (cell % lattice.cols + .5) * lattice.cell, y: (Math.floor(cell / lattice.cols) + .5) * lattice.cell, heading: (id % DIRECTIONS) * ANGLE }; };
  const fits = (id: number) => {
    if (!grid.fits[id])
      grid.fits[id] = maskFits(map, grid, id, grid.masks[id % DIRECTIONS]![0]!) ? 1 : -1;
    if(grid.fits[id]!==1)return false;
    if(!trafficFits[id]){const at=pose(id);trafficFits[id]=trafficClear(at,at)?1:-1;}
    return trafficFits[id]===1;
  };
  const target = nearestShipPose(map, ship, goal,ship,pose=>trafficClear(pose,pose));
  if (!target)
    return {points:[],partial:false};
  const length = shipProfile(ship)!.length;
  const start = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 };
  const desired = Math.round(Math.atan2(target.y - ship.y, target.x - ship.x) * 1e9) / 1e9;
  const turned = { ...start, heading: desired }, direct = { x: target.x, y: target.y, heading: desired };
  if (hullPassageClear(map, ship, start, turned) && hullPassageClear(map, ship, turned, direct) && trafficClear(start,turned) && trafficClear(turned,direct))
    return {points:[direct],partial:false};
  const workspace = searchWorkspace(size), { costs, parents: previous, stamps, generation } = workspace, frontier = new Frontier();
  const cost = (id: number) => stamps[id] === generation ? costs[id]! : Infinity;
  const setCost = (id: number, value: number, parent: number) => { stamps[id] = generation; costs[id] = value; previous[id] = parent; };
  const startTurns = new Int8Array(DIRECTIONS);
  const col = Math.floor(ship.x / lattice.cell), row = Math.floor(ship.y / lattice.cell);
  for (let y = Math.max(0, row - 1); y <= Math.min(lattice.rows - 1, row + 1); y++)
    for (let x = Math.max(0, col - 1); x <= Math.min(lattice.cols - 1, col + 1); x++)
      for (let h = 0; h < DIRECTIONS; h++) {
        const id = (y * lattice.cols + x) * DIRECTIONS + h, p = pose(id);
        if (!fits(id))
          continue;
        if (!startTurns[h])
          startTurns[h] = hullPassageClear(map, ship, start, { ...start, heading: p.heading }) && trafficClear(start,{...start,heading:p.heading}) ? 1 : -1;
        if (startTurns[h] !== 1 || !hullPassageClear(map, ship, { ...start, heading: p.heading }, p) || !trafficClear({...start,heading:p.heading},p))
          continue;
        const g = Math.hypot(p.x - ship.x, p.y - ship.y) + Math.abs(headingDifference(start.heading, p.heading)) * length / 2;
        setCost(id, g, -1);
        frontier.push({ id, cost: g, score: g + Math.hypot(p.x - target.x, p.y - target.y) });
      }
  let best = -1, bestGap = Infinity,visited=0,partial=false;
  while (frontier.items.length) {
    const next = frontier.pop();
    if (next.cost !== cost(next.id))
      continue;
    const id = next.id, p = pose(id), h = id % DIRECTIONS, cell = Math.floor(id / DIRECTIONS), x = cell % lattice.cols, y = Math.floor(cell / lattice.cols);
    if(++visited>budget){best=id;partial=true;break;}
    const gap = Math.hypot(p.x - target.x, p.y - target.y);
    if (gap < bestGap || (gap === bestGap && cost(id) < (best < 0 ? Infinity : cost(best)))) {
      best = id;
      bestGap = gap;
    }
    if (gap <= lattice.cell * 1.5 && hullFits(map, ship, { ...target, heading: p.heading }) && hullPassageClear(map, ship, p, { ...target, heading: p.heading }) && trafficClear(p,{...target,heading:p.heading})) {
      best = id;
      break;
    }
    const visit = (to: number, weight: number, slot: Int8Array, index: number, mask: OccupancyMask) => {
      const value = cost(id) + weight;
      if (value >= cost(to) || !fits(to))
        return;
      if (!slot[index])
        slot[index] = maskFits(map, grid, id, mask) ? 1 : -1;
      if (slot[index] !== 1 || !trafficClear(p,pose(to)))
        return;
      setCost(to, value, id);
      const at = pose(to);
      frontier.push({ id: to, cost: value, score: value + Math.hypot(at.x - target.x, at.y - target.y) });
    };
    visit(cell * DIRECTIONS + (h + 1) % DIRECTIONS, ANGLE * length / 2, grid.turns, id * 2, grid.masks[h]![1]!);
    visit(cell * DIRECTIONS + (h + DIRECTIONS - 1) % DIRECTIONS, ANGLE * length / 2, grid.turns, id * 2 + 1, grid.masks[h]![2]!);
    // Slow docking maneuvers let a ship back away or move seaward before turning beside a coast.
    for (let maneuver = 0; maneuver < 4; maneuver++) {
      const [dx, dy] = STEPS[(h + maneuver * 2) % DIRECTIONS]!, nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < lattice.cols && ny < lattice.rows)
        visit((ny * lattice.cols + nx) * DIRECTIONS + h, lattice.cell * (dx && dy ? Math.SQRT2 : 1) * [1, 1.8, 1.4, 1.8][maneuver]!, grid.moves, id * 4 + maneuver, grid.masks[h]![maneuver + 3]!);
    }
  }
  if (best < 0)
    return {points:[],partial:false};
  const path: ShipPose[] = [];
  for (let at = best; at >= 0; at = previous[at]!)
    path.push(pose(at));
  path.reverse();
  const first = path[0]!;
  if (Math.abs(headingDifference(start.heading, first.heading)) > 1e-7)
    path.unshift({ ...start, heading: first.heading });
  const end = path[path.length - 1]!;
  if (Math.hypot(end.x - target.x, end.y - target.y) <= lattice.cell * 1.5 && hullFits(map, ship, { ...target, heading: end.heading }) && hullPassageClear(map, ship, end, { ...target, heading: end.heading }) && trafficClear(end,{...target,heading:end.heading}))
    path.push({ ...target, heading: end.heading });
  return {points:path,partial};
}
