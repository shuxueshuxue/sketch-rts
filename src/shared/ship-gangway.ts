import { detCos, detSin } from './det-math';
import { clipToConvex, convexHull, expandConvex, capsuleClearsCircles } from './navigation-math';
import { hullGap, localToWorld, shipPassengers, shipProfile, shipsIn, worldToLocal, type Point } from './ship-geometry';
import { headingDifference, hullFits, type ShipPose } from './ship-navigation';
import { shipContactGoal, shipTraffic } from './ship-avoidance';
import { SHIP_IMPACT_SAFE_SPEED, shipPointVelocity } from './ship-collisions';
import { isCabinCrew, isInCabin } from './ship-cabin';
import { supportSurface } from './support-surface';
import { seconds } from './time';
import type { GameMap, GameSnapshot, Unit } from './types';

// RTS balance parameters: a short infantry passage, not a rigid hull constraint.
export const GANGWAY_WIDTH = 48;
export const GANGWAY_MAX_GAP = 36;
export const GANGWAY_MAX_RADIUS = 20;
export const GANGWAY_SETUP_TICKS = seconds(3);
export const GANGWAY_COOLDOWN_TICKS = seconds(20);
export const GANGWAY_HP = 60;
export const GANGWAY_HULL_DAMAGE_SHARE = .5;
const MAX_HEADING_DELTA = .15;
const SPAN_SLACK = 12;
const APPROACH_GAP = 12;

export type ShipGangway = {
  targetId:string; phase:'approach'|'deploying'|'ready';
  sourceAnchor:Point; targetAnchor:Point; width:number;
  initialSpan:number; initialHeadingDelta:number; hp:number;
  readyAtTick:number; cooldownUntilTick:number;
};
/** A body in the water gap follows both live endpoints, rather than one hull. */
export type GangwayCrossing = { sourceId:string; targetId:string; t:number; lateral:number };
export type GangwaySurface = { source:Point; target:Point; polygon:Point[]; width:number; phase:'deploying'|'ready' };
type CrewSnapshot = Partial<Pick<GameSnapshot,'variants'>>;
const crewRules = new WeakMap<Unit,CrewSnapshot>();
const surfaces = new WeakMap<ShipGangway,{a:ReturnType<typeof shipProfile>;b:ReturnType<typeof shipProfile>;key:string;surface:GangwaySurface|undefined}>();

/** Snapshot/query units are fresh objects. Bind their own variant definitions
 * without advancing deployment, changing cooldowns or touching saved state. */
export function bindGangwayCrewRules(units:readonly Unit[],snapshot:CrewSnapshot) {
  for(const source of shipsIn(units))if(source.sailing?.gangway)crewRules.set(source,snapshot);
}
export function gangwayCrewEligible(unit:Unit,snapshot:CrewSnapshot={}) {
  if(unit.variant!==undefined && !snapshot.variants?.[unit.variant])return false;
  return unit.hp>0 && !isInCabin(unit) && unit.radius<=GANGWAY_MAX_RADIUS && isCabinCrew(snapshot,unit);
}
export function shipBoardingRefusal(source:Unit,units:readonly Unit[],tick:number,snapshot:CrewSnapshot={}):'ship'|'crew'|'cooldown'|undefined {
  if(source.hp<=0 || !shipProfile(source) || !source.sailing)return 'ship';
  if(!shipPassengers(units,source).some(crew=>crew.owner===source.owner && gangwayCrewEligible(crew,snapshot)))return 'crew';
  if((source.sailing.gangwayCooldownUntilTick??0)>tick)return 'cooldown';
  return undefined;
}
export function shipBoardingTargetRefusal(source:Unit,target:Unit):'target'|'height'|undefined {
  const a=shipProfile(source),b=shipProfile(target);
  if(source===target || source.id===target.id || source.hp<=0 || target.hp<=0 || !a || !b || !target.sailing)return 'target';
  if(Math.abs(a.deckHeight-b.deckHeight)>GANGWAY_MAX_RADIUS*2)return 'height';
  return undefined;
}
function linearVelocity(ship:Unit):Point {
  const motion=ship.sailing!,heading=motion.heading;
  return {x:motion.velocityX??motion.speed*detCos(heading)+(ship.pushX??0),y:motion.velocityY??motion.speed*detSin(heading)+(ship.pushY??0)};
}
function relativeSpeed(source:Unit,target:Unit,a:Point,b:Point) {
  const av=shipPointVelocity(source,a,linearVelocity(source)),bv=shipPointVelocity(target,b,linearVelocity(target));
  return Math.hypot(av.x-bv.x,av.y-bv.y);
}
function polygonFor(a:Point,b:Point,width:number) {
  const length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1e-6)return [];
  const nx=-(b.y-a.y)/length*width/2,ny=(b.x-a.x)/length*width/2;
  return convexHull([{x:a.x+nx,y:a.y+ny},{x:a.x-nx,y:a.y-ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny}]);
}
function floorSupports(source:Unit,target:Unit,a:Point,b:Point,width:number) {
  const polygon=polygonFor(a,b,width);if(!polygon.length)return false;
  const hulls=[source,target].map(ship=>shipProfile(ship)!.hull.map(p=>localToWorld(ship,p)));
  const floor=supportSurface([...hulls,polygon],undefined,{left:0,top:0,right:0,bottom:0});
  const obstacles=[source,target].flatMap(ship=>shipProfile(ship)!.obstacles.map(o=>({...localToWorld(ship,o),radius:o.radius})));
  return floor.capsuleFits(a,b,GANGWAY_MAX_RADIUS+1) && capsuleClearsCircles(a,b,GANGWAY_MAX_RADIUS+1,obstacles);
}
/** A fixed local anchor inside each usable deck; the rectangle overlaps both
 * floors so the body's disk has support throughout the railing transition. */
