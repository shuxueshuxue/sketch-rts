import { detCos, detSin } from './det-math';
import { UNIT_DEFS } from './catalog';
import { createUnit } from './map';
import { polygonRadius } from './navigation-math';
import { shipBodyClearAtPose } from './ship-collisions';
import { shipProfile, shipScale } from './ship-geometry';
import { hullFits, type ShipPose } from './ship-navigation';
import { CELL_GROUND, footprintHalf } from './terrain';
import type { Building, GameMap, GameSnapshot, Obstacle, Unit, UnitKind } from './types';

type Harbor = Pick<GameSnapshot, 'map' | 'units' | 'buildings' | 'obstacles'>;
type Body = Unit | Building | Obstacle;
type Berths = {
  geometry: string;
  terrain: Harbor['map']['terrain'];
  cells: string | undefined;
  poses: ShipPose[];
  range: number;
  bodies?: string;
  result?: ShipPose | undefined;
};
const berths = new WeakMap<object, WeakMap<Building, Berths>>();
const prototypes = new WeakMap<Building, Map<UnitKind, { definition:typeof UNIT_DEFS[UnitKind]; radius:number; physicalRadius:number; unit:Unit }>>();
const LAUNCH_GAP = 4;
const OUTWARD_STEPS = [0, 32, 64] as const;

/** A completed blocked job needs a shape probe, not a new runtime unit every
 * tick. These derived defaults are never added to the game or used to spawn
 * equipment. A captured or moved yard refreshes only the probe's identity pose.
 */
export function shipLaunchPrototype(dock:Building,kind:UnitKind):Unit {
  let kinds=prototypes.get(dock);
  if(!kinds){kinds=new Map();prototypes.set(dock,kinds);}
  const definition=UNIT_DEFS[kind];
  let cached=kinds.get(kind);
  if(!cached || cached.definition!==definition || cached.radius!==definition.radius
    || cached.unit.radius!==cached.physicalRadius || cached.unit.kind!==kind || cached.unit.deckScale!==undefined || cached.unit.bodyRadius!==undefined || cached.unit.fittings!==undefined) {
    const unit=createUnit('launch',dock.owner,kind,dock.x,dock.y);
    cached={definition,radius:definition.radius,physicalRadius:unit.radius,unit};
    kinds.set(kind,cached);
  }
  const unit=cached.unit;
  unit.owner=dock.owner; unit.x=unit.homeX=dock.x; unit.y=unit.homeY=dock.y;
  return unit;
}

/** Launch only beside this pier. Static shoreline checks are reused while
 * traffic checks resume as soon as a nearby hull/body moves or disappears.
 * Every cache is derived; a restored game chooses the same first safe berth. */
export function shipLaunchPose(snapshot: Harbor, dock: Building, ship: Unit): ShipPose | undefined {
  const profile = shipProfile(ship);
  if (!profile || dock.hp <= 0) return undefined;
  let yards = berths.get(snapshot.map);
  if (!yards) { yards = new WeakMap(); berths.set(snapshot.map, yards); }
  const terrain = snapshot.map.terrain;
  const geometry = `${dock.x}:${dock.y}:${dock.radius}:${ship.kind}:${shipScale(ship)}:${snapshot.map.width}:${snapshot.map.height}:${terrain?.cell}:${terrain?.cols}:${terrain?.rows}`;
  let cached = yards.get(dock);
  if (!cached || cached.geometry !== geometry || cached.terrain !== terrain || cached.cells !== terrain?.cells) {
    const poses = harborPoses(snapshot, dock, ship);
    const radius = polygonRadius(profile.hull);
    const range = poses.reduce((maximum, pose) => Math.max(maximum, Math.hypot(pose.x - dock.x, pose.y - dock.y) + radius), 0);
    cached = { geometry, terrain, cells: terrain?.cells, poses, range };
    yards.set(dock, cached);
  }
  if (!cached.poses.length) return undefined;
  const bodies: Body[] = [];
  for (const body of [...snapshot.units, ...snapshot.buildings, ...(snapshot.obstacles ?? [])]) {
    if (body === ship || body.hp <= 0 || 'order' in body && body.deck) continue;
    const bodyProfile = 'order' in body ? shipProfile(body) : undefined;
    const radius = bodyProfile ? polygonRadius(bodyProfile.hull) : 'order' in body ? Math.max(body.radius, body.bodyRadius ?? 0) * 1.01 : solidHalf(snapshot, body) * Math.SQRT2;
    if (Math.hypot(body.x - dock.x, body.y - dock.y) > cached.range + radius) continue;
    bodies.push(body);
  }
  const signature = bodies.map(body => `${body.id}:${body.kind}:${body.x}:${body.y}:${body.radius}:${'order' in body ? `${body.bodyRadius}:${shipProfile(body) ? shipScale(body) : ''}:${body.sailing?.heading ?? 0}` : ''}`).join('|');
  if (cached.bodies !== signature) {
    cached.bodies = signature;
    cached.result = cached.poses.find(pose => shipBodyClearAtPose(snapshot.map, ship, pose, bodies));
  }
  return cached.result ? { ...cached.result } : undefined;
}

