import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {prepareCrewRendezvous} from './crew-rendezvous';
import {setBuildingBodies} from './terrain';
import {localToWorld,shipProfile} from './ship-geometry';
import {decksCanTransfer} from './connected-decks';
import {reservationTraffic} from './ship-avoidance';
import {shipSolidTraffic,shipBodyClearAtPose,sweepShipCollision,beginShipCollisionFrame} from './ship-collisions';
import {planShipRoute,hullFits,SHIP_LOCAL_ROUTE_BUDGET} from './ship-navigation';

// Exact223200 periodic world/id/three memories of the fixed078026 continuation.
// Query regressions only: no Game/native step/manual orders are executed here.
function load(){
 const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/crew-rendezvous-original-223200.json.gz',import.meta.url))).toString());
 const s=f.snapshot;setBuildingBodies(s.map,[...s.buildings,...(s.obstacles??[])]);
 beginShipCollisionFrame(s.units,s.map,[...s.buildings,...(s.obstacles??[])]);
 const source=s.units.find((u:any)=>u.id==='unit-p0-bombardShip-50739'),target=s.units.find((u:any)=>u.id==='unit-p0-warship-31227'),crew=s.units.find((u:any)=>u.id==='unit-p0-summoner-39390');
 return {f,s,source,target,crew};
}
it('replans the actual empty blocked appointment into a real safe departure for the partner',()=>{
 const {f,s,source,target,crew}=load(),before=structuredClone(f),old=structuredClone(crew.order.rendezvous);
 expect(decksCanTransfer(source,target,crew)).toBe(false);
 expect(source.sailing.route).toMatchObject({points:[],partial:true});
 const oldGoal={x:old.sourceX,y:old.sourceY,heading:old.heading};
 expect(hullFits(s.map,source,oldGoal)).toBe(true);
 expect(shipBodyClearAtPose(s.map,source,oldGoal,[...s.units,...s.buildings,...(s.obstacles??[])])).toBe(true);
 const oldHull=reservationTraffic(source,s.units),oldSolids=shipSolidTraffic(s.map,source,s.units);
 const oldTraffic=Object.assign((a:any,b:any,p?:number)=>oldHull(a,b,p)&&oldSolids(a,b),{hasTraffic:oldHull.hasTraffic||oldSolids.hasTraffic});
 expect(planShipRoute(s.map,source,oldGoal,oldTraffic,SHIP_LOCAL_ROUTE_BUDGET)).toEqual({points:[],partial:true});
 prepareCrewRendezvous(s.map,s.units);
 expect(crew.order.type).toBe('board');expect(crew.order.transportId).toBe(target.id);
 expect(crew.order.rendezvous).not.toEqual(old);
 expect(source.order).toMatchObject({type:'move',rendezvousFor:crew.id});
 expect(target.order).toMatchObject({type:'move',rendezvousFor:crew.id});
 const h=reservationTraffic(target,s.units),b=shipSolidTraffic(s.map,target,s.units);
 const traffic=Object.assign((a:any,c:any,p?:number)=>h(a,c,p)&&b(a,c),{hasTraffic:h.hasTraffic||b.hasTraffic});
 const route=planShipRoute(s.map,target,target.order,traffic,SHIP_LOCAL_ROUTE_BUDGET);
 expect(route.points.length).toBeGreaterThan(0);
 const first=route.points[0]!,start={x:target.x,y:target.y,heading:target.sailing.heading};
 beginShipCollisionFrame(s.units,s.map,[...s.buildings,...(s.obstacles??[])]);
 expect(sweepShipCollision(s.map,target,s.units,start,first)).toBeUndefined();
 // Native planning changes only orders/routes, never relocates live bodies or policy memories.
 for(const unit of s.units){const prior=before.snapshot.units.find((u:any)=>u.id===unit.id);expect({x:unit.x,y:unit.y,deck:unit.deck,hp:unit.hp}).toEqual({x:prior.x,y:prior.y,deck:prior.deck,hp:prior.hp});}
 expect(f.memories).toEqual(before.memories);expect(f.nextId).toBe(before.nextId);
});
it('does not treat an unknown native route as evidence that the appointment is blocked',()=>{
 const {s,source,crew}=load(),old=structuredClone(crew.order.rendezvous);
 delete source.sailing.route;
 prepareCrewRendezvous(s.map,s.units);
 expect(crew.order.rendezvous).toEqual(old);
});
it('does not use a stale origin result to replace a still approaching task',()=>{
 const {s,source,crew}=load(),old=structuredClone(crew.order.rendezvous);
 source.sailing.route.startX-=1;
 prepareCrewRendezvous(s.map,s.units);
 expect(crew.order.rendezvous).toEqual(old);
});
it.each([false,true])('lets the reciprocal partner finish its existing nonempty native approach (partial=%s)',partial=>{
 const {s,source,target,crew}=load();
 // Counterfactual order-only boundary; no live hull or opponent is moved.
 const plan=crew.order.rendezvous;plan.targetY+=100;
 target.order={type:'move',x:plan.targetX,y:plan.targetY,heading:plan.heading,rendezvousFor:crew.id};
 target.sailing.route={goalX:plan.targetX,goalY:plan.targetY,partial,points:[{x:plan.targetX,y:plan.targetY,heading:plan.heading}]};
 const old=structuredClone(plan);prepareCrewRendezvous(s.map,s.units);
 expect(crew.order.rendezvous).toEqual(old);
 expect(source.order.rendezvousFor).toBe(crew.id);
});

