import { detCos, detSin } from "./det-math";
import { localToWorld, shipPassengers, shipProfile, type Point } from "./ship-geometry";
import { headingDifference, hullFits, hullPassageClear, nearestShipPose, shipRoute } from "./ship-navigation";
import { perTick } from "./time";
import type { GameMap, Unit } from "./types";

/** Rates are distance/s, distance/s² and radians/s; loading affects propulsion and steering. */
export function sailToward(ship:Unit,point:Point,map:GameMap,units:readonly Unit[],pace=1) {
  const profile=shipProfile(ship)!;
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  const load=motion.load/profile.loadCapacity;
  const turn=perTick(profile.turnRate/(1+.35*load+.25*motion.balance));
  const acceleration=perTick(profile.acceleration/(1+.4*load));
  const start={x:ship.x,y:ship.y,heading:motion.heading};
  let aim:Point,desired:number;
  if(map.terrain) {
    if(!motion.route || motion.route.goalX!==point.x || motion.route.goalY!==point.y) {
      const points=shipRoute(map,ship,point);
      motion.route={goalX:point.x,goalY:point.y,points,end:points.at(-1)??{x:ship.x,y:ship.y}};
    }
    while(motion.route.points.length && Math.hypot(ship.x-motion.route.points[0]!.x,ship.y-motion.route.points[0]!.y)<1e-7
      && Math.abs(headingDifference(motion.heading,motion.route.points[0]!.heading))<1e-7)motion.route.points.shift();
    const next=motion.route.points[0];
    if(!next){motion.speed=0;return;}
    aim=next;desired=next.heading;
  } else {
    aim=nearestShipPose(map,ship,point)??ship;
    desired=Math.round(Math.atan2(aim.y-ship.y,aim.x-ship.x)*1e9)/1e9;
  }
  const difference=headingDifference(motion.heading,desired);
  const heading=motion.heading+Math.max(-turn,Math.min(turn,difference));
  const turned={...start,heading};
  if(!hullPassageClear(map,ship,start,turned)){motion.speed=0;motion.route=undefined;return;}
  motion.heading=heading;
  const dx=aim.x-ship.x,dy=aim.y-ship.y,gap=Math.hypot(dx,dy);
  // Turns happen in water wide enough for the swept hull; a narrow channel is traversed along its axis.
  if(map.terrain && Math.abs(difference)>turn+1e-7){motion.speed=0;return;}
  if(gap===0){motion.speed=0;return;}
  const alignment=(dx*detCos(heading)+dy*detSin(heading))/gap;
  const dockingPace=alignment>=0 ? .35+.65*alignment : .35-.3*alignment;
  const targetSpeed=ship.speed*pace/(1+.2*load)*(map.terrain ? dockingPace : Math.max(.08,detCos(difference)));
  motion.speed+=Math.max(-acceleration,Math.min(acceleration,targetSpeed-motion.speed));
  const step=Math.min(gap,perTick(motion.speed));
  const next=map.terrain ? {x:ship.x+dx*step/gap,y:ship.y+dy*step/gap,heading} : {x:ship.x+detCos(heading)*step,y:ship.y+detSin(heading)*step,heading};
  if(hullPassageClear(map,ship,turned,next)){ship.x=next.x;ship.y=next.y;}
  else {motion.speed=0;motion.route=undefined;}
  for(const passenger of shipPassengers(units,ship))Object.assign(passenger,localToWorld(ship,passenger.deck!));
}

/** Old authored placements may put a larger new hull across a coast. Normal motion stays continuous. */
export function keepShipsOnWater(map:GameMap,units:readonly Unit[]) {
  for(const ship of units)if(shipProfile(ship) && !hullFits(map,ship)) {
    const pose=nearestShipPose(map,ship,ship);
    if(!pose)continue;
    Object.assign(ship,{x:pose.x,y:pose.y});
    ship.sailing??={heading:pose.heading,speed:0,load:0,balance:0};
    ship.sailing.heading=pose.heading;ship.sailing.speed=0;ship.sailing.route=undefined;
  }
}