function solidHalf(snapshot: Harbor, body: Building | Obstacle) {
  return snapshot.map.terrain ? footprintHalf(body.radius, snapshot.map.terrain.cell) : body.radius;
}

/** The hull support on each face determines its center, so even a broadside
 * carrier clears the square pier without replacing its hull with a circle. */
function harborPoses(snapshot: Harbor, dock: Building, ship: Unit): ShipPose[] {
  const map = snapshot.map, profile = shipProfile(ship)!, half = solidHalf(snapshot, dock);
  const connected = harborWater(map, dock, half + polygonRadius(profile.hull) + 64 + (map.terrain?.cell ?? 0));
  const offsets = [0, -half / 2, half / 2, -half, half];
  const candidates: ShipPose[] = [];
  for (let direction = 0; direction < 16; direction++) {
    const heading = direction * Math.PI / 8, c = detCos(heading), s = detSin(heading);
    const hull = profile.hull.map(point => ({ x: point.x * c - point.y * s, y: point.x * s + point.y * c }));
    const left = Math.min(...hull.map(point => point.x)), right = Math.max(...hull.map(point => point.x));
    const top = Math.min(...hull.map(point => point.y)), bottom = Math.max(...hull.map(point => point.y));
    for (let face = 0; face < 4; face++) for (const offset of offsets) {
      const tangent = Math.max(-half + 1, Math.min(half - 1, offset));
      const anchor = face === 0 ? { x: dock.x + half + 1, y: dock.y + tangent }
        : face === 1 ? { x: dock.x - half - 1, y: dock.y + tangent }
        : face === 2 ? { x: dock.x + tangent, y: dock.y + half + 1 }
        : { x: dock.x + tangent, y: dock.y - half - 1 };
      if (!connected(anchor, anchor)) continue;
      for (const outward of OUTWARD_STEPS) {
        const gap = LAUNCH_GAP + outward;
        const point = face === 0 ? { x: dock.x + half - left + gap, y: dock.y + offset }
          : face === 1 ? { x: dock.x - half - right - gap, y: dock.y + offset }
          : face === 2 ? { x: dock.x + offset, y: dock.y + half - top + gap }
          : { x: dock.x + offset, y: dock.y - half - bottom - gap };
        const pose = { ...point, heading };
        if (hullFits(map, ship, pose) && connected(anchor, point)) candidates.push(pose);
      }
    }
  }
  // Equal choices retain authored direction/face/offset order on every run.
  return candidates.sort((a, b) => Math.hypot(a.x - dock.x, a.y - dock.y) - Math.hypot(b.x - dock.x, b.y - dock.y));
}

/** Only the small harbor halo is labeled. Read the current cells directly so
 * a scripted coast change can release a paid job without stale flow fields. */
function harborWater(map: GameMap, dock: Building, reach: number) {
  const terrain = map.terrain;
  if (!terrain) return () => true;
  const left = Math.max(0, Math.floor((dock.x - reach) / terrain.cell)), right = Math.min(terrain.cols - 1, Math.floor((dock.x + reach) / terrain.cell));
  const top = Math.max(0, Math.floor((dock.y - reach) / terrain.cell)), bottom = Math.min(terrain.rows - 1, Math.floor((dock.y + reach) / terrain.cell));
  const cols = Math.max(0, right - left + 1), rows = Math.max(0, bottom - top + 1);
  const labels = new Int32Array(cols * rows), queue = new Int32Array(labels.length);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
    if (CELL_GROUND[terrain.cells[(top + row) * terrain.cols + left + col] ?? '.']?.sea) labels[row * cols + col] = -1;
  let component = 0;
  for (let cell = 0; cell < labels.length; cell++) {
    if (labels[cell] !== -1) continue;
    labels[cell] = ++component; queue[0] = cell; let head = 0, tail = 1;
    while (head < tail) {
      const current = queue[head++]!, col = current % cols, row = Math.floor(current / cols);
      const neighbors = [col ? current - 1 : -1, col + 1 < cols ? current + 1 : -1, row ? current - cols : -1, row + 1 < rows ? current + cols : -1];
      for (const next of neighbors) if (next >= 0 && labels[next] === -1) { labels[next] = component; queue[tail++] = next; }
    }
  }
  const region = (point: { x: number; y: number }) => {
    const col = Math.floor(point.x / terrain.cell) - left, row = Math.floor(point.y / terrain.cell) - top;
    return col >= 0 && row >= 0 && col < cols && row < rows ? labels[row * cols + col]! : 0;
  };
  return (a: { x: number; y: number }, b: { x: number; y: number }) => region(a) > 0 && region(a) === region(b);
}
