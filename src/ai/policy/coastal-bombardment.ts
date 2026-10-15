import {coastalFireDisks,coastalFireSegmentClear,coastalVoyagePrefixSafe,planCoastalVoyage} from './coastal-voyage';
import {distance} from './spatial';
import {shoreFiringStation} from '../../shared/shore-fire';
import {nearestByRoute} from '../../shared/route-selection';
import type {Building,GameSnapshot,Unit} from '../../shared/types';
import {outmatchingCoast} from './coastal-risk';
import type {AiPolicyContext} from './types';

/** A battery can approach an exposed side of the enemy coast before that
 * building enters local acquisition range. Rank actual sea roads; ordinary
 * sailing still owns hull clearance and the physical voyage. */
export function coastalBombardment(snapshot:GameSnapshot,ship:Unit,targets:readonly Building[],options:AiPolicyContext) {
 const disks=coastalFireDisks(snapshot,ship,options);
 const firingPlan=(target:Building)=>{
  const station=shoreFiringStation(snapshot,ship,target);
  return station && coastalFireSegmentClear(station,station,disks) && !outmatchingCoast(snapshot,ship.owner,ship,station,options).length ? {...station,target} : undefined;
 };
 const current=targets.find(target=>target.id===options.memory.naval?.combat?.[ship.id]?.targetId);
 const retained=current && firingPlan(current);
 if(retained)return retained;
 const candidates=targets.filter(target=>target!==current).flatMap(target=>{
  const plan=firingPlan(target);
  return plan ? [plan] : [];
 });
 return nearestByRoute(snapshot.map,candidates,ship,'sea');
}

/** Keep the ordinary helm's safe intermediate mark through JSON policy saves.
 * Re-query if physical traffic chose another corridor or observed fire moved.
 * A failed search leaves the battery waiting. A native incremental departure
 * is explicitly a finite prefix proof and is checked again before later
 * replans may execute; it is never recorded as a completed voyage. */
export function coastalBatteryWaypoint(snapshot:GameSnapshot,ship:Unit,plan:NonNullable<ReturnType<typeof coastalBombardment>>,options:AiPolicyContext) {
 const voyages=(options.memory.naval ??= {}).coastalVoyages ??= {};
 const current=voyages[ship.id];
 if(current && current.targetId===plan.target.id && distance(current.goal,plan)<70
  && ship.order.type==='move' && distance(ship.order,current.waypoint)<1
  && coastalVoyagePrefixSafe(snapshot,ship,ship.sailing?.route,options)){
  // This records the original tactical query's proof. A later native route
  // flag alone cannot upgrade a finite departure into a completed reference.
  return current.waypoint;
 }
 const voyage=planCoastalVoyage(snapshot,ship,{x:plan.x,y:plan.y},options);
 if(!voyage){delete voyages[ship.id];return;}
 voyages[ship.id]={targetId:plan.target.id,goal:{x:plan.x,y:plan.y},waypoint: voyage.waypoint,proof:voyage.proof};
 return voyage.waypoint;
}
