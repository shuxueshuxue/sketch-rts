import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { shipPassengers, shipProfile } from '../../shared/ship-geometry';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { nearestShipPose, planVoyageRoute } from '../../shared/ship-navigation';
import { sameGround, isWalkable, walkDestination } from '../../shared/terrain';
import { boardingBerth } from '../../shared/naval';
import { seconds } from '../../shared/time';
import { coastOnWater } from '../policy/naval';
import { coastalFireDisks, coastalFireSegmentClear } from '../policy/coastal-voyage';
import { isOpponentOwner } from '../policy/ownership';
import { effectiveCombatRating } from '../policy/v6/strength';
import { mountedEscape } from './mounted-micro';
import { safeLandTravelTicks, armedFoes, retreatLandTravelTicks } from './safe-land-route';
import type { AiPolicyContext } from '../policy/types';
import type { GameSnapshot, PlayerId, Unit, GameCommand } from '../../shared/types';
type Point={x:number;y:number};
const gap=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const power=(s:GameSnapshot,units:Unit[])=>units.reduce((n,u)=>n+effectiveCombatRating(s,u),0);
const fighter=(u:Unit)=>u.kind!=='worker'&&u.expiresTick===undefined&&unitMover(u.kind)==='land';
function safeVoyage(s:GameSnapshot,ship:Unit,goal:Point,options:AiPolicyContext){
 const hull={...ship,order:{type:'move' as const,...goal},orderQueue:[],sailing:{...ship.sailing!}};delete hull.sailing.route;
 const units=s.units.map(u=>u.id===ship.id?hull:u);beginShipCollisionFrame(units,s.map,[...s.buildings,...s.obstacles??[]]);
 const route=planVoyageRoute(s.map,hull,goal,shipRouteTraffic(s.map,hull,units),1024);
 if(route.partial||!route.points.length||gap(route.points.at(-1)!,goal)>24)return undefined;
 const radius=Math.max(...shipProfile(ship)!.hull.map(p=>Math.hypot(p.x,p.y)));
 const disks=[...coastalFireDisks(s,ship,options),...s.units.filter(u=>u.sailing&&isOpponentOwner(s,ship.owner,u.owner,options)&&combatCapability(s,u).armed).map(u=>({id:u.id,x:u.x,y:u.y,radius:combatCapability(s,u).range+radius+160}))];
 let previous={x:ship.x,y:ship.y,heading:ship.sailing!.heading};
 for(const point of route.points){if(!coastalFireSegmentClear(previous,point,disks))return undefined;previous=point;}
 return route;
}
/** Commit one existing embarked detachment to an uncovered own hall.
 * Keep a coastal guard after relief; recover an outmatched detachment through
 * witnessed native boarding roads instead of spending it at a fixed post. */
