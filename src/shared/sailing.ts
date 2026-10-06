import { shipPartMax } from "./ship-equipment";
import { avoidShipHulls, shipContactGoal, shipTraffic, shipTrafficKey } from "./ship-avoidance";
import { detCos, detSin } from "./det-math";
import { shipsIn, shipProfile, distanceToHull, type Point } from "./ship-geometry";
import { headingDifference, hullFits, hullPassageClear, nearestShipPose, planShipRoute, shipPoseAt } from "./ship-navigation";
import { perTick, SIM_TICKS_PER_SECOND } from "./time";
import type { GameMap, Unit } from "./types";
import { advanceShip, shipMotionLimits } from './ship-motion';

/** A hull and all its passengers rotate continuously, in radians per second. */
export function turnShipToward(ship:Unit,desired:number,map:GameMap,units:readonly Unit[],spentTurn=0){
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  const limit=Math.max(0,perTick(shipMotionLimits(ship).turnRate)-spentTurn);
  const difference=headingDifference(motion.heading,desired),heading=motion.heading+Math.max(-limit,Math.min(limit,difference));
  const before={x:ship.x,y:ship.y,heading:motion.heading};
  if(!advanceShip(ship,map,units,{yaw:heading-before.heading,spentYaw:spentTurn}))return false;
  return Math.abs(difference)<=limit+1e-7;
}

