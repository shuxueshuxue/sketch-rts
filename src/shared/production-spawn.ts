import { UNIT_DEFS } from './catalog';
import { createUnit } from './map';
import { GOLD_MINE_RULES } from './mining';
import { segmentDistanceSquared, type Point } from './navigation-math';
import { distanceToHull, shipProfile } from './ship-geometry';
import { footprintHalf, groundRevision, isOpenGround, segmentWalkable, walkableGoal, walkDestination } from './terrain';
import type { Building, GameMap, GameSnapshot, Obstacle, Unit, UnitKind } from './types';

type World = Pick<GameSnapshot, 'map' | 'units' | 'buildings' | 'obstacles'> & Partial<Pick<GameSnapshot, 'resources'>>;
type Solid = Building | Obstacle;
type Exits = {
  geometry: string;
  terrain: GameMap['terrain'];
  cells: string | undefined;
  points: Point[];
  range: number;
  reachability?: { rally: string; points: Map<Point, boolean> };
  selection?: string;
  result?: Point | undefined;
};
const exits = new WeakMap<object, WeakMap<Building, Exits>>();
const prototypes = new WeakMap<Building, Map<UnitKind, { definition: typeof UNIT_DEFS[UnitKind]; unit: Unit }>>();
const GAP = 4;
const OUTWARD = [0, 32, 64] as const;

/** A unit rally follows its current position, not the position recorded when
 * the player set it. Missing/dead targets retain our normal ground rally. */
export function productionRallyPoint(world: Pick<World, 'units' | 'resources'>, building: Building): Point {
  const target = building.rallyTarget;
  if (target?.type === 'unit') {
    const unit = world.units.find(unit => unit.id === target.unitId && unit.owner === building.owner && unit.hp > 0);
    if (unit) return { x: unit.x, y: unit.y };
  } else if (target?.type === 'resource') {
    const resource = world.resources?.find(resource => resource.id === target.resourceId && resource.amount > 0);
    if (resource) return { x: resource.x, y: resource.y };
  }
  return { x: building.rallyX, y: building.rallyY };
}

/** A blocked paid job only needs its ordinary body, not fresh runtime units,
 * IDs, inventory or equipment on every simulation tick. */
export function landSpawnPrototype(building: Building, kind: UnitKind): Unit {
  let kinds = prototypes.get(building);
  if (!kinds) { kinds = new Map(); prototypes.set(building, kinds); }
  const definition = UNIT_DEFS[kind];
  let cached = kinds.get(kind);
  if (!cached || cached.definition !== definition || cached.unit.kind !== kind || cached.unit.radius !== definition.radius
    || cached.unit.bodyRadius !== undefined || cached.unit.deckScale !== undefined || cached.unit.fittings !== undefined) {
    cached = { definition, unit: createUnit('production-probe', building.owner, kind, building.x, building.y) };
    kinds.set(kind, cached);
  }
  cached.unit.owner = building.owner;
  cached.unit.x = cached.unit.homeX = building.x; cached.unit.y = cached.unit.homeY = building.y;
  return cached.unit;
}

/** Warcraft III's official building guide specifies the rally-side exit;
 * our exact placement is a bounded local search with full body clearance.
 * An unreachable rally cannot move a unit across a wall, river or island. */
export function landSpawnPoint(world: World, building: Building, unit: Unit): Point | undefined {
  if (building.hp <= 0) return undefined;
  const radius = Math.max(unit.radius, unit.bodyRadius ?? 0), terrain = world.map.terrain;
  const solids = [...world.buildings, ...(world.obstacles ?? [])].filter(body => body.hp > 0);
  const geometry = `${building.x}:${building.y}:${building.radius}:${radius}:${world.map.width}:${world.map.height}:${terrain?.cell}:${terrain?.cols}:${terrain?.rows}:${groundRevision(world.map)}:${solids.map(s => `${s.id}:${s.x}:${s.y}:${s.radius}`).join('|')}`;
  let buildings = exits.get(world.map);
  if (!buildings) { buildings = new WeakMap(); exits.set(world.map, buildings); }
  let cached = buildings.get(building);
  if (!cached || cached.geometry !== geometry || cached.terrain !== terrain || cached.cells !== terrain?.cells) {
    const points = landExits(world.map, building, radius, solids);
    cached = { geometry, terrain, cells: terrain?.cells, points, range: points.reduce((reach, p) => Math.max(reach, Math.hypot(p.x - building.x, p.y - building.y) + radius), 0) };
    buildings.set(building, cached);
  }
  if (!cached.points.length) return undefined;
  const bodies = world.units.filter(body => body !== unit && body.hp > 0 && !body.deck
    && (shipProfile(body) ? distanceToHull(body, building) : Math.hypot(body.x - building.x, body.y - building.y) - Math.max(body.radius, body.bodyRadius ?? 0)) <= cached!.range);
  const mines = world.resources?.filter(resource => resource.amount > 0 && Math.hypot(resource.x - building.x, resource.y - building.y) <= cached!.range + GOLD_MINE_RULES.radius) ?? [];
  const aim = productionRallyPoint(world, building);
  const selection = `${aim.x}:${aim.y}:${bodies.map(body => `${body.id}:${body.kind}:${body.x}:${body.y}:${body.radius}:${body.bodyRadius}:${body.sailing?.heading ?? 0}`).join('|')}:${mines.map(mine => `${mine.id}:${mine.x}:${mine.y}`).join('|')}`;
  if (cached.selection !== selection) {
    cached.selection = selection;
    const goal = walkableGoal(world.map, aim.x, aim.y);
    const rally = `${goal.x}:${goal.y}`;
    if (cached.reachability?.rally !== rally) cached.reachability = { rally, points: new Map() };
    // Charge the local exit distance too: a farther outer row must not win
    // merely because it is a few pixels nearer a very distant rally.
    const travel = (point: Point) => Math.hypot(point.x - aim.x, point.y - aim.y) + Math.hypot(point.x - building.x, point.y - building.y);
    const ordered = [...cached.points].sort((a, b) => travel(a) - travel(b)
      || Math.hypot(a.x - building.x, a.y - building.y) - Math.hypot(b.x - building.x, b.y - building.y));
    let fallback: Point | undefined;
    let reachableExit = false;
    cached.result = undefined;
    for (const point of ordered) {
      let reachable = cached.reachability.points.get(point);
      if (reachable === undefined) {
        const destination = walkDestination(world.map, point, goal);
        reachable = Math.hypot(destination.x - goal.x, destination.y - goal.y) <= 1e-6;
        cached.reachability.points.set(point, reachable);
      }
      reachableExit ||= reachable;
      if (!bodies.every(body => shipProfile(body) ? distanceToHull(body, point) >= radius + GAP
        : Math.hypot(point.x - body.x, point.y - body.y) >= radius + Math.max(body.radius, body.bodyRadius ?? 0) + GAP)
        || !mines.every(mine => Math.hypot(point.x - mine.x, point.y - mine.y) >= radius + GOLD_MINE_RULES.radius + GAP)) continue;
      fallback ??= point;
      if (!reachable) continue;
      cached.result = point; break;
    }
    // A traffic-blocked reachable gate waits. Falling back into an isolated
    // courtyard would strand the paid unit on the wrong side of its own wall.
    if (!reachableExit) cached.result = fallback;
  }
  return cached.result ? { ...cached.result } : undefined;
}

