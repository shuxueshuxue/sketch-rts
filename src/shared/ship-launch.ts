import { detCos, detSin } from './det-math';
import { UNIT_DEFS } from './catalog';
import { createUnit } from './map';
import { convexHull, polygonPlanes, polygonRadius, polygonTouchesCell } from './navigation-math';
import { productionRallyPoint } from './production-spawn';
import { shipBodyClearAtPose } from './ship-collisions';
import { shipProfile, shipScale } from './ship-geometry';
import { shipLaunchCandidates } from './ship-launch-geometry';
import { hullFits, hullPassageClear, type ShipPose } from './ship-navigation';
import { CELL_GROUND, footprintHalf, sameGround, steerPoint, walkableGoal } from './terrain';
import type { Building, GameMap, GameSnapshot, Obstacle, Unit, UnitKind } from './types';

type Harbor = Pick<GameSnapshot, 'map' | 'units' | 'buildings' | 'obstacles'> & Partial<Pick<GameSnapshot, 'resources'>>;
type Body = Unit | Building | Obstacle;
type Berths = {
  geometry: string;
  terrain: Harbor['map']['terrain'];
  cells: string | undefined;
  poses: ShipPose[];
  entries: Map<ShipPose, ShipPose>;
  range: number;
  rally?: string;
  ranked?: ShipPose[];
  bodies?: string;
  result?: ShipPose | undefined;
  // Each berth's verdict against each nearby body, under the body's description in `bodies`: a blocked yard re-tests
  // only the bodies that moved, not every berth against every body (see shipLaunchPose).
  verdicts: Map<ShipPose, Map<string, { key: string; clear: boolean }>>;
};
const berths = new WeakMap<object, WeakMap<Building, Berths>>();
const prototypes = new WeakMap<Building, Map<UnitKind, { definition:typeof UNIT_DEFS[UnitKind]; radius:number; physicalRadius:number; unit:Unit }>>();

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
    const {poses,entries} = harborPoses(snapshot, dock, ship);
    const radius = polygonRadius(profile.hull);
    const range = poses.reduce((maximum, pose) => Math.max(maximum, Math.hypot(pose.x - dock.x, pose.y - dock.y) + radius), 0);
    cached = { geometry, terrain, cells: terrain?.cells, poses, entries, range, verdicts: new Map() };
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
  const aim=productionRallyPoint(snapshot,dock);
  const keys = bodies.map(body => `${body.id}:${body.kind}:${body.x}:${body.y}:${body.radius}:${'order' in body ? `${body.bodyRadius}:${shipProfile(body) ? shipScale(body) : ''}:${body.sailing?.heading ?? 0}` : ''}`);
  const signature = `${aim.x}:${aim.y}:${keys.join('|')}`;
  if (cached.bodies !== signature) {
    cached.bodies = signature;
    const goal=walkableGoal(snapshot.map,aim.x,aim.y,'sea');
    // Prefer this pier's water that reaches the rally, then its nearest local
    // exit and a bow facing the route's first water leg. The angular cost
    // matters even when Euclidean distances differ slightly: a broadside
    // berth hugging shore must not win over an aligned departure and force a
    // slow turn away from land. This changes neither the harbor halo
    // nor the connected-shore checks: a rally can never launch across land.
    const rally=`${aim.x}:${aim.y}`;
    if(cached.rally!==rally || !cached.ranked) {
      cached.rally=rally;
      const ordered=cached.poses.map(pose=>{
        const exit=Math.hypot(pose.x-dock.x,pose.y-dock.y), leg=steerPoint(snapshot.map,pose,goal,'sea');
        const angle=Math.atan2(leg.y-pose.y,leg.x-pose.x)-pose.heading;
        const difference=Math.abs(Math.atan2(detSin(angle),detCos(angle)));
        return {pose,reachable:sameGround(snapshot.map,pose,goal,'sea'),travel:exit+Math.hypot(pose.x-aim.x,pose.y-aim.y)+profile.length*difference,difference,exit};
      }).sort((a,b)=>Number(b.reachable)-Number(a.reachable) || a.travel-b.travel || a.difference-b.difference || a.exit-b.exit);
      const reachable=ordered.some(candidate=>candidate.reachable);
      cached.ranked=ordered.filter(candidate=>!reachable || candidate.reachable).map(candidate=>candidate.pose);
    }
    // A berth is clear of the bodies exactly when it is clear of each one; a body described as before keeps its verdict.
    const berths = cached;
    const clearOf = (pose: ShipPose, body: Body, key: string) => {
      let verdicts = berths.verdicts.get(pose);
      if (!verdicts) { verdicts = new Map(); berths.verdicts.set(pose, verdicts); }
      const known = verdicts.get(body.id);
      if (known?.key === key) return known.clear;
      const clear = shipBodyClearAtPose(snapshot.map, ship, pose, [body]);
      verdicts.set(body.id, { key, clear });
      return clear;
    };
    berths.result = berths.ranked!.find(pose=>bodies.every((body, index) => clearOf(pose, body, keys[index]!))
      && launchPathClear(snapshot,ship,berths.entries.get(pose)!,pose,bodies));
    // Bodies that left the harbor keep no verdicts beyond a bounded slack.
    const near = new Set(bodies.map(body => body.id));
    for (const verdicts of berths.verdicts.values()) {
      if (verdicts.size <= 2 * near.size + 16) continue;
      for (const id of verdicts.keys()) if (!near.has(id)) verdicts.delete(id);
    }
  }
  return cached.result ? { ...cached.result } : undefined;
}

