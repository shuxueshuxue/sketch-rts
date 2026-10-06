import { detCos, detSin } from "./det-math";
import { shipProfile, type Point } from "./ship-geometry";
import { CELL_GROUND, isWalkable, sameGround, walkableGoal } from "./terrain";
import type { GameMap, Unit } from "./types";
export type ShipPose = Point & {
  heading: number;
};
type SeaMap = Pick<GameMap, "terrain" | "width" | "height">;
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

function touchesCell(polygon: readonly Point[], left: number, top: number, cell: number) {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, nx = -(b.y - a.y), ny = b.x - a.x;
    const low = Math.min(...polygon.map(p => p.x * nx + p.y * ny)), high = Math.max(...polygon.map(p => p.x * nx + p.y * ny));
    const x = nx >= 0 ? left : left + cell, y = ny >= 0 ? top : top + cell;
    const min = x * nx + y * ny, max = min + cell * (Math.abs(nx) + Math.abs(ny));
    if (high <= min + 1e-7 || max <= low + 1e-7)
      return false;
  }
  return true;
}

function clearOutline(map: SeaMap, polygon: readonly Point[]) {
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  if (left < -1e-7 || top < -1e-7 || right > map.width + 1e-7 || bottom > map.height + 1e-7)
    return false;
  const terrain = map.terrain;
  if (!terrain)
    return true;
  const cell = terrain.cell;
  for (let row = Math.floor(top / cell); row <= Math.floor((bottom - 1e-7) / cell); row++)
    for (let col = Math.floor(left / cell); col <= Math.floor((right - 1e-7) / cell); col++) {
      const char = col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows ? undefined : terrain.cells[row * terrain.cols + col];
      if (!CELL_GROUND[char ?? "."]?.sea && touchesCell(polygon, col * cell, row * cell, cell))
        return false;
    }
  return true;
}

export function hullFits(map: SeaMap, ship: Unit, pose: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 }) {
  const profile = shipProfile(ship);
  return Boolean(profile && clearOutline(map, outline(profile.hull, pose)));
}

function convexHull(points: Point[]) {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: Point[]) => { const result: Point[] = []; for (const p of list) {
    while (result.length > 1 && cross(result[result.length - 2]!, result[result.length - 1]!, p) <= 0)
      result.pop();
    result.push(p);
  } return result; };
  const lower = half(sorted), upper = half([...sorted].reverse());
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Translation sweeps the whole hull; rotation is checked in increments of at most two world units at its tip. */

export function hullPassageClear(map: SeaMap, ship: Unit, from: ShipPose, to: ShipPose) {
  const hull = shipProfile(ship)!.hull;
  const turn = headingDifference(from.heading, to.heading);
  const radius = Math.max(...hull.map(p => Math.hypot(p.x, p.y)));
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * radius / 2));
  for (let i = 0; i < steps; i++) {
    const a = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, heading: from.heading + turn * i / steps };
    const b = { x: from.x + (to.x - from.x) * (i + 1) / steps, y: from.y + (to.y - from.y) * (i + 1) / steps, heading: from.heading + turn * (i + 1) / steps };
    if (!clearOutline(map, convexHull([...outline(hull, a), ...outline(hull, b)])))
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

export function nearestShipPose(map: SeaMap, ship: Unit, point: Point, seaOrigin: Point = ship): ShipPose | undefined {
  const preferred = ship.sailing?.heading ?? 0;
  const seaStart = isWalkable(map, seaOrigin.x, seaOrigin.y, "sea") ? seaOrigin : walkableGoal(map, seaOrigin.x, seaOrigin.y, "sea");
  const headings = [preferred, ...Array.from({ length: DIRECTIONS }, (_, i) => i * ANGLE)];
  if (!map.terrain) {
    const hull = outline(shipProfile(ship)!.hull, { x: 0, y: 0, heading: preferred });
    const x = Math.max(-Math.min(...hull.map(p => p.x)), Math.min(map.width - Math.max(...hull.map(p => p.x)), point.x));
    const y = Math.max(-Math.min(...hull.map(p => p.y)), Math.min(map.height - Math.max(...hull.map(p => p.y)), point.y));
    return hullFits(map, ship, { x, y, heading: preferred }) ? { x, y, heading: preferred } : undefined;
  }
  for (const heading of headings)
    if (hullFits(map, ship, { ...point, heading }) && sameGround(map, seaStart, point, "sea"))
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
          if (value < score && hullFits(map, ship, { ...at, heading })) {
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
  fits: Int8Array;
  turns: Int8Array;
  moves: Int8Array;
};
const grids = new WeakMap<object, Map<string, NavGrid>>();

function gridFor(map: SeaMap, ship: Unit) {
  const t = map.terrain!, key = `${ship.kind}:${shipProfile(ship)!.length}:${map.width}:${map.height}:${t.cell}:${t.cols}:${t.rows}`;
  let group = grids.get(t);
  if (!group) {
    group = new Map();
    grids.set(t, group);
  }
  let grid = group.get(key);
  if (!grid || grid.cells !== t.cells) {
    const size = t.cols * t.rows * DIRECTIONS;
    grid = { cells: t.cells, fits: new Int8Array(size), turns: new Int8Array(size * 2), moves: new Int8Array(size * 4) };
    if (group.size >= 32)
      group.delete(group.keys().next().value!);
    group.set(key, grid);
  }
  return grid;
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
  }) { let i = this.items.length; this.items.push(value); while (i) {
    const parent = (i - 1) >> 1;
    if (!this.less(value, this.items[parent]!))
      break;
    this.items[i] = this.items[parent]!;
    i = parent;
  } this.items[i] = value; }
  less(a: {
    id: number;
    score: number;
  }, b: {
    id: number;
    score: number;
  }) { return a.score < b.score || (a.score === b.score && a.id < b.id); }
  pop() { const result = this.items[0]!, tail = this.items.pop()!; if (this.items.length) {
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
  } return result; }
}