function solidHalf(map: GameMap, body: Solid) {
  return map.terrain ? footprintHalf(body.radius, map.terrain.cell) : body.radius;
}
function diskClearsSolid(map: GameMap, point: Point, radius: number, body: Solid) {
  const half = solidHalf(map, body), x = Math.max(0, Math.abs(point.x - body.x) - half), y = Math.max(0, Math.abs(point.y - body.y) - half);
  return x * x + y * y >= radius * radius - 1e-7;
}
function exitClearsSolid(map: GameMap, anchor: Point, point: Point, radius: number, body: Solid) {
  const half = solidHalf(map, body), corners = [{ x: body.x - half, y: body.y - half }, { x: body.x + half, y: body.y - half }, { x: body.x + half, y: body.y + half }, { x: body.x - half, y: body.y + half }];
  if (!diskClearsSolid(map, anchor, radius, body) || !diskClearsSolid(map, point, radius, body)) return false;
  for (let i = 0; i < 4; i++) if (segmentDistanceSquared(anchor, point, corners[i]!, corners[(i + 1) % 4]!) < radius * radius - 1e-7) return false;
  return true;
}
function diskFitsGround(map: GameMap, point: Point, radius: number) {
  if (point.x - radius < 0 || point.y - radius < 0 || point.x + radius > map.width || point.y + radius > map.height) return false;
  const terrain = map.terrain;
  if (!terrain) return true;
  for (let row = Math.floor((point.y - radius) / terrain.cell); row <= Math.floor((point.y + radius) / terrain.cell); row++)
    for (let col = Math.floor((point.x - radius) / terrain.cell); col <= Math.floor((point.x + radius) / terrain.cell); col++) {
      const x = Math.max(col * terrain.cell, Math.min((col + 1) * terrain.cell, point.x)), y = Math.max(row * terrain.cell, Math.min((row + 1) * terrain.cell, point.y));
      if ((x - point.x) ** 2 + (y - point.y) ** 2 < radius * radius - 1e-7
        && !isOpenGround(map, (col + .5) * terrain.cell, (row + .5) * terrain.cell)) return false;
    }
  return true;
}
function landExits(map: GameMap, building: Building, radius: number, solids: readonly Solid[]) {
  const half = solidHalf(map, building), tangent = Math.max(0, half - Math.min(radius, half));
  const offsets = [...new Set([0, -half / 2, half / 2, -tangent, tangent])];
  const points: Point[] = [];
  for (let face = 0; face < 4; face++) for (const offset of offsets) {
    const anchor = face === 0 ? { x: building.x + half + .01, y: building.y + offset }
      : face === 1 ? { x: building.x - half - .01, y: building.y + offset }
      : face === 2 ? { x: building.x + offset, y: building.y + half + .01 }
      : { x: building.x + offset, y: building.y - half - .01 };
    if (!isOpenGround(map, anchor.x, anchor.y)) continue;
    for (const outward of OUTWARD) {
      const reach = half + radius + GAP + outward;
      const point = face === 0 ? { x: building.x + reach, y: building.y + offset }
        : face === 1 ? { x: building.x - reach, y: building.y + offset }
        : face === 2 ? { x: building.x + offset, y: building.y + reach }
        : { x: building.x + offset, y: building.y - reach };
      // Checking the exit segment prevents an outer free row from placing a
      // new unit beyond a neighboring gate or strip of impassable terrain.
      if (!diskFitsGround(map, point, radius) || !segmentWalkable(map, anchor, point)
        || !solids.every(body => diskClearsSolid(map, point, radius + GAP, body) && (body === building || exitClearsSolid(map, anchor, point, radius, body)))) continue;
      points.push(point);
    }
  }
  return points;
}