/** Rates are distance/s, distance/s² and radians/s; loading affects propulsion and steering. */
export function sailToward(ship:Unit,point:Point & {heading?:number},map:GameMap,units:readonly Unit[],pace=1) {
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  const maxParts=shipPartMax(ship);const propulsion=(ship.shipParts?.rigging ?? maxParts.rigging)/maxParts.rigging;
  if(propulsion<=0){motion.speed=0;return;}
  const limits=shipMotionLimits(ship);
  const turn=perTick(limits.turnRate);
  const acceleration=perTick(limits.acceleration);
  const start={x:ship.x,y:ship.y,heading:motion.heading};
  let aim:Point,desired:number;
  if(map.terrain) {
    const movedGoal = motion.route && Math.hypot(motion.route.goalX-point.x,motion.route.goalY-point.y);
    if(!motion.route || movedGoal!>map.terrain.cell/2 || !motion.route.points.length && movedGoal!>1) {
      const traffic=shipTraffic(ship,units),{points,partial}=planShipRoute(map,ship,point.heading===undefined ? shipContactGoal(ship,point,units) ?? point : point,traffic,traffic.hasTraffic?512:Infinity);
      motion.route={goalX:point.x,goalY:point.y,points,end:points.at(-1)??{x:ship.x,y:ship.y},trafficKey:shipTrafficKey(ship,units),partial,startX:ship.x,startY:ship.y,startHeading:motion.heading};
    }
    while(motion.route.points.length && Math.hypot(ship.x-motion.route.points[0]!.x,ship.y-motion.route.points[0]!.y)<1e-7
      && Math.abs(headingDifference(motion.heading,motion.route.points[0]!.heading))<1e-7)motion.route.points.shift();
    const next=motion.route.points[0];
    if(!next){motion.speed=0;if(motion.route.trafficKey!==shipTrafficKey(ship,units) || motion.route.partial && (Math.hypot(ship.x-motion.route.startX!,ship.y-motion.route.startY!)>1 || Math.abs(headingDifference(motion.route.startHeading!,motion.heading))>.001))motion.route=undefined;return;}
    if(next.pivot){
      const difference=headingDifference(start.heading,next.heading),lever=Math.hypot(ship.x-next.pivot.x,ship.y-next.pivot.y);
      const targetSpeed=Math.min(ship.speed*pace*.5,lever*turn*SIM_TICKS_PER_SECOND);
      motion.speed+=Math.max(-acceleration,Math.min(acceleration,targetSpeed-motion.speed));
      const angle=Math.min(Math.abs(difference),turn,lever ? perTick(motion.speed)/lever : turn);
      const at=shipPoseAt(start,next,Math.abs(difference)>1e-7?angle/Math.abs(difference):1);
      const leverSigned=(ship.x-next.pivot.x)*detCos(start.heading)+(ship.y-next.pivot.y)*detSin(start.heading);
      if(!advanceShip(ship,map,units,{yaw:headingDifference(start.heading,at.heading),pivotLever:leverSigned})){motion.speed=0;motion.route=undefined;}
      return;
    }
    aim=next;desired=next.heading;
  } else {
    aim=nearestShipPose(map,ship,point)??ship;
    desired=Math.hypot(aim.x-ship.x,aim.y-ship.y)<1e-7 && point.heading!==undefined ? point.heading : Math.round(Math.atan2(aim.y-ship.y,aim.x-ship.x)*1e9)/1e9;
  }
  const difference=headingDifference(motion.heading,desired);
  const heading=motion.heading+Math.max(-turn,Math.min(turn,difference));
  const turned={...start,heading};
  if(!advanceShip(ship,map,units,{yaw:heading-start.heading})){motion.speed=0;motion.route=undefined;return;}
  // Turns happen in water wide enough for the swept hull; a narrow channel is traversed along its axis.
  if(map.terrain && Math.abs(difference)>turn+1e-7){motion.speed=0;return;}
  // Collinear lattice points are not mandatory stops. Skip a clear run before
  // local avoidance so another hull cannot trap us at an obsolete grid point.
  if(motion.route && Math.hypot(aim.x-ship.x,aim.y-ship.y)>1e-7){
    const initialDirection=Math.atan2(aim.y-ship.y,aim.x-ship.x);
    let through=0;
    for(let i=1;i<motion.route.points.length;i++){
      const candidate=motion.route.points[i]!;
      if(candidate.pivot || Math.abs(headingDifference(heading,candidate.heading))>1e-7 || Math.abs(headingDifference(initialDirection,Math.atan2(candidate.y-ship.y,candidate.x-ship.x)))>1e-7 || !hullPassageClear(map,ship,turned,candidate))break;
      through=i;aim=candidate;
    }
    if(through)motion.route.points.splice(0,through);
  }
  const docking=units.some(other=>other!==ship && shipProfile(other) && distanceToHull(other,point)===0);
  const detour=!map.terrain ? avoidShipHulls(map,ship,aim,units,docking) : aim;
  if(!detour){motion.speed=0;if(motion.route?.trafficKey!==shipTrafficKey(ship,units))motion.route=undefined;return;}
  const dx=detour.x-ship.x,dy=detour.y-ship.y,gap=Math.hypot(dx,dy);
  if(gap===0){motion.speed=0;return;}
  const alignment=(dx*detCos(heading)+dy*detSin(heading))/gap;
  const travelSpeed=alignment>=0 ? limits.speed : limits.reverseSpeed;
  if(map.terrain && Math.abs(dx*detSin(heading)-dy*detCos(heading))>1e-5){motion.speed=0;motion.route=undefined;return;}
  const targetSpeed=travelSpeed*pace*(map.terrain ? 1 : Math.max(.08,detCos(difference)));
  motion.speed+=Math.max(-acceleration,Math.min(acceleration,targetSpeed-motion.speed));
  const step=Math.min(gap,perTick(motion.speed));
  if(!advanceShip(ship,map,units,{surge:step*(map.terrain && alignment<0?-1:1),spentYaw:Math.abs(heading-start.heading)})){motion.speed=0;motion.route=undefined;}
}

/** Old authored placements may put a larger new hull across a coast. Normal motion stays continuous. */
export function keepShipsOnWater(map:GameMap,units:readonly Unit[]) {
  for(const ship of shipsIn(units))if(!hullFits(map,ship)) {
    const pose=nearestShipPose(map,ship,ship);
    if(!pose)continue;
    Object.assign(ship,{x:pose.x,y:pose.y});
    ship.sailing??={heading:pose.heading,speed:0,load:0,balance:0};
    ship.sailing.heading=pose.heading;ship.sailing.speed=0;ship.sailing.route=undefined;
  }
}
