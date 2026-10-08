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
  const isManeuver = (point: ShipPose, from: {x:number;y:number}) => point.exact || point.pivot ||
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
    // A tack uses a turn gate, not a two-unit pin that the boat must stop on.
    const turnGate=first.tack ? lookahead*.55 : Math.min(5,lookahead*.06);
    if (squared>1e-10 && gap>turnGate && along<1 && !(onNext>0 && gap<lookahead)) break;
    origin=points.shift()!;route.legX=origin.x;route.legY=origin.y;
  }
  const last=points.at(-1);
  if (!last) { motion.speed=0;motion.yawRate=0;return true; }
  if (isManeuver(points[0]!,origin)) return 'maneuver';
  const endGap=Math.hypot(last.x-ship.x,last.y-ship.y);
  const arrival=route.arrivalRadius ?? .3;
  if(points.length===1 && endGap<=arrival){
    if(route.intent!=='pursuit'){points.length=0;motion.speed=0;motion.yawRate=0;}
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
    // Looking through the tack's turn gate starts easing the helm before the
    // vertex; the boat never has to visit an exact pin and turn on the spot.
  }
  let cx=carrot.x-ship.x,cy=carrot.y-ship.y,distance=Math.hypot(cx,cy);
  if(distance<1e-7)return false;
  const wasAvoiding=route.avoidHeading!==undefined;
  const avoidance=avoidanceCourse(ship,units,Math.atan2(cy,cx),motion.speed);
  // Once clear of traffic, join the next mark from here. Forcing the vessel
  // back onto the old centreline can add an unnecessary upwind S-turn.
  if(wasAvoiding && !avoidance.active && !first.tack){
    const direct=Math.atan2(first.y-ship.y,first.x-ship.x);
    const start={x:ship.x,y:ship.y,heading:motion.heading},turned={...start,heading:direct};
    if(hullPassageClear(map,ship,start,turned) && hullPassageClear(map,ship,turned,{...first,heading:direct})){
      route.legX=ship.x;route.legY=ship.y;
      distance=Math.min(lookahead,Math.hypot(first.x-ship.x,first.y-ship.y));
      cx=distance*detCos(direct);cy=distance*detSin(direct);avoidance.heading=direct;
    }
  }
  let error=headingDifference(motion.heading,avoidance.heading);
  const current=coursePerformance(ship,map,undefined,{assumeTrimmed:true});
  const wanted=coursePerformance(ship,map,Math.atan2(cy,cx),{assumeTrimmed:true});
  const crossing=!current.calm && current.trueWindAngle<current.beatAngle && current.targetSpeed<current.auxiliarySpeed;
  const mode=current.calm?'calm-assist':first.tack?'tacking':crossing || wanted.targetSpeed<wanted.auxiliarySpeed?'maneuver':'sail';
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
  if(terminal){
    // The last few metres are a low-speed approach: its turning radius shrinks
    // with headway instead of orbiting a point inside the cruising circle.
    if(Math.abs(error)>.2)targetSpeed=Math.min(targetSpeed,performance.auxiliarySpeed);
    if(Math.abs(error)>Math.PI/2)targetSpeed=Math.min(targetSpeed,performance.auxiliarySpeed*.25);
    if(Math.abs(curvature)>1e-7)targetSpeed=Math.min(targetSpeed,limits.turnRate/Math.abs(curvature)*.8);
  }
  if(route.intent!=='pursuit')targetSpeed=Math.min(targetSpeed,Math.sqrt(2*limits.acceleration*endGap));
  const braking=route.targetSpeed!==undefined || terminal && (Math.abs(error)>.2 || endGap<speedStoppingDistance(motion.speed,limits.acceleration));
  const slowing=braking?acceleration:acceleration*.2;
  let speed=motion.speed+clamp(targetSpeed-motion.speed,-slowing,acceleration);
  if(terminal && Math.abs(curvature)>1e-7)speed=Math.min(speed,limits.turnRate/Math.abs(curvature)*.8);
  const maxYaw=terminal?limits.turnRate:Math.min(limits.turnRate,Math.max(speed,performance.auxiliarySpeed*.6)/radius);
  // Keep a committed turn's side if a moving destination wobbles across the
  // exact stern. Outside that small ambiguity, the path determines the helm.
  if(Math.abs(error)>Math.PI*.85 && Math.abs(motion.yawRate??0)>.02)error=Math.sign(motion.yawRate!)*Math.abs(error);
  let wantedYaw=clamp(speed*curvature,-maxYaw,maxYaw);
  if(Math.abs(error)>Math.PI/2)wantedYaw=Math.sign(error)*maxYaw;
  if(first.tack && crossing)wantedYaw=clamp(error*.7,-limits.turnRate,limits.turnRate);
  // A small deadband and rate limit remove left/right chatter without snapping
  // the ship to its course. The saved rate makes read-back deterministic.
  if(Math.abs(error)<.003)wantedYaw=0;
  const yawAcceleration=limits.turnRate*2;
  let yawRate=(motion.yawRate??0)+clamp(wantedYaw-(motion.yawRate??0),-perTick(yawAcceleration),perTick(yawAcceleration));
  yawRate=clamp(yawRate,-limits.turnRate,limits.turnRate);
  let surge=perTick(speed),yaw=perTick(yawRate);
  if(points.length===1 && endGap<=surge && Math.abs(error)<=perTick(limits.turnRate)){
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
    for(const factor of [.6,.25,0]){
      const step=surge*factor,turn=yaw*factor;
      if(!safe(step,turn))continue;
      surge=step;yaw=turn;speed*=factor;yawRate*=factor;found=true;break;
    }
    if(!found || surge<1e-5){motion.speed=0;motion.yawRate=0;return false;}
  }
  if(!advanceShip(ship,map,units,{surge,yaw})){motion.speed=0;motion.yawRate=0;return false;}
  motion.speed=speed;motion.yawRate=yawRate;
  return true;
}

function speedStoppingDistance(speed:number,acceleration:number){return speed*speed/(2*Math.max(1,acceleration))+2;}
