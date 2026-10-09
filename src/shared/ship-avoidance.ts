import { clipToConvex, convexHull, minkowskiSum, expandConvex, pointSegmentDistanceSquared, polygonPlanes } from "./navigation-math";
import { circleInPolygon, hullGap, localToWorld, shipProfile, worldToLocal, type Point } from "./ship-geometry";
import { hullPassageClear } from "./ship-navigation";
import type { GameMap, Unit } from "./types";
import { detCos, detSin } from "./det-math";
import { headingDifference, shipPoseAt, type ShipPose } from "./ship-navigation";
import { SIM_TICKS_PER_SECOND } from './time';
import { shipMotionLimits } from './ship-handling';

const trafficShapes=new Map<string,Point[]>();

/** Early passing decisions use relative motion; geometric sweeps still own
 * permission to move. Positive angles turn to starboard in world XY. The
 * serialized route holds an actual world course until the other hull passes,
 * so path recentering or a newly clear CPA cannot undo the alteration. */
export function avoidanceCourse(ship:Unit,units:readonly Unit[],desiredHeading:number,speed:number):{heading:number;speedScale:number;active:boolean} {
  const motion=ship.sailing,route=motion?.route,profile=shipProfile(ship);
  if(!motion || !profile)return{heading:desiredHeading,speedScale:1,active:false};
  const ownSpeed=Math.max(0,speed),heading=motion.heading;
  const releaseTicks=SIM_TICKS_PER_SECOND;
  const final=route?.points.length===1 ? route.points[0] : undefined;
  const brakingDistance=motion.speed*motion.speed/(2*Math.max(1e-7,shipMotionLimits(ship).acceleration));
  const stopping=route?.targetSpeed===0 && shipTraffic(ship,units)({x:ship.x,y:ship.y,heading},
    {x:ship.x+brakingDistance*detCos(heading),y:ship.y+brakingDistance*detSin(heading),heading});
  // The prediction horizon ends at a nearby clear stopping point. Extrapolating
  // our present velocity through that point would invent a later collision and
  // repeatedly steer a ferry away from its safe unloading approach.
  if(stopping || final && route!.intent!=='pursuit' && Math.hypot(final.x-ship.x,final.y-ship.y)<profile.length*.65
    && shipTraffic(ship,units)({x:ship.x,y:ship.y,heading},final)){
    delete route!.avoidHeading;delete route!.avoidBaseHeading;delete route!.avoidTargetId;
    delete route!.avoidTicks;delete route!.avoidSide;
    return{heading:desiredHeading,speedScale:1,active:false};
  }
  if(route?.avoidHeading!==undefined && route.avoidBaseHeading!==undefined && route.avoidTargetId){
    const other=units.find(unit=>unit.id===route.avoidTargetId && unit.hp>0),otherProfile=other && shipProfile(other);
    const dx=other?other.x-ship.x:0,dy=other?other.y-ship.y:0,base=route.avoidBaseHeading;
    const along=dx*detCos(base)+dy*detSin(base);
    const across=Math.abs(-dx*detSin(base)+dy*detCos(base));
    const parallel=other && Math.abs(headingDifference(base,other.sailing?.heading ?? 0))<Math.PI/3;
    const beside=otherProfile && parallel && across>(profile.beam+otherProfile.beam)*.75+profile.length*.25;
    const otherHeading=other?.sailing?.heading ?? 0,otherSpeed=other?.sailing?.speed ?? 0;
    const ox=other?.sailing?.velocityX ?? otherSpeed*detCos(otherHeading),oy=other?.sailing?.velocityY ?? otherSpeed*detSin(otherHeading);
    const rx=ox-(motion.velocityX ?? motion.speed*detCos(heading)),ry=oy-(motion.velocityY ?? motion.speed*detSin(heading));
    // Being safe on the altered heading is not evidence that returning to the
    // intended course is safe. Check that course as well before releasing it.
    const restoreSpeed=Math.min(ownSpeed,route.targetSpeed ?? ownSpeed),qx=ox-restoreSpeed*detCos(desiredHeading),qy=oy-restoreSpeed*detSin(desiredHeading);
    const restoringSquared=qx*qx+qy*qy,restoringClosing=dx*qx+dy*qy;
    const closestTime=restoringSquared>1?Math.max(0,Math.min(8,-restoringClosing/restoringSquared)):0;
    const clearance=otherProfile?(profile.length+otherProfile.length)*.5+Math.max(profile.beam,otherProfile.beam)*.35:0;
    const safeReturn=restoringSquared<1 || restoringClosing>=0 || Math.hypot(dx+qx*closestTime,dy+qy*closestTime)>=clearance;
    const separated=other && otherProfile && dx*rx+dy*ry>=0 && hullGap(ship,other)>Math.max(profile.beam,otherProfile.beam)*.75;
    const stoppedFinal=final && other && Math.hypot(ox,oy)<1 && shipTraffic(ship,[ship,other])({x:ship.x,y:ship.y,heading},final);
    const passed=!otherProfile || !!stoppedFinal || safeReturn && (along<-(profile.length+otherProfile.length)*.45 || !!beside || !!separated);
    route.avoidTicks=Math.max(0,(route.avoidTicks??releaseTicks)-1);
    if(passed)route.avoidTicks=Math.min(route.avoidTicks,releaseTicks);
    if(route.avoidTicks>0){
      const remaining=Math.min(1,route.avoidTicks/releaseTicks);
      const course=route.avoidHeading+headingDifference(route.avoidHeading,desiredHeading)*(1-remaining);
      const headOn=other && Math.abs(headingDifference(base,other.sailing?.heading ?? 0))>Math.PI*2/3;
      const starboard=dx*(-detSin(base))+dy*detCos(base)>0;
      return{heading:course,speedScale:passed ? 1 : headOn ? .85 : starboard ? .55 : .9,active:true};
    }
    delete route.avoidHeading;delete route.avoidBaseHeading;delete route.avoidTargetId;
    delete route.avoidTicks;delete route.avoidSide;
  }
  const vx=motion.velocityX ?? ownSpeed*detCos(heading),vy=motion.velocityY ?? ownSpeed*detSin(heading);
  const ownMotion=Math.hypot(vx,vy),fx=detCos(heading),fy=detSin(heading);
  let threat:{time:number;distance:number;clearance:number;starboard:boolean;headOn:boolean;id:string}|undefined;
  for(const other of units){
    if(other===ship || other.hp<=0)continue;
    const otherProfile=shipProfile(other);if(!otherProfile)continue;
    const dx=other.x-ship.x,dy=other.y-ship.y,distance=Math.hypot(dx,dy);
    const otherMotion=other.sailing,otherHeading=otherMotion?.heading ?? 0,otherSpeed=otherMotion?.speed ?? 0;
    const ox=otherMotion?.velocityX ?? otherSpeed*detCos(otherHeading),oy=otherMotion?.velocityY ?? otherSpeed*detSin(otherHeading);
    // Following a vessel that has stopped ends at a finite standoff. Prove
    // that final leg against its real hull instead of treating the boat as a
    // large circle and projecting our travel beyond the stopping station.
    if(final && Math.hypot(ox,oy)<1 && shipTraffic(ship,[ship,other])({x:ship.x,y:ship.y,heading},final))continue;
    // At rest the requested drive supplies a prospective velocity, allowing
    // ships beginning opposed orders to make a passing choice before contact.
    const ax=ownMotion>1?vx:ownSpeed*detCos(desiredHeading),ay=ownMotion>1?vy:ownSpeed*detSin(desiredHeading);
    const rx=ox-ax,ry=oy-ay,relativeSquared=rx*rx+ry*ry,closing=dx*rx+dy*ry;
    if(relativeSquared<1 || closing>=-1e-7)continue;
    const clearance=(profile.length+otherProfile.length)*.5+Math.max(profile.beam,otherProfile.beam)*.35;
    const horizon=Math.max(6,Math.min(10,clearance/Math.max(10,ownSpeed)*2.5));
    const time=-closing/relativeSquared;
    if(distance>clearance+(ownSpeed+Math.hypot(ox,oy))*horizon)continue;
    const closest=Math.hypot(dx+rx*time,dy+ry*time);
    if(closest>=clearance)continue;
    const enters=time-Math.sqrt((clearance*clearance-closest*closest)/relativeSquared);
    if(enters>horizon)continue;
    // An overtaken vessel behind our beam owns its maneuver; being approached
    // from astern is not a reason to zigzag out of an otherwise steady course.
    if(dx*fx+dy*fy<-profile.length*.35 && Math.abs(headingDifference(heading,otherHeading))<Math.PI/3)continue;
    const candidate={time:enters,distance,clearance,starboard:dx*(-fy)+dy*fx>0,
      headOn:Math.abs(headingDifference(heading,otherHeading))>Math.PI*2/3,id:other.id};
    if(!threat || candidate.time<threat.time-1e-7 || Math.abs(candidate.time-threat.time)<1e-7 && other.id<threat.id)threat=candidate;
  }
  if(threat){
    const urgency=Math.max(0,Math.min(1,(threat.clearance*2-threat.distance)/threat.clearance));
    const offset=(30+urgency*20)*Math.PI/180;
    const course=heading+offset;
    if(route){
      route.avoidSide=1;route.avoidTicks=releaseTicks+SIM_TICKS_PER_SECOND*120;
      route.avoidHeading=course;route.avoidBaseHeading=heading;route.avoidTargetId=threat.id;
    }
    // Crossing traffic from starboard is given room astern. Head-on vessels
    // both alter right early instead of symmetrically stopping bow to bow.
    return{heading:course,speedScale:threat.headOn ? .85 : threat.starboard ? .55 : .9,active:true};
  }
  if(route){delete route.avoidSide;delete route.avoidTicks;}
  return{heading:desiredHeading,speedScale:1,active:false};
}

