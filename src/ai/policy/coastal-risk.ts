import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { canReach } from '../../shared/naval';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { isInCabin } from '../../shared/ship-cabin';
import { distanceToHull, shipProfile } from '../../shared/ship-geometry';
import { headingDifference, hullPassageClear, nearestShipPose, planVoyageRoute, shipPoseAt, type ShipPose } from '../../shared/ship-navigation';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isEnemyOwner } from './ownership';
import { distance, type Point } from './spatial';
import type { AiPolicyContext } from '../policy';
import { attackMargin } from './v6/general';
import { effectiveCombatRating } from './v6/strength';
import { coastalFireDisks, coastalFireSegmentClear } from './coastal-voyage';

/** Native centre motion is straight or circular (including contact pivots).
 * Recover its circle from the native interpolation, then test the analytic
 * nearest point on that arc. The midpoint identifies the known circle; it is
 * not a sampled approximation to an arbitrary road. */
function centreDoesNotApproach(from: ShipPose, to: ShipPose, danger: Point): boolean {
  const middle = shipPoseAt(from, to, .5);
  if (Math.hypot(middle.x - (from.x + to.x) / 2, middle.y - (from.y + to.y) / 2) <= 1e-5)
    return (from.x - danger.x) * (to.x - from.x) + (from.y - danger.y) * (to.y - from.y) >= 0;
  const start = shipPoseAt(from, to, 0), end = shipPoseAt(from, to, 1);
  if (distance(start, from) > 1e-5 || distance(end, to) > 1e-5) return false;
  const ax = middle.x - from.x, ay = middle.y - from.y, bx = to.x - from.x, by = to.y - from.y;
  const determinant = 2 * (ax * by - ay * bx);
  if (!determinant) return false;
  const aa = ax * ax + ay * ay, bb = bx * bx + by * by;
  const centre = { x: from.x + (aa * by - bb * ay) / determinant,
    y: from.y + (ax * bb - bx * aa) / determinant };
  const turn = headingDifference(from.heading, to.heading), circle = Math.PI * 2;
  const angle = Math.atan2(danger.y - centre.y, danger.x - centre.x)
    - Math.atan2(from.y - centre.y, from.x - centre.x);
  const nearestTurn = turn >= 0 ? (angle % circle + circle) % circle : -((-angle % circle + circle) % circle);
  let closest = Math.min(distance(from, danger), distance(to, danger));
  if (Math.abs(nearestTurn) <= Math.abs(turn))
    closest = Math.min(closest, Math.abs(distance(centre, danger) - distance(centre, from)));
  return closest + 1e-5 >= distance(from, danger);
}

/** A finite withdrawal prefix may leave coverage that already contains the
 * hull. It must not go deeper or enter another weapon's coverage. This uses
 * the existing enclosing-hull fire disks without the advance warning margin.
 * Curves outside coverage retain the existing curved-centre safety bound;
 * overlapping starts use the native arc rather than its endpoint chord. */
export function coastalWithdrawalPrefixSafe(snapshot: GameSnapshot, ship: Unit,
  route: { points: readonly ShipPose[] } | undefined, options: AiPolicyContext): boolean {
  if (!ship.sailing || !shipProfile(ship) || !route?.points.length) return false;
  const disks = coastalFireDisks(snapshot, ship, options, 0);
  let previous: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing.heading };
  for (const point of route.points) {
    for (const disk of disks) {
      if (distance(previous, disk) > disk.radius) {
        if (!coastalFireSegmentClear(previous, point, [disk])) return false;
      } else {
        if (!centreDoesNotApproach(previous, point, disk)) return false;
      }
    }
    previous = point;
  }
  return true;
}

/** Query the public coordinate move, including all real solids. The returned
 * complete ordinary road is an admission proof, never an installed route. */
