import { detCos, detSin } from "./det-math";
import { bodyMass } from "./physical-body";
import { shipsIn, authoredShipScale, circleInPolygon, localToWorld, shipPassengers, shipProfile, worldToLocal, type Point } from "./ship-geometry";
import { perTick } from "./time";
import type { Unit } from "./types";
import { capsuleClearsBodies, capsuleClearsCircles, diskInConvex, expandConvex, polygonPlanes } from './navigation-math';
import { isInCabin } from './ship-cabin';
import { gangwayBetween, gangwayCrossingPosition } from './ship-gangway';

export function deckLoad(units: readonly Unit[], ship: Unit) {
  return (ship.holdMass ?? 0)+shipPassengers(units,ship).reduce((sum,unit)=>sum+bodyMass(unit),0);
}
export function deckPointFits(ship: Unit, passenger: Unit, point: Point, units: readonly Unit[], occupied=true) {
  const profile=shipProfile(ship);
  if(!profile || !diskInConvex(point,passenger.radius+1,profile.deck))return false;
  if(profile.obstacles.some(o=>Math.hypot(point.x-o.x,point.y-o.y)<o.radius+passenger.radius+1-1e-6))return false;
  return !occupied || !shipPassengers(units,ship).some(other=>other.hp>0 && !isInCabin(other) && other.id!==passenger.id && Math.hypot(point.x-other.deck!.x,point.y-other.deck!.y)<passenger.radius+other.radius+1-1e-6);
}
/** Whether a deck has free ground for this passenger anywhere: the answer of deckPlacement, without looking for the
 * closest spot once one is found. */