/** Frozen traffic geometry for one route search. The same continuous swept
 * hull used for coasts also constrains lattice positions and turns. */
export function shipTraffic(ship:Unit,units:readonly Unit[],range=600) {
  const hull=shipProfile(ship)!.hull,radius=Math.max(...hull.map(p=>Math.hypot(p.x,p.y)));
  const bodies=units.filter(other=>other!==ship && other.hp>0 && shipProfile(other) && Math.hypot(other.x-ship.x,other.y-ship.y)<range)
    .map(other=>({other,center:{x:other.x,y:other.y},radius:Math.max(...shipProfile(other)!.hull.map(p=>Math.hypot(p.x,p.y)))}));
  const configurations=new Map<string,Point[]>(),sweeps=new Map<string,Point[]>();
  const configuration=(from:number,to:number,body:typeof bodies[number],padding:number)=>{
    const key=`${from}:${to}:${body.other.id}:${padding}`,known=configurations.get(key);if(known)return known;
    const profile=shipProfile(body.other)!,angle=body.other.sailing?.heading ?? 0;
    const shapeKey=`${ship.kind}:${shipProfile(ship)!.length}:${from}:${to}:${body.other.kind}:${profile.length}:${angle}:${padding}`;
    let polygon=trafficShapes.get(shapeKey);
    if(!polygon){
      const sweepKey=`${from}:${to}`;let shape=sweeps.get(sweepKey);
      if(!shape){const turn=headingDifference(from,to),steps=Math.max(1,Math.ceil(Math.abs(turn)*radius/4)),points:Point[]=[];
        for(let i=0;i<=steps;i++){const heading=from+turn*i/steps,c=detCos(heading),s=detSin(heading);points.push(...hull.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})));}
        shape=convexHull(points);if(turn)shape=expandConvex(shape,radius*(turn/steps)**2/8+1e-7);sweeps.set(sweepKey,shape);
      }
      const c=detCos(angle),s=detSin(angle),outline=profile.hull.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));
      polygon=minkowskiSum(outline,shape.map(p=>({x:-p.x,y:-p.y})));
      if(padding)polygon=expandConvex(polygon,padding);
      if(trafficShapes.size>=512)trafficShapes.delete(trafficShapes.keys().next().value!);trafficShapes.set(shapeKey,polygon);
    }
    configurations.set(key,polygon);return polygon;
  };
  const interior=(point:Point,polygon:readonly Point[])=>polygonPlanes(polygon).every(p=>point.x*p.x+point.y*p.y>p.min+1e-6);
  const clear=(from:ShipPose,to:ShipPose,padding=0):boolean=>{
    if(!bodies.length)return true;
    if(to.pivot){
      const turn=headingDifference(from.heading,to.heading),lever=Math.hypot(from.x-to.pivot.x,from.y-to.pivot.y);
      const steps=Math.max(1,Math.ceil(Math.abs(turn)*Math.sqrt((radius+lever)/(8*.025))));
      const error=lever*(turn/steps)**2/8+1e-7;
      for(let i=0;i<steps;i++)if(!clear(shipPoseAt(from,to,i/steps),shipPoseAt(from,to,(i+1)/steps),error))return false;
      return true;
    }
    const dx=to.x-from.x,dy=to.y-from.y,turn=headingDifference(from.heading,to.heading);
    return bodies.every(body=>{
      if(pointSegmentDistanceSquared(body.center,from,to)>(radius+body.radius+padding)**2)return true;
      const polygon=configuration(from.heading,to.heading,body,padding);
      const start={x:from.x-body.center.x,y:from.y-body.center.y},end={x:to.x-body.center.x,y:to.y-body.center.y};
      const clip=clipToConvex(start,end,polygon);if(!clip || clip[1]-clip[0]<1e-7)return true;
      const middle=(clip[0]+clip[1])/2;
      if(!interior({x:start.x+dx*middle,y:start.y+dy*middle},polygon))return true;
      // Initial contact may separate, but cannot rotate deeper into contact.
      return Math.abs(turn)<1e-7 && clip[0]<=1e-7 && dx*(from.x-body.center.x)+dy*(from.y-body.center.y)>0;
    });
  };
  return Object.assign(clear,{hasTraffic:bodies.length>0});
}

