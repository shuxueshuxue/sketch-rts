import { shipMotionLimits } from './ship-handling';
import { coursePerformance } from './ship-wind';
import { windAt } from './wind-field';
import { detCos, detSin } from "./det-math";
import { shipProfile, type Point } from "./ship-geometry";
import { CELL_GROUND, isWalkable, sameGround, walkableGoal } from "./terrain";
import type { GameMap, Unit } from "./types";
import { convexHull, expandConvex, polygonPlanes, polygonRadius, polygonTouchesCell } from './navigation-math';
import preparedMasks from './generated/ship-navigation-masks.json';
import { buildNavigationMasks, type OccupancyMask } from './navigation-masks';
import { shipScale, DEFAULT_SHIP_SCALE } from './ship-geometry';
export type ShipPose = Point & {
  heading: number;
  pivot?: Point;
  tack?: boolean;
  exact?: boolean;
  /** Signed curvature of the incoming segment; heading is its end tangent. */
  curvature?: number;
  /** A physical speed ceiling, also placed at the entry to an upcoming bend. */
  speedLimit?: number;
};
function curvedSegment(from:ShipPose,to:ShipPose):number {
  const curvature=to.curvature ?? 0;
  if(Math.abs(curvature)<1e-9)return 0;
  const x=from.x+(detSin(to.heading)-detSin(from.heading))/curvature;
  const y=from.y-(detCos(to.heading)-detCos(from.heading))/curvature;
  // Runtime hull sweeps and exact maneuvers may copy waypoint metadata. Only
  // the actual reference circle receives curved interpolation.
  return Math.hypot(x-to.x,y-to.y)<1e-5?curvature:0;
}
/** Rotation around a fixed bow/stern contact point, used for a real departure
 * maneuver rather than translating a hull sideways without turning it. */