export function deckHasRoom(ship: Unit, passenger: Unit, units: readonly Unit[]) {
  return !!deckPlacement(ship, passenger, units, {x:0,y:0}, true, 4, true);
}
/** Find actual free ground on a deck; neither supply nor a fixed slot count is consulted. */
export function deckPlacement(ship: Unit, passenger: Unit, units: readonly Unit[], preferred: Point={x:0,y:0}, occupied=true, spacing=4, anywhere=false) {
  const profile=shipProfile(ship);
  if(!profile)return undefined;
  if(deckPointFits(ship,passenger,preferred,units,occupied))return preferred;
  const {xs,ys}=deckGrid(profile,spacing), probe={x:0,y:0};
  // Without the crew, the free ground is the deck's own: its grid points clear of the railing and fittings, found once
  // for a body of this size. The closest of them, the first in row order among equally close ones.
  if(!occupied){
    const free=freeDeckGrid(profile,passenger.radius,spacing).points;
    let best=-1,score=Infinity;
    for(let k=0;k<free.length;k+=2){
      const value=(free[k]!-preferred.x)**2+(free[k+1]!-preferred.y)**2;
      if(value<score){score=value;best=k;}
    }
    return best<0?undefined:{x:free[best]!,y:free[best+1]!};
  }
  // One synchronous placement reads the same floor and crew membership.
  // Keep the preferred fast path, and prepare only the projections and crew
  // reached by the original point checks; live crew fields remain per-point.
  // The deck's own free ground is known (see freeDeckGrid); a grid point there fits unless a crewman stands on it.
  const {mask}=freeDeckGrid(profile,passenger.radius,spacing);
  let crew:Unit[]|undefined;
  const fits=(point:Point,i:number,j:number)=>{
    if(!mask[j*xs.length+i])return false;
    crew ??= shipPassengers(units,ship);
    for(let index=0;index<crew.length;index++){
      const other=crew[index]!;
      if(other.hp>0 && !isInCabin(other) && other.id!==passenger.id && Math.hypot(point.x-other.deck!.x,point.y-other.deck!.y)<passenger.radius+other.radius+1-1e-6)return false;
    }
    return true;
  };
  // @@@deck-placement-rings - The closest free grid point to the preferred one, the first in row order among equally close
  // ones. The grid is searched in rings outward from the preferred point, and stops once no farther ring can come closer
  // than the best point found: a free spot near the preferred one is found after a few probes, not a scan of the deck.
  const nearest=(values:readonly number[],value:number)=>{
    let index=0;
    for(let i=1;i<values.length;i++)if(Math.abs(values[i]!-value)<Math.abs(values[index]!-value))index=i;
    return index;
  };
  const ci=nearest(xs,preferred.x), cj=nearest(ys,preferred.y);
  // How far the preferred point lies from the ring centre's grid point, along either axis.
  const offset=Math.max(Math.abs(xs[ci]!-preferred.x),Math.abs(ys[cj]!-preferred.y));
  let best:Point|undefined, score=Infinity, bi=0, bj=0;
  const visit=(i:number,j:number)=>{
    if(i<0||j<0||i>=xs.length||j>=ys.length)return;
    const x=xs[i]!,y=ys[j]!,value=(x-preferred.x)**2+(y-preferred.y)**2;
    if(!(value<score || value===score && (j<bj || j===bj && i<bi)))return;
    probe.x=x;probe.y=y;
    if(fits(probe,i,j)){best={x,y};score=value;bi=i;bj=j;}
  };
  if(anywhere){
    for(let j=0;j<ys.length && !best;j++)for(let i=0;i<xs.length && !best;i++)visit(i,j);
    return best;
  }
  const rings=Math.max(ci,cj,xs.length-1-ci,ys.length-1-cj);
  for(let r=0;r<=rings;r++) {
    // Every point of this ring is at least this far away; no farther ring can do better than the best already found.
    const reach=Math.max(0,r*spacing*(1-1e-9)-offset-1e-9);
    if(reach*reach>score)break;
    if(r===0){visit(ci,cj);continue;}
    for(let i=ci-r;i<=ci+r;i++){visit(i,cj-r);visit(i,cj+r);}
    for(let j=cj-r+1;j<=cj+r-1;j++){visit(ci-r,j);visit(ci+r,j);}
  }
  return best;
}
// The grid points of a deck where a body of this radius fits the railing and fittings: as a list in row order (x, y
// pairs), and as a mask over the grid (row by row).
const freeGrids=new WeakMap<object,Map<string,{points:number[];mask:Uint8Array}>>();
function freeDeckGrid(profile:NonNullable<ReturnType<typeof shipProfile>>,bodyRadius:number,spacing:number) {
  let grids=freeGrids.get(profile);
  if(!grids)freeGrids.set(profile,grids=new Map());
  const key=`${bodyRadius}/${spacing}`;
  let free=grids.get(key);
  if(!free){
    const {xs,ys}=deckGrid(profile,spacing),axes=polygonPlanes(profile.deck),radius=bodyRadius+1,points:number[]=[];
    const mask=new Uint8Array(xs.length*ys.length);
    const thresholds=axes.map(axis=>axis.min+radius*Math.hypot(axis.x,axis.y)-1e-6);
    ys.forEach((y,j)=>xs.forEach((x,i)=>{
      if(!axes.every((axis,index)=>x*axis.x+y*axis.y>=thresholds[index]!))return;
      if(profile.obstacles.some(o=>Math.hypot(x-o.x,y-o.y)<o.radius+bodyRadius+1-1e-6))return;
      mask[j*xs.length+i]=1;points.push(x,y);
    }));
    grids.set(key,free={points,mask});
  }
  return free;
}
// A deck's grid at a spacing: the same coordinates, accumulated step by step from the corner, that a row-by-row scan visits.
const deckGrids=new WeakMap<object,Map<number,{xs:number[];ys:number[]}>>();
function deckGrid(profile:NonNullable<ReturnType<typeof shipProfile>>,spacing:number) {
  let grids=deckGrids.get(profile);
  if(!grids)deckGrids.set(profile,grids=new Map());
  let grid=grids.get(spacing);
  if(!grid){
    const xs:number[]=[],ys:number[]=[];
    for(let y=-profile.beam/2;y<=profile.beam/2;y+=spacing)ys.push(y);
    for(let x=-profile.length/2;x<=profile.length/2;x+=spacing)xs.push(x);
    grids.set(spacing,grid={xs,ys});
  }
  return grid;
}
/** Project a pointer onto the usable floor, including the passenger's footprint.
 * Dragging past a railing stays at the railing; fittings and crew choose the
 * closest remaining free position rather than rejecting the whole gesture. */
