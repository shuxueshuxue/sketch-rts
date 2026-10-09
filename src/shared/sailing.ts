import { shipPartMax } from "./ship-equipment";
import { reservationTraffic, shipContactGoal, shipTraffic, shipTrafficKey } from "./ship-avoidance";
import { detCos, detSin } from "./det-math";
import { shipsIn, shipProfile, type Point } from "./ship-geometry";
import { headingDifference, hullFits, hullPassageClear, nearestShipPose, planShipRoute, planVoyageRoute, planBeatDeparture, shipPoseAt, shipTackRoute } from "./ship-navigation";
import { perTick, SIM_TICKS_PER_SECOND } from "./time";
import type { GameMap, Unit } from "./types";
import { advanceShip, shipMotionLimits } from './ship-motion';
import { followShipRoute } from './ship-guidance';
import { coursePerformance } from './ship-wind';
import { windAt } from './wind-field';
import { tryAdmitShipPlan } from './ship-planning-budget';
import { isStaggered } from './push';

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
  if(map.wind)cached.map.wind=map.wind;else delete cached.map.wind;
  return cached.map;
}

/** A hull and all its passengers rotate continuously, in radians per second. */
export function turnShipToward(ship:Unit,desired:number,map:GameMap,units:readonly Unit[],spentTurn=0){
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  const limit=Math.max(0,perTick(shipMotionLimits(ship).turnRate)-spentTurn);
  const difference=headingDifference(motion.heading,desired),heading=motion.heading+Math.max(-limit,Math.min(limit,difference));
  const before={x:ship.x,y:ship.y,heading:motion.heading};
  if(motion.sail && Math.abs(difference)>1e-7)motion.sail.mode=windAt(map,ship).speed>0?'maneuver':'calm-assist';
  if(!advanceShip(ship,map,units,{yaw:heading-before.heading,spentYaw:spentTurn}))return false;
  return Math.abs(difference)<=limit+1e-7;
}

export type ShipCourseGoal = Point & {
  heading?: number;
  intent?: 'pursuit';
  targetId?: string;
  arrivalRadius?: number;
  targetSpeed?: number;
  fireHeading?: number;
  retreat?: boolean;
};

/** A voyage owns its corridor and helm until a meaningful change needs a new
 * course. Tracking a vessel does not implicitly request a contact berth. */
