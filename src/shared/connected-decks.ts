import { deckHasRoom, deckLoad, deckPlacement, deckPointFits } from "./decks";
import { capsuleClearsBodies, capsuleClearsCircles, clipToConvex, expandConvex } from './navigation-math';
import { supportSurface } from './support-surface';
import { walkField, walkGraph, walkLeg, type WalkGraph } from './walk-field';
import { bodyMass } from "./physical-body";
import { shipsIn, circleInPolygon, hullGap, localToWorld, shipPassengers, shipProfile, worldToLocal, type Point } from "./ship-geometry";
import { detCos, detSin } from "./det-math";
import { perTick } from "./time";
import { strikeReach } from "./combat-geometry";
import { groundRevision, isOpenGround } from "./terrain";
import { SHIP_IMPACT_SAFE_SPEED, shipPointVelocity } from './ship-collisions';
import { gangwayBetween, gangwayCrossingAt, gangwaySurface, type GangwaySurface } from './ship-gangway';
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
  // The fixed waypoints of the crossing and what is known between them (see @@@walk-field).
  graph: WalkGraph;
  bridges: GangwaySurface[];
};
const crossings = new WeakMap<GameMap, {
  terrain: GameMap['terrain'];
  cells: string | undefined;
  entries: Map<string, CrossingGeometry>;
}>();
const profileIds = new WeakMap<object, number>();
let nextProfileId = 1;
function seamPoints(a:readonly Point[],b:readonly Point[]) {
  const points:Point[]=[];
  for(const [hull,other] of [[a,b],[b,a]] as const)for(let i=0;i<hull.length;i++) {
    const from=hull[i]!,to=hull[(i+1)%hull.length]!,interval=clipToConvex(from,to,other);
    if(!interval)continue;
    for(const fraction of [.25,.5,.75]) {
      const t=interval[0]+(interval[1]-interval[0])*fraction;
      points.push({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t});
    }
  }
  return points;
}
function crossingGeometry(ships: Unit[], passenger: Unit, map: GameMap, land: boolean): CrossingGeometry {
  const gangways: {source:Unit;target:Unit;surface:GangwaySurface}[]=[];
  for(const source of ships) {
    const target=ships.find(ship=>ship.id===source.sailing?.gangway?.targetId);
    const connection=target && gangwayBetween(source,target,passenger);
    if(connection?.source===source)gangways.push(connection);
  }
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
  const bridgeKey=gangways.map(({source,target,surface})=>`${source.id}:${target.id}:${surface.width}:${surface.source.x},${surface.source.y}:${surface.target.x},${surface.target.y}`).join(';');
  // The local bounds only frame the ground's edges; a crossing between decks alone has none, and is one geometry for
  // every walker on it.
  const key = `${poses.join(';')}/${bridgeKey}/${radius}/${land}/${groundRevision(map)}/${land ? `${left},${top},${right},${bottom}` : ''}`;
  let cache = crossings.get(map);
  if (!cache || cache.terrain !== terrain || cache.cells !== terrain?.cells) {
    cache = { terrain, cells: terrain?.cells, entries: new Map() };
    crossings.set(map, cache);
  }
  const known = cache.entries.get(key);
  if (known)
    return known;
  const surface = ships.map(ship => ({ ship, profile: shipProfile(ship)!, hull: shipProfile(ship)!.hull.map(p => localToWorld(ship, p)) }));
  const hulls=surface.map(s => expandConvex(s.hull, CONTACT_CLEARANCE / 2));
  const floor = supportSurface([...hulls,...gangways.map(connection=>connection.surface.polygon)], land && terrain ? { cell: terrain.cell, cols: terrain.cols, rows: terrain.rows, open: (col, row) => col >= 0 && row >= 0 && col < terrain.cols && row < terrain.rows && isOpenGround(map, (col + .5) * terrain.cell, (row + .5) * terrain.cell, 'land') } : undefined, { left, top, right, bottom });
  const obstacles = surface.flatMap(({ ship, profile }) => profile.obstacles.map(o => ({ ...localToWorld(ship, o), radius: o.radius })));
  const nodes: Point[] = [];
  const fits = (p: Point) => floor.diskFits(p, radius) && capsuleClearsCircles(p, p, radius, obstacles);
  for(const {surface:bridge} of gangways)for(const t of [0,.25,.5,.75,1]) {
    const point={x:bridge.source.x+(bridge.target.x-bridge.source.x)*t,y:bridge.source.y+(bridge.target.y-bridge.source.y)*t};
    if(fits(point))nodes.push(point);
  }
  // A slight berth yaw can leave a usable seam between the fixed quarter-edge
  // samples. Include the actual overlapping seam used by the contact proof.
  for(let i=0;i<hulls.length;i++)for(let j=i+1;j<hulls.length;j++)
    for(const point of seamPoints(hulls[i]!,hulls[j]!))if(fits(point))nodes.push(point);
  for (const { hull } of surface)
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
      for (const t of [.25, .5, .75]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (fits(p))
          nodes.push(p);
      }
    }
  // Eroded hull corners provide routes out of narrow aft boarding positions.
  // Seam samples alone leave larger crew trapped between a cabin and railing.
  for (const { hull } of surface)
    for (const point of expandConvex(hull,-radius-1e-4))
      if (fits(point)) nodes.push(point);
  for (const obstacle of obstacles)
    for (let i = 0; i < 12; i++) {
      const r = (obstacle.radius + passenger.radius + 3) / detCos(Math.PI / 12), angle = i * Math.PI / 6;
      const point = { x: obstacle.x + detCos(angle) * r, y: obstacle.y + detSin(angle) * r };
      if (fits(point))
        nodes.push(point);
    }
  const result = { surface, floor, obstacles, graph: walkGraph(nodes), bridges: gangways.map(connection => connection.surface) };
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
// The usable seam between two touching hulls for a body of this size. Every walker asks it of every pair of hulls each
// tick, and it depends only on the two hulls' poses: the answer is kept until either moves.
const seams = new Map<string, Point[]>();
function supportedSeamPoints(a:Unit,b:Unit,passenger:Unit) {
  const key = `${poseKey(a)}/${poseKey(b)}/${passenger.radius}`;
  let points = seams.get(key);
  if (!points) {
    if (seams.size >= 64) seams.delete(seams.keys().next().value!);
    seams.set(key, points = seamPointsBetween(a, b, passenger));
  }
  return points;
}
function poseKey(ship: Unit) {
  const profile = shipProfile(ship);
  if (!profile) return `${ship.id}:none`;
  let id = profileIds.get(profile);
  if (id === undefined) profileIds.set(profile, id = nextProfileId++);
  return `${id}:${ship.hp > 0}:${ship.x}:${ship.y}:${ship.sailing?.heading ?? 0}`;
}
function seamPointsBetween(a:Unit,b:Unit,passenger:Unit) {
  if (!decksTouch(a, b, passenger)) return [];
  const hulls = [a,b].map(ship => expandConvex(shipProfile(ship)!.hull.map(point => localToWorld(ship,point)), CONTACT_CLEARANCE / 2));
  const floor = supportSurface(hulls, undefined, {left:0,top:0,right:0,bottom:0});
  const obstacles = [a,b].flatMap(ship => shipProfile(ship)!.obstacles.map(obstacle => ({...localToWorld(ship,obstacle),radius:obstacle.radius})));
  return seamPoints(hulls[0]!,hulls[1]!).filter(point=>floor.diskFits(point,passenger.radius+1) && capsuleClearsCircles(point,point,passenger.radius+1,obstacles));
}
/** A hypothetical terminal berth checks support without carrying the current
 * approach's velocity into the plan. Point contact at a bow is insufficient. */
