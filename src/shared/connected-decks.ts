import { deckLoad, deckPlacement } from "./decks";
import { capsuleClearsBodies, capsuleClearsCircles, expandConvex } from './navigation-math';
import { supportSurface } from './support-surface';
import { bodyMass } from "./physical-body";
import { shipsIn, circleInPolygon, hullGap, localToWorld, shipPassengers, shipProfile, worldToLocal, type Point } from "./ship-geometry";
import { detCos, detSin } from "./det-math";
import { perTick } from "./time";
import { groundRevision, isOpenGround } from "./terrain";
import type { GameMap, Unit } from "./types";
// Sub-pixel contact tolerance accommodates hull separation's numerical clearance.
const CONTACT_CLEARANCE = .5;
type Surface = {
  ship: Unit;
  profile: NonNullable<ReturnType<typeof shipProfile>>;
  hull: Point[];
}[];
type CrossingGeometry = {
  surface: Surface;
  floor: ReturnType<typeof supportSurface>;
  obstacles: (Point & {
    radius: number;
  })[];
  nodes: Point[];
  links: Int8Array;
};
const crossings = new WeakMap<GameMap, {
  terrain: GameMap['terrain'];
  cells: string | undefined;
  entries: Map<string, CrossingGeometry>;
}>();
const profileIds = new WeakMap<object, number>();
let nextProfileId = 1;
function crossingGeometry(ships: Unit[], passenger: Unit, map: GameMap, land: boolean): CrossingGeometry {
  const terrain = map.terrain, cell = terrain?.cell ?? 32, radius = passenger.radius + 1, padding = passenger.radius * 4 + cell * 3;
  const poses = ships.map(ship => {
    const profile = shipProfile(ship)!;
    let id = profileIds.get(profile);
    if (id === undefined) {
      id = nextProfileId++;
      profileIds.set(profile, id);
    }
    return `${id}:${ship.x}:${ship.y}:${ship.sailing?.heading ?? 0}`;
  });
  // Cell-aligned local bounds remain valid while a body moves within them.
  const left = Math.floor((Math.min(passenger.x, ...ships.map(s => s.x - shipProfile(s)!.length)) - padding) / cell) * cell;
  const right = Math.ceil((Math.max(passenger.x, ...ships.map(s => s.x + shipProfile(s)!.length)) + padding) / cell) * cell;
  const top = Math.floor((Math.min(passenger.y, ...ships.map(s => s.y - shipProfile(s)!.length)) - padding) / cell) * cell;
  const bottom = Math.ceil((Math.max(passenger.y, ...ships.map(s => s.y + shipProfile(s)!.length)) + padding) / cell) * cell;
  const key = `${poses.join(';')}/${radius}/${land}/${groundRevision(map)}/${left},${top},${right},${bottom}`;
  let cache = crossings.get(map);
  if (!cache || cache.terrain !== terrain || cache.cells !== terrain?.cells) {
    cache = { terrain, cells: terrain?.cells, entries: new Map() };
    crossings.set(map, cache);
  }
  const known = cache.entries.get(key);
  if (known)
    return known;
  const surface = ships.map(ship => ({ ship, profile: shipProfile(ship)!, hull: shipProfile(ship)!.hull.map(p => localToWorld(ship, p)) }));
  const floor = supportSurface(surface.map(s => expandConvex(s.hull, CONTACT_CLEARANCE / 2)), land && terrain ? { cell: terrain.cell, cols: terrain.cols, rows: terrain.rows, open: (col, row) => col >= 0 && row >= 0 && col < terrain.cols && row < terrain.rows && isOpenGround(map, (col + .5) * terrain.cell, (row + .5) * terrain.cell, 'land') } : undefined, { left, top, right, bottom });
  const obstacles = surface.flatMap(({ ship, profile }) => profile.obstacles.map(o => ({ ...localToWorld(ship, o), radius: o.radius })));
  const nodes: Point[] = [];
  const fits = (p: Point) => floor.diskFits(p, radius) && capsuleClearsCircles(p, p, radius, obstacles);
  for (const { hull } of surface)
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
      for (const t of [.25, .5, .75]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (fits(p))
          nodes.push(p);
      }
    }
  for (const obstacle of obstacles)
    for (let i = 0; i < 12; i++) {
      const r = (obstacle.radius + passenger.radius + 3) / detCos(Math.PI / 12), angle = i * Math.PI / 6;
      const point = { x: obstacle.x + detCos(angle) * r, y: obstacle.y + detSin(angle) * r };
      if (fits(point))
        nodes.push(point);
    }
  const result = { surface, floor, obstacles, nodes, links: new Int8Array(nodes.length ** 2) };
  if (cache.entries.size >= 32)
    cache.entries.delete(cache.entries.keys().next().value!);
  cache.entries.set(key, result);
  return result;
}
export function shipShorePoints(ship: Unit, map: Pick<GameMap, "terrain" | "width" | "height">) {
  const profile = shipProfile(ship);
  if (!profile || !map.terrain)
    return [];
  const points: Point[] = [];
  for (let i = 0; i < profile.hull.length; i++) {
    const a = profile.hull[i]!, b = profile.hull[(i + 1) % profile.hull.length]!, steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10));
    for (let j = 0; j <= steps; j++) {
      const at = localToWorld(ship, { x: a.x + (b.x - a.x) * j / steps, y: a.y + (b.y - a.y) * j / steps });
      if (isOpenGround(map, at.x, at.y, "land"))
        points.push(at);
    }
  }
  return points;
}
export function decksTouch(a: Unit, b: Unit, passenger: Unit) {
  const aa = shipProfile(a), bb = shipProfile(b);
  return Boolean(a.hp > 0 && b.hp > 0 && aa && bb && Math.abs(aa.deckHeight - bb.deckHeight) <= passenger.radius * 2
    && Math.hypot(a.x - b.x, a.y - b.y) < (aa.length + bb.length) / 2 && hullGap(a, b) <= CONTACT_CLEARANCE);
}
function connectedShips(start: Unit, passenger: Unit, units: readonly Unit[]) {
  const found = [start], seen = new Set([start.id]);
  const vessels = shipsIn(units);
  for (let i = 0; i < found.length; i++)
    for (const ship of vessels)
      if (!seen.has(ship.id) && decksTouch(found[i]!, ship, passenger)) {
        seen.add(ship.id);
        found.push(ship);
      }
  return found;
}
/** Hull contact, usable floor and body clearance govern decks and shore alike. */
export function walkConnectedSurfaces(passenger: Unit, world: Point, units: readonly Unit[], map: GameMap, pace = 1) {
  const hulls = shipsIn(units);
  if (!hulls.length)
    return false;
  const source = passenger.deck && hulls.find(ship => ship.id === passenger.deck!.shipId);
  let target = hulls.find(ship => ship.hp > 0 && shipProfile(ship) && circleInPolygon(worldToLocal(ship, world), 0, shipProfile(ship)!.hull));
  if (!source && !target) {
    const dx = world.x - passenger.x, dy = world.y - passenger.y, len = Math.hypot(dx, dy) || 1;
    const next = { x: passenger.x + dx / len * perTick(passenger.speed) * pace, y: passenger.y + dy / len * perTick(passenger.speed) * pace };
    target = hulls.find(ship => ship.hp > 0 && shipProfile(ship) && circleInPolygon(worldToLocal(ship, next), 0, shipProfile(ship)!.hull));
  }
  if (!source && !target || source && target?.id === source.id)
    return false;
  if (!source && target && Math.hypot(passenger.x - target.x, passenger.y - target.y) > shipProfile(target)!.length / 2 + passenger.radius * 3)
    return false;
  const ships = connectedShips(source || target!, passenger, units);
  if (target && !ships.includes(target))
    return false;
  const land = !source || !target;
  if (land && (!map.terrain || ships.every(ship => shipProfile(ship)!.deckHeight > passenger.radius * 2.5)))
    return false;
  const geometry = crossingGeometry(ships, passenger, map, land), { surface, floor, obstacles } = geometry;
  let destination: Point | undefined;
  if (target) {
    if (deckLoad(units, target) + bodyMass(passenger) > shipProfile(target)!.loadCapacity || !deckPlacement(target, passenger, units))
      return false;
    if (!source && !ships.some(ship => Math.hypot(passenger.x - ship.x, passenger.y - ship.y) < shipProfile(ship)!.length / 2 + passenger.radius * 3))
      return false;
    const goal = deckPlacement(target, passenger, units, worldToLocal(target, source ? world : passenger), true);
    if (goal)
      destination = localToWorld(target, goal);
  }
  else {
    const terrain = map.terrain!, reach = shipProfile(source!)!.length / 2 + passenger.radius * 3;
    let score = Infinity;
    for (let row = Math.max(0, Math.floor((source!.y - reach) / terrain.cell)); row < Math.min(terrain.rows, Math.ceil((source!.y + reach) / terrain.cell)); row++)
      for (let col = Math.max(0, Math.floor((source!.x - reach) / terrain.cell)); col < Math.min(terrain.cols, Math.ceil((source!.x + reach) / terrain.cell)); col++) {
        const point = { x: (col + .5) * terrain.cell, y: (row + .5) * terrain.cell };
        if (!floor.diskOnLand(point, passenger.radius + 1) || surface.some(({ hull }) => circleInPolygon(point, 0, hull)))
          continue;
        const value = Math.hypot(point.x - world.x, point.y - world.y) + Math.hypot(point.x - passenger.x, point.y - passenger.y) * .5;
        if (value < score) {
          score = value;
          destination = point;
        }
      }
  }
  if (!destination)
    return false;
  // Only bodies beside this crossing can obstruct it. Distant shore armies
  // used to create hundreds of nodes and quadratic, map-wide edge searches.
  const margin = passenger.radius * 4 + 32;
  const left = Math.min(passenger.x, destination.x) - margin, right = Math.max(passenger.x, destination.x) + margin;
  const top = Math.min(passenger.y, destination.y) - margin, bottom = Math.max(passenger.y, destination.y) + margin;
  const bodies = units.filter(other => other.id !== passenger.id && other.hp > 0 && !shipProfile(other)
    && (!other.deck || ships.some(ship => ship.id === other.deck?.shipId))
    && other.x + other.radius >= left && other.x - other.radius <= right && other.y + other.radius >= top && other.y - other.radius <= bottom);
  const fits = (point: Point, occupied = false) => {
    if (obstacles.some(o => Math.hypot(point.x - o.x, point.y - o.y) < o.radius + passenger.radius + 1))
      return false;
    if (!floor.diskFits(point, passenger.radius + 1))
      return false;
    return !occupied || capsuleClearsBodies(passenger, point, passenger.radius + 1, bodies);
  };
  const staticClear = (a: Point, b: Point) => floor.capsuleFits(a, b, passenger.radius + 1) && capsuleClearsCircles(a, b, passenger.radius + 1, obstacles);
  const clear = (a: Point, b: Point, ai = -1, bi = -1) => {
    const count = geometry.nodes.length, cacheable = ai >= 2 && bi >= 2 && ai < count + 2 && bi < count + 2;
    let valid: boolean;
    if (cacheable) {
      const index = (ai - 2) * count + bi - 2;
      if (!geometry.links[index])
        geometry.links[index] = staticClear(a, b) ? 1 : -1;
      valid = geometry.links[index] === 1;
    }
    else
      valid = staticClear(a, b);
    return valid && capsuleClearsBodies(a, b, passenger.radius + 1, bodies);
  };
  const nodes: Point[] = [passenger, destination];
  if (!clear(passenger, destination)) {
    nodes.push(...geometry.nodes);
    for (const other of bodies) {
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6, r = (other.radius + passenger.radius + 3) / detCos(Math.PI / 12);
        const point = { x: other.x + detCos(angle) * r, y: other.y + detSin(angle) * r };
        if (fits(point, true))
          nodes.push(point);
      }
    }
  }
  const costs = nodes.map(() => Infinity), parents = nodes.map(() => -1), seen = new Set<number>();
  costs[0] = 0;
  while (seen.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!seen.has(i) && (current < 0 || costs[i]! < costs[current]!))
        current = i;
    if (current < 0 || !Number.isFinite(costs[current]!))
      return true;
    if (current === 1)
      break;
    seen.add(current);
    for (let i = 0; i < nodes.length; i++) {
      const value = costs[current]! + Math.hypot(nodes[i]!.x - nodes[current]!.x, nodes[i]!.y - nodes[current]!.y);
      if (!seen.has(i) && value < costs[i]! && clear(nodes[current]!, nodes[i]!, current, i)) {
        if (value < costs[i]!) {
          costs[i] = value;
          parents[i] = current;
        }
      }
    }
  }
  let next = 1;
  while (parents[next]! > 0)
    next = parents[next]!;
  const waypoint = nodes[next]!, gap = Math.hypot(waypoint.x - passenger.x, waypoint.y - passenger.y);
  if (!gap)
    return true;
  const step = Math.min(gap, perTick(passenger.speed) * pace), at = { x: passenger.x + (waypoint.x - passenger.x) * step / gap, y: passenger.y + (waypoint.y - passenger.y) * step / gap };
  if (!fits(at, true))
    return true;
  const parent = surface.find(({ hull }) => circleInPolygon(at, 0, hull))?.ship;
  if (parent && parent.id !== passenger.deck?.shipId && deckLoad(units, parent) + bodyMass(passenger) > shipProfile(parent)!.loadCapacity)
    return true;
  if (parent?.id !== passenger.deck?.shipId)
    passenger.aim = undefined;
  if (parent)
    passenger.deck = { shipId: parent.id, ...worldToLocal(parent, at) };
  else if (floor.diskOnLand(at, passenger.radius + 1))
    delete passenger.deck;
  else if (source)
    passenger.deck = { shipId: source.id, ...worldToLocal(source, at) };
  Object.assign(passenger, at);
  return true;
}
/** A hull that pulls away cannot carry a soldier standing outside its own usable deck. */
export function settleDeckSupport(units: readonly Unit[], map: GameMap) {
  if (!shipsIn(units).length)
    return;
  for (const passenger of units) {
    if (!passenger.deck || passenger.hp <= 0)
      continue;
    const ship = units.find(ship => ship.id === passenger.deck!.shipId && ship.hp > 0), profile = ship && shipProfile(ship);
    if (!ship || !profile || circleInPolygon(passenger.deck, passenger.radius + 1, profile.deck))
      continue;
    if (units.some(other => other.id !== ship.id && decksTouch(ship, other, passenger)))
      continue;
    // A body can straddle a shore edge while every part remains supported.
    let supported = true;
    for (let i = 0; i < 24; i++) {
      const point = { x: passenger.x + detCos(i * Math.PI / 12) * (passenger.radius + 1), y: passenger.y + detSin(i * Math.PI / 12) * (passenger.radius + 1) };
      if (!isOpenGround(map, point.x, point.y, "land") && !circleInPolygon(worldToLocal(ship, point), 0, profile.hull))
        supported = false;
    }
    if (supported)
      continue;
    if (isOpenGround(map, passenger.x, passenger.y, "land")) {
      let safe = true;
      for (let i = 0; i < 24; i++)
        if (!isOpenGround(map, passenger.x + detCos(i * Math.PI / 12) * (passenger.radius + 1), passenger.y + detSin(i * Math.PI / 12) * (passenger.radius + 1), "land"))
          safe = false;
      if (safe) {
        delete passenger.deck;
        continue;
      }
    }
    const point = deckPlacement(ship, passenger, units, passenger.deck);
    if (point) {
      passenger.deck = { shipId: ship.id, ...point };
      Object.assign(passenger, localToWorld(ship, point));
    }
    // Losing a temporary bridge is not a shipwreck. Stay attached to the
    // living hull until a usable deck position opens; hull destruction is
    // the simulation's single authority for drowning passengers.
  }
}