function deploymentAnchors(source:Unit,target:Unit) {
  if(shipBoardingTargetRefusal(source,target) || hullGap(source,target)>GANGWAY_MAX_GAP
    || Math.abs(headingDifference(source.sailing!.heading,target.sailing!.heading))>MAX_HEADING_DELTA)return undefined;
  const a=shipProfile(source)!,b=shipProfile(target)!,heading=source.sailing!.heading;
  const relative=worldToLocal(source,target);
  if(Math.abs(relative.y)<(a.beam+b.beam)/4)return undefined;
  const shorter=Math.min(a.length,b.length);
  let best:{sourceAnchor:Point;targetAnchor:Point;span:number}|undefined;
  const onSide=(ship:Unit,station:Point,toward:Unit)=>{
    const profile=shipProfile(ship)!,floor=expandConvex(profile.deck,-GANGWAY_MAX_RADIUS-2),x=worldToLocal(ship,station).x;
    const from={x,y:-profile.beam},to={x,y:profile.beam},interval=clipToConvex(from,to,floor);if(!interval)return undefined;
    const side=worldToLocal(ship,toward).y>=0?interval[1]:interval[0];
    return {x,y:from.y+(to.y-from.y)*side};
  };
  for(const along of [0,-shorter*.1,shorter*.1,-shorter*.25,shorter*.25]) {
    const station={x:(source.x+target.x)/2+along*detCos(heading),y:(source.y+target.y)/2+along*detSin(heading)};
    const sourceAnchor=onSide(source,station,target),targetAnchor=onSide(target,station,source);if(!sourceAnchor||!targetAnchor)continue;
    const aw=localToWorld(source,sourceAnchor),bw=localToWorld(target,targetAnchor),span=Math.hypot(aw.x-bw.x,aw.y-bw.y);
    if(!floorSupports(source,target,aw,bw,GANGWAY_WIDTH))continue;
    if(!best || span<best.span)best={sourceAnchor,targetAnchor,span};
  }
  return best;
}
/** Read-only world geometry for simulation, routing and rendering. An invalid
 * connection never supplies floor, even before its saved state is cleaned up. */