/** Only a reciprocal boarding appointment reserves a partner's future pose
 * during strategic planning. Actual helm and motion checks always call
 * shipTraffic against the live hull, so this cannot permit a ship crossing. */
export function reservationTraffic(ship:Unit,units:readonly Unit[],range=600) {
  const rendezvousFor=ship.order.type==='move'?ship.order.rendezvousFor:undefined;
  const crew=rendezvousFor?units.find(unit=>unit.id===rendezvousFor):undefined;
  const boarding=crew?.order.type==='board'?crew.order:undefined,plan=boarding?.rendezvous;
  if(!plan?.reciprocal || !boarding || ship.id!==plan.sourceId && ship.id!==boarding.transportId)return shipTraffic(ship,units,range);
  const partnerId=ship.id===plan.sourceId?boarding.transportId:plan.sourceId;
  const reserved=units.map(other=>{
    if(other.id!==partnerId || other.order.type!=='move' || other.order.rendezvousFor!==rendezvousFor || !other.sailing)return other;
    const x=other.id===plan.sourceId?plan.sourceX:plan.targetX,y=other.id===plan.sourceId?plan.sourceY:plan.targetY;
    return{...other,x,y,sailing:{...other.sailing,heading:plan.heading}};
  });
  return shipTraffic(ship,reserved,range);
}

