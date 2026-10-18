import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { shipProfile, distanceToHull } from '../../shared/ship-geometry';
import { planVoyageRoute, type ShipPose } from '../../shared/ship-navigation';
import { BOARDING_GAP } from '../../shared/naval';
import { seconds } from '../../shared/time';
import { combatCapability } from '../../shared/combat-capabilities';
import { isEnemyOwner } from '../policy/ownership';
import { coastalFireDisks, coastalFireSegmentClear } from '../policy/coastal-voyage';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
const gap=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** Reapproach an existing boarding berth only after sustained lack of closing.
 * Keep other helm orders and native collision/boarding control authoritative. */
export function loadingApproach(snapshot:GameSnapshot,owner:PlayerId,options:AiPolicyContext,planned:GameCommand[]):GameCommand[]{
 const memory=options.memory.naval;
 if(!memory)return [];
 const marks=memory.loadingApproaches??={},seen=new Set<string>(),commands:GameCommand[]=[];
 for(const boat of snapshot.units){
  const mission=memory.ferries?.[boat.id],profile=shipProfile(boat);
  if(boat.owner!==owner||!boat.sailing||!profile||mission?.phase!=='loading'||boat.order.type!=='idle'
   ||planned.some(c=>'unitIds'in c&&c.unitIds.includes(boat.id)))continue;
  const waiting=snapshot.units.filter(u=>u.owner===owner&&!u.deck&&u.order.type==='board'&&u.order.transportId===boat.id);
  const first=waiting[0],berth=first?.order.type==='board'?first.order.berth:undefined;
  if(!first||!berth||!berth.shore||!waiting.some(unit=>gap(unit,berth.shore!)<=first.radius+BOARDING_GAP*4))continue;
  const crew=waiting.map(u=>u.id).sort().join('|'),goal={x:berth.x,y:berth.y};seen.add(boat.id);
  let mark=marks[boat.id];
  const hullGap=distanceToHull(boat,berth.shore);
  if(!mark||gap(mark.goal,goal)>1||gap(mark.shore,berth.shore)>1||mark.crew!==crew||hullGap<mark.bestGap-32){marks[boat.id]={tick:snapshot.tick,bestGap:hullGap,crew,goal,shore:{...berth.shore}};continue;}
  if(snapshot.tick-mark.tick<seconds(40)||gap(boat,berth)<profile.length||hullGap<=first.radius+BOARDING_GAP*2
    ||snapshot.tick-(mark.checkedAt??-Infinity)<seconds(5))continue;
  mark.checkedAt=snapshot.tick;
  const hull:Unit={...boat,order:{type:'move',...goal},orderQueue:[],sailing:{...boat.sailing}};delete hull.sailing!.route;
  const units=snapshot.units.map(u=>u.id===boat.id?hull:u);beginShipCollisionFrame(units,snapshot.map,[...snapshot.buildings,...snapshot.obstacles??[]]);
  const route=planVoyageRoute(snapshot.map,hull,goal,shipRouteTraffic(snapshot.map,hull,units),1024);
  if(route.partial||!route.points.length||gap(route.points.at(-1)!,goal)>24)continue;
  const radius=Math.max(...profile.hull.map(p=>Math.hypot(p.x,p.y)));
  const disks=[...coastalFireDisks(snapshot,boat,options),...snapshot.units.filter(u=>u.sailing&&isEnemyOwner(snapshot,owner,u.owner,options)&&combatCapability(snapshot,u).armed)
   .map(u=>({id:u.id,x:u.x,y:u.y,radius:combatCapability(snapshot,u).range+radius+160}))];
  let previous:ShipPose={x:boat.x,y:boat.y,heading:boat.sailing.heading};let safe=true;
  for(const point of route.points){if(!coastalFireSegmentClear(previous,point,disks)){safe=false;break;}previous=point;}
  if(!safe)continue;
  commands.push({type:'move',unitIds:[boat.id],...goal});delete marks[boat.id];
 }
 for(const id of Object.keys(marks))if(!seen.has(id))delete marks[id];
 return commands;
}
