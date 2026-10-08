import { shipPartMax } from "./ship-equipment";
import { shipContactGoal, shipTraffic, shipTrafficKey } from "./ship-avoidance";
import { detCos, detSin } from "./det-math";
import { shipsIn, shipProfile, type Point } from "./ship-geometry";
import { headingDifference, hullFits, hullPassageClear, nearestShipPose, planShipRoute, shipPoseAt } from "./ship-navigation";
import { perTick, SIM_TICKS_PER_SECOND } from "./time";
import type { GameMap, Unit } from "./types";
import { advanceShip, shipMotionLimits } from './ship-motion';
import { followShipRoute } from './ship-guidance';

// Authored scenes without a terrain grid use the same swept water routes as
// generated maps. A direct steering shortcut could wedge two touching hulls
// before their requested arrival headings were reached.
const openWaterMaps=new WeakMap<GameMap,{width:number;height:number;map:GameMap}>();
function navigationMap(map:GameMap):GameMap{
  if(map.terrain)return map;
  let cached=openWaterMaps.get(map);
  if(!cached||cached.width!==map.width||cached.height!==map.height){
    const cell=32,cols=Math.ceil(map.width/cell),rows=Math.ceil(map.height/cell);
    cached={width:map.width,height:map.height,map:{...map,terrain:{cell,cols,rows,cells:'~'.repeat(cols*rows)}}};openWaterMaps.set(map,cached);
  }
  return cached.map;
}

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
  map=navigationMap(map);
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  const maxParts=shipPartMax(ship);const propulsion=(ship.shipParts?.rigging ?? maxParts.rigging)/maxParts.rigging;
  if(propulsion<=0){motion.speed=0;return;}
  const limits=shipMotionLimits(ship);
  const turn=perTick(limits.turnRate);
  const acceleration=perTick(limits.acceleration);
  const start={x:ship.x,y:ship.y,heading:motion.heading};
  let aim:Point,desired:number;
  const replan=(allowCruise=true)=>{
    const traffic=shipTraffic(ship,units),contact=point.heading===undefined ? shipContactGoal(ship,point,units) : undefined;
    const {points,partial}=planShipRoute(map,ship,contact ?? point,traffic,traffic.hasTraffic?512:Infinity);
    motion.route={goalX:point.x,goalY:point.y,points,end:points.at(-1)??{x:ship.x,y:ship.y},trafficKey:shipTrafficKey(ship,units),partial,startX:ship.x,startY:ship.y,startHeading:motion.heading,
      ...(point.heading===undefined && !contact ? {cruise:allowCruise} : {})};
  };
  {
    const movedGoal = motion.route && Math.hypot(motion.route.goalX-point.x,motion.route.goalY-point.y);
    if(!motion.route || movedGoal!>map.terrain!.cell/2 || !motion.route.points.length && movedGoal!>1) {
      replan();
    }
    const route=motion.route!;
    while(route.points.length && Math.hypot(ship.x-route.points[0]!.x,ship.y-route.points[0]!.y)<1e-7
      && Math.abs(headingDifference(motion.heading,route.points[0]!.heading))<1e-7){
      const passed=route.points.shift()!;route.legX=passed.x;route.legY=passed.y;
      if(route.cruise===false)route.cruise=true;
    }
    if(route.cruise && route.points.length){
      const cruise=followShipRoute(ship,map,units,pace);
      if(cruise===true)return;
      // An existing reverse/pivot route is already exact and validated. Only
      // a blocked cruise sweep needs a new route from its actual pose.
      if(cruise==='maneuver')route.cruise=false;
      else replan(false);
      // A completed safe leg can retry cruise after a temporary obstruction.
      motion.speed=0;
    }
    const active=motion.route!;
    const next=active.points[0];
    if(!next){motion.speed=0;if(active.trafficKey!==shipTrafficKey(ship,units) || active.partial && (Math.hypot(ship.x-active.startX!,ship.y-active.startY!)>1 || Math.abs(headingDifference(active.startHeading!,motion.heading))>.001))motion.route=undefined;return;}
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
  }
  const difference=headingDifference(motion.heading,desired);
  const heading=motion.heading+Math.max(-turn,Math.min(turn,difference));
  const turned={...start,heading};
  if(!advanceShip(ship,map,units,{yaw:heading-start.heading})){motion.speed=0;motion.route=undefined;return;}
  // Turns happen in water wide enough for the swept hull; a narrow channel is traversed along its axis.
  if(Math.abs(difference)>turn+1e-7){motion.speed=0;return;}
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
  const detour=aim;
  const dx=detour.x-ship.x,dy=detour.y-ship.y,gap=Math.hypot(dx,dy);
  if(gap===0){motion.speed=0;return;}
  const alignment=(dx*detCos(heading)+dy*detSin(heading))/gap;
  const travelSpeed=alignment>=0 ? limits.speed : limits.reverseSpeed;
  if(Math.abs(dx*detSin(heading)-dy*detCos(heading))>1e-5){motion.speed=0;motion.route=undefined;return;}
  const targetSpeed=travelSpeed*pace;
  motion.speed+=Math.max(-acceleration,Math.min(acceleration,targetSpeed-motion.speed));
  const step=Math.min(gap,perTick(motion.speed));
  if(!advanceShip(ship,map,units,{surge:step*(alignment<0?-1:1),spentYaw:Math.abs(heading-start.heading)})){motion.speed=0;motion.route=undefined;}
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