export function decksSupportCrossing(a:Unit,b:Unit,passenger:Unit) {
  return supportedSeamPoints(a,b,passenger).length>0;
}
function seamVelocity(ship:Unit,point:Point) {
  const motion=ship.sailing,heading=motion?.heading??0,speed=motion?.speed??0;
  // Last tick's actual signed travel is authoritative at the tick boundary.
  // A newly stopped speed field must not erase that displacement immediately.
  // Recorded travel already includes shove; add it only to the speed fallback.
  return shipPointVelocity(ship,point,{x:motion?.velocityX??speed*detCos(heading)+(ship.pushX??0),
    y:motion?.velocityY??speed*detSin(heading)+(ship.pushY??0)});
}
/** A supported seam permits walking only at mooring-scale relative velocity.
 * Check the usable seam, including yaw's point velocity, so another route
 * sample cannot turn a fast passing contact into a stationary gangway. */
export function decksAllowCrossing(a: Unit, b: Unit, passenger: Unit) {
  const points=supportedSeamPoints(a,b,passenger);
  return points.length>0 && points.every(point=>{
    const av=seamVelocity(a,point),bv=seamVelocity(b,point);
    return Math.hypot(av.x-bv.x,av.y-bv.y)<=SHIP_IMPACT_SAFE_SPEED+1e-6;
  });
}
/** Physical hull contact remains sufficient. Across a water gap only a ready,
 * intact infantry gangway contributes the missing walking surface. */
