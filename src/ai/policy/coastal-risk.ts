import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { canReach } from '../../shared/naval';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { isInCabin } from '../../shared/ship-cabin';
import { distanceToHull, shipProfile } from '../../shared/ship-geometry';
import { headingDifference, hullPassageClear, nearestShipPose, planVoyageRoute } from '../../shared/ship-navigation';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isEnemyOwner } from './ownership';
import { distance, type Point } from './spatial';
import type { AiPolicyContext } from '../policy';
import { attackMargin } from './v6/general';
import { effectiveCombatRating } from './v6/strength';
import { coastalFireDisks, coastalFireSegmentClear } from './coastal-voyage';

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
  const traffic=shipRouteTraffic(snapshot.map,hull,snapshot.units.map(unit=>unit.id===ship.id?hull:unit));
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
export function coastalRefuge(snapshot: GameSnapshot, ship: Unit, threats: Unit[]): Point | undefined {
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
  return candidates[0]?.pose;
}
