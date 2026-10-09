import { shipTraffic } from './ship-avoidance';
import { isShipKind, shipProfile } from './ship-geometry';
import { advanceVoyageRefinement, beginVoyageRefinement, planDirectVoyage, advanceShipRouteSearch, headingDifference, type ShipRouteSearchState, type ShipPose, type VoyageRefinementState } from './ship-navigation';
import { windAt, updateWindField, WIND_CHANGE_INTERVAL_TICKS } from './wind-field';
import type { ShipCourseGoal } from './sailing';
import type { GameMap, Unit } from './types';
import { hasShipPlanningWork } from './ship-planning-budget';

type VoyageJob = { version:1; phase:'direct'|'reference'|'refine'|'finished'; ship:Unit; traffic:Unit[]; goal:ShipCourseGoal;
  windKey:string; guard:string; anchor?:ShipPose; recovery?:boolean; limited?:boolean; partial?:boolean; points?:ShipPose[]; searchSteps?:number; search?:ShipRouteSearchState; refinement?:VoyageRefinementState };
const decoded=new WeakMap<Unit,{source:string;job:VoyageJob}>();
const trafficViews=new WeakMap<VoyageJob,ReturnType<typeof shipTraffic>>();
// Restored checkpoints keep a compact logical cursor. Reconstruct its graph
// separately so a browser can yield between the same deterministic slices.
// This state never participates in the saved job or the world's checksum.
const reconstruction=new WeakMap<VoyageJob,{remaining:number;invalid:boolean}>();

function trafficView(job:VoyageJob):ReturnType<typeof shipTraffic> {
  let traffic=trafficViews.get(job);
  if(!traffic){traffic=shipTraffic(job.ship,job.traffic);trafficViews.set(job,traffic);}
  return traffic;
}
function voyageReference(job:VoyageJob):boolean {
  return job.goal.heading===undefined && Math.hypot(job.goal.x-job.ship.x,job.goal.y-job.ship.y)>shipProfile(job.ship)!.length*.5;
}
function prepareReferenceSearch(job:VoyageJob,map:GameMap,maxSlices:number):{ready:boolean;used:number;invalid:boolean} {
  if(job.phase!=='reference')return {ready:true,used:0,invalid:false};
  let state=reconstruction.get(job);
  if(!job.search){
    job.search={phase:'prepare'};
    state={remaining:job.searchSteps??0,invalid:false};
    reconstruction.set(job,state);
  }
  // A live graph already includes every saved logical slice; only a freshly
  // decoded graph has prior work left to reconstruct.
  if(!state)return {ready:true,used:0,invalid:false};
  if(state.invalid || state.remaining===0 || maxSlices===0)
    return {ready:state.invalid || state.remaining===0,used:0,invalid:state.invalid};
  const traffic=trafficView(job);
  let used=0;
  while(!state.invalid && state.remaining>0 && used<maxSlices){
    used++;
    if(advanceShipRouteSearch(map,job.ship,job.goal,traffic,job.limited?1024:Infinity,voyageReference(job),job.search)){
      // Leave authoritative fields untouched during preparation. The normal
      // planner rejects this invalid cursor when the simulation next advances.
      state.invalid=true;
    }else state.remaining--;
  }
  return {ready:state.invalid || state.remaining===0,used,invalid:state.invalid};
}
function preparationLimit(maxSlices:number):number {
  if(!Number.isSafeInteger(maxSlices) || maxSlices<0)throw new RangeError('Invalid ship preparation slice count');
  return maxSlices;
}

/** Rebuild only derived work, without advancing the encoded logical cursor. */
export function prepareShipPlanningJob(ship:Unit,map:GameMap,maxSlices=1):boolean {
  const limit=preparationLimit(maxSlices),job=read(ship);
  return !job || !validShipPlanningJob(ship,job.goal,map) || prepareReferenceSearch(job,map,limit).ready;
}

