import { detCos, detSin } from './det-math';
import { decksAllowCrossing,decksCanTransfer,decksSupportCrossing } from './connected-decks';
import { gangwaySurface } from './ship-gangway';
import { shipContactGoal, shipTraffic } from './ship-avoidance';
import { headingDifference, hullFits, type ShipPose } from './ship-navigation';
import { shipProfile, shipsIn } from './ship-geometry';
import { RANGED_ATTACK_RANGE_THRESHOLD } from './aiming';
import type { GameMap, Unit, UnitOrder } from './types';

export type CrewRendezvous = {
  sourceId: string; sourceX: number; sourceY: number; heading: number;
  targetX: number; targetY: number; reciprocal: boolean;
};

function contactPose(source:Unit,target:Unit,heading:number,side:number,along:number):ShipPose|undefined {
  const reach=shipProfile(source)!.length+shipProfile(target)!.length;
  const goal={x:target.x+along*detCos(heading),y:target.y+along*detSin(heading)};
  const probe={...source,x:goal.x-side*detSin(heading)*reach,y:goal.y+side*detCos(heading)*reach,sailing:{...source.sailing!,heading}};
  return shipContactGoal(probe,goal,[target]);
}

function rendezvous(map:GameMap,units:readonly Unit[],source:Unit,target:Unit,crew:Unit):CrewRendezvous|undefined {
  const direction=Math.atan2(target.y-source.y,target.x-source.x);
  const reciprocal=source.owner===target.owner && ['idle','hold'].includes(target.order.type) && !target.orderQueue?.length;
  const headings=(reciprocal ? [direction-Math.PI/2,direction+Math.PI/2,source.sailing!.heading,target.sailing!.heading] : [target.sailing!.heading])
    .sort((a,b)=>Math.abs(headingDifference(source.sailing!.heading,a))+(reciprocal?Math.abs(headingDifference(target.sailing!.heading,a)):0)
      -Math.abs(headingDifference(source.sailing!.heading,b))-(reciprocal?Math.abs(headingDifference(target.sailing!.heading,b)):0));
  let best:CrewRendezvous|undefined,bestScore=Infinity;
  // Nearby parallel stations avoid forcing a large hull around the far end
  // of its partner just to match both centers. The usable seam remains proven.
  const offset=Math.min(shipProfile(source)!.length,shipProfile(target)!.length)*.1;
  for(const heading of headings)for(const side of [-1,1])for(const along of [0,-offset,offset]){
    const targetPose={x:target.x,y:target.y,heading};
    const other={...target,...targetPose,sailing:{...target.sailing!,heading}};
    const sourcePose=contactPose(source,other,heading,side,along);if(!sourcePose)continue;
    if(reciprocal){
      const dx=(source.x+target.x-sourcePose.x-targetPose.x)/2,dy=(source.y+target.y-sourcePose.y-targetPose.y)/2;
      sourcePose.x+=dx;sourcePose.y+=dy;targetPose.x+=dx;targetPose.y+=dy;
    }
    const a={...source,x:sourcePose.x,y:sourcePose.y,sailing:{...source.sailing!,heading}},b={...target,x:targetPose.x,y:targetPose.y,sailing:{...target.sailing!,heading}};
    const traffic=units.filter(unit=>unit!==source&&unit!==target);
    if(!hullFits(map,source,sourcePose)||!hullFits(map,target,targetPose)||!decksSupportCrossing(a,b,crew)
      ||!shipTraffic(a,traffic)(sourcePose,sourcePose)||!shipTraffic(b,traffic)(targetPose,targetPose))continue;
    const score=Math.hypot(sourcePose.x-source.x,sourcePose.y-source.y)+Math.abs(headingDifference(source.sailing!.heading,heading))*shipProfile(source)!.length/2
      +(reciprocal?Math.hypot(targetPose.x-target.x,targetPose.y-target.y)+Math.abs(headingDifference(target.sailing!.heading,heading))*shipProfile(target)!.length/2:0);
    if(score<bestScore){bestScore=score;best={sourceId:source.id,sourceX:sourcePose.x,sourceY:sourcePose.y,heading,targetX:targetPose.x,targetY:targetPose.y,reciprocal};}
  }
  return best;
}

/** Recomputed from ordinary saved orders: crew can finish their crossing or
 * melee while an idle/fighting hull holds its berth. A new helm order always
 * takes precedence, and no contact can command another owner's voyage. */