export function coastalWithdrawalPassage(snapshot: GameSnapshot, ship: Unit, goal: Point, options: AiPolicyContext) {
  if (!ship.sailing || !shipProfile(ship)) return;
  goal = { x: goal.x, y: goal.y };
  const hull: Unit = { ...ship, order: { type: 'move', x: goal.x, y: goal.y, avoidCombat: true },
    orderQueue: [], sailing: { ...ship.sailing } };
  delete hull.sailing!.route;
  const units = snapshot.units.map(unit => unit.id === ship.id ? hull : unit);
  beginShipCollisionFrame(units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const traffic = shipRouteTraffic(snapshot.map, hull, units);
  const route = planVoyageRoute(snapshot.map, hull, goal, traffic, 1024), end = route.points.at(-1);
  if (route.partial !== false || !end || distance(end, goal) > MOVE_ORDER_ARRIVAL_RANGE
    || !coastalWithdrawalPrefixSafe(snapshot, ship, route, options)
    || !coastalFireSegmentClear(end, end, coastalFireDisks(snapshot, ship, options, 0))) return;
  let previous: ShipPose = { x: ship.x, y: ship.y, heading: ship.sailing.heading };
  for (const point of route.points) {
    if (!hullPassageClear(snapshot.map, hull, previous, point) || !traffic(previous, point)) return;
    previous = point;
  }
  return route;
}

/** Query the same coordinate-only move that the public command will execute.
 * A short straight reverse avoids the inward arc of a full forward turn.
 * Existing incoming fire may overlap the hull, but this leg must move away
 * from that coverage and must not enter another gun's actual firing disk. */
export function coastalAsternPassageClear(snapshot: GameSnapshot, ship: Unit, goal: Point, options: AiPolicyContext): boolean {
  if (!ship.sailing || !shipProfile(ship)) return false;
  const heading=ship.sailing.heading,from={x:ship.x,y:ship.y,heading};
  const dx=goal.x-ship.x,dy=goal.y-ship.y;
  if (dx*Math.cos(heading)+dy*Math.sin(heading)>=0 || Math.abs(-dx*Math.sin(heading)+dy*Math.cos(heading))>1e-5) return false;
  const hull:Unit={...ship,order:{type:'move',x:goal.x,y:goal.y},orderQueue:[],sailing:{...ship.sailing}};
  delete hull.sailing!.route;
  const units=snapshot.units.map(unit=>unit.id===ship.id?hull:unit);
  beginShipCollisionFrame(units,snapshot.map,[...snapshot.buildings,...snapshot.obstacles??[]]);
  const traffic=shipRouteTraffic(snapshot.map,hull,units);
  const route=planVoyageRoute(snapshot.map,hull,goal,traffic,1024),end=route.points.at(-1);
  if (route.partial!==false || !end || distance(end,goal)>MOVE_ORDER_ARRIVAL_RANGE) return false;
  const disks=coastalFireDisks(snapshot,ship,options,0);
  let previous=from;
  for(const point of route.points) {
    if (point.pivot || point.curvature || Math.abs(headingDifference(heading,point.heading))>1e-5
      || !hullPassageClear(snapshot.map,hull,previous,point)) return false;
    for(const disk of disks) {
      if(distance(previous,disk)>disk.radius) {
        if(!coastalFireSegmentClear(previous,point,[disk]))return false;
      } else if((previous.x-disk.x)*(point.x-previous.x)+(previous.y-disk.y)*(point.y-previous.y)<-1e-5)return false;
    }
    previous=point;
  }
  return true;
}

export function coastalAsternStep(snapshot: GameSnapshot, ship: Unit, threats: Unit[], options: AiPolicyContext): Point | undefined {
  const profile=shipProfile(ship);
  if(!profile || !ship.sailing)return;
  const heading=ship.sailing.heading;
  // Below half a hull, ordinary navigation retains the exact astern maneuver.
  const goal={x:ship.x-Math.cos(heading)*profile.length*.4,y:ship.y-Math.sin(heading)*profile.length*.4};
  if(threats.some(foe=>(ship.x-foe.x)*(goal.x-ship.x)+(ship.y-foe.y)*(goal.y-ship.y)<=0))return;
  return coastalAsternPassageClear(snapshot,ship,goal,options)?goal:undefined;
}

/** Shore fire threatens the hull edge, not its center. Count only troops that
 * can reach this water, and only nearby allies that can fight those troops.
 * A remote army or a soldier in a cabin is not cover for a coastal battery.
 */
export function outmatchingCoast(snapshot: GameSnapshot, owner: PlayerId, ship: Unit, station: Point & {heading?:number}, options: AiPolicyContext): Unit[] {
  const posed={...ship,x:station.x,y:station.y,sailing:{...ship.sailing!,heading:station.heading ?? ship.sailing!.heading}};
  const threats=snapshot.units.filter(unit=>unit.hp>0 && unitMover(unit.kind)==='land' && !isInCabin(unit)
    && isEnemyOwner(snapshot,owner,unit.owner,options) && combatCapability(snapshot,unit).armed
    && distanceToHull(posed,unit)<=combatCapability(snapshot,unit).range+160
    && canReach(snapshot.map,unit,posed,snapshot.units));
  if (!threats.length) return [];
  const support=snapshot.units.filter(unit=>unit.hp>0 && unit.owner!=='neutral' && !isInCabin(unit)
    && !isEnemyOwner(snapshot,owner,unit.owner,options)
    && (unit.id===ship.id || distance(unit,ship)<600 || distance(unit,station)<600)
    && threats.some(foe=>canReach(snapshot.map,unit,foe,snapshot.units,combatCapability(snapshot,unit).range)
      && (!shipProfile(unit) || distance(unit,ship)<600 || distance(unit,station)<600)));
  const ours=support.reduce((sum,unit)=>sum+effectiveCombatRating(snapshot,unit),0);
  const theirs=threats.reduce((sum,unit)=>sum+effectiveCombatRating(snapshot,unit),0);
  return theirs*attackMargin(options)>ours ? threats : [];
}

/** A heading-compatible escape, rather than a point directly opposite the
 * enemy that makes the hull describe a large turn through its firing zone.
 * Ordinary movement still plans and executes the actual collision-free road.
 */
export function coastalRefuge(snapshot: GameSnapshot, ship: Unit, threats: Unit[], admit?: (goal: Point) => boolean): Point | undefined {
  const heading=ship.sailing?.heading ?? 0;
  const candidates=[];
  for (let i=0;i<16;i++) {
    const angle=heading+i*Math.PI/8;
    const pose=nearestShipPose(snapshot.map,ship,{x:ship.x+Math.cos(angle)*600,y:ship.y+Math.sin(angle)*600});
    if (!pose || distance(ship,pose)<200) continue;
    const hull={...ship,x:pose.x,y:pose.y,sailing:{...ship.sailing!,heading:pose.heading}};
    if (threats.some(foe=>distanceToHull(hull,foe)<=combatCapability(snapshot,foe).range+200)) continue;
    candidates.push({pose,turn:Math.abs(headingDifference(heading,Math.atan2(pose.y-ship.y,pose.x-ship.x))),distance:distance(ship,pose)});
  }
  candidates.sort((a,b)=>a.turn-b.turn || a.distance-b.distance);
  return candidates.find(candidate => !admit || admit(candidate.pose))?.pose;
}