/** Stable unit-order FIFO, with one budget shared across every restored hull. */
export function prepareRestoredShipPlanning(units:readonly Unit[],map:GameMap,maxSlices=1,currentTick?:number):boolean {
  let remaining=preparationLimit(maxSlices),ready=true;
  let validityMap=map;
  if(currentTick!==undefined && (currentTick+1)%WIND_CHANGE_INTERVAL_TICKS===0){
    // The next simulation tick applies this deterministic weather event
    // before steering. Predict only its validity; keep graph work on the
    // actual map so valid caches never move to a disposable clone.
    const nextMap={...map};
    if(updateWindField(nextMap,currentTick+1))validityMap=nextMap;
  }
  for(const unit of units){
    if(!unit.sailing?.planningJob)continue;
    // stepGame advances the clock before its ordinary request pruning.
    // A saved request missed last tick will be canceled there, even if its
    // geometry remains valid. Avoid rebuilding it; never cancel it early.
    if(currentTick!==undefined){
      const nextTick=currentTick+1,last=unit.sailing.planningJobLastRequestedAtTick;
      if(!hasShipPlanningWork(unit,units) || last===undefined || !Number.isSafeInteger(last)
        || last<0 || last>nextTick || last<nextTick-1)continue;
    }
    const job=read(unit);if(!job)continue;
    // The simulation still owns cancellation. Avoid rebuilding a graph that
    // its existing validity rules will reject on the next simulation tick.
    if(!validShipPlanningJob(unit,job.goal,validityMap))continue;
    const prepared=prepareReferenceSearch(job,map,remaining);
    remaining-=prepared.used;
    ready=prepared.ready && ready;
  }
  return ready;
}

export function prepareShipPlanningJobs(game:{units:readonly Unit[];map:GameMap;tick?:number},maxSlices=1):boolean {
  return prepareRestoredShipPlanning(game.units,game.map,maxSlices,game.tick);
}

function plannerUnit(source:Unit):Unit {
  // Navigation consumes geometry, handling and queued plain courses. Never
  // copy cargo, routes or another encoded job into this immutable projection.
  const motion=source.sailing;
  return JSON.parse(JSON.stringify({id:source.id,owner:source.owner,kind:source.kind,hp:source.hp,maxHp:source.maxHp,
    radius:source.radius,bodyRadius:source.bodyRadius,x:source.x,y:source.y,speed:source.speed,
    cargoCapacity:source.cargoCapacity,deckScale:source.deckScale,fittings:source.fittings,shipParts:source.shipParts,
    order:source.order,orderQueue:source.orderQueue,
    sailing:motion && {heading:motion.heading,speed:motion.speed,load:motion.load,balance:motion.balance,
      velocityX:motion.velocityX,velocityY:motion.velocityY,sail:motion.sail}})) as Unit;
}
function guard(ship:Unit):string {
  const profile=shipProfile(ship)!;
  // Deck balance and live headway change continuously. The actual helmsman
  // still uses current limits; those changes must not restart a coastal job.
  return `${ship.kind}:${profile.length}:${profile.beam}:${ship.maxHp}`;
}
function read(ship:Unit):VoyageJob|undefined {
  const source=ship.sailing?.planningJob;if(!source){decoded.delete(ship);return;}
  const cached=decoded.get(ship);if(cached?.source===source)return cached.job;
  try {
    const job=JSON.parse(source) as VoyageJob;
    if(job.version!==1 || !['direct','reference','refine','finished'].includes(job.phase) || !job.ship?.sailing
      || !Array.isArray(job.traffic) || !Number.isFinite(job.goal?.x) || !Number.isFinite(job.goal?.y)
      || job.searchSteps!==undefined && (!Number.isSafeInteger(job.searchSteps) || job.searchSteps<0))return;
    decoded.set(ship,{source,job});return job;
  }catch{return;}
}
function save(ship:Unit,job:VoyageJob):void {
  // The search graph is derived from immutable inputs and its logical step
  // count. Keeping it in the weak decoded view avoids megabyte snapshots and
  // repeated graph encoding; cold restores replay those exact prior slices.
  const {search:_,...saved}=job;
  const source=JSON.stringify(saved);ship.sailing!.planningJob=source;decoded.set(ship,{source,job});
}
export function cancelShipPlanningJob(ship:Unit):void {if(ship.sailing){delete ship.sailing.planningJob;delete ship.sailing.planningJobLastRequestedAtTick;}decoded.delete(ship);}
export function shipPlanningSliceCost(ship:Unit):number {
  const job=read(ship);return job?.phase==='finished'?0:job?.phase==='refine'?4:2;
}
export function holdsShipPlanningOrigin(ship:Unit):boolean {const job=read(ship);return !!job && (job.phase!=='direct' || job.recovery) && !job.anchor;}

