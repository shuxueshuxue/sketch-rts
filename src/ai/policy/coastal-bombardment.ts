import {coastalFireDisks,coastalFireSegmentClear,coastalVoyagePrefixSafe,planCoastalVoyage} from './coastal-voyage';
import {distance} from './spatial';
import {shoreFiringStation} from '../../shared/shore-fire';
import {nearestByRoute} from '../../shared/route-selection';
import type {NavalPlanMemory} from '../memory';
import type {Building,GameCommand,GameSnapshot,Unit} from '../../shared/types';
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

/** A published ordinary leg remains this battery's task while the native
 * mover is executing it. Being inside the combat radius is not arrival.
 * A changed target, incompatible station, or another public order releases
 * this ownership; route safety is still checked by the normal waypoint path. */
export function coastalBatteryMovePending(ship:Unit,plan:NonNullable<ReturnType<typeof coastalBombardment>>,options:AiPolicyContext): boolean {
 const current=options.memory.naval?.coastalVoyages?.[ship.id];
 return !!current && current.targetId===plan.target.id && distance(current.goal,plan)<70
  && ship.order.type==='move' && !!ship.order.avoidCombat && distance(ship.order,current.waypoint)<1;
}

/** Keep the ordinary helm's safe intermediate mark through JSON policy saves.
 * Re-query if physical traffic chose another corridor or observed fire moved.
 * A failed search leaves the battery waiting. A native incremental departure
 * is explicitly a finite prefix proof and is checked again before later
 * replans may execute; it is never recorded as a completed voyage. */
export function coastalBatteryWaypoint(snapshot:GameSnapshot,ship:Unit,plan:NonNullable<ReturnType<typeof coastalBombardment>>,options:AiPolicyContext) {
 const voyages=(options.memory.naval ??= {}).coastalVoyages ??= {};
 const current=voyages[ship.id];
 if(current && coastalBatteryMovePending(ship,plan,options)
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

/** A selected coastal building is a deliberate battery objective. Let the
 * ordinary native attack retain that target and find a physical firing pose;
 * a coordinate attack-move may acquire unrelated units before its first shot.
 * This publishes no heading or queried route, and makes no firing guarantee. */
export function coastalBatteryAttackCommand(ship:Unit,target:Building,memory:NavalPlanMemory):GameCommand | undefined {
 memory.combat![ship.id]!.commandTargetId=target.id;
 if(ship.order.type==='attack' && ship.order.targetId===target.id)return;
 return {type:'attack',unitIds:[ship.id],targetId:target.id};
}