export function projectDeckPoint(ship: Unit, passenger: Unit, preferred: Point, units: readonly Unit[]) {
  const profile=shipProfile(ship);
  if(!profile)return undefined;
  if(deckPointFits(ship,passenger,preferred,units))return preferred;
  if(diskInConvex(preferred,passenger.radius+1,profile.deck))return deckPlacement(ship,passenger,units,preferred,true,2);
  const floor=expandConvex(profile.deck,-passenger.radius-1-1e-6);
  let nearest:Point|undefined,score=Infinity;
  for(let i=0;i<floor.length;i++) {
    const a=floor[i]!,b=floor[(i+1)%floor.length]!,dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((preferred.x-a.x)*dx+(preferred.y-a.y)*dy)/(dx*dx+dy*dy)));
    const point={x:a.x+dx*t,y:a.y+dy*t},distance=(point.x-preferred.x)**2+(point.y-preferred.y)**2;
    if(distance<score){nearest=point;score=distance;}
  }
  if(nearest && deckPointFits(ship,passenger,nearest,units))return nearest;
  return deckPlacement(ship,passenger,units,preferred,true,2);
}
export function canBoard(ship: Unit, passenger: Unit, units: readonly Unit[]) {
  const profile=shipProfile(ship);
  if(!profile || shipProfile(passenger) || isInCabin(passenger))return false;
  if(passenger.deck){
    const source=units.find(unit=>unit.id===passenger.deck!.shipId),sourceProfile=source && shipProfile(source);
    if(!sourceProfile || source!.id===ship.id || Math.abs(profile.deckHeight-sourceProfile.deckHeight)>passenger.radius*2 && !gangwayBetween(source!,ship,passenger))return false;
  } else if(ship.owner!==passenger.owner)return false;
  return deckLoad(units,ship)+bodyMass(passenger)<=profile.loadCapacity && deckHasRoom(ship,passenger,units);
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
  const vessels=shipsIn(units);if(!vessels.length)return;
  const ships=new Map(vessels.map(ship=>[ship.id,ship]));
  // Each hull's crew in unit order, as shipPassengers lists it, gathered in one pass instead of one pass per hull.
  const crews=new Map<string,Unit[]>();
  for(const unit of units)if(unit.deck){const crew=crews.get(unit.deck.shipId);if(crew)crew.push(unit);else crews.set(unit.deck.shipId,[unit]);}
  for(const ship of ships.values()) {
    const profile=shipProfile(ship)!, crew=crews.get(ship.id)??[];
    const cabin=profile.obstacles.find(obstacle=>obstacle.type==='cabin');
    const load=(ship.holdMass ?? 0)+crew.reduce((sum,unit)=>sum+bodyMass(unit),0);
    const offset=load ? Math.hypot(crew.reduce((s,u)=>s+(isInCabin(u)?cabin?.x??u.deck!.x:u.deck!.x)*bodyMass(u),0),crew.reduce((s,u)=>s+(isInCabin(u)?cabin?.y??u.deck!.y:u.deck!.y)*bodyMass(u),0))/load : 0;
    ship.sailing??={heading:0,speed:0,load:0,balance:0};
    ship.sailing.load=load;
    ship.sailing.balance=offset/(profile.length/2);
  }
  for(const unit of units) if(unit.deck) {
    const ship=ships.get(unit.deck.shipId);
    const crossing=unit.gangway&&gangwayCrossingPosition(unit.gangway,units);
    if(ship) {
      if(crossing){Object.assign(unit,crossing);Object.assign(unit.deck,worldToLocal(ship,crossing));}
      else Object.assign(unit,localToWorld(ship,unit.deck));
    }
  }
}
/** A broken passage retreats only its live walkers to a surviving deck. A
 * passenger whose parent hull sank remains under normal shipwreck authority. */