export function beginShipPlanningJob(ship:Unit,goal:ShipCourseGoal,map:GameMap,units:readonly Unit[],anchor?:ShipPose,recovery=false):void {
  const frozen=plannerUnit(ship);
  if(anchor){frozen.x=anchor.x;frozen.y=anchor.y;frozen.sailing!.heading=anchor.heading;}
  const traffic=units.filter(unit=>unit!==ship && unit.hp>0 && isShipKind(unit.kind) && Math.hypot(unit.x-frozen.x,unit.y-frozen.y)<600).map(source=>JSON.parse(JSON.stringify({
    id:source.id,owner:source.owner,kind:source.kind,hp:source.hp,maxHp:source.maxHp,x:source.x,y:source.y,
    radius:source.radius,cargoCapacity:source.cargoCapacity,deckScale:source.deckScale,
    sailing:{heading:source.sailing?.heading??0}})) as Unit);
  const limited=shipTraffic(frozen,traffic).hasTraffic;
  save(ship,{version:1,phase:'direct',ship:frozen,traffic,goal:{...goal},windKey:windAt(map,ship).key,guard:guard(ship),
    ...(anchor?{anchor:{...anchor}}:{}),...(recovery?{recovery:true}:{}),...(limited?{limited:true}:{})});
}
export function validShipPlanningJob(ship:Unit,goal:ShipCourseGoal,map:GameMap):boolean {
  const job=read(ship);if(!job)return false;
  if(job.windKey!==windAt(map,ship).key || job.guard!==guard(ship) || job.goal.intent!==goal.intent
    || job.goal.targetId!==goal.targetId || job.goal.heading!==goal.heading || !!job.goal.retreat!==!!goal.retreat
    || (job.goal.fireHeading===undefined)!==(goal.fireHeading===undefined)
    || Math.hypot(job.goal.x-goal.x,job.goal.y-goal.y)>(goal.intent==='pursuit'?shipProfile(ship)!.length*.8:(map.terrain?.cell??32)/2))return false;
  if(job.anchor)return !!ship.sailing?.route?.points.some(point=>point.x===job.anchor!.x&&point.y===job.anchor!.y&&point.heading===job.anchor!.heading);
  if(job.phase!=='direct' && Math.abs(headingDifference(job.ship.sailing!.heading,ship.sailing!.heading))>.025)return false;
  return Math.hypot(job.ship.x-ship.x,job.ship.y-ship.y)<shipProfile(ship)!.length*.1;
}

/** Frozen inputs and the exact logical search count are authoritative.
 * The weak decoded view also retains the derived graph; cold restoration
 * reconstructs it through the same slices, trial order and geometric checks. */
export function advanceShipPlanningJob(ship:Unit,map:GameMap):{points:ShipPose[];partial:boolean;anchor?:ShipPose;recovery?:boolean}|undefined {
  const job=read(ship);if(!job)return;
  // Before its first granted slice, a deferred hull may pre-turn or keep
  // traversing its committed leg. No connector has been evaluated yet, so
  // freeze its actual pose and headway together when that slice is granted.
  if(job.phase==='direct' && !job.anchor){job.ship=plannerUnit(ship);trafficViews.delete(job);}
  // The synchronous voyage planner leaves nearby stations and requested
  // attitudes to the exact reference planner. They must not acquire an
  // artificial sailing circle or refinement when continued across ticks.
  const voyage=voyageReference(job);
  if(job.phase==='direct' && !voyage)job.phase='reference';
  const traffic=trafficView(job);
  let points:ShipPose[]|undefined;
  if(job.phase==='finished')points=job.points;
  else if(job.phase==='direct'){
    points=planDirectVoyage(map,job.ship,job.goal,traffic);
    if(!points){job.phase='reference';save(ship,job);return;}
  }else if(job.phase==='reference'){
    // Headless and direct simulation callers retain the synchronous contract;
    // browser callers can finish this exact reconstruction before advancing.
    if(prepareReferenceSearch(job,map,Infinity).invalid){cancelShipPlanningJob(ship);return;}
    const reference=advanceShipRouteSearch(map,job.ship,job.goal,traffic,job.limited?1024:Infinity,voyage,job.search!);
    job.searchSteps=(job.searchSteps??0)+1;
    if(!reference){save(ship,job);return;}
    delete job.search;delete job.searchSteps;
    job.partial=reference.partial;
    if(!voyage)points=reference.points;
    else {
      job.refinement=beginVoyageRefinement({x:job.ship.x,y:job.ship.y,heading:job.ship.sailing!.heading},reference.points);
      job.phase='refine';save(ship,job);return;
    }
  }else {
    if(!job.refinement)return;
    if(!advanceVoyageRefinement(map,job.ship,job.refinement,traffic,job.limited?2:8)){save(ship,job);return;}
    points=job.refinement.result;
  }
  if(!points)return;
  job.points=points;job.phase='finished';delete job.refinement;
  save(ship,job);
  return {points,partial:job.partial??false,...(job.anchor?{anchor:job.anchor}:{}),...(job.recovery?{recovery:true}:{})};
}