function solidHalf(snapshot: Harbor, body: Building | Obstacle) {
  return snapshot.map.terrain ? footprintHalf(body.radius, snapshot.map.terrain.cell) : body.radius;
}

/** The outer rows remain connected to the physical pier: a free hull beyond
 * a neighboring fixed gate/building is not a valid slideway. Dynamic traffic
 * is checked at the actual berth; it does not add static shoreline probes. */
function launchPathClear(snapshot:Harbor, ship:Unit, entry:ShipPose, pose:ShipPose, bodies:readonly Body[]) {
  if(entry.x===pose.x && entry.y===pose.y)return true;
  const c=detCos(pose.heading),s=detSin(pose.heading),local=shipProfile(ship)!.hull.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));
  const envelope=convexHull([...local.map(p=>({x:p.x+entry.x,y:p.y+entry.y})),...local.map(p=>({x:p.x+pose.x,y:p.y+pose.y}))]);
  const planes=polygonPlanes(envelope);
  const left=Math.min(...envelope.map(p=>p.x)),right=Math.max(...envelope.map(p=>p.x)),top=Math.min(...envelope.map(p=>p.y)),bottom=Math.max(...envelope.map(p=>p.y));
  return bodies.every(body=>{
    if('order' in body)return true;
    const half=solidHalf(snapshot,body);
    if(right<=body.x-half || left>=body.x+half || bottom<=body.y-half || top>=body.y+half)return true;
    return !polygonTouchesCell(planes,body.x-half,body.y-half,2*half);
  });
}

/** The hull support on each face determines its center, so even a broadside
 * carrier clears the square pier without replacing its hull with a circle. */
function harborPoses(snapshot: Harbor, dock: Building, ship: Unit): {poses:ShipPose[];entries:Map<ShipPose,ShipPose>} {
  const map = snapshot.map, candidates = shipLaunchCandidates(map, dock, ship);
  const connected = harborWater(map, dock, candidates.reach);
  const poses: ShipPose[] = [], entries = new Map<ShipPose, ShipPose>();
  for (let index = 0; index < candidates.count; index++) {
    const { pose, entry, anchor, outward } = candidates.at(index);
    if (connected(anchor, anchor) && hullFits(map, ship, pose) && connected(anchor, pose)
      && (!outward || hullPassageClear(map, ship, entry, pose))) {
      poses.push(pose); entries.set(pose, entry);
    }
  }
  // Equal choices retain authored direction/face/offset order on every run.
  return {poses:poses.sort((a, b) => Math.hypot(a.x - dock.x, a.y - dock.y) - Math.hypot(b.x - dock.x, b.y - dock.y)),entries};
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