export function settleGangwayCrossings(units:readonly Unit[]) {
  for(const passenger of units) {
    const crossing=passenger.gangway;
    if(!crossing || passenger.hp<=0 || gangwayCrossingPosition(crossing,units))continue;
    const parent=units.find(ship=>ship.id===passenger.deck?.shipId);
    if(!parent || parent.hp<=0)continue;
    const endpoints=[crossing.sourceId,crossing.targetId].map(id=>units.find(ship=>ship.id===id && ship.hp>0)).filter((ship):ship is Unit=>!!ship);
    endpoints.sort((a,b)=>Math.hypot(passenger.x-a.x,passenger.y-a.y)-Math.hypot(passenger.x-b.x,passenger.y-b.y));
    for(const ship of endpoints) {
      if(ship!==parent && deckLoad(units,ship)+bodyMass(passenger)>shipProfile(ship)!.loadCapacity)continue;
      const point=deckPlacement(ship,passenger,units,worldToLocal(ship,passenger));
      if(!point)continue;
      passenger.deck={shipId:ship.id,...point};delete passenger.gangway;
      Object.assign(passenger,localToWorld(ship,point));break;
    }
  }
}

type Body=Point&{radius:number};
// The other crew standing on this deck, as bodies in its frame: what a walk on the deck must not pass through.
function deckBodies(ship:Unit,passenger:Unit,units:readonly Unit[]):Body[] {
  return shipPassengers(units,ship).filter(other=>other.id!==passenger.id&&other.hp>0&&!isInCabin(other)).map(other=>({...other.deck!,radius:other.radius}));
}
function clearPath(ship: Unit, passenger: Unit, a:Point, b:Point, bodies?:readonly Body[]) {
  const profile=shipProfile(ship)!;
  return diskInConvex(a,passenger.radius+1,profile.deck) && diskInConvex(b,passenger.radius+1,profile.deck)
    && capsuleClearsCircles(a,b,passenger.radius+1,profile.obstacles)
    && (!bodies || capsuleClearsBodies(a,b,passenger.radius+1,bodies));
}
/** Small visibility graph around fixed deck fittings; moving crew are physical bodies. */
function deckWaypoint(ship:Unit,passenger:Unit,goal:Point,units:readonly Unit[],avoidCrew=false) {
  return deckRoute(ship,passenger,goal,units,avoidCrew)?.[1] ?? passenger.deck!;
}
/** The walk from where the passenger stands to the goal, start and goal included, or undefined when none is open. */
function deckRoute(ship:Unit,passenger:Unit,goal:Point,units:readonly Unit[],avoidCrew:boolean):Point[]|undefined {
  const start=passenger.deck!, profile=shipProfile(ship)!;
  // The crew is gathered once for the whole search, not once for every edge it tries.
  const bodies=avoidCrew?deckBodies(ship,passenger,units):undefined;
  if(clearPath(ship,passenger,start,goal,bodies))return [start,goal];
  const nodes:Point[]=[start,goal];
  // Deck corners connect narrow passages between the cabin and the railing.
  // Fitting-ring nodes alone can leave these routes disconnected on large hulls.
  for(const point of expandConvex(profile.deck,-passenger.radius-1-1e-4))
    if(deckPointFits(ship,passenger,point,units,false))nodes.push(point);
  const obstacles=[...profile.obstacles,...(bodies??[])];
  for(const o of obstacles)for(let i=0;i<12;i++) {
    const angle=i*Math.PI/6,r=(o.radius+passenger.radius+3)/detCos(Math.PI/12);
    const point={x:o.x+detCos(angle)*r,y:o.y+detSin(angle)*r};
    if(deckPointFits(ship,passenger,point,units,false))nodes.push(point);
  }
  const cost=nodes.map(()=>Infinity), previous=nodes.map(()=>-1), seen=new Set<number>();cost[0]=0;
  while(seen.size<nodes.length) {
    let current=-1;
    for(let i=0;i<nodes.length;i++)if(!seen.has(i)&&(current<0||cost[i]!<cost[current]!))current=i;
    if(current<0||!Number.isFinite(cost[current]!))break;
    if(current===1){const route=[nodes[1]!];for(let at=1;at>0;at=previous[at]!)route.unshift(nodes[previous[at]!]!);return route;}
    seen.add(current);
    for(let i=0;i<nodes.length;i++) {
      const candidate=cost[current]!+Math.hypot(nodes[i]!.x-nodes[current]!.x,nodes[i]!.y-nodes[current]!.y);
      if(seen.has(i)||candidate>=cost[i]!||!clearPath(ship,passenger,nodes[current]!,nodes[i]!,bodies))continue;
      if(candidate<cost[i]!){cost[i]=candidate;previous[i]=current;}
    }
  }
  return undefined;
}
/** Admission checks use the same fixed deck routes as walking. Temporary crew
 * congestion can yield; a railing or fitting that seals the route cannot. */
