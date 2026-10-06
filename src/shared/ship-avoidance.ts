import { clipToConvex, convexHull, expandConvex, pointSegmentDistanceSquared, polygonPlanes } from "./navigation-math";
import { localToWorld, shipProfile, type Point } from "./ship-geometry";
import { hullPassageClear } from "./ship-navigation";
import type { GameMap, Unit } from "./types";
import { detCos, detSin } from "./det-math";
import { headingDifference, type ShipPose } from "./ship-navigation";

const trafficShapes=new Map<string,Point[]>();

/** Frozen traffic geometry for one route search. The same continuous swept
 * hull used for coasts also constrains lattice positions and turns. */
export function shipTraffic(ship:Unit,units:readonly Unit[]) {
  const hull=shipProfile(ship)!.hull,radius=Math.max(...hull.map(p=>Math.hypot(p.x,p.y)));
  const bodies=units.filter(other=>other!==ship && other.hp>0 && shipProfile(other) && Math.hypot(other.x-ship.x,other.y-ship.y)<600)
    .map(other=>({other,center:{x:other.x,y:other.y},radius:Math.max(...shipProfile(other)!.hull.map(p=>Math.hypot(p.x,p.y)))}));
  const configurations=new Map<string,{center:Point;radius:number;polygon:Point[]}[]>();
  const configuration=(from:number,to=from)=>{
    const key=`${from}:${to}`,known=configurations.get(key);if(known)return known;
    const turn=headingDifference(from,to),steps=Math.max(1,Math.ceil(Math.abs(turn)*radius/4)),points:Point[]=[];
    for(let i=0;i<=steps;i++){const angle=from+turn*i/steps,c=detCos(angle),s=detSin(angle);
      points.push(...hull.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})));}
    let shape=convexHull(points);if(turn)shape=expandConvex(shape,radius*(turn/steps)**2/8+1e-7);
    const obstacles=bodies.map(body=>{
      const profile=shipProfile(body.other)!,angle=body.other.sailing?.heading ?? 0;
      const shapeKey=`${ship.kind}:${shipProfile(ship)!.length}:${from}:${to}:${body.other.kind}:${profile.length}:${angle}`;
      let polygon=trafficShapes.get(shapeKey);
      if(!polygon){const c=detCos(angle),s=detSin(angle),outline=profile.hull.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));
        polygon=convexHull(outline.flatMap(b=>shape.map(a=>({x:b.x-a.x,y:b.y-a.y}))));
        if(trafficShapes.size>=512)trafficShapes.delete(trafficShapes.keys().next().value!);trafficShapes.set(shapeKey,polygon);}
      return {...body,polygon};
    });
    configurations.set(key,obstacles);return obstacles;
  };
  const interior=(point:Point,polygon:readonly Point[])=>polygonPlanes(polygon).every(p=>point.x*p.x+point.y*p.y>p.min+1e-6);
  const clear=(from:ShipPose,to:ShipPose)=>{
    if(!bodies.length)return true;
    const dx=to.x-from.x,dy=to.y-from.y,turn=headingDifference(from.heading,to.heading);
    return configuration(from.heading,to.heading).every(body=>{
      if(pointSegmentDistanceSquared(body.center,from,to)>(radius+body.radius)**2)return true;
      const start={x:from.x-body.center.x,y:from.y-body.center.y},end={x:to.x-body.center.x,y:to.y-body.center.y};
      const clip=clipToConvex(start,end,body.polygon);if(!clip || clip[1]-clip[0]<1e-7)return true;
      const middle=(clip[0]+clip[1])/2;
      if(!interior({x:start.x+dx*middle,y:start.y+dy*middle},body.polygon))return true;
      // Initial contact may separate, but cannot rotate deeper into contact.
      return Math.abs(turn)<1e-7 && clip[0]<=1e-7 && dx*(from.x-body.center.x)+dy*(from.y-body.center.y)>0;
    });
  };
  return Object.assign(clear,{hasTraffic:bodies.length>0});
}

export function shipTrafficKey(ship:Unit,units:readonly Unit[]) {
  return units.filter(other=>other!==ship && other.hp>0 && shipProfile(other) && Math.hypot(other.x-ship.x,other.y-ship.y)<600)
    .map(other=>`${other.id}:${Math.round(other.x/16)}:${Math.round(other.y/16)}:${Math.round((other.sailing?.heading ?? 0)*16/Math.PI)}`).join('|');
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
      const polygon=expandConvex(convexHull(outline.flatMap(b=>hull.map(a=>({x:b.x-a.x,y:b.y-a.y})))),.1);
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