export function sailToward(ship:Unit,point:ShipCourseGoal,map:GameMap,units:readonly Unit[],pace=1) {
  map=navigationMap(map);
  const motion=ship.sailing??={heading:0,speed:0,load:0,balance:0};
  const maxParts=shipPartMax(ship);const propulsion=(ship.shipParts?.rigging ?? maxParts.rigging)/maxParts.rigging;
  if(propulsion<=0){motion.speed=0;return;}
  const limits=shipMotionLimits(ship),wind=windAt(map,ship);
  const turn=perTick(limits.turnRate);
  const acceleration=perTick(limits.acceleration);
  const start={x:ship.x,y:ship.y,heading:motion.heading};
  let aim:Point,desired:number;
  const length=shipProfile(ship)!.length;
  const voyageCompanion=(other:Unit,bearing:number,windPlan=false)=>{
    if(ship.order.type!=='move' || ship.order.heading!==undefined || ship.order.rendezvousFor!==undefined
      || point.intent!==undefined || point.heading!==undefined || other===ship || other.owner!==ship.owner
      || other.order.type!=='move' || other.order.heading!==undefined || other.order.rendezvousFor!==undefined || !other.sailing)return false;
    if((other.shipParts?.rigging ?? shipPartMax(other).rigging)<=0 || other.sailing.route?.cruise===false)return false;
    const onward=Math.atan2(other.order.y-other.y,other.order.x-other.x);
    const otherLength=shipProfile(other)?.length ?? length;
    const remaining=Math.hypot(other.order.x-other.x,other.order.y-other.y);
    const clearFinish=Math.hypot(other.order.x-point.x,other.order.y-point.y)>(length+otherLength)*.5;
    return remaining>1 && (remaining>otherLength || clearFinish)
      && Math.abs(headingDifference(bearing,onward))<=Math.PI/6
      && (windPlan || Math.abs(headingDifference(other.sailing.heading,onward))<=Math.PI/6);
  };
  const contactGoal=()=>{
    const bearing=Math.atan2(point.y-ship.y,point.x-ship.x);
    // A passing companion occupying our eventual destination is not a
    // requested berth. Its current footprint must not become a permanent
    // replacement for the player's destination.
    return shipContactGoal(ship,point,units.filter(other=>!voyageCompanion(other,bearing)));
  };
  const replan=(allowCruise=true,planned?:ReturnType<typeof planVoyageRoute>)=>{
    const previous=motion.route;
    const tackHeading=point.intent==='pursuit' && previous?.windKey===wind.key ? previous.points.find(point=>point.tack && !point.curvature)?.heading : undefined;
    const contact=point.intent!=='pursuit' && point.heading===undefined && Math.hypot(point.x-ship.x,point.y-ship.y)<length*2
      ? contactGoal() : undefined;
    const precision=point.heading!==undefined || !!contact;
    // Moving companions are local passing traffic, not permanent islands.
    // Freezing an entire convoy into the strategic coast search can exhaust
    // its budget on retreat corners instead of finding the water corridor.
    // The helmsman and physical sweep still check every live hull each step.
    const bearing=Math.atan2(point.y-ship.y,point.x-ship.x);
    const coastalVoyage=allowCruise && !precision && point.intent===undefined && ship.order.type==='move' && ship.order.rendezvousFor===undefined
      && !hullPassageClear(map,ship,{...start,heading:bearing},{...point,heading:bearing});
    const companions=allowCruise && !precision && point.intent===undefined && ship.order.type==='move'
      && ship.order.rendezvousFor===undefined;
    const alignedDeparture=companions && !previous && !ship.orderQueue?.length
      && Math.abs(headingDifference(start.heading,bearing))<1e-7;
    const strategicUnits=companions ? units.filter(other=>{
      if(other===ship || other.owner!==ship.owner || other.order.type!=='move'
        || other.order.heading!==undefined || other.order.rendezvousFor!==undefined || !other.sailing)return true;
      if((other.shipParts?.rigging ?? shipPartMax(other).rigging)<=0)return true;
      if(coastalVoyage)return false;
      // A parallel convoy follows an underway leader instead of navigating
      // around a frozen copy of its stern. Real headway and every physical
      // sweep still include that hull; disabled or docking vessels stay fixed.
      const leader=other.sailing.route;
      if(alignedDeparture && leader?.cruise===true && !leader.intent && !other.orderQueue?.length
        && leader.goalX===other.order.x && leader.goalY===other.order.y && leader.points.length
        && shipMotionLimits(other).speed>0 && shipMotionLimits(other).turnRate>0 && !isStaggered(other)
        && !other.effects.some(effect=>effect.remaining>0 && (effect.type==='stun'||effect.type==='root'))
        && Math.abs(headingDifference(bearing,other.sailing.heading))<Math.PI/12
        && Math.abs(headingDifference(bearing,Math.atan2(other.order.y-other.y,other.order.x-other.x)))<Math.PI/12
        && Math.hypot(other.order.x-other.x,other.order.y-other.y)>(shipProfile(other)?.length??length))return false;
      const companion=shipProfile(other);
      const along=(other.x-ship.x)*detCos(bearing)+(other.y-ship.y)*detSin(bearing);
      const across=Math.abs(-(other.x-ship.x)*detSin(bearing)+(other.y-ship.y)*detCos(bearing));
      // A close departure needs actual maneuvering room before we can treat
      // the leader as a future empty corridor. This uses the enlarged hulls,
      // rather than assuming an arbitrary center-to-center convoy spacing.
      if(companion && along>0 && across<(shipProfile(ship)!.beam+companion.beam)*.5
        && along<(length+companion.length)*.5+Math.max(shipProfile(ship)!.beam,companion.beam)*.5)return true;
      // A companion already sailing the same course will have left its
      // current footprint before we reach it. Keep the sea corridor instead
      // of planning a berth maneuver around a frozen copy of its hull.
      // The local helmsman and every physical sweep still see all ships.
      return !voyageCompanion(other,bearing);
    }) : units;
    const traffic=reservationTraffic(ship,strategicUnits);
    const planner=allowCruise && !precision ? planVoyageRoute : planShipRoute;
    // A nearby firing station requests a soft hull attitude, not an exact
    // berth or a full-speed turning circle. Each control step still sweeps
    // both terrain and live hulls; obstructed approaches keep their corridor.
    const fireCourse=allowCruise && point.fireHeading!==undefined && Math.hypot(point.x-ship.x,point.y-ship.y)<length*3
      && hullPassageClear(map,ship,start,{...point,heading:point.fireHeading});
    const course=coursePerformance(ship,map,bearing,{assumeTrimmed:true});
    const aligned=point.heading===undefined && !precision && !ship.orderQueue?.length
      && Math.abs(headingDifference(start.heading,bearing))<1e-7 && !course.noGo
      && course.targetSpeed>=course.auxiliarySpeed
      && hullPassageClear(map,ship,start,{...point,heading:start.heading}) && traffic(start,{...point,heading:start.heading});
    if(!planned && !fireCourse && !aligned && !tryAdmitShipPlan(ship))return false;
    const {points,partial}=planned ?? (fireCourse ? {points:[{x:point.x,y:point.y,heading:point.fireHeading!}],partial:false}
      : planner(map,ship,contact ?? point,traffic,traffic.hasTraffic?1024:Infinity));
    if(!allowCruise)for(const point of points)point.exact=true;
    motion.route={goalX:point.x,goalY:point.y,points,end:points.at(-1)??{x:ship.x,y:ship.y},trafficKey:shipTrafficKey(ship,units),partial,
      startX:ship.x,startY:ship.y,startHeading:motion.heading,windKey:wind.key,age:0,blockedTicks:0,
      ...(tackHeading!==undefined?{tackHeading}:{}),
      ...(previous?.avoidSide!==undefined?{avoidSide:previous.avoidSide,avoidTicks:previous.avoidTicks??0}:{}),
      ...(previous?.avoidHeading!==undefined?{avoidHeading:previous.avoidHeading}:{}),
      ...(previous?.avoidBaseHeading!==undefined?{avoidBaseHeading:previous.avoidBaseHeading}:{}),
      ...(previous?.avoidTargetId!==undefined?{avoidTargetId:previous.avoidTargetId}:{}),
      ...(point.intent?{intent:point.intent}:{}),...(point.targetId?{targetId:point.targetId}:{}),
      ...(point.arrivalRadius!==undefined?{arrivalRadius:point.arrivalRadius}:{}),
      ...(point.targetSpeed!==undefined?{targetSpeed:point.targetSpeed}:{}),
      ...(point.fireHeading!==undefined?{fireHeading:point.fireHeading}:{}),...(point.retreat?{retreat:true}:{}),
      ...(!precision ? {cruise:allowCruise} : {})};
    delete motion.planningRequestedAtTick;
    delete motion.planningLastRequestedAtTick;
    return true;
  };
  const waitForTraffic=()=>{
    motion.speed=0;
    const route=motion.route;if(!route)return;
    route.blockedTicks=(route.blockedTicks??0)+1;
    // Contact spends momentum, not the route. A passing hull may release the
    // next physical step before another strategic search is useful.
    if(route.blockedTicks>=10 && (route.age??0)>=SIM_TICKS_PER_SECOND)replan(false);
  };
  {
    let route=motion.route;
    const moved=route?Math.hypot(route.goalX-point.x,route.goalY-point.y):Infinity;
    const dynamic=point.intent==='pursuit' && route?.intent==='pursuit' && route.targetId===point.targetId;
    if(route)route.age=(route.age??0)+1;
    const windChange=route?.windKey!==undefined && route.windKey!==wind.key;
    const turningTack=route?.points.some(point=>point.tack) && (coursePerformance(ship,map).noGo || Math.abs(motion.yawRate??0)>.08);
    const due=dynamic ? (route!.age??0)>=(route!.points.some(point=>point.tack)?80:40)
      && moved>length*.8 && !turningTack : moved>map.terrain!.cell/2;
    const enteringBerth=route?.cruise && point.intent!=='pursuit' && point.heading===undefined
      && Math.hypot(point.x-ship.x,point.y-ship.y)<length*2 && !!contactGoal();
    if(!route || windChange || enteringBerth || (route.fireHeading===undefined)!==(point.fireHeading===undefined) || !!route.retreat!==!!point.retreat || route.intent!==point.intent || route.targetId!==point.targetId || due || !route.points.length && (moved>1 || route.partial && route.intent==='pursuit')){
      if(!replan()){
        // A queued replacement does not spend an underway ship's momentum.
        // Keep a live corridor to the same quarry, or its pre-weather route,
        // until its turn arrives. Guidance still checks the current wind,
        // terrain and every hull before each physical movement.
        const sameWindVoyage=!!route && windChange && !due && !enteringBerth && point.heading===undefined
          && route.intent===point.intent && route.targetId===point.targetId;
        if(!route?.points.length || !dynamic && !sameWindVoyage){
          motion.speed=0;
          // A new attack can align its bow while its complex corridor waits.
          // Keep any existing corridor untouched; this finite turn uses the
          // same collision sweep and whole-frame yaw allowance as gunnery.
          if(!route && point.intent==='pursuit' && point.heading===undefined)
            turnShipToward(ship,Math.atan2(point.y-ship.y,point.x-ship.x),map,units);
          return;
        }
      }else route=motion.route!;
    }
    route.windKey??=wind.key;
    if(point.arrivalRadius!==undefined)route.arrivalRadius=point.arrivalRadius;
    if(point.targetSpeed!==undefined)route.targetSpeed=point.targetSpeed;else delete route.targetSpeed;
    if(point.fireHeading!==undefined)route.fireHeading=point.fireHeading;else delete route.fireHeading;
    if(point.retreat)route.retreat=true;else delete route.retreat;
    // On a clear final pursuit leg update the destination without throwing
    // away the helm, speed, side of turn or the strategic route object.
    if(dynamic && route.cruise && route.points.length===1 && !route.points[0]!.tack && !route.points[0]!.pivot && moved<=length*.8){
      const end=route.points[0]!;
      const origin={x:route.legX??route.startX??ship.x,y:route.legY??route.startY??ship.y};
      if(hullFits(map,ship,{x:point.x,y:point.y,heading:Math.atan2(point.y-origin.y,point.x-origin.x)})){
        end.x=point.x;end.y=point.y;end.heading=Math.atan2(point.y-origin.y,point.x-origin.x);
        route.end={x:point.x,y:point.y};route.goalX=point.x;route.goalY=point.y;
      }
    }
    while(route.points.length && Math.hypot(ship.x-route.points[0]!.x,ship.y-route.points[0]!.y)<1e-7
      && Math.abs(headingDifference(motion.heading,route.points[0]!.heading))<1e-7
      && !(route.intent==='pursuit' && motion.pursuit?.moving && !route.partial && route.points.length===1
        && !route.points[0]!.tack && !route.points[0]!.exact && !route.points[0]!.pivot)){
      const passed=route.points.shift()!;route.legX=passed.x;route.legY=passed.y;
      if(route.cruise===false){
        const next=route.points[0];
        route.cruise=!!next && !next.exact && !next.pivot
          && (next.x-ship.x)*detCos(next.heading)+(next.y-ship.y)*detSin(next.heading)>=-1e-7;
      }
    }
    const intermediate=route.partial && route.intent!=='pursuit' && route.cruise && route.points.length===1 ? route.points[0] : undefined;
    if(intermediate && point.heading===undefined && !intermediate.exact && !intermediate.pivot && !intermediate.tack) {
      const origin={x:route.legX??route.startX??ship.x,y:route.legY??route.startY??ship.y};
      const dx=intermediate.x-origin.x,dy=intermediate.y-origin.y,squared=dx*dx+dy*dy;
      // Traffic may carry a hull past a temporary corridor endpoint. That
      // endpoint is not its destination; do not sail a loop to visit it again.
      if(squared>1e-7 && (ship.x-origin.x)*dx+(ship.y-origin.y)*dy>=squared
        && (intermediate.x-ship.x)*detCos(motion.heading)+(intermediate.y-ship.y)*detSin(motion.heading)<0) {
        if(!replan()){motion.speed=0;return;}
        route=motion.route!;
      }
    }
    if(route.cruise===false && point.heading===undefined && route.points.length===1
      && !route.points[0]!.pivot && Math.hypot(point.x-ship.x,point.y-ship.y)>length*2
      && (route.age??0)>=SIM_TICKS_PER_SECOND
      && ((route.age??0)%SIM_TICKS_PER_SECOND===0 || motion.planningRequestedAtTick!==undefined)){
      const traffic=shipTraffic(ship,units);
      if(tryAdmitShipPlan(ship)){
        const recovery=planVoyageRoute(map,ship,point,traffic,traffic.hasTraffic?1024:Infinity);
        delete motion.planningRequestedAtTick;delete motion.planningLastRequestedAtTick;
        if(!recovery.partial && recovery.points.length && recovery.points.every(point=>!point.exact && !point.pivot)){
          replan(true,recovery);route=motion.route!;
        }
      }
    }
    if(route.cruise && route.points.length){
      const movingPursuit=route.intent==='pursuit' && motion.pursuit?.moving;
      const retryWind=route.windTried && (Math.hypot(ship.x-(route.windTryX??route.startX??ship.x),ship.y-(route.windTryY??route.startY??ship.y))>=length*1.5
        || movingPursuit && (route.age??0)%20===0 && route.points.length===1);
      let windLeg:typeof route.points[number]|undefined;
      for(let index=route.points.length-1;index>=0;index--)if(!route.points[index]!.pivot){windLeg=route.points[index];break;}
      const legPerformance=windLeg && coursePerformance(ship,map,Math.atan2(windLeg.y-ship.y,windLeg.x-ship.x),{assumeTrimmed:true});
      const needsWindPlanning=!!legPerformance && !legPerformance.calm && legPerformance.trueWindAngle<legPerformance.beatAngle && legPerformance.maxForwardSpeed>0;
      if(route.fireHeading===undefined && (!route.windTried || retryWind) && !route.points.some(point=>point.tack)
        && (!needsWindPlanning || tryAdmitShipPlan(ship))){
        route.windTried=true;route.windTryX=ship.x;route.windTryY=ship.y;
        delete motion.planningRequestedAtTick;delete motion.planningLastRequestedAtTick;
        // Wind planning works on a useful voyage leg, not every short arc
        // sample used to describe the initial turn.
        let index=route.points.length-1;
        while(index>0 && route.points[index]!.pivot)index--;
        const next=route.points[index];
        if(next && !route.points.slice(0,index+1).some(point=>point.pivot)){
          const bearing=Math.atan2(point.y-ship.y,point.x-ship.x);
          const traffic=shipTraffic(ship,units.filter(other=>!voyageCompanion(other,bearing,true)),Infinity);
          const departure=movingPursuit ? planBeatDeparture(map,ship,next,traffic,route.tackHeading) : undefined;
          const tack=!departure ? shipTackRoute(map,ship,next,traffic,route.tackHeading) : undefined;
          if(departure){
            // A moving interception point can lie too close for a full pair
            // of laylines. Start on a productive beat now and re-evaluate
            // after this finite leg, instead of crawling at the no-go edge.
            route.points=departure;route.end=departure.at(-1)!;route.partial=true;
            route.legX=ship.x;route.legY=ship.y;
          }
          if(tack){
            const finish=tack.at(-1)!;
            const reaches=Math.hypot(finish.x-next.x,finish.y-next.y)<1;
            if(reaches)route.points.splice(0,index+1,...tack);
            else {
              // A bounded tack replaces the old departure, too. Reusing its
              // original turn arc would send us back to where we set sail.
              const onward={...ship,x:finish.x,y:finish.y,sailing:{...motion,heading:finish.heading}};
              const suffix=planVoyageRoute(map,onward,{x:next.x,y:next.y},shipTraffic(onward,units.filter(unit=>unit!==ship),Infinity),1024);
              route.points.splice(0,index+1,...tack,...suffix.points);
              route.partial ||= suffix.partial;
              route.end=route.points.at(-1)??finish;
            }
            route.legX=ship.x;route.legY=ship.y;
          }
        }
      }
      const cruise=followShipRoute(ship,map,units,pace);
      if(cruise===true){route.blockedTicks=0;return;}
      if(cruise==='maneuver'){
        const first=route.points[0],turned=first && {...start,heading:first.heading};
        const traffic=shipTraffic(ship,units);
        if(first?.exact && !first.pivot && turned && hullPassageClear(map,ship,start,turned)
          && hullPassageClear(map,ship,turned,first) && traffic(start,turned) && traffic(turned,first))route.cruise=false;
        else if(!replan(false)){motion.speed=0;return;}
        motion.yawRate=0;
      }
      else {
        route.blockedTicks=(route.blockedTicks??0)+1;
        // Traffic gets time to clear. Only sustained lack of a safe forward
        // step changes the corridor; never alternate executors every tick.
        if(route.blockedTicks>=10 && (route.age??0)>=20)replan(false);
        return;
      }
    }
    const active=motion.route!;
    const performance=coursePerformance(ship,map);
    if(motion.sail)motion.sail.mode=performance.calm?'calm-assist':'maneuver';
    const next=active.points[0];
    if(!next){
      motion.speed=0;if(motion.sail)motion.sail.mode='idle';
      // A moving neighbor changes the traffic key several times a second.
      // An empty partial search retains its failed corridor for one second;
      // wind and command changes are still admitted immediately above.
      if((active.age??0)>=SIM_TICKS_PER_SECOND && (active.age??0)%SIM_TICKS_PER_SECOND===0
        && (active.trafficKey!==shipTrafficKey(ship,units) || active.partial && (Math.hypot(ship.x-active.startX!,ship.y-active.startY!)>1 || Math.abs(headingDifference(active.startHeading!,motion.heading))>.001)))motion.route=undefined;
      return;
    }
    if(next.pivot){
      const difference=headingDifference(start.heading,next.heading),lever=Math.hypot(ship.x-next.pivot.x,ship.y-next.pivot.y);
      const targetSpeed=Math.min(performance.auxiliarySpeed*pace,lever*turn*SIM_TICKS_PER_SECOND);
      motion.speed=Math.min(targetSpeed,motion.speed+acceleration);
      const angle=Math.min(Math.abs(difference),turn,lever ? perTick(motion.speed)/lever : turn);
      const at=shipPoseAt(start,next,Math.abs(difference)>1e-7?angle/Math.abs(difference):1);
      const leverSigned=(ship.x-next.pivot.x)*detCos(start.heading)+(ship.y-next.pivot.y)*detSin(start.heading);
      if(!advanceShip(ship,map,units,{yaw:headingDifference(start.heading,at.heading),pivotLever:leverSigned}))waitForTraffic();
      else {motion.speed=lever*Math.abs(headingDifference(start.heading,motion.heading))*SIM_TICKS_PER_SECOND;active.blockedTicks=0;}
      return;
    }
    aim=next;desired=next.heading;
  }
  const difference=headingDifference(motion.heading,desired);
  const heading=motion.heading+Math.max(-turn,Math.min(turn,difference));
  const turned={...start,heading};
  if(!advanceShip(ship,map,units,{yaw:heading-start.heading})){waitForTraffic();return;}
  // Turns happen in water wide enough for the swept hull; a narrow channel is traversed along its axis.
  if(Math.abs(difference)>turn+1e-7){motion.speed=0;if(motion.route)motion.route.blockedTicks=0;return;}
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
  const course=coursePerformance(ship,map,heading,{assumeTrimmed:true});
  // Exact geometry is also used for a distant occupied deck. Sail the clear
  // approach; auxiliary speed is for the final berth, astern and weak courses.
  const approach=alignment>=0 && course.targetSpeed>=course.auxiliarySpeed;
  if(motion.sail)motion.sail.mode=course.calm?'calm-assist':approach?'sail':'maneuver';
  const drive=approach?coursePerformance(ship,map,heading).targetSpeed:course.auxiliarySpeed;
  const travelSpeed=alignment>=0 ? drive : Math.min(limits.reverseSpeed,drive);
  if(Math.abs(dx*detSin(heading)-dy*detCos(heading))>1e-5){motion.speed=0;motion.route=undefined;return;}
  const targetSpeed=Math.min(travelSpeed*pace,Math.sqrt(2*limits.acceleration*gap));
  const alongVelocity=(motion.velocityX??0)*detCos(heading)+(motion.velocityY??0)*detSin(heading);
  const direction=alignment<0?-1:1;
  // speed is a magnitude. It must not turn saved forward momentum into an
  // instant astern impulse (or vice versa) when a precise berth reverses.
  if(alongVelocity*direction<-1e-7){motion.speed=0;return;}
  motion.speed+=Math.max(-acceleration,Math.min(acceleration,targetSpeed-motion.speed));
  if(direction<0)motion.speed=Math.min(motion.speed,targetSpeed);
  const step=Math.min(gap,perTick(motion.speed));
  if(!advanceShip(ship,map,units,{surge:step*direction,spentYaw:Math.abs(heading-start.heading)}))waitForTraffic();
  else {if(direction<0)motion.speed=Math.hypot(ship.x-start.x,ship.y-start.y)*SIM_TICKS_PER_SECOND;if(motion.route)motion.route.blockedTicks=0;}
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