export function shipTrafficKey(ship:Unit,units:readonly Unit[]) {
  return units.filter(other=>other!==ship && other.hp>0 && shipProfile(other) && Math.hypot(other.x-ship.x,other.y-ship.y)<600)
    .map(other=>`${other.id}:${Math.round(other.x/16)}:${Math.round(other.y/16)}:${Math.round((other.sailing?.heading ?? 0)*16/Math.PI)}`).join('|');
}
/** A destination on another deck means hull contact. Compute the berth in
 * configuration space, then let normal surge/yaw routing reach that pose. */
export function shipContactGoal(ship:Unit,goal:Point,units:readonly Unit[]):ShipPose|undefined {
  const other=units.find(other=>other!==ship && other.hp>0 && shipProfile(other) && circleInPolygon(worldToLocal(other,goal),0,shipProfile(other)!.hull));
  if(!other)return;
  const dx=goal.x-ship.x,dy=goal.y-ship.y,length=Math.hypot(dx,dy);if(length<1e-7)return;
  const direction=Math.atan2(dy,dx),preferred=ship.sailing?.heading ?? 0;
  const headings=[preferred,...[direction,direction+Math.PI].sort((a,b)=>Math.abs(headingDifference(preferred,a))-Math.abs(headingDifference(preferred,b)))];
  for(const heading of headings){
    const c=detCos(heading),s=detSin(heading),hull=shipProfile(ship)!.hull.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));
    const polygon=minkowskiSum(shipProfile(other)!.hull.map(p=>localToWorld(other,p)),hull.map(a=>({x:-a.x,y:-a.y})));
    const clip=clipToConvex(ship,goal,polygon);if(!clip || clip[0]<=1e-7)continue;
    const fraction=Math.max(0,clip[0]-.05/length);
    return{x:ship.x+dx*fraction,y:ship.y+dy*fraction,heading};
  }
}