/** Heading-aware water routing. A long, narrow hull can pass a channel that it cannot turn inside. */

export function shipRoute(map: SeaMap, ship: Unit, goal: Point): ShipPose[] {
  const t = map.terrain;
  if (!t)
    return [{ ...goal, heading: Math.round(Math.atan2(goal.y - ship.y, goal.x - ship.x) * 1e9) / 1e9 }];
  const grid = gridFor(map, ship), size = grid.fits.length;
  const pose = (id: number): ShipPose => { const cell = Math.floor(id / DIRECTIONS); return { x: (cell % t.cols + .5) * t.cell, y: (Math.floor(cell / t.cols) + .5) * t.cell, heading: (id % DIRECTIONS) * ANGLE }; };
  const fits = (id: number) => { if (!grid.fits[id])
    grid.fits[id] = hullFits(map, ship, pose(id)) ? 1 : -1; return grid.fits[id] === 1; };
  const target = nearestShipPose(map, ship, goal);
  if (!target)
    return [];
  const length = shipProfile(ship)!.length;
  const start = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 };
  const desired = Math.round(Math.atan2(target.y - ship.y, target.x - ship.x) * 1e9) / 1e9;
  const turned = { ...start, heading: desired }, direct = { x: target.x, y: target.y, heading: desired };
  if (hullPassageClear(map, ship, start, turned) && hullPassageClear(map, ship, turned, direct))
    return [direct];
  const cost = new Float64Array(size).fill(Infinity), previous = new Int32Array(size).fill(-1), frontier = new Frontier();
  const col = Math.floor(ship.x / t.cell), row = Math.floor(ship.y / t.cell);
  for (let y = Math.max(0, row - 1); y <= Math.min(t.rows - 1, row + 1); y++)
    for (let x = Math.max(0, col - 1); x <= Math.min(t.cols - 1, col + 1); x++)
      for (let h = 0; h < DIRECTIONS; h++) {
        const id = (y * t.cols + x) * DIRECTIONS + h, p = pose(id);
        if (!fits(id) || !hullPassageClear(map, ship, start, { ...start, heading: p.heading }) || !hullPassageClear(map, ship, { ...start, heading: p.heading }, p))
          continue;
        const g = Math.hypot(p.x - ship.x, p.y - ship.y) + Math.abs(headingDifference(start.heading, p.heading)) * length / 2;
        cost[id] = g;
        frontier.push({ id, cost: g, score: g + Math.hypot(p.x - target.x, p.y - target.y) });
      }
  let best = -1, bestGap = Infinity;
  while (frontier.items.length) {
    const next = frontier.pop();
    if (next.cost !== cost[next.id])
      continue;
    const id = next.id, p = pose(id), h = id % DIRECTIONS, cell = Math.floor(id / DIRECTIONS), x = cell % t.cols, y = Math.floor(cell / t.cols);
    const gap = Math.hypot(p.x - target.x, p.y - target.y);
    if (gap < bestGap || (gap === bestGap && cost[id]! < (best < 0 ? Infinity : cost[best]!))) {
      best = id;
      bestGap = gap;
    }
    if (gap <= t.cell * .72 && hullFits(map, ship, { ...target, heading: p.heading }) && hullPassageClear(map, ship, p, { ...target, heading: p.heading })) {
      best = id;
      break;
    }
    const visit = (to: number, weight: number, slot: Int8Array, index: number) => {
      const value = cost[id]! + weight;
      if (value >= cost[to]! || !fits(to))
        return;
      if (!slot[index])
        slot[index] = hullPassageClear(map, ship, p, pose(to)) ? 1 : -1;
      if (slot[index] !== 1)
        return;
      cost[to] = value;
      previous[to] = id;
      const at = pose(to);
      frontier.push({ id: to, cost: value, score: value + Math.hypot(at.x - target.x, at.y - target.y) });
    };
    visit(cell * DIRECTIONS + (h + 1) % DIRECTIONS, ANGLE * length / 2, grid.turns, id * 2);
    visit(cell * DIRECTIONS + (h + DIRECTIONS - 1) % DIRECTIONS, ANGLE * length / 2, grid.turns, id * 2 + 1);
    // Slow docking maneuvers let a ship back away or move seaward before turning beside a coast.
    for (let maneuver = 0; maneuver < 4; maneuver++) {
      const [dx, dy] = STEPS[(h + maneuver * 2) % DIRECTIONS]!, nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < t.cols && ny < t.rows)
        visit((ny * t.cols + nx) * DIRECTIONS + h, t.cell * (dx && dy ? Math.SQRT2 : 1) * [1, 1.8, 1.4, 1.8][maneuver]!, grid.moves, id * 4 + maneuver);
    }
  }
  if (best < 0)
    return [];
  const path: ShipPose[] = [];
  for (let at = best; at >= 0; at = previous[at]!)
    path.push(pose(at));
  path.reverse();
  const first = path[0]!;
  if (Math.abs(headingDifference(start.heading, first.heading)) > 1e-7)
    path.unshift({ ...start, heading: first.heading });
  const end = path[path.length - 1]!;
  if (Math.hypot(end.x - target.x, end.y - target.y) <= t.cell * .72 && hullFits(map, ship, { ...target, heading: end.heading }) && hullPassageClear(map, ship, end, { ...target, heading: end.heading }))
    path.push({ ...target, heading: end.heading });
  return path;
}
