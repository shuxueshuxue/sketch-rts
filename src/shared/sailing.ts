import { detCos, detSin } from "./det-math";
import { localToWorld, shipPassengers, shipProfile, type Point } from "./ship-geometry";
import { isWalkable, openStep, steerPoint, walkableGoal } from "./terrain";
import { perTick } from "./time";
import type { GameMap, Unit } from "./types";

/** Rates are distance/s, distance/s² and radians/s; loading affects propulsion and steering. */
export function sailToward(ship:Unit,point:Point,map:GameMap,units:readonly Unit[],pace=1) {
  const profile=shipProfile(ship)!;
  const goal=!map.terrain || isWalkable(map,point.x,point.y,"sea") ? point : walkableGoal(map,point.x,point.y,"sea");
  const aim=map.terrain ? steerPoint(map,ship,goal,"sea") : goal;
  const dx=aim.x-ship.x,dy=aim.y-ship.y,gap=Math.hypot(dx,dy);
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  if(gap===0){motion.speed=0;return;}
  const desired=Math.round(Math.atan2(dy,dx)*1e9)/1e9;
  const difference=((desired-motion.heading+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  const load=motion.load/profile.loadCapacity;
  const turn=perTick(profile.turnRate/(1+.35*load+.25*motion.balance));
  motion.heading+=Math.max(-turn,Math.min(turn,difference));
  motion.heading=((motion.heading+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  const targetSpeed=ship.speed*pace/(1+.2*load)*Math.max(.08,detCos(difference));
  const acceleration=perTick(profile.acceleration/(1+.4*load));
  motion.speed+=Math.max(-acceleration,Math.min(acceleration,targetSpeed-motion.speed));
  const step=Math.min(gap,perTick(motion.speed));
  const next={x:ship.x+detCos(motion.heading)*step,y:ship.y+detSin(motion.heading)*step};
  const at=openStep(map,ship,{x:Math.max(0,Math.min(map.width,next.x)),y:Math.max(0,Math.min(map.height,next.y))},"sea");
  if(at.x===ship.x && at.y===ship.y)motion.speed=0;
  ship.x=at.x;ship.y=at.y;
  for(const passenger of shipPassengers(units,ship))Object.assign(passenger,localToWorld(ship,passenger.deck!));
}