/** A local visibility graph in configuration space: B ⊕ −A accounts for
 * both real hulls. It complements the static, heading-aware water route. */
export function avoidShipHulls(map:GameMap,ship:Unit,goal:Point,units:readonly Unit[],docking=false):Point|undefined {
  const p=shipProfile(ship)!,heading=ship.sailing?.heading ?? 0,start={x:ship.x,y:ship.y};
  const gap=Math.hypot(goal.x-start.x,goal.y-start.y);
  if(gap<1e-7)return goal;
  const end=goal;
  const hull=p.hull.map(point=>{const at=localToWorld(ship,point);return{x:at.x-ship.x,y:at.y-ship.y};});
  const obstacles=units.filter(other=>other!==ship && shipProfile(other) && Math.hypot(other.x-ship.x,other.y-ship.y)<500
    && pointSegmentDistanceSquared(other,start,end)<((p.length+shipProfile(other)!.length)/2+20)**2).map(other=>{
      const outline=shipProfile(other)!.hull.map(point=>localToWorld(other,point));
      const polygon=expandConvex(minkowskiSum(outline,hull.map(a=>({x:-a.x,y:-a.y}))),.1);
      return{center:other,polygon};
    });
  if(!obstacles.length)return goal;
  const intersects=(a:Point,b:Point)=>obstacles.some(({polygon,center})=>{
    const clip=clipToConvex(a,b,polygon);if(!clip || clip[1]-clip[0]<1e-7 || clip[0]>1-1e-7)return false;
    const middle=(clip[0]+clip[1])/2,at={x:a.x+(b.x-a.x)*middle,y:a.y+(b.y-a.y)*middle};
    // Visibility edges can lie on a supporting line. Only interior
    // penetration blocks them; rejecting tangencies disconnects the graph.
    if(polygonPlanes(polygon).some(plane=>at.x*plane.x+at.y*plane.y<=plane.min+1e-6))return false;
    // Contact resolution may leave a tiny initial overlap. A separating
    // maneuver is allowed, but another inward movement is not.
    return !(clip[0]<=1e-7 && (b.x-a.x)*(a.x-center.x)+(b.y-a.y)*(a.y-center.y)>0);
  });
  if(!intersects(start,end))return goal;
  // An intentional docking destination ends at contact, not at the other hull's center.
  let destination=end;
  for(const {polygon} of obstacles){
    const inside=clipToConvex(end,end,polygon),crossing=clipToConvex(start,end,polygon);
    if(docking && inside && crossing && crossing[0]>0)destination={x:start.x+(end.x-start.x)*crossing[0],y:start.y+(end.y-start.y)*crossing[0]};
  }
  const nodes=[start,destination,...obstacles.flatMap(o=>o.polygon)];
  const costs=nodes.map(()=>Infinity),parents=nodes.map(()=>-1),done=nodes.map(()=>false);costs[0]=0;
  for(let turn=0;turn<nodes.length;turn++){
    let current=-1;for(let i=0;i<nodes.length;i++)if(!done[i] && (current<0 || costs[i]!<costs[current]!))current=i;
    if(current<0 || !Number.isFinite(costs[current]!))break;
    if(current===1){let first=1;while(parents[first]!>0)first=parents[first]!;return nodes[first];}
    done[current]=true;const a=nodes[current]!;
    for(let next=1;next<nodes.length;next++){
      if(done[next])continue;const b=nodes[next]!,weight=Math.hypot(a.x-b.x,a.y-b.y);
      const side=(end.x-start.x)*(b.y-start.y)-(end.y-start.y)*(b.x-start.x);
      const cost=costs[current]!+weight+(side<0?.001:0);
      if(cost>=costs[next]! || intersects(a,b) || !hullPassageClear(map,ship,{...a,heading},{...b,heading}))continue;
      costs[next]=cost;parents[next]=current;
    }
  }
  return undefined;
}
