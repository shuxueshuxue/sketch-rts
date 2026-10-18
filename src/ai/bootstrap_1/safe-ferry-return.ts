import {shipPassengers,shipProfile} from '../../shared/ship-geometry';
import {nearestShipPose,planVoyageRoute} from '../../shared/ship-navigation';
import {beginShipCollisionFrame} from '../../shared/ship-collisions';
import {shipRouteTraffic} from '../../shared/ship-avoidance';
import {landingSpot} from '../../shared/naval';
import {sameGround,isWalkable} from '../../shared/terrain';
import {coastOnWater} from '../policy/naval';
import {coastalFireDisks,coastalFireSegmentClear} from '../policy/coastal-voyage';
import {armedFoes,safeLandTravelTicks} from './safe-land-route';
import {combatCapability} from '../../shared/combat-capabilities';
import {isEnemyOwner} from '../policy/ownership';
import type {GameSnapshot,PlayerId,Unit,GameCommand} from '../../shared/types';
import type {AiPolicyContext} from '../policy/types';
const gap=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** A cancelled colony returns to a currently owned safe shore, not a stale departure.
 * Query native hull routes and passenger landings; issue only ordinary public commands. */
export function safeFerryReturn(s:GameSnapshot,owner:PlayerId,o:AiPolicyContext,planned:GameCommand[]){
 const commands:GameCommand[]=[],controlled=new Set<string>(),proofs:unknown[]=[];
 const halls=s.buildings.filter(b=>b.owner===owner&&b.kind==='townHall'&&b.complete&&b.hp>0),foes=armedFoes(s,owner,o);
 for(const ship of s.units.filter(u=>u.owner===owner&&u.sailing)){
  const job=o.memory.naval?.ferries?.[ship.id],profile=shipProfile(ship);
  if(!job||job.phase!=='return'||job.purpose!=='settle'||!profile)continue;
  const cargo=shipPassengers(s.units,ship),own=cargo.filter(u=>u.owner===owner&&u.expiresTick===undefined);if(!own.length)continue;
  if(o.memory.naval?.coastalRetreat?.[ship.id] || planned.some(c=>c.type==='move'&&c.unitIds.includes(ship.id)))continue;
  const lands=(boat:Unit,hall:typeof halls[number])=>own.every(u=>{const spot=landingSpot(s.map,boat,cargo.indexOf(u),cargo.length,s.units,u);return spot&&gap(spot,hall)<850&&sameGround(s.map,spot,hall)&&safeLandTravelTicks(s,{...u,...spot,deck:undefined,cabin:undefined},hall,foes)!==undefined;});
  const ready=halls.find(h=>lands(ship,h));controlled.add(ship.id);
  if(ready){if(ship.order.type!=='idle')commands.push({type:'stop',unitIds:[ship.id]});commands.push(...own.map(u=>({type:'unloadPassenger' as const,transportId:ship.id,passengerId:u.id})));proofs.push({shipId:ship.id,kind:'actualLanding',hallId:ready.id});continue;}
  const radius=Math.max(...profile.hull.map(p=>Math.hypot(p.x,p.y))),disks=[...coastalFireDisks(s,ship,o),...s.units.filter(u=>u.sailing&&isEnemyOwner(s,owner,u.owner,o)&&combatCapability(s,u).armed).map(u=>({id:u.id,x:u.x,y:u.y,radius:combatCapability(s,u).range+radius+160}))];
  let choice: {point:{x:number;y:number};hallId:string;route:unknown}|undefined;
  const candidates=[...halls.map(hall=>({hall,coast:job.from})),...halls.flatMap(hall=>[hall,...Array.from({length:8},(_,i)=>({x:hall.x+400*Math.cos(i*Math.PI/4),y:hall.y+400*Math.sin(i*Math.PI/4)}))].filter(p=>sameGround(s.map,p,hall)&&isWalkable(s.map,p.x,p.y)).flatMap(p=>{const coast=coastOnWater(s,p,ship);return coast?[{hall,coast}]:[];})).sort((a,b)=>gap(ship,a.coast)-gap(ship,b.coast))];
  for(const {hall,coast} of candidates){
   const pose=nearestShipPose(s.map,ship,coast);if(!pose)continue;
   const hull:Unit={...ship,x:pose.x,y:pose.y,sailing:{...ship.sailing!,heading:pose.heading},order:{type:'move',x:pose.x,y:pose.y},orderQueue:[]};if(!lands(hull,hall))continue;
   const moving:Unit={...ship,sailing:{...ship.sailing!},order:{type:'move',x:pose.x,y:pose.y,avoidCombat:true},orderQueue:[]};delete moving.sailing!.route;
   const units=s.units.map(u=>u.id===ship.id?moving:u);beginShipCollisionFrame(units,s.map,[...s.buildings,...s.obstacles??[]]);
   const route=planVoyageRoute(s.map,moving,pose,shipRouteTraffic(s.map,moving,units),1024);
   if(route.partial||!route.points.length||gap(route.points.at(-1)!,pose)>24)continue;
   let previous={x:ship.x,y:ship.y,heading:ship.sailing!.heading},clear=true;
   for(const p of route.points){if(!coastalFireSegmentClear(previous,p,disks)){clear=false;break;}previous=p;}if(!clear)continue;
   choice={point:{x:pose.x,y:pose.y},hallId:hall.id,route};break;
  }
  if(choice){job.from=choice.point;if(ship.order.type!=='move'||gap(ship.order,choice.point)>1||!ship.order.avoidCombat)commands.push({type:'move',unitIds:[ship.id],...choice.point,avoidCombat:true});proofs.push({shipId:ship.id,...choice});}
  else {commands.push({type:'stop',unitIds:[ship.id]});proofs.push({shipId:ship.id,kind:'noSafeRoute'});}
 }
 return {commands:[...planned.flatMap((c):GameCommand[]=>'unitIds'in c&&['unload','move','stop','holdPosition'].includes(c.type)?(c.unitIds.some(id=>controlled.has(id))?c.unitIds.every(id=>controlled.has(id))?[]:[{...c,unitIds:c.unitIds.filter(id=>!controlled.has(id))}]:[c]):[c]),...commands],proofs};
}