export function deckStaticPathExists(ship:Unit,passenger:Unit,goal:Point) {
  const start=passenger.deck;
  if(start?.shipId!==ship.id || !deckPointFits(ship,passenger,goal,[],false))return false;
  if(Math.hypot(goal.x-start.x,goal.y-start.y)<1e-7)return true;
  const next=deckWaypoint(ship,passenger,goal,[],false);
  return Math.hypot(next.x-start.x,next.y-start.y)>1e-7;
}
// @@@give-way - An idle body gives way to its own side's movement, as idle units do in Warcraft III: when a mover finds
// no way past its side's bodies but one past the fixed ground, each idle body of its side standing on that way is sent
// to the free spot nearest it off the way, and walks there as ordered. Bodies holding their ground, fighting or under
// orders do not yield. On a deck the bodies are crew and the fixed ground the deck's fittings: boarders packed in behind
// a stern cabin stood at the mouth of its pocket, and whoever was told to walk out of it never could. (The cabin door's
// queue has its own, see yieldCabinApproach.)
export function deckGiveWay(ship:Unit,mover:Unit,world:Point,units:readonly Unit[]):{unit:Unit;spot:Point}[] {
  if(!mover.deck)return [];
  // Only idle crew of the mover's side yield; a deck without any (a fight) needs no search.
  const willing=shipPassengers(units,ship).filter(other=>other.id!==mover.id && other.owner===mover.owner && other.hp>0 && !isInCabin(other)
    && !other.gangway && other.order.type==='idle' && !other.orderQueue?.length);
  if(!willing.length)return [];
  const goal=deckPlacement(ship,mover,units,worldToLocal(ship,world),true);
  if(!goal || deckRoute(ship,mover,goal,units,true))return [];
  const route=deckRoute(ship,mover,goal,units,false);
  if(!route)return [];
  const idle=willing.filter(other=>route.some((point,i)=>i>0 && !capsuleClearsBodies(route[i-1]!,point,0,[{...other.deck!,radius:mover.radius+other.radius+1}])));
  if(!idle.length)return [];
  // The way itself is kept clear, as if the mover already stood all along it.
  const way:Unit[]=[];
  route.forEach((point,i)=>{if(i===0)return;const from=route[i-1]!,steps=Math.max(1,Math.ceil(Math.hypot(point.x-from.x,point.y-from.y)/mover.radius));
    for(let k=1;k<=steps;k++)way.push({...mover,id:`${mover.id}#way${way.length}`,deck:{shipId:ship.id,x:from.x+(point.x-from.x)*k/steps,y:from.y+(point.y-from.y)*k/steps}});});
  const yielding:{unit:Unit;spot:Point}[]=[];
  for(const other of idle){
    const spot=deckPlacement(ship,other,[...units,...way],other.deck!,true,2);
    if(spot)yielding.push({unit:other,spot});
  }
  return yielding;
}
export function moveOnDeck(passenger:Unit,ship:Unit,world:Point,units:readonly Unit[],pace=1,avoidCrew=true) {
  if(!passenger.deck)return;
  const goal=deckPlacement(ship,passenger,units,worldToLocal(ship,world),avoidCrew);
  if(!goal)return;
  const target=deckWaypoint(ship,passenger,goal,units,avoidCrew), start=passenger.deck;
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
      for(let attempt=0;!placed && attempt<40;attempt++) {ship.deckScale=authoredShipScale(ship)*1.1;placed=boardUnit(ship,passenger,units);}
      if(!placed)throw new Error(`Cannot restore passenger ${passenger.id} aboard ${ship.id}`);
      passenger.order={type:"idle"};passenger.orderQueue=[];
      units.push(passenger);existing.add(passenger.id);
    }
  }
  syncDecks(units);
}