export function decksCanTransfer(a:Unit,b:Unit,passenger:Unit) {
  return decksAllowCrossing(a,b,passenger) || !!gangwayBetween(a,b,passenger);
}
function connectedShips(start: Unit, passenger: Unit, units: readonly Unit[]) {
  const found = [start], seen = new Set([start.id]);
  const vessels = shipsIn(units);
  for (let i = 0; i < found.length; i++)
    for (const ship of vessels)
      if (!seen.has(ship.id) && decksCanTransfer(found[i]!, ship, passenger)) {
        seen.add(ship.id);
        found.push(ship);
      }
  return found;
}
// How far each hull's farthest corner lies from its centre: a point beyond that cannot be on the deck. Every walker asks
// this of every hull each tick, and most hulls are far away; rotating the point into each of them is the cost.
const hullReach = new WeakMap<readonly Point[], number>();
function onHull(ship: Unit, point: Point) {
  if (ship.hp <= 0) return false;
  const profile = shipProfile(ship);
  if (!profile) return false;
  let reach = hullReach.get(profile.hull);
  if (reach === undefined) {
    reach = profile.hull.reduce((farthest, corner) => Math.max(farthest, Math.hypot(corner.x, corner.y)), 0);
    hullReach.set(profile.hull, reach);
  }
  const dx = point.x - ship.x, dy = point.y - ship.y;
  // One unit of slack covers circleInPolygon's tolerance on an edge.
  if (dx * dx + dy * dy > (reach + 1) * (reach + 1)) return false;
  return circleInPolygon(worldToLocal(ship, point), 0, profile.hull);
}

// @@@making-way - A boarder on a deck sent at a body there walks to the free spot nearest it. When that spot is out of
// reach, the boarder makes way: it chooses as if the boarders nearer the body already stood at the spots they would
// take (and the farther were not there), so it leaves them room. Two side by side at a narrow mouth (the deck tapering
// to a corner) each held the spots in reach shut to the other, each one's nearest spot was where it stood, and neither
// ever struck. The crew as the walker sees it for that choice.
function makingWay(passenger: Unit, ship: Unit, units: readonly Unit[]): readonly Unit[] {
  const order = passenger.order, victim = order.type === 'attack' ? units.find(unit => unit.id === order.targetId) : undefined;
  if (!victim?.deck || victim.deck.shipId !== ship.id || passenger.deck?.shipId !== ship.id) return units;
  const at = victim.deck, reach = strikeReach(passenger, victim) - 1;
  const own = deckPlacement(ship, passenger, units, at, true);
  if (!own || Math.hypot(own.x - at.x, own.y - at.y) <= reach) return units;
  const near = (unit: Unit) => Math.hypot(unit.x - victim.x, unit.y - victim.y), mine = near(passenger);
  const rivals = units.filter(other => other !== passenger && other.owner === passenger.owner && other.hp > 0 && other.deck?.shipId === ship.id
    && (other.order.type === 'board' && other.order.transportId === ship.id || other.order.type === 'attack' && other.order.targetId === victim.id));
  const ahead = rivals.filter(other => near(other) < mine || near(other) === mine && other.id < passenger.id).sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : 1));
  if (!ahead.length) return units;
  const rival = new Set(rivals), placed = units.filter(unit => !rival.has(unit));
  for (const other of ahead) {
    const claimed = deckPlacement(ship, other, placed, at, true);
    placed.push(claimed ? { ...other, deck: { ...other.deck!, ...claimed } } : other);
  }
  return placed;
}

