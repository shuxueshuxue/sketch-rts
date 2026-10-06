import { detCos, detSin } from './det-math';
import { decksTouch } from './connected-decks';
import { shipContactGoal, shipTraffic } from './ship-avoidance';
import { headingDifference, hullFits, type ShipPose } from './ship-navigation';
import { shipProfile } from './ship-geometry';
import type { GameMap, Unit, UnitOrder } from './types';

export type CrewRendezvous = {
  sourceId: string; sourceX: number; sourceY: number; heading: number;
  targetX: number; targetY: number; reciprocal: boolean;
};

function contactPose(source:Unit,target:Unit,heading:number,side:number):ShipPose|undefined {
  const reach=shipProfile(source)!.length+shipProfile(target)!.length;
  const probe={...source,x:target.x-side*detSin(heading)*reach,y:target.y+side*detCos(heading)*reach,sailing:{...source.sailing!,heading}};
  return shipContactGoal(probe,target,[target]);
}

function rendezvous(map:GameMap,units:readonly Unit[],source:Unit,target:Unit,crew:Unit):CrewRendezvous|undefined {
  const direction=Math.atan2(target.y-source.y,target.x-source.x);
  const reciprocal=source.owner===target.owner && ['idle','hold'].includes(target.order.type);
  const headings=(reciprocal ? [direction-Math.PI/2,direction+Math.PI/2,source.sailing!.heading,target.sailing!.heading] : [target.sailing!.heading])
    .sort((a,b)=>Math.abs(headingDifference(source.sailing!.heading,a))+(reciprocal?Math.abs(headingDifference(target.sailing!.heading,a)):0)
      -Math.abs(headingDifference(source.sailing!.heading,b))-(reciprocal?Math.abs(headingDifference(target.sailing!.heading,b)):0));
  let best:CrewRendezvous|undefined,bestScore=Infinity;
  for(const heading of headings)for(const side of [-1,1]){
    const targetPose={x:target.x,y:target.y,heading};
    const other={...target,...targetPose,sailing:{...target.sailing!,heading}};
    const sourcePose=contactPose(source,other,heading,side);if(!sourcePose)continue;
    if(reciprocal){
      const dx=(source.x+target.x-sourcePose.x-targetPose.x)/2,dy=(source.y+target.y-sourcePose.y-targetPose.y)/2;
      sourcePose.x+=dx;sourcePose.y+=dy;targetPose.x+=dx;targetPose.y+=dy;
    }
    const a={...source,x:sourcePose.x,y:sourcePose.y,sailing:{...source.sailing!,heading}},b={...target,x:targetPose.x,y:targetPose.y,sailing:{...target.sailing!,heading}};
    const traffic=units.filter(unit=>unit!==source&&unit!==target);
    if(!hullFits(map,source,sourcePose)||!hullFits(map,target,targetPose)||!decksTouch(a,b,crew)
      ||!shipTraffic(a,traffic)(sourcePose,sourcePose)||!shipTraffic(b,traffic)(targetPose,targetPose))continue;
    const score=Math.hypot(sourcePose.x-source.x,sourcePose.y-source.y)+Math.abs(headingDifference(source.sailing!.heading,heading))*shipProfile(source)!.length/2
      +(reciprocal?Math.hypot(targetPose.x-target.x,targetPose.y-target.y)+Math.abs(headingDifference(target.sailing!.heading,heading))*shipProfile(target)!.length/2:0);
    if(score<bestScore){bestScore=score;best={sourceId:source.id,sourceX:sourcePose.x,sourceY:sourcePose.y,heading,targetX:targetPose.x,targetY:targetPose.y,reciprocal};}
  }
  return best;
}

export function cancelCrewRendezvous(units:readonly Unit[],shipIds:ReadonlySet<string>){
  const cancelled=new Set<string>();
  for(const crew of units)if(crew.order.type==='board' && crew.deck && (shipIds.has(crew.deck.shipId)||shipIds.has(crew.order.transportId)||!!crew.order.rendezvous && shipIds.has(crew.order.rendezvous.sourceId))){
    cancelled.add(crew.id);crew.order={type:'idle'};crew.orderQueue=[];
  }
  for(const ship of units)if(ship.order.type==='move' && ship.order.rendezvousFor && cancelled.has(ship.order.rendezvousFor) && !shipIds.has(ship.id)){
    ship.order={type:'idle'};ship.sailing!.route=undefined;
  }
}

/** Crew orders create ordinary, engine-constrained navigation requests.
 * Other owners' ships are never commanded. A fresh ship command cancels its
 * implicit participation; nearby crew cross on foot only after contact. */
export function prepareCrewRendezvous(map:GameMap,units:readonly Unit[]) {
  const active=new Set(units.filter(crew=>crew.hp>0 && crew.deck && crew.order.type==='board').map(crew=>crew.id));
  for(const ship of units)if(ship.order.type==='move' && ship.order.rendezvousFor && !active.has(ship.order.rendezvousFor)){
    ship.order={type:'idle'};ship.sailing!.route=undefined;
  }
  const claimed=new Set<string>();
  for(const crew of units){
    if(crew.order.type!=='board'||!crew.deck||crew.deck.shipId===crew.order.transportId)continue;
    const order=crew.order,source=units.find(unit=>unit.id===crew.deck!.shipId),target=units.find(unit=>unit.id===order.transportId);
    if(!source||!target||source.hp<=0||target.hp<=0||source.owner!==crew.owner||claimed.has(source.id))continue;
    claimed.add(source.id);
    if(decksTouch(source,target,crew))continue;
    const participating=(ship:Unit)=>['idle','hold'].includes(ship.order.type)||ship.order.type==='move'&&ship.order.rendezvousFor===crew.id;
    if(!participating(source))continue;
    let plan=order.rendezvous;
    if(!plan || plan.sourceId!==source.id || !plan.reciprocal && Math.hypot(target.x-plan.targetX,target.y-plan.targetY)>4
      || plan.reciprocal && !participating(target))plan=rendezvous(map,units,source,target,crew);
    if(!plan)continue;
    order.rendezvous=plan;
    const navigate=(ship:Unit,x:number,y:number)=>{
      const next:UnitOrder={type:'move',x,y,heading:plan!.heading,rendezvousFor:crew.id};
      if(ship.order.type==='move' && ship.order.rendezvousFor===crew.id && ship.order.x===x && ship.order.y===y && ship.order.heading===plan!.heading)return;
      ship.order=next;ship.orderQueue=[];ship.sailing!.route=undefined;
    };
    navigate(source,plan.sourceX,plan.sourceY);
    if(plan.reciprocal && target.owner===crew.owner && participating(target)){claimed.add(target.id);navigate(target,plan.targetX,plan.targetY);}
  }
}