it('keeps the registered building frame while checking a hypothetical reciprocal departure',()=>{
 const {s,source,target,crew}=load();
 // Portable order/geometry boundary only. A new farm blocks the previously
 // safe forward escape while both actual starting hulls remain body-clear.
 const start={x:target.x,y:target.y,heading:target.sailing.heading};
 const oldFirst={x:2135.7798784897154,y:5210.558192332396,heading:1.8036152252972375,exact:true};
 const dx=oldFirst.x-start.x,dy=oldFirst.y-start.y,length=Math.hypot(dx,dy),v={x:dx/length,y:dy/length};
 const atEnd={...target,x:oldFirst.x,y:oldFirst.y,sailing:{...target.sailing,heading:oldFirst.heading}};
 const leading=shipProfile(target)!.hull.map(point=>localToWorld(atEnd,point)).sort((a,b)=>b.x*v.x+b.y*v.y-a.x*v.x-a.y*v.y)[0]!;
 const wall={...s.buildings.find((b:any)=>b.id==='building-p0-shipyard-1022'),id:'diagnostic-forward-wall',kind:'farm',x:leading.x+v.x*16,y:leading.y+v.y*16,radius:16};
 s.buildings.push(wall);setBuildingBodies(s.map,[...s.buildings,...(s.obstacles??[])]);
 beginShipCollisionFrame(s.units,s.map,[...s.buildings,...(s.obstacles??[])]);
 expect(shipBodyClearAtPose(s.map,target,start,s.buildings)).toBe(true);
 expect(shipSolidTraffic(s.map,target,s.units)(start,oldFirst)).toBe(false);
 prepareCrewRendezvous(s.map,s.units);
 const hulls=[source,target].filter(ship=>ship.order.type==='move');
 for(const ship of hulls){
  const h=reservationTraffic(ship,s.units),b=shipSolidTraffic(s.map,ship,s.units);
  const traffic=Object.assign((a:any,c:any,p?:number)=>h(a,c,p)&&b(a,c),{hasTraffic:h.hasTraffic||b.hasTraffic});
  const route=planShipRoute(s.map,ship,ship.order,traffic,SHIP_LOCAL_ROUTE_BUDGET);
  if(route.points[0])expect(sweepShipCollision(s.map,ship,s.units,{x:ship.x,y:ship.y,heading:ship.sailing.heading},route.points[0])).toBeUndefined();
 }
 expect(crew.order.type).toBe('board');expect(crew.order.transportId).toBe(target.id);
});
it('recognizes the native numerical endpoint residual instead of restarting that hull forever',()=>{
 const {s,target,crew}=load();
 // The ordinary keel executor accepts up to1e-5 lateral residual on its final point.
 crew.order.rendezvous.targetX=target.x+5e-6;
 const old=structuredClone(crew.order.rendezvous);prepareCrewRendezvous(s.map,s.units);
 expect(crew.order.rendezvous).not.toEqual(old);
});
