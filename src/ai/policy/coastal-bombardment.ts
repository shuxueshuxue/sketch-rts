import {coastalFireDisks,coastalFireSegmentClear,coastalVoyagePrefixSafe,planCoastalVoyage,type CoastalVoyage} from './coastal-voyage';
import {distance} from './spatial';
import {shoreFiringStation} from '../../shared/shore-fire';
import {walkingDistance} from '../../shared/terrain';
import type {ShipPose} from '../../shared/ship-navigation';
import {validShipPlanningJob} from '../../shared/ship-planning-job';
import type {Building,GameSnapshot,Unit} from '../../shared/types';
import {outmatchingCoast} from './coastal-risk';
import type {AiPolicyContext} from './types';

type CoastalPlan=ShipPose & {target:Building|Unit;voyage?:CoastalVoyage};
/** Keep the published ordinary-move identity through a safe native prefix or
 * the native planner's own live job/FIFO wait. Waiting owns no movement proof:
 * a later installed prefix must still pass the fire-safety check. */
export function continuingCoastalVoyage(snapshot:GameSnapshot,ship:Unit,options:AiPolicyContext) {
 const current=options.memory.naval?.coastalVoyages?.[ship.id];
 if(!current || ship.order.type!=='move' || distance(ship.order,current.waypoint)>=1)return;
 if(!snapshot.units.some(target=>target.id===current.targetId && target.hp>0)
  && !snapshot.buildings.some(target=>target.id===current.targetId && target.hp>0))return;
 const motion=ship.sailing;
 if(motion?.route?.points.length)return coastalVoyagePrefixSafe(snapshot,ship,motion.route,options) ? current : undefined;
 const validTick=(tick:number|undefined):tick is number=>tick!==undefined && Number.isSafeInteger(tick) && tick>=0 && tick<=snapshot.tick;
 if(motion?.planningJob){
  const last=motion.planningJobLastRequestedAtTick;
  return validTick(last) && last>=snapshot.tick-1 && validShipPlanningJob(ship,current.waypoint,snapshot.map) ? current : undefined;
 }
 const requested=motion?.planningRequestedAtTick,last=motion?.planningLastRequestedAtTick ?? requested;
 return validTick(requested) && validTick(last) && last>=requested && last>=snapshot.tick-1 ? current : undefined;
}
function continuingWaypoint(snapshot:GameSnapshot,ship:Unit,plan:CoastalPlan,options:AiPolicyContext) {
 const current=continuingCoastalVoyage(snapshot,ship,options);
 return current && current.targetId===plan.target.id && distance(current.goal,plan)<70 ? current.waypoint : undefined;
}

/** Compare firing stations by sea road, but admit only a currently usable
 * shot or an actual safe native voyage query. A static coast alone must not
 * retain a failed objective while other legitimate targets can be reached. */
export function coastalBombardment(snapshot:GameSnapshot,ship:Unit,targets:readonly (Building|Unit)[],options:AiPolicyContext):CoastalPlan|undefined {
 const disks=coastalFireDisks(snapshot,ship,options);
 const firingPlan=(target:Building|Unit):CoastalPlan|undefined=>{
  const station=shoreFiringStation(snapshot,ship,target);
  return station && coastalFireSegmentClear(station,station,disks) && !outmatchingCoast(snapshot,ship.owner,ship,station,options).length ? {...station,target} : undefined;
 };
 const reachable=(plan:CoastalPlan):CoastalPlan|undefined=>{
  if(distance(ship,plan)<1e-5 || continuingWaypoint(snapshot,ship,plan,options))return plan;
  const voyage=planCoastalVoyage(snapshot,ship,plan,options);
  return voyage ? {...plan,voyage} : undefined;
 };
 const continuingTarget=continuingCoastalVoyage(snapshot,ship,options)?.targetId;
 const current=targets.find(target=>target.id===(continuingTarget ?? options.memory.naval?.combat?.[ship.id]?.targetId));
 const retained=current && firingPlan(current);
 const continuing=retained && reachable(retained);
 if(continuing)return continuing;
 const candidates=targets.filter(target=>target!==current).flatMap(target=>{
  const plan=firingPlan(target),road=plan && walkingDistance(snapshot.map,ship,plan,'sea');
  return plan && road!==undefined ? [{plan,road}] : [];
 }).sort((a,b)=>a.road-b.road);
 for(const {plan}of candidates){const chosen=reachable(plan);if(chosen)return chosen;}
 return undefined;
}

/** Keep the ordinary helm's safe intermediate mark through JSON policy saves.
 * Re-query if physical traffic chose another corridor or observed fire moved.
 * A failed search leaves the battery waiting. A native incremental departure
 * is explicitly a finite prefix proof and is checked again before later
 * replans may execute; it is never recorded as a completed voyage. */
export function coastalBatteryWaypoint(snapshot:GameSnapshot,ship:Unit,plan:NonNullable<ReturnType<typeof coastalBombardment>>,options:AiPolicyContext) {
 const voyages=(options.memory.naval ??= {}).coastalVoyages ??= {};
 const current=continuingWaypoint(snapshot,ship,plan,options);
 if(current)return current;
 const voyage=plan.voyage ?? planCoastalVoyage(snapshot,ship,{x:plan.x,y:plan.y},options);
 if(!voyage){delete voyages[ship.id];return;}
 voyages[ship.id]={targetId:plan.target.id,goal:{x:plan.x,y:plan.y},waypoint: voyage.waypoint,proof:voyage.proof};
 return voyage.waypoint;
}