export function shipPoseAt(from: ShipPose, to: ShipPose, fraction: number): ShipPose {
  const heading=from.heading+headingDifference(from.heading,to.heading)*fraction;
  if(to.pivot){const lever=(from.x-to.pivot.x)*detCos(from.heading)+(from.y-to.pivot.y)*detSin(from.heading);return{x:to.pivot.x+lever*detCos(heading),y:to.pivot.y+lever*detSin(heading),heading};}
  const curvature=curvedSegment(from,to);
  if(curvature)return{x:from.x+(detSin(heading)-detSin(from.heading))/curvature,y:from.y-(detCos(heading)-detCos(from.heading))/curvature,heading};
  return{x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction,heading};
}
type SeaMap = Pick<GameMap, "terrain" | "width" | "height" | "wind">;
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
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const point of polygon) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
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
  const curvature=curvedSegment(from,to);
  const hullRadius = polygonRadius(hull);
  const lever = to.pivot ? Math.hypot(from.x-to.pivot.x,from.y-to.pivot.y) : curvature ? 1/Math.abs(curvature) : 0;
  const radius = hullRadius + lever;
  // The center's circular arc lies within R Δθ² / 8 of its endpoint chord.
  // A cruise turn needs this short corridor, rather than a whole turn circle.
  // Inconsistent copied pivot metadata retains the conservative fallback.
  const pivotArc = !to.pivot || [0,1].every(fraction => {
    const at = shipPoseAt(from,to,fraction), endpoint = fraction ? to : from;
    return Math.hypot(at.x-endpoint.x,at.y-endpoint.y)<1e-5;
  });
  const corridorRadius = pivotArc ? hullRadius + lever*turn*turn/8 + (lever ? 1e-5 : 0) : radius;
  if (openWaterBox(map, Math.min(from.x, to.x) - corridorRadius, Math.min(from.y, to.y) - corridorRadius, Math.max(from.x, to.x) + corridorRadius, Math.max(from.y, to.y) + corridorRadius))
    return true;
  if(turn && (!hullFits(map,ship,from) || !hullFits(map,ship,to)))return false;
  // Subdivide by a geometric error bound, rather than vertex travel. Every
  // envelope still contains the whole arc, with at most 0.025 units padding.
  const steps = Math.max(1, Math.ceil(Math.abs(turn) * Math.sqrt(radius / (8 * .025))));
  // Linear interpolation error of a rotating vertex is at most R Δθ² / 8.
  // The expanded convex envelope contains the entire intermediate hull.
  const error = turn ? radius * (turn / steps) ** 2 / 8 + 1e-7 : 0;
  for (let i = 0; i < steps; i++) {
    const a = shipPoseAt(from,to,i/steps);
    const b = shipPoseAt(from,to,(i+1)/steps);
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
    if(hullFits(map, ship, { x, y, heading: preferred }) && accepts({x,y,heading:preferred}))return{x,y,heading:preferred};
    for(let distance=16;distance<=shipProfile(ship)!.length*4;distance+=16)for(let i=0;i<16;i++){
      const angle=i*Math.PI/8,at={x:x+distance*detCos(angle),y:y+distance*detSin(angle),heading:preferred};
      if(hullFits(map,ship,at) && accepts(at))return at;
    }
    return undefined;
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
let search = { costs: new Float64Array(0), parents: new Int32Array(0), stamps: new Uint32Array(0), trafficFits: new Int32Array(0), generation: 0 };
function searchWorkspace(size: number) {
  if (search.costs.length < size)
    search = { costs: new Float64Array(size), parents: new Int32Array(size), stamps: new Uint32Array(size), trafficFits: new Int32Array(size), generation: 0 };
  if (++search.generation === 0x7fffffff) {
    search.stamps.fill(0);
    search.trafficFits.fill(0);
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
/** Straight travel is forward or astern along the keel. All connectors obey
 * the same constraint as route edges; grid alignment is never a side-slip. */
function routeTime(map:SeaMap,ship:Unit,from:ShipPose,points:readonly ShipPose[]) {
  const limits=shipMotionLimits(ship);let time=0,previous=from;
  for(const point of points){
    const yaw=Math.abs(headingDifference(previous.heading,point.heading));
    const dx=point.x-previous.x,dy=point.y-previous.y;
    const performance=coursePerformance(ship,map,point.heading,{assumeTrimmed:true});
    const speed=dx*detCos(point.heading)+dy*detSin(point.heading)<-1e-7?Math.min(limits.reverseSpeed,performance.auxiliarySpeed):Math.max(performance.targetSpeed,performance.auxiliarySpeed);
    time+=yaw/Math.max(1e-6,limits.turnRate)+Math.hypot(dx,dy)/Math.max(1e-6,speed);
    previous=point;
  }
  return time;
}
function keelCandidates(ship:Unit,from:ShipPose,goal:Point & {heading?:number}):ShipPose[][] {
  const gap=Math.hypot(goal.x-from.x,goal.y-from.y);
  if(gap<1e-7)return [goal.heading===undefined || Math.abs(headingDifference(from.heading,goal.heading))<1e-7?[]:[{...goal,heading:goal.heading}]];
  const direction=Math.atan2(goal.y-from.y,goal.x-from.x);
  // Astern is a short maneuver, not an alternative cruise direction.
  const length=shipProfile(ship)!.length;
  // A precise berth or its approach pose may need a short astern leg before
  // swinging the hull alongside. Requiring that pose to share the current
  // heading ruled out the useful retreat and forced a near-half-circle turn.
  const headings=gap<=(goal.heading!==undefined?length:length/2)?[direction,direction+Math.PI]:[direction];
  return headings.map(heading=>{
    const turned={x:from.x,y:from.y,heading},end={x:goal.x,y:goal.y,heading};
    const points=Math.abs(headingDifference(from.heading,heading))<1e-7?[end]:[turned,end];
    if(goal.heading!==undefined && Math.abs(headingDifference(heading,goal.heading))>1e-7)points.push({...end,heading:goal.heading});
    return points;
  });
}
function connectorClear(map:SeaMap,ship:Unit,from:ShipPose,points:ShipPose[],traffic:(a:ShipPose,b:ShipPose)=>boolean) {
  return points.every((point,i)=>{
    const previous=points[i-1] ?? from;
    return hullPassageClear(map,ship,previous,point) && traffic(previous,point);
  });
}
function keelConnector(map:SeaMap,ship:Unit,from:ShipPose,goal:Point & {heading?:number},traffic:(a:ShipPose,b:ShipPose)=>boolean):ShipPose[]|undefined {
  return keelCandidates(ship,from,goal).sort((a,b)=>routeTime(map,ship,from,a)-routeTime(map,ship,from,b))
    .find(points=>connectorClear(map,ship,from,points,traffic));
}
/** A passage plan beats to the destination's layline, not back to the direct
 * track every few hull lengths. Shorter pairs are only coastal fallbacks. */
export function shipTackRoute(map:SeaMap,ship:Unit,goal:ShipPose,traffic:(a:ShipPose,b:ShipPose)=>boolean,preferredHeading?:number):ShipPose[]|undefined {
  const start={x:ship.x,y:ship.y,heading:ship.sailing?.heading ?? 0};
  const dx=goal.x-start.x,dy=goal.y-start.y,gap=Math.hypot(dx,dy),length=shipProfile(ship)!.length;
  const performance=coursePerformance(ship,map,Math.atan2(dy,dx),{assumeTrimmed:true});
  if(gap<length || performance.calm || performance.trueWindAngle>=performance.beatAngle
    || !performance.noGo && performance.targetSpeed>=performance.auxiliarySpeed || performance.maxForwardSpeed<=0)return;
  const wind=windAt(map,ship),angles=[wind.from+performance.beatAngle,wind.from-performance.beatAngle];
  const directions=angles.map(heading=>({x:detCos(heading),y:detSin(heading)}));
  const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
  // Hold the tack already closest to the bow when both sides have sea room.
  // Trim/surge fluctuations must not repeatedly change this strategic choice.
  const preferred=preferredHeading ?? start.heading;
  const sides=[0,1].sort((a,b)=>Math.abs(headingDifference(preferred,angles[a]!))-Math.abs(headingDifference(preferred,angles[b]!)));
  const distances=[gap];
  for(let distance=gap/2;distance>=length;distance/=2)distances.push(distance);
  if(distances.at(-1)!>length+1e-7)distances.push(length);
  // A newly plotted voyage prefers a complete pair. A moving-target update
  // keeps the committed tack, shortening it near a coast before changing side.
  const choices=preferredHeading===undefined
    ? distances.flatMap(distance=>sides.map(side=>({distance,side})))
    : sides.flatMap(side=>distances.map(distance=>({distance,side})));
  if(shipMotionLimits(ship).turnRate<=1e-7)return;
  for(const {distance,side} of choices){
    const end={x:start.x+dx*distance/gap,y:start.y+dy*distance/gap};
    const other=1-side,a=directions[side]!,b=directions[other]!,det=cross(a,b);
    let best:ShipPose[]|undefined,bestCost=Infinity;
    const startingTurn=Math.abs(headingDifference(start.heading,angles[side]!))>1e-7;
    for(const startupRadius of startingTurn?departureRadii(map,ship):[voyageTurnRadius(ship)])for(const radius of voyageRadii(ship)){
      const speedLimit=curveSpeedLimit(ship,radius),startupSpeed=curveSpeedLimit(ship,startupRadius);
      const lead=startingTurn?brakingEntry(ship,start,startupSpeed):[];
      const startup=circleArc(lead.at(-1) ?? start,angles[side]!,startupRadius,startupSpeed);
      const sailed=startup.at(-1) ?? lead.at(-1) ?? start;
      const delta={x:end.x-sailed.x,y:end.y-sailed.y};
      const first=cross(delta,b)/det,second=cross(a,delta)/det;
      const turn=headingDifference(angles[side]!,angles[other]!);
      // A circular tack starts before the layline intersection. Passing the
      // sharp intersection first would require an impossible instant helm.
      const setback=radius*Math.tan(Math.abs(turn)/2);
      if(first<=setback+1 || second<=setback+1)continue;
      const entry:ShipPose={x:sailed.x+a.x*(first-setback),y:sailed.y+a.y*(first-setback),heading:angles[side]!,curvature:0,speedLimit};
      const tack=circleArc(entry,angles[other]!,radius,speedLimit);
      const finish:ShipPose={...end,heading:angles[other]!,curvature:0};
      const points=[...lead,...startup,entry,...tack,finish].map(point=>({...point,tack:true}));
      const cost=voyageTime(map,ship,start,points);
      if(cost>=bestCost || !voyageCorridorClear(map,ship,start,points,traffic))continue;
      best=points;bestCost=cost;
    }
    if(best)return best;
  }
}
/** A moving interception point is not a berth. When a complete rounded tack
 * cannot fit before that near point, establish useful close-hauled headway on
 * one committed leg; the pursuit navigator will update its interception. */
export function planBeatDeparture(map:SeaMap,ship:Unit,goal:ShipPose,traffic:(a:ShipPose,b:ShipPose)=>boolean,preferredHeading?:number):ShipPose[]|undefined {
  const start:ShipPose={x:ship.x,y:ship.y,heading:ship.sailing?.heading ?? 0};
  const bearing=Math.atan2(goal.y-start.y,goal.x-start.x),performance=coursePerformance(ship,map,bearing,{assumeTrimmed:true});
  if(performance.calm || performance.trueWindAngle>=performance.beatAngle || shipMotionLimits(ship).turnRate<=1e-7 || performance.maxForwardSpeed<=0)return;
  const wind=windAt(map,ship),angles=[wind.from+performance.beatAngle,wind.from-performance.beatAngle];
  const useful=angles.filter(heading=>{
    const drive=coursePerformance(ship,map,heading,{assumeTrimmed:true}).targetSpeed;
    return drive*detCos(headingDifference(heading,bearing))>Math.max(performance.targetSpeed,performance.auxiliarySpeed)*1.1;
  });
  const preferred=preferredHeading ?? start.heading;
  useful.sort((a,b)=>Math.abs(headingDifference(preferred,a))-Math.abs(headingDifference(preferred,b)));
  const length=shipProfile(ship)!.length*2;
  for(const heading of useful){
    let best:ShipPose[]|undefined,bestCost=Infinity;
    for(const radius of departureRadii(map,ship)){
      const speedLimit=curveSpeedLimit(ship,radius),lead=Math.abs(headingDifference(start.heading,heading))>1e-7?brakingEntry(ship,start,speedLimit):[];
      const arc=circleArc(lead.at(-1) ?? start,heading,radius,speedLimit),entry=arc.at(-1) ?? lead.at(-1) ?? start;
      const finish:ShipPose={x:entry.x+length*detCos(heading),y:entry.y+length*detSin(heading),heading,curvature:0};
      const points=[...lead,...arc,finish].map(point=>({...point,tack:true})),cost=voyageTime(map,ship,start,points);
      if(cost>=bestCost || !voyageCorridorClear(map,ship,start,points,traffic))continue;
      best=points;bestCost=cost;
    }
    if(best)return best;
  }
}
function departureRoute(map:SeaMap,ship:Unit,goal:Point,traffic:(a:ShipPose,b:ShipPose)=>boolean,latticeEscape=false):ShipPose[]|undefined {
  const start={x:ship.x,y:ship.y,heading:ship.sailing?.heading ?? 0},length=shipProfile(ship)!.length;
  const desired=Math.atan2(goal.y-start.y,goal.x-start.x);
  const differences=[headingDifference(start.heading,desired),headingDifference(start.heading,desired+Math.PI)];
  for(const difference of differences)for(const lever of [length/2,-length/2]){
    if(Math.abs(difference)<1e-7)continue;
    const angle=Math.max(-Math.PI/2,Math.min(Math.PI/2,difference));
    const pivot={x:start.x-lever*detCos(start.heading),y:start.y-lever*detSin(start.heading)};
    const heading=start.heading+angle,end={x:pivot.x+lever*detCos(heading),y:pivot.y+lever*detSin(heading),heading,pivot};
    if(hullPassageClear(map,ship,start,end) && traffic(start,end))return[end];
  }
  // In a channel too narrow to turn, travel along the current keel to an
  // opening. Backing out remains possible without inventing lateral thrust.
  let escape:ShipPose|undefined;
  for(const direction of [1,-1])for(let distance=map.terrain!.cell;distance<=length*4;distance+=map.terrain!.cell){
    const end={x:start.x+direction*distance*detCos(start.heading),y:start.y+direction*distance*detSin(start.heading),heading:start.heading};
    if(!hullPassageClear(map,ship,start,end) || !traffic(start,end))break;
    if(keelConnector(map,ship,end,goal,traffic))return[end];
    if(latticeEscape && !escape){
      const cell=map.terrain!.cell,col=Math.floor(end.x/cell),row=Math.floor(end.y/cell);
      for(let y=row-1;y<=row+1 && !escape;y++)for(let x=col-1;x<=col+1 && !escape;x++)for(let h=0;h<DIRECTIONS;h++){
        const entrance={x:(x+.5)*cell,y:(y+.5)*cell,heading:h*ANGLE};
        if(hullFits(map,ship,entrance) && keelConnector(map,ship,end,entrance,traffic)){escape=end;break;}
      }
    }
  }
  // Backing away from a crossing hull need only recover a valid lattice
  // entrance. The coast may still require a detour after that entrance;
  // insisting on a direct goal connector would leave a reversible jam stuck.
  if(escape)return[{...escape,exact:true}];
}
/** A berth can be reached with a turning arc even when a straight final leg
 * would point its bow through the coast. Stage in open water, then swing the
 * bow/stern around a fixed point on the keel. No sideways docking shortcut. */
function arrivalConnectorFor(map:SeaMap,ship:Unit,goal:ShipPose,traffic:(a:ShipPose,b:ShipPose)=>boolean) {
  const length=shipProfile(ship)!.length;
  const arcs:{stage:ShipPose;end:ShipPose;angle:number}[]=[];
  for(const angle of [Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2])for(const lever of [length/2,-length/2]){
    const pivot={x:goal.x-lever*detCos(goal.heading),y:goal.y-lever*detSin(goal.heading)},heading=goal.heading-angle;
    const stage={x:pivot.x+lever*detCos(heading),y:pivot.y+lever*detSin(heading),heading},end={...goal,pivot};
    if(!hullFits(map,ship,stage) || !traffic(stage,stage))continue;
    if(!hullPassageClear(map,ship,stage,end) || !traffic(stage,end))continue;
    arcs.push({stage,end,angle});
  }
  // These swept arrival arcs depend only on the berth. Validate them once
  // per search, then reuse them at every nearby lattice state.
  return (from:ShipPose):ShipPose[]|undefined=>{
    let best:ShipPose[]|undefined,bestCost=Infinity;
    for(const {stage,end,angle} of arcs){
      const connection=keelConnector(map,ship,from,stage,traffic);if(!connection)continue;
      const last=connection.at(-1) ?? from;
      if(!hullPassageClear(map,ship,last,stage) || !traffic(last,stage))continue;
      const cost=routeTime(map,ship,from,[...connection,...(Math.abs(headingDifference(last.heading,stage.heading))>1e-7?[stage]:[]),end]);
      if(cost>=bestCost)continue;
      bestCost=cost;best=[...connection,...(Math.abs(headingDifference(last.heading,stage.heading))>1e-7?[stage]:[]),end];
    }
    return best;
  }
}
/** Heading-aware water routing. A long, narrow hull can pass a channel that it cannot turn inside. */
export function shipRoute(map: SeaMap, ship: Unit, goal: Point, trafficClear: (from:ShipPose,to:ShipPose)=>boolean = ()=>true): ShipPose[] {
  return planShipRoute(map,ship,goal,trafficClear).points;
}
/** Nominal cruising radius. A shorter, low-speed arc may use the hull-length
 * floor; the controller still respects the existing speed and rudder limits. */
export function voyageTurnRadius(ship:Unit):number {
  const limits=shipMotionLimits(ship),length=shipProfile(ship)!.length;
  return Math.max(length*.65,limits.turnRate>1e-7?limits.speed/limits.turnRate:0);
}
function voyageRadii(ship:Unit):number[] {
  const minimum=shipProfile(ship)!.length*.65,nominal=voyageTurnRadius(ship);
  return [...new Set([nominal,Math.max(minimum,nominal*.7),minimum])];
}
function queuedVoyageRadii(ship:Unit):number[] {
  // Closely spaced marks may need a slower, tighter bend after an oblique
  // departure. The curve speed still follows the same physical rudder limit.
  const length=shipProfile(ship)!.length;
  return [...new Set([...voyageRadii(ship).map(radius=>Math.max(length,radius)),length*.45])];
}
function departureRadii(map:SeaMap,ship:Unit):number[] {
  const limits=shipMotionLimits(ship),auxiliary=coursePerformance(ship,map).auxiliarySpeed;
  // Getting out of the wind eye is a low-speed maneuver. Its physical yaw
  // limit allows a much tighter swept turn than a cruise or mid-voyage tack;
  // retaining the cruising floor here makes heavy ships crawl for ten seconds.
  const assisted=Math.max(shipProfile(ship)!.length*.2,auxiliary/Math.max(1e-7,limits.turnRate));
  return [...new Set([...voyageRadii(ship),assisted])];
}
function curveSpeedLimit(ship:Unit,radius:number):number {
  // Leave steering authority for tracking errors as well as the planned yaw.
  return Math.min(shipMotionLimits(ship).speed,radius*shipMotionLimits(ship).turnRate*.85);
}
function circleArc(from:ShipPose,heading:number,radius:number,speedLimit:number):ShipPose[] {
  const turn=headingDifference(from.heading,heading);
  return signedCircleArc(from,turn,radius,speedLimit);
}
function signedCircleArc(from:ShipPose,turn:number,radius:number,speedLimit:number):ShipPose[] {
  if(Math.abs(turn)<1e-7)return [];
  const curvature=Math.sign(turn)/radius,count=Math.max(1,Math.ceil(Math.abs(turn)/(Math.PI/36)));
  const points:ShipPose[]=[];
  for(let i=1;i<=count;i++){
    const heading=from.heading+turn*i/count;
    points.push({x:from.x+(detSin(heading)-detSin(from.heading))/curvature,
      y:from.y-(detCos(heading)-detCos(from.heading))/curvature,heading,curvature,speedLimit});
  }
  return points;
}
function brakingEntry(ship:Unit,from:ShipPose,speedLimit:number):ShipPose[] {
  const speed=Math.max(0,ship.sailing?.speed ?? 0),acceleration=shipMotionLimits(ship).acceleration;
  const distance=Math.max(0,(speed*speed-speedLimit*speedLimit)/(2*Math.max(1e-6,acceleration)));
  return distance<1e-7?[]:[{x:from.x+distance*detCos(from.heading),y:from.y+distance*detSin(from.heading),heading:from.heading,curvature:0,speedLimit}];
}
/** Forward travel turns while advancing. Compare feasible bend speeds and
 * acceleration from the actual headway rather than always choosing full R. */
function voyageTime(map:SeaMap,ship:Unit,from:ShipPose,points:readonly ShipPose[]):number {
  const acceleration=Math.max(1e-6,shipMotionLimits(ship).acceleration);
  let time=0,speed=Math.max(0,ship.sailing?.speed ?? 0),previous=from;
  for(const point of points){
    const yaw=Math.abs(headingDifference(previous.heading,point.heading));
    const distance=point.curvature?yaw/Math.abs(point.curvature):Math.hypot(point.x-previous.x,point.y-previous.y);
    const performance=coursePerformance(ship,map,(previous.heading+point.heading)/2,{assumeTrimmed:true});
    const cap=Math.min(Math.max(performance.targetSpeed,performance.auxiliarySpeed),point.speedLimit ?? Infinity);
    const changingDistance=Math.abs(cap*cap-speed*speed)/(2*acceleration);
    if(distance<=changingDistance){
      const endSpeed=Math.sqrt(Math.max(0,speed*speed+Math.sign(cap-speed)*2*acceleration*distance));
      time+=Math.abs(endSpeed-speed)/acceleration;speed=endSpeed;
    }else {
      // Once acceleration has reached the cap, the remaining leg cruises at
      // that speed. Using one mean speed for a long leg unfairly rewards a
      // huge departure arc simply because it starts that leg a little faster.
      time+=Math.abs(cap-speed)/acceleration+(distance-changingDistance)/Math.max(1e-6,cap);
      speed=cap;
    }
    previous=point;
  }
  return time;
}
const positiveAngle=(angle:number)=>((angle%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
function voyageLength(from:Point,points:readonly Point[]):number {
  let distance=0,previous=from;
  for(const point of points){distance+=Math.hypot(point.x-previous.x,point.y-previous.y);previous=point;}
  return distance;
}
function voyageCorridorClear(map:SeaMap,ship:Unit,from:ShipPose,points:ShipPose[],traffic:(a:ShipPose,b:ShipPose)=>boolean):boolean {
  if(!connectorClear(map,ship,from,points,traffic))return false;
  // A reference curve needs sea room for a tracking controller to ease the
  // helm before each sample. A zero-margin arc grazing a coast belongs to the
  // exact maneuver executor even when its centerline sweep alone would fit.
  const margin=shipProfile(ship)!.length*.1;
  for(const side of [-1,1]){
    const offset=(point:ShipPose):ShipPose=>({...point,x:point.x-side*margin*detSin(point.heading),y:point.y+side*margin*detCos(point.heading),
      ...(point.curvature?{curvature:point.curvature/(1-side*margin*point.curvature)}:{})});
    if(!connectorClear(map,ship,offset(from),points.map(offset),traffic))return false;
  }
  return true;
}
/** Round a queued course change before its intersection. The current leg
 * must already be aligned; otherwise the ordinary voyage connector owns the
 * approach. All remaining legs and the complete turn have tracking room. */
export function roundVoyageCorner(map:SeaMap,ship:Unit,from:ShipPose,corner:Point,next:Point,traffic:(a:ShipPose,b:ShipPose)=>boolean=()=>true):ShipPose[]|undefined {
  const incoming=Math.atan2(corner.y-from.y,corner.x-from.x),outgoing=Math.atan2(next.y-corner.y,next.x-corner.x);
  const turn=headingDifference(incoming,outgoing),before=Math.hypot(corner.x-from.x,corner.y-from.y),after=Math.hypot(next.x-corner.x,next.y-corner.y);
  if(Math.abs(headingDifference(from.heading,incoming))>.01 || Math.abs(turn)<.01 || Math.abs(turn)>Math.PI-.1 || shipMotionLimits(ship).turnRate<=1e-7)return;
  let best:ShipPose[]|undefined,bestCost=Infinity;
  for(const radius of queuedVoyageRadii(ship)){
    if(best && radius<shipProfile(ship)!.length*.65)continue;
    const setback=radius*Math.tan(Math.abs(turn)/2),speedLimit=curveSpeedLimit(ship,radius);
    const braking=brakingEntry(ship,from,speedLimit),brakingLength=braking.length?Math.hypot(braking[0]!.x-from.x,braking[0]!.y-from.y):0;
    if(setback+brakingLength+1>=before || setback+1>=after)continue;
    const entry:ShipPose={x:corner.x-setback*detCos(incoming),y:corner.y-setback*detSin(incoming),heading:incoming,curvature:0,speedLimit};
    const points=[entry,...circleArc(entry,outgoing,radius,speedLimit),{...next,heading:outgoing,curvature:0}];
    const cost=voyageTime(map,ship,from,points);
    if(cost>=bestCost || !voyageCorridorClear(map,ship,from,points,traffic))continue;
    best=points;bestCost=cost;
  }
  return best;
}
/** Forward circle followed by its tangent to a free-heading destination.
 * Each small reference segment is swept with its changing hull orientation;
 * no zero-distance rotation is hidden in an open-water voyage. */
function forwardConnector(map:SeaMap,ship:Unit,from:ShipPose,goal:Point,traffic:(a:ShipPose,b:ShipPose)=>boolean,next?:Point):ShipPose[]|undefined {
  const dx=goal.x-from.x,dy=goal.y-from.y,gap=Math.hypot(dx,dy);
  if(gap<1e-7)return [];
  const direction=Math.atan2(dy,dx),error=headingDifference(from.heading,direction);
  if(Math.abs(error)<1e-7){const direct=[{...goal,heading:from.heading}];return connectorClear(map,ship,from,direct,traffic)?direct:undefined;}
  if(shipMotionLimits(ship).turnRate<=1e-7)return;
  let best:ShipPose[]|undefined,bestCost=Infinity,bestCanRound=false;
  for(const radius of next ? queuedVoyageRadii(ship) : voyageRadii(ship)){
    if(bestCanRound && radius<shipProfile(ship)!.length*.65)continue;
    const speedLimit=curveSpeedLimit(ship,radius),lead=brakingEntry(ship,from,speedLimit),entry=lead.at(-1) ?? from;
    for(const side of [error<0?-1:1,error<0?1:-1]){
      const center={x:entry.x-side*radius*detSin(entry.heading),y:entry.y+side*radius*detCos(entry.heading)};
      const gx=goal.x-center.x,gy=goal.y-center.y,distance=Math.hypot(gx,gy);
      if(distance<radius+1e-7)continue;
      const radial=Math.atan2(gy,gx)-side*Math.acos(Math.min(1,radius/distance));
      const heading=radial+side*Math.PI/2,turn=positiveAngle(side*headingDifference(from.heading,heading));
      // A near-full circle is a berthing maneuver; it is not a useful route to
      // a nearby point and would look like orbiting a moving target.
      if(turn>Math.PI*1.5)continue;
      const points:ShipPose[]=[...lead,...signedCircleArc(entry,side*turn,radius,speedLimit)];
      const tangent=points.at(-1)!;
      // A large hull's fastest departure arc can leave a very short tangent
      // and a steep arrival heading. Prefer an approach with enough sea room
      // for the already queued bend, rather than stopping at that first mark.
      const canRound=!next || !!roundVoyageCorner(map,{...ship,sailing:{...ship.sailing!,speed:speedLimit}},tangent,goal,next,traffic);
      if(Math.hypot(goal.x-tangent.x,goal.y-tangent.y)>1e-7)points.push({...goal,heading:tangent.heading,curvature:0});
      const cost=voyageTime(map,ship,from,points);
      if(bestCanRound && !canRound || bestCanRound===canRound && cost>=bestCost-1e-7 || !voyageCorridorClear(map,ship,from,points,traffic))continue;
      best=points;bestCost=cost;bestCanRound=canRound;
    }
  }
  return best;
}
function simplifyVoyageReference(map:SeaMap,ship:Unit,from:ShipPose,points:ShipPose[],traffic:(a:ShipPose,b:ShipPose)=>boolean):ShipPose[] {
  let previous=from;
  for(const point of points){
    if(point.pivot || (point.x-previous.x)*detCos(point.heading)+(point.y-previous.y)*detSin(point.heading)<-1e-5)
      return points.map(point=>({...point,exact:true}));
    previous=point;
  }
  // Keep the endpoints of straight lattice runs and both poses of each
  // required turn. If no swept forward replacement fits, the exact maneuver
  // remains available unchanged to the coast/berth executor.
  const corners=points.filter((point,i)=>{
    const a=points[i-1] ?? from,b=points[i+1];
    return !b || Math.abs(headingDifference(a.heading,point.heading))>1e-7
      || Math.abs(headingDifference(point.heading,b.heading))>1e-7
      || Math.hypot(point.x-a.x,point.y-a.y)<1e-7 || Math.hypot(b.x-point.x,b.y-point.y)<1e-7;
  });
  const result:ShipPose[]=[];let cursor=from;
  for(let i=0;i<corners.length;){
    let connection:ShipPose[]|undefined,end=i;
    for(let j=corners.length-1;j>=i;j--){
      if(Math.hypot(corners[j]!.x-cursor.x,corners[j]!.y-cursor.y)<shipProfile(ship)!.length*.5)continue;
      const candidate=forwardConnector(map,ship,cursor,corners[j]!,traffic);
      if(!candidate || voyageLength(cursor,candidate)>voyageLength(cursor,corners.slice(i,j+1))*1.1)continue;
      const following=corners[j+1];
      if(following && !connectorClear(map,ship,candidate.at(-1)!,[following],traffic))continue;
      connection=candidate;end=j;break;
    }
    if(connection){result.push(...connection);cursor=connection.at(-1)!;i=end+1;}
    else {cursor=corners[i++]!;result.push({...cursor,exact:true});}
  }
  return result;
}
/** Cruise planning is separate from exact docking. Start with a continuous
 * forward curve; use the heading lattice only as a safe coastal reference. */
export function planVoyageRoute(map:SeaMap,ship:Unit,goal:Point & {heading?:number},trafficClear:(from:ShipPose,to:ShipPose)=>boolean=()=>true,budget=Infinity):{points:ShipPose[];partial:boolean} {
  const from={x:ship.x,y:ship.y,heading:ship.sailing?.heading ?? 0};
  if(goal.heading!==undefined || Math.hypot(goal.x-from.x,goal.y-from.y)<=shipProfile(ship)!.length*.5)
    return planShipRoute(map,ship,goal,trafficClear,budget);
  const queued=ship.orderQueue?.[0],current=ship.order;
  const next=current.type==='move' && current.heading===undefined && current.rendezvousFor===undefined
    && current.deckPoint===undefined && current.deckShipId===undefined
    && current.x===goal.x && current.y===goal.y && queued?.type==='move'
    && queued.heading===undefined && queued.rendezvousFor===undefined && queued.deckPoint===undefined && queued.deckShipId===undefined
    && !!queued.avoidCombat===!!current.avoidCombat
    && !coursePerformance(ship,map,Math.atan2(queued.y-goal.y,queued.x-goal.x),{assumeTrimmed:true}).noGo ? queued : undefined;
  const direct=forwardConnector(map,ship,from,goal,trafficClear,next);
  if(direct)return{points:direct,partial:false};
  const reference=planShipRoute(map,ship,goal,trafficClear,budget);
  return{points:simplifyVoyageReference(map,ship,from,reference.points,trafficClear),partial:reference.partial};
}
/** A deterministic expansion budget bounds temporary traffic searches. Partial
 * routes remain journeys, never arrivals at the requested destination. */
export function planShipRoute(map: SeaMap, ship: Unit, goal: Point & {heading?:number}, trafficClear: (from:ShipPose,to:ShipPose)=>boolean = ()=>true, budget=Infinity): {points:ShipPose[];partial:boolean} {
  const originalTraffic=trafficClear;let trafficBlocked=false;
  trafficClear=(from,to)=>{const clear=originalTraffic(from,to);trafficBlocked ||= !clear;return clear;};
  const t = map.terrain;
  if (!t)
    return {points:[{ ...goal, heading: Math.round(Math.atan2(goal.y - ship.y, goal.x - ship.x) * 1e9) / 1e9 }],partial:false};
  const grid = gridFor(map, ship), size = grid.fits.length;
  const limits=shipMotionLimits(ship),cruise=Math.max(1e-6,coursePerformance(ship,map,0,{assumeTrimmed:true}).maxForwardSpeed),turnSpeed=Math.max(1e-6,limits.turnRate);
  const courseSpeeds=Array.from({length:DIRECTIONS},(_,h)=>{
    const performance=coursePerformance(ship,map,h*ANGLE,{assumeTrimmed:true});
    return {forward:Math.max(performance.targetSpeed,performance.auxiliarySpeed),reverse:Math.min(limits.reverseSpeed,performance.auxiliarySpeed)};
  });
  const lattice = grid;
  const pose = (id: number): ShipPose => { const cell = Math.floor(id / DIRECTIONS); return { x: (cell % lattice.cols + .5) * lattice.cell, y: (Math.floor(cell / lattice.cols) + .5) * lattice.cell, heading: (id % DIRECTIONS) * ANGLE }; };
  const fits = (id: number) => {
    if (!grid.fits[id])
      grid.fits[id] = maskFits(map, grid, id, grid.masks[id % DIRECTIONS]![0]!) ? 1 : -1;
    if(grid.fits[id]!==1)return false;
    // Traffic changes between searches even on unchanged terrain. Signed
    // generations retain no stale result, and avoid a map-sized allocation
    // for every replan (or any traffic array on the direct-connector path).
    if(trafficFits[id]!==generation && trafficFits[id]!==-generation){const at=pose(id);trafficFits[id]=trafficClear(at,at)?generation:-generation;}
    return trafficFits[id]===generation;
  };
  const requested=goal.heading===undefined?undefined:{x:goal.x,y:goal.y,heading:goal.heading};
  const terrainTarget=requested && hullFits(map,ship,requested) ? requested : nearestShipPose(map,ship,goal);
  const target=terrainTarget && trafficClear(terrainTarget,terrainTarget) ? terrainTarget : nearestShipPose(map,ship,goal,ship,pose=>trafficClear(pose,pose));
  const deferred=!!terrainTarget && (!target || Math.hypot(target.x-terrainTarget.x,target.y-terrainTarget.y)>1e-7
    || goal.heading!==undefined && Math.abs(headingDifference(target.heading,terrainTarget.heading))>1e-7);
  if (!target)
    return {points:[],partial:deferred};
  const length = shipProfile(ship)!.length;
  const start = { x: ship.x, y: ship.y, heading: ship.sailing?.heading ?? 0 };
  const destination=requested?target:{x:target.x,y:target.y};
  const direct=keelConnector(map,ship,start,destination,trafficClear);
  // The executor already turns before thrust. Keeping a zero-distance turn
  // waypoint here would stop propulsion on every moving-target replan.
  if(direct)return {points:direct.filter((point,i)=>i!==0 || Math.hypot(point.x-start.x,point.y-start.y)>1e-7 || direct.length===1),partial:deferred};
  const arrive=arrivalConnectorFor(map,ship,target,trafficClear);
  const arrival=arrive(start);
  if(arrival)return {points:arrival,partial:deferred};
  const direction=Math.atan2(target.y-start.y,target.x-start.x);
  if([direction,direction+Math.PI].every(heading=>!hullPassageClear(map,ship,start,{...start,heading}) || !trafficClear(start,{...start,heading}))){
    const departure=departureRoute(map,ship,target,trafficClear);
    if(departure)return {points:departure,partial:true};
  }
  const workspace = searchWorkspace(size), { costs, parents: previous, stamps, trafficFits, generation } = workspace, frontier = new Frontier();
  const cost = (id: number) => stamps[id] === generation ? costs[id]! : Infinity;
  const setCost = (id: number, value: number, parent: number) => { stamps[id] = generation; costs[id] = value; previous[id] = parent; };
  const prefixes=new Map<number,ShipPose[]>(),entrances=new Map<number,ShipPose[][]>();
  const col = Math.floor(ship.x / lattice.cell), row = Math.floor(ship.y / lattice.cell);
  for (let y = Math.max(0, row - 1); y <= Math.min(lattice.rows - 1, row + 1); y++)
    for (let x = Math.max(0, col - 1); x <= Math.min(lattice.cols - 1, col + 1); x++)
      for (let h = 0; h < DIRECTIONS; h++) {
        const id = (y * lattice.cols + x) * DIRECTIONS + h, p = pose(id);
        if (!fits(id))
          continue;
        // The eight headings at one cell share the same ahead/astern entrance.
        // Validate those continuous sweeps once, then test each final yaw.
        const cell=y*lattice.cols+x;
        if(!entrances.has(cell))entrances.set(cell,keelCandidates(ship,start,{x:p.x,y:p.y}).filter(points=>connectorClear(map,ship,start,points,trafficClear)));
        let prefix:ShipPose[]|undefined,g=Infinity;
        for(const entrance of entrances.get(cell)!){
          const end=entrance.at(-1) ?? start;
          if(!hullPassageClear(map,ship,end,p) || !trafficClear(end,p))continue;
          const points=[...entrance,...(Math.abs(headingDifference(end.heading,p.heading))>1e-7?[p]:[])],time=routeTime(map,ship,start,points);
          if(time<g){g=time;prefix=points;}
        }
        if(!prefix)continue;
        setCost(id,g,-1);prefixes.set(id,prefix);
        frontier.push({ id, cost: g, score: g + Math.hypot(p.x - target.x, p.y - target.y)/cruise });
      }
  if(!frontier.items.length){const departure=departureRoute(map,ship,target,trafficClear,true);return{points:departure ?? [],partial:!!departure || deferred || trafficBlocked};}
  let best = -1, bestGap = Infinity,visited=0,partial=false,terminal:ShipPose[]|undefined;
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
    if(gap<=lattice.cell*1.5){
      const connection=keelConnector(map,ship,p,destination,trafficClear) ?? arrive(p);
      if(connection){best=id;terminal=connection;break;}
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
      frontier.push({ id: to, cost: value, score: value + Math.hypot(at.x - target.x, at.y - target.y)/cruise });
    };
    visit(cell * DIRECTIONS + (h + 1) % DIRECTIONS, ANGLE / turnSpeed, grid.turns, id * 2, grid.masks[h]![1]!);
    visit(cell * DIRECTIONS + (h + DIRECTIONS - 1) % DIRECTIONS, ANGLE / turnSpeed, grid.turns, id * 2 + 1, grid.masks[h]![2]!);
    // Only ahead/astern edges. A hull cannot strafe along the route.
    for (const maneuver of [0,2]) {
      const [dx, dy] = STEPS[(h + maneuver * 2) % DIRECTIONS]!, nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < lattice.cols && ny < lattice.rows)
        visit((ny * lattice.cols + nx) * DIRECTIONS + h, lattice.cell * (dx && dy ? Math.SQRT2 : 1) / Math.max(1e-6,maneuver===2?courseSpeeds[h]!.reverse:courseSpeeds[h]!.forward), grid.moves, id * 4 + maneuver, grid.masks[h]![maneuver + 3]!);
    }
  }
  if (best < 0)
    return {points:[],partial:false};
  const path: ShipPose[] = [];
  for (let at = best; at >= 0; at = previous[at]!)
    path.push(pose(at));
  path.reverse();
  const root=path[0]!;
  const rootId=(Math.floor(root.y/lattice.cell)*lattice.cols+Math.floor(root.x/lattice.cell))*DIRECTIONS+Math.round(root.heading/ANGLE)%DIRECTIONS;
  const prefix=prefixes.get(rootId) ?? [root];
  path.splice(0,1,...prefix);
  if(terminal)path.push(...terminal);
  if(!terminal && trafficBlocked && !partial){
    // Exhausting a temporarily occupied corridor is not arrival. Compare the
    // terrain-only endpoint so a genuinely unreachable island/pond still
    // retains its ordinary nearest-reachable completion semantics.
    const unobstructed=planShipRoute(map,ship,goal),end=path.at(-1) ?? start,possible=unobstructed.points.at(-1) ?? start;
    partial=unobstructed.partial || Math.hypot(end.x-possible.x,end.y-possible.y)>1e-7;
  }
  return {points:path,partial:partial || deferred};
}