/** Hull contact, usable floor and body clearance govern decks and shore alike. */
export function walkConnectedSurfaces(passenger: Unit, world: Point, units: readonly Unit[], map: GameMap, pace = 1) {
  const hulls = shipsIn(units);
  if (!hulls.length)
    return false;
  const source = passenger.deck && hulls.find(ship => ship.id === passenger.deck!.shipId);
  let target = hulls.find(ship => onHull(ship, world));
  // A ground journey does not silently turn into boarding merely because a
  // passing hull overlaps the shallows. Enter a deck when it is the destination.
  if (!source && !target && !isOpenGround(map,world.x,world.y,'land')) {
    const dx = world.x - passenger.x, dy = world.y - passenger.y, len = Math.hypot(dx, dy) || 1;
    const next = { x: passenger.x + dx / len * perTick(passenger.speed) * pace, y: passenger.y + dy / len * perTick(passenger.speed) * pace };
    target = hulls.find(ship => onHull(ship, next));
  }
  if (!source && !target)
    return false;
  if (!source && target && Math.hypot(passenger.x - target.x, passenger.y - target.y) > shipProfile(target)!.length / 2 + passenger.radius * 3)
    return false;
  const ships = connectedShips(source || target!, passenger, units);
  if(source && target?.id===source.id && ships.length===1 && deckPointFits(source,passenger,worldToLocal(source,passenger),units,false))return false;
  if (target && !ships.includes(target))
    return false;
  const land = !source || !target;
  if (land && (!map.terrain || ships.every(ship => shipProfile(ship)!.deckHeight > passenger.radius * 2.5)))
    return false;
  const geometry = crossingGeometry(ships, passenger, map, land), { surface, floor, obstacles } = geometry;
  // Ground routing owns an approach until the whole body fits the crossing floor.
  if (!source && !floor.diskFits(passenger, passenger.radius + 1))
    return false;
  let destination: Point | undefined, aim: Point | undefined;
  if (target) {
    if (deckLoad(units, target) + (passenger.deck?.shipId===target.id?0:bodyMass(passenger)) > shipProfile(target)!.loadCapacity || !deckHasRoom(target, passenger, units))
      return false;
    if (!source && !ships.some(ship => Math.hypot(passenger.x - ship.x, passenger.y - ship.y) < shipProfile(ship)!.length / 2 + passenger.radius * 3))
      return false;
    const local = worldToLocal(target, source ? world : passenger), goal = deckPlacement(target, passenger, makingWay(passenger, target, units), local, true);
    // The walk is laid toward where this body would stand on an empty deck, the same for every walker sent there; the
    // spot it takes among the crew is its last, direct step.
    const free = deckPlacement(target, passenger, units, local, false);
    if (free) aim = localToWorld(target, free);
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
  const bodies = units.filter(other => other.id !== passenger.id && other.hp > 0 && !other.cabin && !shipProfile(other)
    && (!other.deck || ships.some(ship => ship.id === other.deck?.shipId))
    && other.x + other.radius >= left && other.x - other.radius <= right && other.y + other.radius >= top && other.y - other.radius <= bottom);
  const fits = (point: Point, occupied = false) => {
    if (obstacles.some(o => Math.hypot(point.x - o.x, point.y - o.y) < o.radius + passenger.radius + 1 - 1e-6))
      return false;
    if (!floor.diskFits(point, passenger.radius + 1))
      return false;
    return !occupied || capsuleClearsBodies(passenger, point, passenger.radius + 1, bodies);
  };
  // The fittings are the cheap test and the usual refusal; the floor's boundary is walked only for a passage clear of them.
  const staticClear = (a: Point, b: Point) => capsuleClearsCircles(a, b, passenger.radius + 1, obstacles)
    && floor.supported(a) && floor.supported(b) && floor.capsuleClear(a, b, passenger.radius + 1);
  // A walker heads straight for its destination when nothing stands between; otherwise it walks the crossing's field
  // toward where it would stand on an empty deck (see @@@walk-field).
  const open = (a: Point, b: Point) => capsuleClearsBodies(a, b, passenger.radius + 1, bodies);
  // On a one-person bridge, which has too little side room for a ring of points round a body, the safe front of the body
  // on the bridge's centerline.
  const bridgeFronts = (other: Unit) => {
    const points: Point[] = [];
    for (const bridge of geometry.bridges) {
      const a = bridge.source, b = bridge.target, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), radius = other.radius + passenger.radius + 2;
      const along = ((other.x - a.x) * dx + (other.y - a.y) * dy) / len, across = ((other.y - a.y) * dx - (other.x - a.x) * dy) / len;
      if (Math.abs(across) >= radius) continue;
      const offset = Math.sqrt(radius * radius - across * across);
      for (const distance of [along - offset, along + offset]) if (distance >= 0 && distance <= len) {
        const point = { x: a.x + dx / len * distance, y: a.y + dy / len * distance };
        if (fits(point, true)) points.push(point);
      }
    }
    return points;
  };
  // Points to step round a body standing in the way: a ring about it, and its fronts on a bridge.
  const around = (from: Point, toward: Point) => {
    const points: Point[] = [];
    for (const other of bodies) {
      if (capsuleClearsBodies(from, toward, passenger.radius + 1, [other])) continue;
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6, r = (other.radius + passenger.radius + 3) / detCos(Math.PI / 12);
        const point = { x: other.x + detCos(angle) * r, y: other.y + detSin(angle) * r };
        if (fits(point, true)) points.push(point);
      }
      points.push(...bridgeFronts(other));
    }
    return points;
  };
  // @@@explicit-route - A walker sent at one body cannot take on another in its way instead (an explicit attack keeps its
  // target), so a body between them must not hold it: it plans its whole route round every body, as each walker did
  // before the shared field. The rest walk the field; a body in their way is one they may fight.
  const searchedLeg = (): Point | undefined => {
    const graph = geometry.graph, fixedNodes = graph.nodes;
    const clear = (a: Point, b: Point, ai = -1, bi = -1, occupied = true) => {
      const count = fixedNodes.length, cacheable = ai >= 2 && bi >= 2 && ai < count + 2 && bi < count + 2;
      let valid: boolean;
      if (cacheable) {
        const index = (ai - 2) * count + bi - 2;
        if (!graph.links[index]) graph.links[index] = graph.links[(bi - 2) * count + ai - 2] = staticClear(a, b) ? 1 : -1;
        valid = graph.links[index] === 1;
      }
      else valid = staticClear(a, b);
      return valid && (!occupied || open(a, b));
    };
    const nodes: Point[] = [passenger, destination];
    if (!clear(passenger, destination)) {
      nodes.push(...fixedNodes);
      for (const other of bodies) {
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6, r = (other.radius + passenger.radius + 3) / detCos(Math.PI / 12);
          const point = { x: other.x + detCos(angle) * r, y: other.y + detSin(angle) * r };
          if (fits(point, true)) nodes.push(point);
        }
        nodes.push(...bridgeFronts(other));
      }
    }
    const fixed = nodes.length > 2 ? fixedNodes.length : 0, distances = graph.distances;
    const between = (i: number, j: number) => {
      if (i < 2 || j < 2 || i >= fixed + 2 || j >= fixed + 2) return Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
      const index = (i - 2) * fixed + j - 2;
      let value = distances[index]!;
      if (value !== value) distances[index] = distances[(j - 2) * fixed + i - 2] = value = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
      return value;
    };
    const count = nodes.length, costs = new Float64Array(count).fill(Infinity), parents = new Int32Array(count).fill(-1), seen = new Uint8Array(count);
    costs[0] = 0;
    let destinationNode = 1, settled = 0;
    while (settled < count) {
      let current = -1;
      for (let i = 0; i < count; i++) if (!seen[i] && (current < 0 || costs[i]! < costs[current]!)) current = i;
      if (current < 0 || !Number.isFinite(costs[current]!)) {
        // A defender may seal the far end of a one-person bridge: walk to the closest floor reachable, so melee can meet
        // it at the entrance. Every candidate still has a proven, body-clear path from the start.
        const remaining = new Float64Array(count).fill(Infinity), visited = new Uint8Array(count); remaining[1] = 0;
        for (let pass = 0; pass < count; pass++) {
          let closest = -1;
          for (let i = 0; i < count; i++) if (!visited[i] && (closest < 0 || remaining[i]! < remaining[closest]!)) closest = i;
          if (closest < 0 || !Number.isFinite(remaining[closest]!)) break;
          visited[closest] = 1;
          for (let i = 0; i < count; i++) if (!visited[i]) {
            const distance = remaining[closest]! + between(i, closest);
            if (distance < remaining[i]! && clear(nodes[closest]!, nodes[i]!, closest, i, false)) remaining[i] = distance;
          }
        }
        const estimate = (i: number) => Number.isFinite(remaining[0]!) ? remaining[i]! : Math.hypot(nodes[i]!.x - destination.x, nodes[i]!.y - destination.y);
        let best = estimate(0);
        destinationNode = 0;
        for (let i = 2; i < count; i++) if (Number.isFinite(costs[i]!)) {
          const distance = estimate(i);
          if (distance < best - 1e-6) { best = distance; destinationNode = i; }
        }
        if (destinationNode === 0) return undefined;
        break;
      }
      if (current === 1) break;
      seen[current] = 1; settled++;
      for (let i = 0; i < count; i++) {
        const value = costs[current]! + between(i, current);
        if (!seen[i] && value < costs[i]! && clear(nodes[current]!, nodes[i]!, current, i)) { costs[i] = value; parents[i] = current; }
      }
    }
    let next = destinationNode;
    while (parents[next]! > 0) next = parents[next]!;
    return nodes[next];
  };
  // A boarding crew's attack on the front rank is chosen again every tick: a body in its way becomes its target.
  const order = passenger.order, explicit = order.type === 'attack' && order.leashX === undefined && !order.frontRank;
  const goal = aim ?? destination;
  const waypoint = explicit ? searchedLeg()
    : staticClear(passenger, destination) && open(passenger, destination) ? destination
    : walkLeg(geometry.graph, walkField(geometry.graph, goal, staticClear), goal, passenger, staticClear, open, around);
  if (!waypoint)
    return true;
  const gap = Math.hypot(waypoint.x - passenger.x, waypoint.y - passenger.y);
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
  if(parent || floor.diskOnLand(at,passenger.radius+1))delete passenger.gangway;
  else {
    const connection=ships.flatMap(ship=>{
      const receiver=ships.find(other=>other.id===ship.sailing?.gangway?.targetId);
      const bridge=receiver&&gangwayBetween(ship,receiver,passenger);
      return bridge?.source===ship && circleInPolygon(at,0,bridge.surface.polygon)?[bridge]:[];
    })[0];
    if(connection)passenger.gangway=gangwayCrossingAt(connection,at);
  }
  Object.assign(passenger, at);
  return true;
}
/** A hull that pulls away cannot carry a soldier standing outside its own usable deck. */
export function settleDeckSupport(units: readonly Unit[], map: GameMap) {
  if (!shipsIn(units).length)
    return;
  for (const passenger of units) {
    if (!passenger.deck || passenger.hp <= 0 || passenger.cabin?.shipId === passenger.deck.shipId)
      continue;
    const ship = units.find(ship => ship.id === passenger.deck!.shipId && ship.hp > 0), profile = ship && shipProfile(ship);
    if (!ship || !profile || circleInPolygon(passenger.deck, passenger.radius + 1, profile.deck))
      continue;
    if (passenger.gangway) {
      const source=units.find(unit=>unit.id===passenger.gangway!.sourceId),target=units.find(unit=>unit.id===passenger.gangway!.targetId);
      if(source&&target&&gangwaySurface(source,target)?.phase==='ready')continue;
      delete passenger.gangway;
    }
    if (units.some(other => other.id !== ship.id && decksCanTransfer(ship, other, passenger)))
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