export function homeRelief(s:GameSnapshot,owner:PlayerId,options:AiPolicyContext,planned:GameCommand[]=[]){
 const memory=options.memory,commands:GameCommand[]=[],claimed=new Set<string>();let selection:unknown;
 const halls=s.buildings.filter(b=>b.owner===owner&&b.kind==='townHall'&&b.complete);
 const enemies=s.units.filter(u=>!u.deck&&unitMover(u.kind)==='land'&&isOpponentOwner(s,owner,u.owner,options)&&combatCapability(s,u).armed);
 const attackers=(hall:Point)=>enemies.filter(u=>sameGround(s.map,u,hall)&&gap(u,hall)<900);
 let job=memory.homeRelief;
 if(job&&!halls.some(h=>h.id===job!.hallId)){delete memory.homeRelief;job=undefined;}
 if(!job&&s.tick>=(memory.homeReliefRetry??0)){
  memory.homeReliefRetry=s.tick+seconds(5);
  for(const hall of halls){
   const raiders=attackers(hall),threat=power(s,raiders);if(threat<.5)continue;
   const local=s.units.filter(u=>u.owner===owner&&!u.deck&&fighter(u)&&sameGround(s.map,u,hall)&&gap(u,hall)<900);
   if(power(s,local)>=threat*1.3)continue;
   const choices=s.units.filter(u=>u.owner===owner&&u.sailing&&shipProfile(u)&&u.hp>=u.maxHp*.7
    &&!memory.naval?.ferries?.[u.id]&&!memory.naval?.coastalRetreat?.[u.id]&&memory.naval?.outfit?.shipId!==u.id)
    .map(ship=>({ship,crew:shipPassengers(s.units,ship).filter(u=>u.owner===owner&&fighter(u)&&combatCapability(s,u).armed)}))
    .filter(c=>c.crew.length>=2&&power(s,c.crew)>=threat*1.3).sort((a,b)=>gap(a.ship,hall)-gap(b.ship,hall));
   for(const {ship,crew} of choices){
    const points=[hall,...Array.from({length:8},(_,i)=>({x:hall.x+450*Math.cos(i*Math.PI/4),y:hall.y+450*Math.sin(i*Math.PI/4)}))]
     .filter(p=>sameGround(s.map,p,hall)&&isWalkable(s.map,p.x,p.y)).flatMap(p=>{const coast=coastOnWater(s,p,ship);return coast?[coast]:[];})
     .filter((p,i,all)=>all.findIndex(q=>gap(p,q)<16)===i).sort((a,b)=>gap(ship,a)-gap(ship,b));
    for(const landing of points){
     const pose=nearestShipPose(s.map,ship,landing);if(!pose||gap(pose,landing)>shipProfile(ship)!.length)continue;
     const route=safeVoyage(s,ship,{x:pose.x,y:pose.y},options);if(!route)continue;
     const dist=gap(hall,landing)||1;const station=nearestShipPose(s.map,ship,{x:landing.x+(landing.x-hall.x)/dist*300,y:landing.y+(landing.y-hall.y)/dist*300});
     if(!station)continue;
     job=memory.homeRelief={hallId:hall.id,shipId:ship.id,crewIds:crew.map(u=>u.id),landing,station:{x:station.x,y:station.y},phase:'travel',since:s.tick,initialThreat:threat};
     selection={job:structuredClone(job),threat,crewPower:power(s,crew),route,pose};break;
    }
    if(job)break;
   }
   if(job)break;
  }
 }
 if(!job)return {commands,claimed,selection};
 const hall=halls.find(h=>h.id===job!.hallId)!,ship=s.units.find(u=>u.id===job!.shipId&&u.owner===owner);
 const crew=s.units.filter(u=>u.owner===owner&&job!.crewIds.includes(u.id));
 if(!ship&&!crew.length){delete memory.homeRelief;return {commands,claimed,selection};}
 const helmEmergency=!!ship&&(!!memory.naval?.coastalRetreat?.[ship.id]
  ||planned.some(c=>(c.type==='move'||c.type==='unload')&&c.avoidCombat&&c.unitIds.includes(ship.id)));
 const recovering=new Set(planned.flatMap(c=>c.type==='move'&&c.avoidCombat?c.unitIds:[]));
 if(ship&&!helmEmergency)claimed.add(ship.id);for(const u of crew)if(!recovering.has(u.id))claimed.add(u.id);
 const landFoes=armedFoes(s,owner,options),raid=attackers(hall);
 if(job.phase==='guard'&&ship&&!helmEmergency&&power(s,raid)>power(s,crew.filter(u=>!u.deck))*1.3){
  const waiting=crew.filter(u=>!u.deck),berth=waiting[0]&&boardingBerth(s.map,waiting[0],ship);
  if(berth?.shore&&waiting.every(u=>retreatLandTravelTicks(s,u,berth.shore!,landFoes)!==undefined)){
   const route=safeVoyage(s,ship,berth,options);
   if(route){job.phase='evacuate';selection={kind:'evacuation',job:structuredClone(job),berth,route,landTicks:waiting.map(u=>({id:u.id,ticks:retreatLandTravelTicks(s,u,berth.shore!,landFoes)}))};}
  }
 }
 if((job.phase==='evacuate'||job.phase==='recover')&&ship){
  if(helmEmergency)return {commands,claimed,selection};
  if(crew.every(u=>u.deck?.shipId===ship.id))job.phase='recover';
  if(job.phase==='evacuate'){
   if(ship.order.type!=='idle')commands.push({type:'stop',unitIds:[ship.id]});
   const waiting=crew.filter(u=>!u.deck&&(u.order.type!=='board'||u.order.transportId!==ship.id));
   if(waiting.length)commands.push({type:'board',unitIds:waiting.map(u=>u.id),transportId:ship.id});
  }else if(gap(ship,job.station)>80){
   if((ship.order.type!=='move'||gap(ship.order,job.station)>24)&&safeVoyage(s,ship,job.station,options))commands.push({type:'move',unitIds:[ship.id],...job.station,avoidCombat:true});
  }else if(ship.order.type!=='hold')commands.push({type:'holdPosition',unitIds:[ship.id]});
  return {commands,claimed,selection};
 }
 if(ship&&crew.some(u=>u.deck?.shipId===ship.id)){
  if(helmEmergency)return {commands,claimed,selection};
  if(ship.order.type!=='unload'||gap(ship.order,job.landing)>24)commands.push({type:'unload',unitIds:[ship.id],...job.landing});
 }else{
  job.phase='guard';
  if(ship&&!helmEmergency){
   if(gap(ship,job.station)>80){if(ship.order.type!=='move'||gap(ship.order,job.station)>24)commands.push({type:'move',unitIds:[ship.id],...job.station,avoidCombat:true});}
   else if(ship.order.type!=='hold')commands.push({type:'holdPosition',unitIds:[ship.id]});
  }
 }
 const foes=armedFoes(s,owner,options),raiders=attackers(hall);
 const landed=crew.filter(u=>!u.deck&&sameGround(s.map,u,hall)&&gap(u,hall)<1100);
 for(const unit of crew.filter(u=>!u.deck&&!recovering.has(u.id))){
  const target=raiders.filter(foe=>safeLandTravelTicks(s,unit,foe,foes.filter(f=>f.id!==foe.id))!==undefined)
   .sort((a,b)=>gap(unit,a)-gap(unit,b))[0];
  if(target&&power(s,landed)>=power(s,raiders)*1.1){if(unit.order.type!=='attack'||unit.order.targetId!==target.id)commands.push({type:'attack',unitIds:[unit.id],targetId:target.id});}
  else{
   const near=foes.filter(f=>gap(f,unit)<1000);
   if(raiders.length&&power(s,landed)<power(s,raiders)*1.1&&near.length){commands.push(mountedEscape(s,unit,near,0,undefined,true));continue;}
   const index=crew.indexOf(unit),post=walkDestination(s.map,unit,{x:hall.x+(index%2?80:-80),y:hall.y-120});
   if(gap(unit,post)>80){
    if(retreatLandTravelTicks(s,unit,post,foes)!==undefined){if(unit.order.type!=='move'||gap(unit.order,post)>24)commands.push({type:'move',unitIds:[unit.id],...post,avoidCombat:true});}
    else {const near=foes.filter(f=>gap(f,unit)<700);if(near.length)commands.push(mountedEscape(s,unit,near,0,undefined,true));}
   }
   else if(unit.order.type!=='hold')commands.push({type:'holdPosition',unitIds:[unit.id]});
  }
 }
 return {commands,claimed,selection};
}
