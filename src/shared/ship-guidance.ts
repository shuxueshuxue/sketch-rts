import { detCos, detSin } from './det-math';
import { avoidanceCourse, shipTraffic } from './ship-avoidance';
import { shipProfile } from './ship-geometry';
import { shipMotionLimits } from './ship-handling';
import { advanceShip } from './ship-motion';
import { headingDifference, hullPassageClear, type ShipPose } from './ship-navigation';
import { coursePerformance } from './ship-wind';
import { perTick, SIM_TICKS_PER_SECOND } from './time';
import type { GameMap, Unit } from './types';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The voyage helmsman tracks a continuous reference with forward motion.
 * Waypoints describe water to pass through; only the final destination stops
 * the boat. Berths and intentional astern/pivot movements have their own executor. */
export function followShipRoute(ship: Unit, map: GameMap, units: readonly Unit[], pace: number): boolean | 'maneuver' {
  const motion = ship.sailing!, route = motion.route!, points = route.points;
  const limits = shipMotionLimits(ship), profile = shipProfile(ship)!;
  let origin = { x: route.legX ?? route.startX ?? ship.x, y: route.legY ?? route.startY ?? ship.y };
  const lookahead = clamp(motion.speed * 2.2, profile.length * .55, profile.length * 1.15);
  // Keep a short reversing leg or a contact-point turn exact. A later maneuver
  // does not prevent ordinary sailing on the entire approach to it.
  const firing=route.fireHeading!==undefined && points.length===1 && !points[0]!.exact && !points[0]!.pivot;
  const isManeuver = (point: ShipPose, from: {x:number;y:number}) => point.exact || point.pivot || !firing &&
    (point.x-from.x)*detCos(point.heading)+(point.y-from.y)*detSin(point.heading)<-1e-5;
  const precisionIndex=points.findIndex((point,index)=>Boolean(isManeuver(point,index?points[index-1]!:origin)));
  if(precisionIndex>=0 && (precisionIndex===0 || Math.hypot(ship.x-points[precisionIndex-1]!.x,ship.y-points[precisionIndex-1]!.y)<profile.length*1.5))return 'maneuver';
  while (points.length > 1) {
    const first = points[0]!, next = points[1]!;
    if (isManeuver(first, origin)) return 'maneuver';
    const dx = first.x-origin.x, dy = first.y-origin.y, squared = dx*dx+dy*dy;
    const along = squared ? ((ship.x-origin.x)*dx+(ship.y-origin.y)*dy)/squared : 1;
    const gap = Math.hypot(ship.x-first.x,ship.y-first.y);
    const nextDx=next.x-first.x,nextDy=next.y-first.y,nextLength=Math.hypot(nextDx,nextDy);
    const onNext=nextLength ? ((ship.x-first.x)*nextDx+(ship.y-first.y)*nextDy)/nextLength : -Infinity;
    // Advance along each tangent/arc segment without cutting its turn early.
    const turnGate=Math.min(3,lookahead*.025);
    if (squared>1e-10 && gap>turnGate && along<1 && !(first.curvature===undefined && onNext>0 && gap<lookahead)) break;
    const passed=points.shift()!;
    if(passed.queuedTurn)route.queuedPassed=true;
    origin=passed;route.legX=origin.x;route.legY=origin.y;
  }
  const last=points.at(-1);
  if (!last) { motion.speed=0;motion.yawRate=0;return true; }
  if (isManeuver(points[0]!,origin)) return 'maneuver';
  const endGap=Math.hypot(last.x-ship.x,last.y-ship.y);
  const arrival=route.arrivalRadius ?? .3;
  if(!firing && points.length===1 && endGap<=arrival){
    if(route.intent!=='pursuit'){points.length=0;motion.speed=0;motion.yawRate=0;}
    else {
      motion.yawRate=0;
      if(route.partial || last.tack)points.length=0;
    }
    return true;
  }
  const first=points[0]!, dx=first.x-origin.x,dy=first.y-origin.y,squared=dx*dx+dy*dy;
  const projection=squared?clamp(((ship.x-origin.x)*dx+(ship.y-origin.y)*dy)/squared,0,1):1;
  let carrot={x:origin.x+dx*projection,y:origin.y+dy*projection},remaining=lookahead;
  let previous=origin;
  for(const next of points){
    if(isManeuver(next,previous))break;
    const gap=Math.hypot(next.x-carrot.x,next.y-carrot.y);
    if(gap>=remaining && gap>1e-7){carrot={x:carrot.x+(next.x-carrot.x)*remaining/gap,y:carrot.y+(next.y-carrot.y)*remaining/gap};break;}
    remaining-=gap;carrot=next;previous=next;
    // Ordinary uncurved references use this lookahead; described arcs use
    // their tangent and feed-forward curvature below.
  }
  let cx=carrot.x-ship.x,cy=carrot.y-ship.y,distance=Math.hypot(cx,cy);
  if(distance<1e-7 && !firing)return false;
  const wasAvoiding=route.avoidHeading!==undefined;
  // On a described curve the tangent and curvature are the reference.
  // Feeding pure-pursuit curvature on top would command the same turn twice.
  const curved=first.curvature!==undefined && !(points.length===1 && endGap<profile.length);
  const pathCurvature=first.curvature ?? 0;
  const arcAngle=2*Math.asin(clamp(Math.sqrt(squared)*pathCurvature/2,-1,1));
  // A straight segment's tangent belongs to its current endpoints. A yielded
  // leg or a moving pursuit goal can replace the origin without replacing
  // this waypoint's originally authored heading.
  const tangent=curved && !pathCurvature ? Math.atan2(dy,dx) : first.heading-arcAngle*(1-projection);
  const crossTrack=-(ship.x-(origin.x+dx*projection))*detSin(tangent)+(ship.y-(origin.y+dy*projection))*detCos(tangent);
  const reference=curved ? tangent-Math.atan2(crossTrack,lookahead) : Math.atan2(cy,cx);
  // A firing station owns its weapon attitude. Collision sweeps below still
  // stop contact; normal passing rules must not steer the battery away forever.
  const avoidance=firing ? {heading:route.fireHeading!,speedScale:1,active:false}
    : avoidanceCourse(ship,units,reference,motion.speed);
  // Once clear of traffic, join the next mark from here. Forcing the vessel
  // back onto the old centreline can add an unnecessary upwind S-turn.
  // A stationary fighting station keeps its planned approach through the
  // occupied battery ring; an ordinary voyage or moving chase can rejoin.
  const rejoinable=!curved || points.length===1 && (route.intent!=='pursuit' || motion.pursuit?.moving);
  if(wasAvoiding && !avoidance.active && !first.tack && !pathCurvature && !firing && rejoinable){
    const direct=Math.atan2(first.y-ship.y,first.x-ship.x);
    const start={x:ship.x,y:ship.y,heading:motion.heading},turned={...start,heading:direct};
    if(hullPassageClear(map,ship,start,turned) && hullPassageClear(map,ship,turned,{...first,heading:direct})){
      route.legX=ship.x;route.legY=ship.y;
      // Route endpoints may share the last waypoint until a JSON save copies
      // them. Replace the tangent without mutating that shared endpoint so
      // continuing a saved voyage uses the same state as uninterrupted play.
      if(first.curvature===0)points[0]={...first,heading:direct};
      distance=Math.min(lookahead,Math.hypot(first.x-ship.x,first.y-ship.y));
      cx=distance*detCos(direct);cy=distance*detSin(direct);avoidance.heading=direct;
    }
  }
  let error=headingDifference(motion.heading,avoidance.heading);
  const current=coursePerformance(ship,map,undefined,{assumeTrimmed:true});
  const wanted=coursePerformance(ship,map,Math.atan2(cy,cx),{assumeTrimmed:true});
  const crossing=!current.calm && current.trueWindAngle<current.beatAngle && current.targetSpeed<current.auxiliarySpeed;
  const mode=current.calm?'calm-assist':firing && (route.retreat || crossing)?'maneuver':first.tack?'tacking':crossing || wanted.targetSpeed<wanted.auxiliarySpeed?'maneuver':'sail';
  if(motion.sail)motion.sail.mode=mode;
  const performance=coursePerformance(ship,map);
  const drive=mode==='maneuver'||mode==='calm-assist'||crossing?performance.auxiliarySpeed:performance.targetSpeed;
  if(limits.turnRate<=1e-9 && Math.abs(error)>.001){motion.speed=0;motion.yawRate=0;return true;}
  const acceleration=perTick(limits.acceleration),radius=profile.length*.65;
  const terminal=points.length===1 && route.intent!=='pursuit' && endGap<profile.length;
  const curvature=2*detSin(error)/Math.max(distance,terminal?1:profile.length*.25);
  let targetSpeed=drive*pace*avoidance.speedScale;
  if(route.targetSpeed!==undefined)targetSpeed=Math.min(targetSpeed,Math.max(0,route.targetSpeed));
  targetSpeed*=clamp(1-Math.abs(error)*.22,.4,1);
  if(firing){
    if(route.retreat)targetSpeed=Math.min(targetSpeed,limits.reverseSpeed,performance.auxiliarySpeed);
    // Turn the battery promptly without sailing a pointless wide orbit.
    targetSpeed*=Math.max(0,detCos(error));
    if(route.retreat)targetSpeed=Math.min(targetSpeed,Math.sqrt(2*limits.acceleration*Math.max(0,endGap-arrival)));
  }
  // A speed cap belongs to the entering segment. Brake before an arc entry,
  // with enough headroom for tracking correction as well as planned yaw.
  let alongDistance=0,geometrySpeed=Infinity,previousLimitPoint={x:ship.x,y:ship.y};
  const speedHorizon=Math.max(motion.speed,targetSpeed)**2/(2*Math.max(1e-9,limits.acceleration));
  for(const point of points){
    // Beyond this distance even a zero-speed segment cannot constrain the
    // current drive or braking. Long sampled turn/tack routes need only scan
    // their braking horizon, while retaining every cap that can matter now.
    if(alongDistance>speedHorizon)break;
    const segmentLength=Math.hypot(point.x-previousLimitPoint.x,point.y-previousLimitPoint.y);
    const limitDistance=alongDistance+(point.curvature ? 0 : segmentLength);
    if(point.speedLimit!==undefined)geometrySpeed=Math.min(geometrySpeed,Math.sqrt(point.speedLimit**2+2*limits.acceleration*limitDistance));
    alongDistance+=segmentLength;
    previousLimitPoint=point;
  }
  targetSpeed=Math.min(targetSpeed,geometrySpeed);
  if(terminal){
    // The last few metres are a low-speed approach: its turning radius shrinks
    // with headway instead of orbiting a point inside the cruising circle.
    if(Math.abs(error)>.2)targetSpeed=Math.min(targetSpeed,performance.auxiliarySpeed);
    if(Math.abs(error)>Math.PI/2)targetSpeed=Math.min(targetSpeed,performance.auxiliarySpeed*.25);
    if(Math.abs(curvature)>1e-7)targetSpeed=Math.min(targetSpeed,limits.turnRate/Math.abs(curvature)*.8);
  }
  if(route.intent!=='pursuit')targetSpeed=Math.min(targetSpeed,Math.sqrt(2*limits.acceleration*endGap));
  const braking=motion.speed>geometrySpeed || route.targetSpeed!==undefined || terminal && (Math.abs(error)>.2 || endGap<speedStoppingDistance(motion.speed,limits.acceleration));
  // Losing aerodynamic drive while crossing the wind releases the sails;
  // it does not command full braking and discard all entry headway.
  const slowing=braking?acceleration:acceleration*.2;
  let speed=motion.speed+clamp(targetSpeed-motion.speed,-slowing,acceleration);
  if(terminal && Math.abs(curvature)>1e-7)speed=Math.min(speed,limits.turnRate/Math.abs(curvature)*.8);
  const maxYaw=terminal||curved||firing?limits.turnRate:Math.min(limits.turnRate,Math.max(speed,performance.auxiliarySpeed*.6)/radius);
  // Keep a committed turn's side if a moving destination wobbles across the
  // exact stern. Outside that small ambiguity, the path determines the helm.
  if(Math.abs(error)>Math.PI*.85 && Math.abs(motion.yawRate??0)>.02)error=Math.sign(motion.yawRate!)*Math.abs(error);
  let wantedYaw=clamp(curved && !avoidance.active ? speed*pathCurvature+(2*speed/lookahead+.35)*error : speed*curvature,-maxYaw,maxYaw);
  if(firing)wantedYaw=clamp(error*.9,-limits.turnRate,limits.turnRate);
  if(Math.abs(error)>Math.PI/2)wantedYaw=Math.sign(error)*maxYaw;
  if(first.tack && crossing && !curved)wantedYaw=clamp(error*.7,-limits.turnRate,limits.turnRate);
  // A small deadband and rate limit remove left/right chatter without snapping
  // the ship to its course. The saved rate makes read-back deterministic.
  if(Math.abs(error)<.003 && (!curved || !pathCurvature))wantedYaw=0;
  const yawAcceleration=limits.turnRate*2;
  let yawRate=(motion.yawRate??0)+clamp(wantedYaw-(motion.yawRate??0),-perTick(yawAcceleration),perTick(yawAcceleration));
  yawRate=clamp(yawRate,-limits.turnRate,limits.turnRate);
  let direction=firing && route.retreat ? -1 : 1;
  const alongVelocity=(motion.velocityX??0)*detCos(motion.heading)+(motion.velocityY??0)*detSin(motion.heading);
  if(direction*alongVelocity < -1e-7){speed=0;direction=0;}
  let surge=perTick(speed)*direction,yaw=perTick(yawRate);
  if(!firing && points.length===1 && endGap<=surge && Math.abs(error)<=perTick(limits.turnRate)){
    surge=endGap;yaw=error;yawRate=yaw*SIM_TICKS_PER_SECOND;
  }
  const start:ShipPose={x:ship.x,y:ship.y,heading:motion.heading},traffic=shipTraffic(ship,units);
  const safe=(step:number,turn:number)=>{
    // Check a braking horizon, rather than rejecting a useful curve because
    // an unchanging helm held far into the future would eventually hit land.
    const steps=Math.max(1,Math.min(12,Math.ceil(speed/Math.max(1,limits.acceleration)*SIM_TICKS_PER_SECOND)));
    let from=start;
    for(let i=0;i<steps;i++){
      const heading=from.heading+turn,turned={...from,heading};
      const to={x:from.x+step*detCos(heading),y:from.y+step*detSin(heading),heading};
      if(!hullPassageClear(map,ship,from,turned)||!traffic(from,turned)||!hullPassageClear(map,ship,turned,to)||!traffic(turned,to))return false;
      from=to;
    }
    return true;
  };
  if(!safe(surge,yaw)){
    // A brief slow-down can let a crossing vessel pass without throwing away
    // the strategic route. Replanning, if needed, is scheduled by the navigator.
    let found=false;
    // Headway can only brake at the hull's actual deceleration. A sudden
    // obstruction inside that distance must reach the physical contact sweep.
    const minimumSpeed=Math.max(0,motion.speed-acceleration);
    for(const factor of [.6,.25,0]){
      if(speed*factor<minimumSpeed-1e-7)continue;
      const step=surge*factor,turn=yaw*factor;
      if(!safe(step,turn))continue;
      surge=step;yaw=turn;speed*=factor;yawRate*=factor;found=true;break;
    }
    if(!found){speed=minimumSpeed;surge=perTick(speed)*direction;}
    if(Math.abs(surge)<1e-5 && Math.abs(yaw)<1e-7){motion.speed=0;motion.yawRate=0;return false;}
  }
  if(!advanceShip(ship,map,units,{surge,yaw})){motion.speed=0;motion.yawRate=0;return false;}
  motion.speed=speed;motion.yawRate=yawRate;
  return true;
}

function speedStoppingDistance(speed:number,acceleration:number){return speed*speed/(2*Math.max(1,acceleration))+2;}