export function boardingHoldShips(units:readonly Unit[]) {
  const holds=new Set<string>(),ships=shipsIn(units);
  if(!ships.length)return holds;
  const byId=new Map<string,Unit>(),vessels=new Set<string>();
  for(const unit of units)byId.set(unit.id,unit);
  for(const ship of ships)if(ship.hp>0)vessels.add(ship.id);
  const hold=(ship:Unit)=>{
    const order=ship.order;
    if(['idle','hold','aim','attack','attackMove'].includes(order.type) || order.type==='move' && order.rendezvousFor)holds.add(ship.id);
  };
  // A deployed passage belongs to its source helm. The target may escape on
  // its own voyage; the bridge contributes floor without commanding that helm.
  for(const source of ships) {
    const target=byId.get(source.sailing?.gangway?.targetId??'');
    if(target && gangwaySurface(source,target) && !['move','follow','unload'].includes(source.order.type))holds.add(source.id);
  }
  for(const crew of units) {
    if(crew.hp<=0 || !crew.deck || crew.cabin)continue;
    const order=crew.order;
    let source=byId.get(crew.deck.shipId),target:Unit|undefined;
    if(order.type==='board') {
      target=byId.get(order.transportId);
      // Crossing the center seam changes deck parent before the whole body is
      // safely inside the receiver. Keep the original berth until arrival.
      if(source?.id===target?.id && order.rendezvous)source=byId.get(order.rendezvous.sourceId);
    } else if((order.type==='attack' || order.type==='attackMove') && order.targetId && crew.attackRange<=RANGED_ATTACK_RANGE_THRESHOLD) {
      const opponent=byId.get(order.targetId);
      target=opponent?.deck?byId.get(opponent.deck.shipId):opponent;
      // Boarders remain a boarding battle after both fighters step onto one
      // hull. Their owner's touching vessel can still provide the way back.
      if(source && target?.id===source.id && opponent && crew.owner!==opponent.owner) {
        const invaderOwner=crew.owner!==source.owner?crew.owner:opponent.owner!==source.owner?opponent.owner:undefined;
        if(invaderOwner)for(const ship of ships)if(ship.owner===invaderOwner && ship.id!==source.id && decksAllowCrossing(source,ship,crew)){hold(source);hold(ship);}
      }
    } else if((order.type==='move' || order.type==='attackMove') && order.deckShipId)target=byId.get(order.deckShipId);
    if(!source || !target || source.id===target.id || !vessels.has(source.id) || !vessels.has(target.id) || !decksAllowCrossing(source,target,crew))continue;
    hold(source);hold(target);
  }
  return holds;
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
  let active:Set<string>|undefined;
  let boarders:Unit[]|undefined,pending:Unit[]|undefined;
  for(const unit of units){
    if(unit.deck && unit.order.type==='board'){
      (boarders??=[]).push(unit);
      if(unit.hp>0)(active??=new Set()).add(unit.id);
    }
    if(unit.order.type==='move' && unit.order.rendezvousFor)(pending??=[]).push(unit);
  }
  if(pending)for(const ship of pending)if(ship.order.type==='move' && ship.order.rendezvousFor && !active?.has(ship.order.rendezvousFor)){
    ship.order={type:'idle'};ship.sailing!.route=undefined;
  }
  if(!boarders)return;
  let claimed:Set<string>|undefined;
  for(const crew of boarders){
    if(crew.order.type!=='board'||!crew.deck||crew.deck.shipId===crew.order.transportId)continue;
    const order=crew.order,source=units.find(unit=>unit.id===crew.deck!.shipId),target=units.find(unit=>unit.id===order.transportId);
    if(!source||!target||source.hp<=0||target.hp<=0||source.owner!==crew.owner||claimed?.has(source.id))continue;
    (claimed??=new Set()).add(source.id);
    if(decksCanTransfer(source,target,crew)) {
      order.rendezvous??={sourceId:source.id,sourceX:source.x,sourceY:source.y,heading:target.sailing!.heading,targetX:target.x,targetY:target.y,reciprocal:false};
      for(const ship of [source,target])if(ship.order.type==='move' && ship.order.rendezvousFor===crew.id){
        ship.order={type:'idle'};ship.sailing!.route=undefined;ship.sailing!.speed=0;delete ship.sailing!.pursuit;
      }
      continue;
    }
    const participating=(ship:Unit)=>!ship.orderQueue?.length && (['idle','hold'].includes(ship.order.type)||ship.order.type==='move'&&ship.order.rendezvousFor===crew.id);
    if(!participating(source))continue;
    let plan=order.rendezvous;
    if(!plan || plan.sourceId!==source.id || !plan.reciprocal && (Math.hypot(target.x-plan.targetX,target.y-plan.targetY)>4 || Math.abs(headingDifference(target.sailing!.heading,plan.heading))>.01)
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
