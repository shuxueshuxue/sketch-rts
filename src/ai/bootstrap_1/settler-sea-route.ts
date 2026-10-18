import { combatCapability } from '../../shared/combat-capabilities';
import { polygonRadius } from '../../shared/navigation-math';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { shipRouteTraffic } from '../../shared/ship-avoidance';
import { shipProfile } from '../../shared/ship-geometry';
import { nearestShipPose, planVoyageRoute, type ShipPose } from '../../shared/ship-navigation';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { coastalFireDisks, coastalFireSegmentClear } from '../policy/coastal-voyage';
import { isEnemyOwner } from '../policy/ownership';
import type { AiPolicyContext } from '../policy/types';

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);

/** A numerical escort advantage does not protect workers on an exposed deck.
 * Use actual ordinary-move corridors before admitting a nearby detour. */
export function settlerSeaRoutes(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: GameCommand[]) {
  const memory = options.memory.naval;
  if (!memory) return commands;
  const marks = memory.settlerSeaMarks ??= {};
  const held = new Set<string>(), moves: GameCommand[] = [];
  for (const boat of snapshot.units.filter(unit => unit.owner===owner && unit.sailing)) {
    const mission=memory.ferries?.[boat.id], profile=shipProfile(boat);
    if (!profile || !mission || !['settle','rebase'].includes(mission.purpose) || mission.phase==='loading'
      || !snapshot.units.some(unit=>unit.owner===owner && unit.kind==='worker' && unit.deck?.shipId===boat.id)) {
      delete marks[boat.id]; continue;
    }
    const goal=mission.phase==='return'?mission.from:mission.to;
    const enemies=snapshot.units.filter(unit=>unit.sailing && unit.hp>0 && isEnemyOwner(snapshot,owner,unit.owner,options)
      && combatCapability(snapshot,unit).armed && distance(unit,boat)<combatCapability(snapshot,unit).range+1100);
    if (!enemies.length) {delete marks[boat.id];continue;}
    const disks=[...coastalFireDisks(snapshot,boat,options),...enemies.map(unit=>({id:unit.id,x:unit.x,y:unit.y,
      // Preserve stand-off while a mobile battery approaches. A clear static
      // weapon circle alone admitted a long turn straight toward that ship.
      radius:Math.max(combatCapability(snapshot,unit).range+polygonRadius(profile.hull)+160,distance(boat,unit)-32)}))];
    const start:ShipPose={x:boat.x,y:boat.y,heading:boat.sailing!.heading};
    // This is advance avoidance. A ship already under fire needs a separate
    // withdrawal proof; do not pretend an intersecting corridor is safe.
    if (!coastalFireSegmentClear(start,start,disks)) {delete marks[boat.id];continue;}
    const safe=(points:readonly ShipPose[])=>{
      let previous=start;
      for(const point of points){if(!coastalFireSegmentClear(previous,point,disks))return false;previous=point;}
      return points.length>0;
    };
    const query=(destination:Point,complete:boolean)=>{
      const hull:Unit={...boat,order:{type:'move',...destination,avoidCombat:true},orderQueue:[],sailing:{...boat.sailing!}};
      delete hull.sailing!.route;
      const units=snapshot.units.map(unit=>unit.id===boat.id?hull:unit);
      beginShipCollisionFrame(units,snapshot.map,[...snapshot.buildings,...snapshot.obstacles??[]]);
      const route=planVoyageRoute(snapshot.map,hull,destination,shipRouteTraffic(snapshot.map,hull,units),1024);
      if (!route.points.length || complete && (route.partial || distance(route.points.at(-1)!,destination)>24)) return false;
      return safe(route.points);
    };
    let mark=marks[boat.id];
    if (mark && (distance(mark.goal,goal)>1 || distance(boat,mark.waypoint)<80 || !query(mark.waypoint,true))) {
      delete marks[boat.id];mark=undefined;
    }
    if (!mark) {
      // The executor may still follow an older incremental turn. A newly
      // queried safe route does not replace that cached native voyage.
      const executing=boat.sailing!.route;
      if ((!executing || safe(executing.points)) && query(goal,false)) continue;
      const candidates=Array.from({length:16},(_,i)=>nearestShipPose(snapshot.map,boat,
        {x:boat.x+600*Math.cos(i*Math.PI/8),y:boat.y+600*Math.sin(i*Math.PI/8)}))
        .filter((point):point is ShipPose=>!!point && distance(point,boat)>160 && distance(point,goal)<distance(boat,goal))
        .sort((a,b)=>distance(a,goal)-distance(b,goal));
      const waypoint=candidates.find(point=>query(point,true));
      if (!waypoint) continue;
      mark=marks[boat.id]={goal:{...goal},waypoint:{x:waypoint.x,y:waypoint.y}};
    }
    held.add(boat.id);
    if (boat.order.type!=='move' || !boat.order.avoidCombat || distance(boat.order,mark.waypoint)>1)
      moves.push({type:'move',unitIds:[boat.id],...mark.waypoint,avoidCombat:true});
  }
  for(const id of Object.keys(marks))if(!snapshot.units.some(unit=>unit.id===id))delete marks[id];
  return [...commands.flatMap((command):GameCommand[]=>{
    if(!('unitIds' in command))return [command];
    const unitIds=command.unitIds.filter(id=>!held.has(id));
    return unitIds.length?[{...command,unitIds}]:[];
  }),...moves];
}