export function gangwaySurface(source:Unit,target:Unit,state:ShipGangway|undefined=source.sailing?.gangway):GangwaySurface|undefined {
  if(!state || state.phase==='approach')return undefined;
  const pose=(ship:Unit)=>[ship.id,ship.hp,ship.x,ship.y,ship.sailing?.heading,ship.sailing?.speed,ship.sailing?.velocityX,ship.sailing?.velocityY,ship.sailing?.yawRate,ship.pushX,ship.pushY].join(',');
  const key=`${pose(source)}/${pose(target)}/${state.targetId},${state.phase},${state.hp},${state.sourceAnchor.x},${state.sourceAnchor.y},${state.targetAnchor.x},${state.targetAnchor.y},${state.width},${state.initialSpan},${state.initialHeadingDelta}`;
  const a=shipProfile(source),b=shipProfile(target),cached=surfaces.get(state);
  if(cached?.key===key && cached.a===a && cached.b===b)return cached.surface;
  const surface=computeGangwaySurface(source,target,state);
  surfaces.set(state,{a,b,key,surface});return surface;
}
function computeGangwaySurface(source:Unit,target:Unit,state:ShipGangway):GangwaySurface|undefined {
  if(state.phase==='approach' || state.targetId!==target.id || state.hp<=0 || shipBoardingTargetRefusal(source,target)
    || hullGap(source,target)>GANGWAY_MAX_GAP)return undefined;
  const delta=headingDifference(source.sailing!.heading,target.sailing!.heading);
  if(Math.abs(delta)>MAX_HEADING_DELTA || Math.abs(headingDifference(state.initialHeadingDelta,delta))>MAX_HEADING_DELTA)return undefined;
  const a=localToWorld(source,state.sourceAnchor),b=localToWorld(target,state.targetAnchor),span=Math.hypot(a.x-b.x,a.y-b.y);
  if(Math.abs(span-state.initialSpan)>SPAN_SLACK || relativeSpeed(source,target,a,b)>SHIP_IMPACT_SAFE_SPEED+1e-6
    || !floorSupports(source,target,a,b,state.width))return undefined;
  return {source:a,target:b,polygon:polygonFor(a,b,state.width),width:state.width,phase:state.phase};
}
export function gangwayBetween(a:Unit,b:Unit,passenger:Unit):{source:Unit;target:Unit;surface:GangwaySurface}|undefined {
  for(const [source,target] of [[a,b],[b,a]] as const) {
    if(source.sailing?.gangway?.phase!=='ready' || source.sailing.gangway.targetId!==target.id)continue;
    const context=crewRules.get(source);
    if(passenger.variant!==undefined && !context)continue;
    if(!gangwayCrewEligible(passenger,context??{}))continue;
    const surface=gangwaySurface(source,target);
    if(surface?.phase==='ready')return {source,target,surface};
  }
  return undefined;
}
/** Ordinary helm navigation approaches only the commanded source. A target's
 * saved course and helm are never changed by this ability. */
