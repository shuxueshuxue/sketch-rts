import { detCos, detSin } from "./det-math";
import { bodyMass } from "./physical-body";
import { circleInPolygon, localToWorld, shipPassengers, shipProfile, worldToLocal, type Point } from "./ship-geometry";
import { perTick } from "./time";
import type { Unit } from "./types";

export function deckLoad(units: readonly Unit[], ship: Unit) {
  return shipPassengers(units,ship).reduce((sum,unit)=>sum+bodyMass(unit),0);
}
export function deckPointFits(ship: Unit, passenger: Unit, point: Point, units: readonly Unit[], occupied=true) {
  const profile=shipProfile(ship);
  if(!profile || !circleInPolygon(point,passenger.radius+1,profile.deck))return false;
  if(profile.obstacles.some(o=>Math.hypot(point.x-o.x,point.y-o.y)<o.radius+passenger.radius+1))return false;
  return !occupied || !shipPassengers(units,ship).some(other=>other.id!==passenger.id && Math.hypot(point.x-other.deck!.x,point.y-other.deck!.y)<passenger.radius+other.radius+1);
}
/** Find actual free ground on a deck; neither supply nor a fixed slot count is consulted. */
export function deckPlacement(ship: Unit, passenger: Unit, units: readonly Unit[], preferred: Point={x:0,y:0}, occupied=true, spacing=4) {
  const profile=shipProfile(ship);
  if(!profile)return undefined;
  if(deckPointFits(ship,passenger,preferred,units,occupied))return preferred;
  let best:Point|undefined, score=Infinity;
  for(let y=-profile.beam/2;y<=profile.beam/2;y+=spacing) for(let x=-profile.length/2;x<=profile.length/2;x+=spacing) {
    const point={x,y}, value=(x-preferred.x)**2+(y-preferred.y)**2;
    if(value<score && deckPointFits(ship,passenger,point,units,occupied)){best=point;score=value;}
  }
  return best;
}
export function canBoard(ship: Unit, passenger: Unit, units: readonly Unit[]) {
  const profile=shipProfile(ship);
  return Boolean(profile && !shipProfile(passenger) && ship.owner===passenger.owner && !passenger.deck && deckLoad(units,ship)+bodyMass(passenger)<=profile.loadCapacity && deckPlacement(ship,passenger,units));
}
export function boardUnit(ship: Unit, passenger: Unit, units: readonly Unit[]) {
  const profile=shipProfile(ship);
  if(!profile || passenger.deck || deckLoad(units,ship)+bodyMass(passenger)>profile.loadCapacity)return false;
  // Enter along the aft port edge, preserving the open center for later passengers.
  const point=deckPlacement(ship,passenger,units,{x:-profile.length/2,y:-profile.beam/2},true,2);
  if(!point)return false;
  passenger.deck={shipId:ship.id,...point};
  passenger.aim=undefined;
  Object.assign(passenger,localToWorld(ship,point));
  return true;
}
export function syncDecks(units: readonly Unit[]) {
  const ships=new Map(units.filter(ship=>shipProfile(ship)).map(ship=>[ship.id,ship]));
  for(const ship of ships.values()) {
    const profile=shipProfile(ship)!, crew=shipPassengers(units,ship);
    const load=crew.reduce((sum,unit)=>sum+bodyMass(unit),0);
    const offset=load ? Math.hypot(crew.reduce((s,u)=>s+u.deck!.x*bodyMass(u),0),crew.reduce((s,u)=>s+u.deck!.y*bodyMass(u),0))/load : 0;
    ship.sailing??={heading:0,speed:0,load:0,balance:0};
    ship.sailing.load=load;
    ship.sailing.balance=offset/(profile.length/2);
  }
  for(const unit of units) if(unit.deck) {
    const ship=ships.get(unit.deck.shipId);
    if(ship)Object.assign(unit,localToWorld(ship,unit.deck));
  }
}

function clearPath(ship: Unit, passenger: Unit, a:Point, b:Point, units:readonly Unit[]) {
  const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/4));
  for(let i=1;i<=steps;i++)if(!deckPointFits(ship,passenger,{x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps},units,false))return false;
  return true;
}
/** Small visibility graph around fixed deck fittings; moving crew are physical bodies. */
function deckWaypoint(ship:Unit,passenger:Unit,goal:Point,units:readonly Unit[]) {
  const start=passenger.deck!, profile=shipProfile(ship)!;
  if(clearPath(ship,passenger,start,goal,units))return goal;
  const nodes:Point[]=[start,goal];
  for(const o of profile.obstacles)for(let i=0;i<12;i++) {
    const angle=i*Math.PI/6,r=(o.radius+passenger.radius+3)/detCos(Math.PI/12);
    const point={x:o.x+detCos(angle)*r,y:o.y+detSin(angle)*r};
    if(deckPointFits(ship,passenger,point,units,false))nodes.push(point);
  }
  const cost=nodes.map(()=>Infinity), previous=nodes.map(()=>-1), seen=new Set<number>();cost[0]=0;
  while(seen.size<nodes.length) {
    let current=-1;
    for(let i=0;i<nodes.length;i++)if(!seen.has(i)&&(current<0||cost[i]!<cost[current]!))current=i;
    if(current<0||!Number.isFinite(cost[current]!))break;
    if(current===1){let next=1;while(previous[next]!>0)next=previous[next]!;return nodes[next]!;}
    seen.add(current);
    for(let i=0;i<nodes.length;i++) {
      if(seen.has(i)||!clearPath(ship,passenger,nodes[current]!,nodes[i]!,units))continue;
      const candidate=cost[current]!+Math.hypot(nodes[i]!.x-nodes[current]!.x,nodes[i]!.y-nodes[current]!.y);
      if(candidate<cost[i]!){cost[i]=candidate;previous[i]=current;}
    }
  }
  return start;
}
export function moveOnDeck(passenger:Unit,ship:Unit,world:Point,units:readonly Unit[],pace=1) {
  if(!passenger.deck)return;
  const goal=deckPlacement(ship,passenger,units,worldToLocal(ship,world),false);
  if(!goal)return;
  const target=deckWaypoint(ship,passenger,goal,units), start=passenger.deck;
  const gap=Math.hypot(target.x-start.x,target.y-start.y), step=Math.min(gap,perTick(passenger.speed)*pace);
  if(gap===0)return;
  const next={x:start.x+(target.x-start.x)*step/gap,y:start.y+(target.y-start.y)*step/gap};
  if(deckPointFits(ship,passenger,next,units)){Object.assign(start,next);Object.assign(passenger,localToWorld(ship,start));}
}
/** Old snapshots nested passengers; migration exposes each exactly once without changing supply. */
export function restoreCargoDecks(units:Unit[]) {
  const existing=new Set(units.map(u=>u.id));
  for(const ship of [...units]) {
    const cargo=ship.cargo;
    if(!cargo)continue;
    delete ship.cargo;
    for(const passenger of cargo) {
      if(existing.has(passenger.id))continue;
      // Saved transports can be overfull under newer geometry. Expand that old-format
      // hull deterministically until its existing crew fits, without losing units.
      let placed=boardUnit(ship,passenger,units);
      for(let attempt=0;!placed && attempt<40;attempt++) {ship.deckScale=(ship.deckScale??1)*1.1;placed=boardUnit(ship,passenger,units);}
      if(!placed)throw new Error(`Cannot restore passenger ${passenger.id} aboard ${ship.id}`);
      passenger.order={type:"idle"};passenger.orderQueue=[];
      units.push(passenger);existing.add(passenger.id);
    }
  }
  syncDecks(units);
}