export function shipBoardingGoal(map:GameMap,units:readonly Unit[],source:Unit,target:Unit):ShipPose|undefined {
  if(shipBoardingTargetRefusal(source,target))return undefined;
  const heading=target.sailing!.heading,reach=shipProfile(source)!.length+shipProfile(target)!.length;
  const offset=Math.min(shipProfile(source)!.length,shipProfile(target)!.length)*.1;
  let best:ShipPose|undefined,score=Infinity;
  for(const side of [-1,1])for(const along of [0,-offset,offset]) {
    const station={x:target.x+along*detCos(heading),y:target.y+along*detSin(heading)};
    const probe={...source,x:station.x-side*detSin(heading)*reach,y:station.y+side*detCos(heading)*reach,sailing:{...source.sailing!,heading}};
    const pose=shipContactGoal(probe,station,[target]);if(!pose)continue;
    pose.x-=side*detSin(heading)*APPROACH_GAP;pose.y+=side*detCos(heading)*APPROACH_GAP;
    const candidate={...source,x:pose.x,y:pose.y,sailing:{...source.sailing!,heading}};
    if(!hullFits(map,source,pose)||!shipTraffic(candidate,units.filter(ship=>ship!==source&&ship!==target))(pose,pose)||!deploymentAnchors(candidate,target))continue;
    const cost=Math.hypot(source.x-pose.x,source.y-pose.y)+Math.abs(headingDifference(source.sailing!.heading,heading))*shipProfile(source)!.length/2;
    if(cost<score){score=cost;best=pose;}
  }
  return best;
}
export function beginShipBoarding(map:GameMap,units:readonly Unit[],source:Unit,target:Unit,tick:number,snapshot:CrewSnapshot={}):boolean {
  if(shipBoardingRefusal(source,units,tick,snapshot) || shipBoardingTargetRefusal(source,target) || !shipBoardingGoal(map,units,source,target))return false;
  crewRules.set(source,snapshot);
  source.sailing!.gangway={targetId:target.id,phase:'approach',sourceAnchor:{x:0,y:0},targetAnchor:{x:0,y:0},width:GANGWAY_WIDTH,
    initialSpan:0,initialHeadingDelta:0,hp:GANGWAY_HP,readyAtTick:0,cooldownUntilTick:source.sailing!.gangwayCooldownUntilTick??0};
  return true;
}
export function cancelShipBoarding(source:Unit) { if(source.sailing)delete source.sailing.gangway; }
/** Run before hull orders, and again after movement before syncing crew. */
export function updateShipGangways(map:GameMap,units:readonly Unit[],tick:number,snapshot:CrewSnapshot={}) {
  void map;
  for(const source of shipsIn(units)) {
    const state=source.sailing?.gangway;if(!state)continue;
    crewRules.set(source,snapshot);
    const target=units.find(unit=>unit.id===state.targetId);
    if(!target || shipBoardingTargetRefusal(source,target) || ['move','follow','unload'].includes(source.order.type)) {cancelShipBoarding(source);continue;}
    if(state.phase==='approach') {
      if(source.order.type!=='boardShip' || !shipPassengers(units,source).some(crew=>crew.owner===source.owner&&gangwayCrewEligible(crew,snapshot))) {cancelShipBoarding(source);continue;}
      const anchors=deploymentAnchors(source,target);if(!anchors)continue;
      const a=localToWorld(source,anchors.sourceAnchor),b=localToWorld(target,anchors.targetAnchor);
      if(relativeSpeed(source,target,a,b)>SHIP_IMPACT_SAFE_SPEED+1e-6)continue;
      Object.assign(state,{sourceAnchor:anchors.sourceAnchor,targetAnchor:anchors.targetAnchor,phase:'deploying',initialSpan:anchors.span,initialHeadingDelta:headingDifference(source.sailing!.heading,target.sailing!.heading),
        readyAtTick:tick+GANGWAY_SETUP_TICKS,cooldownUntilTick:tick+GANGWAY_COOLDOWN_TICKS});
      source.sailing!.gangwayCooldownUntilTick=state.cooldownUntilTick;
    } else if(!gangwaySurface(source,target,state))cancelShipBoarding(source);
    else if(state.phase==='deploying' && tick>=state.readyAtTick)state.phase='ready';
  }
}
/** Feed actual damage after armor/wards. A bridge has no separate kill or XP. */
export function damageShipGangway(source:Unit,damage:number) {
  const state=source.sailing?.gangway;
  if(!state || state.phase==='approach' || damage<=0)return;
  state.hp=Math.max(0,state.hp-damage*GANGWAY_HULL_DAMAGE_SHARE);
  if(state.hp===0)cancelShipBoarding(source);
}
export function gangwayCrossingPosition(crossing:GangwayCrossing,units:readonly Unit[]):Point|undefined {
  const source=units.find(ship=>ship.id===crossing.sourceId),target=units.find(ship=>ship.id===crossing.targetId);
  if(!source||!target)return undefined;
  const surface=gangwaySurface(source,target);if(surface?.phase!=='ready')return undefined;
  return gangwayPointOnSurface(crossing,surface);
}
export function gangwayPointOnSurface(crossing:GangwayCrossing,surface:GangwaySurface):Point {
  const dx=surface.target.x-surface.source.x,dy=surface.target.y-surface.source.y,len=Math.hypot(dx,dy);
  return {x:surface.source.x+dx*crossing.t-dy/len*crossing.lateral,y:surface.source.y+dy*crossing.t+dx/len*crossing.lateral};
}
export function gangwayCrossingAt(connection:{source:Unit;target:Unit;surface:GangwaySurface},point:Point):GangwayCrossing {
  const a=connection.surface.source,b=connection.surface.target,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  return {sourceId:connection.source.id,targetId:connection.target.id,t:Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(length*length))),
    lateral:((point.y-a.y)*dx-(point.x-a.x)*dy)/length};
}
