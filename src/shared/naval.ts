import { unitMover } from "./catalog";
import { detCos, detSin } from "./det-math";
import { isOpenGround, isWalkable, sameGround, walkableGoal, walkDestination } from "./terrain";
import type { Building, GameMap, Obstacle, Unit } from "./types";
import { deckPlacement } from "./decks";
import { shipPassengers, shipProfile, localToWorld, worldToLocal, distanceToHull } from "./ship-geometry";
import { shipBodyClearanceAtHeading } from "./ship-collisions";
import { hullFits, nearestShipPose } from "./ship-navigation";
import { decksCanTransfer, shipShorePoints } from "./connected-decks";
import { isInCabin } from './ship-cabin';

// @@@reach - A unit fights only what it can come within its reach of from its own ground (see @@@terrain-movers): a
// soldier strikes a ship that has come in to the shallows, where it can wade out to it, and not one out on deep water; an
// archer on the beach shoots a ship within its range of the shore; a ship shoots what stands within its range of the water.
// Seeking a target, turning on an attacker, keeping one and charging all ask this, so nobody stands on a beach waiting for
// a ship it will never reach. A target on the attacker's own ground it can always reach (a walk the buildings bar is the
// walk's matter, not the fight's); any other it reaches from where its ground comes nearest. Two land units were taken to
// share their ground, and on the islands they do not: three riders sought a snapper 118 to 152 off across a deep channel
// and pressed against each other on the shore for minutes, each walk ending at the same spot (pool-elderwood-4).
export function canReach(map: Pick<GameMap, "terrain" | "width" | "height">, attacker: Unit, target: Unit | Building | Obstacle, units: readonly Unit[] = [], attackRange = attacker.attackRange) {
  if (isInCabin(attacker) || ('order' in target && isInCabin(target))) return false;
  const targetDeck="order" in target && target.deck && units.find(ship=>ship.id===target.deck!.shipId);
  if (attacker.deck) {
    if ("deck" in target && target.deck?.shipId === attacker.deck.shipId) return true;
    const ship = units.find(unit => unit.id === attacker.deck!.shipId);
    if(ship && targetDeck && decksCanTransfer(ship,targetDeck,attacker))return true;
    if(ship && !targetDeck && shipShorePoints(ship,map).some(point=>sameGround(map,point,target,"land")))return true;
    const stand = ship && deckPlacement(ship, attacker, units, worldToLocal(ship,target), false);
    const at = ship && stand ? localToWorld(ship,stand) : attacker;
    return ("order" in target && shipProfile(target)?distanceToHull(target,at):Math.hypot(at.x-target.x,at.y-target.y)-("order" in target ? 0 : target.radius)) <= attackRange;
  }
  if (!map.terrain) return true;
  if(targetDeck && unitMover(attacker.kind)==="land" && shipShorePoints(targetDeck,map).some(point=>sameGround(map,attacker,point,"land")))return true;
  const mover = unitMover(attacker.kind);
  if (isWalkable(map, target.x, target.y, mover) && sameGround(map, attacker, target, mover)) return true;
  // A building is reached at its wall (see @@@building-reach), a unit at its center.
  const stand = walkDestination(map, attacker, walkableGoal(map, target.x, target.y, mover), mover);
  return ("order" in target && shipProfile(target)?distanceToHull(target,stand):Math.hypot(stand.x - target.x, stand.y - target.y) - ("order" in target ? 0 : target.radius)) <= attackRange;
}

// @@@transport - Crew remain ordinary live units on a moving deck. Circles must fit
// the exported deck and fittings, and their body mass must fit the ship's payload.
// The owner can select, fight with and individually unload crew near a shore.
export const BOARDING_GAP = 24;
// A passenger steps ashore only on land this near the transport's side.
export const LANDING_REACH = 72;

export function carries(unit: Unit) {
  return shipProfile(unit)?.loadCapacity ?? 0;
}

export function alongside(unit: Unit, transport: Unit) {
  return distanceToHull(transport,unit)<=unit.radius+BOARDING_GAP;
}

/** One reachable shore for the whole boat, rather than chasing each passenger in turn. */
export function boardingBerth(map: GameMap, passenger: Unit, transport: Unit) {
  if (!map.terrain) return { x: transport.x, y: transport.y };
  // A terrain-clear hull can still be out of boarding reach. Keep searching
  // its other poses instead of rejecting the whole shore after the first one.
  const reachesShore = (shore: {x:number;y:number}) => (pose: {x:number;y:number;heading:number}) =>
    distanceToHull({...transport,...pose,sailing:{heading:pose.heading,speed:0,load:0,balance:0}},shore)<=passenger.radius+BOARDING_GAP;
  const terrain = map.terrain;
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let index = 0; index < terrain.cells.length; index++) {
    if (terrain.cells[index] !== ",") continue;
    const point = { x: (index % terrain.cols + 0.5) * terrain.cell, y: (Math.floor(index / terrain.cols) + 0.5) * terrain.cell };
    if (!isOpenGround(map, point.x, point.y) || !isOpenGround(map, point.x, point.y, "sea")) continue;
    if (!sameGround(map, passenger, point) || !sameGround(map, transport, point, "sea")) continue;
    const score = Math.hypot(point.x - transport.x, point.y - transport.y) * 2 + Math.hypot(point.x - passenger.x, point.y - passenger.y) * 0.15;
    candidates.push({ ...point, score });
  }
  for (const point of candidates.sort((a,b) => a.score-b.score)) {
    const land = walkDestination(map, passenger, point);
    const sea = nearestShipPose(map,transport,point,transport,reachesShore(land));
    if(!sea)continue;
    const dock={...transport,x:sea.x,y:sea.y,sailing:{heading:sea.heading,speed:0,load:0,balance:0}};
    if (Math.hypot(land.x-point.x, land.y-point.y) < 1 && distanceToHull(dock,land)<=passenger.radius+BOARDING_GAP)return {x:sea.x,y:sea.y,heading:sea.heading,shore:land};
  }
  const land = walkDestination(map, passenger, walkableGoal(map, transport.x, transport.y));
  const sea = nearestShipPose(map,transport,walkableGoal(map,land.x,land.y,"sea"),transport,reachesShore(land));
  if(!sea)return undefined;
  const dock={...transport,x:sea.x,y:sea.y,sailing:{heading:sea.heading,speed:0,load:0,balance:0}};
  return distanceToHull(dock,land)<=passenger.radius+BOARDING_GAP ? {x:sea.x,y:sea.y,heading:sea.heading,shore:land} : undefined;
}

/** Keep a boarding pose outside waiting passengers while retaining their shore.
 * Search by hull length: a carrier may need more than a boarding gap of
 * displacement to put its center outside the soldiers it is collecting.
 * Every candidate still needs hull, body and actual boarding-reach clearance. */
export function clearBoardingBerth(map: GameMap, passenger: Unit, boat: Unit,
  berth: NonNullable<Extract<Unit["order"], {type:"board"}>["berth"]>, units: readonly Unit[]) {
  // A coarse shore-cell center can miss an already reachable side of the
  // stationary hull. Refine that same shore cell before sending the ship on
  // a new maneuver away from the approaching passengers.
  const shore=berth.shore ?? passenger;
  const cell=map.terrain?.cell;
  if(cell && Math.hypot(boat.x-shore.x,boat.y-shore.y)<(shipProfile(boat)?.length ?? boat.radius*2)/2+cell) {
    const candidates=[] as {x:number;y:number}[];
    const left=Math.floor(shore.x/cell)*cell,top=Math.floor(shore.y/cell)*cell;
    for(let y=top+1;y<top+cell;y+=cell/4)for(let x=left+1;x<left+cell;x+=cell/4)candidates.push({x,y});
    candidates.sort((a,b)=>distanceToHull(boat,a)-distanceToHull(boat,b));
    const reachable=candidates.find(point=>{
      if(distanceToHull(boat,point)>passenger.radius+BOARDING_GAP || !isOpenGround(map,point.x,point.y)
        || !sameGround(map,passenger,point))return false;
      const arrival=walkDestination(map,passenger,point);
      return Math.hypot(arrival.x-point.x,arrival.y-point.y)<1e-7;
    });
    if(reachable)return {x:boat.x,y:boat.y,heading:boat.sailing?.heading ?? 0,shore:reachable};
  }
  const heading=berth.heading ?? boat.sailing?.heading ?? 0;
  const bodiesClear=shipBodyClearanceAtHeading(map,boat,heading,units);
  const clear=(x:number,y:number)=>bodiesClear({x,y}) && hullFits(map,boat,{x,y,heading});
  if(clear(berth.x,berth.y))return berth;
  const searchRadius=(shipProfile(boat)?.length ?? boat.radius*2)/2+passenger.radius+BOARDING_GAP;
  for(let radius=8;radius<=searchRadius;radius+=8) {
    const candidates=[] as {x:number;y:number}[];
    for(let y=-radius;y<=radius;y+=8)for(let x=-radius;x<=radius;x+=8) {
      if(Math.max(Math.abs(x),Math.abs(y))!==radius)continue;
      candidates.push({x:berth.x+x,y:berth.y+y});
    }
    candidates.sort((a,b)=>Math.hypot(a.x-berth.x,a.y-berth.y)-Math.hypot(b.x-berth.x,b.y-berth.y));
    for(const point of candidates) {
      const dock={...boat,...point,sailing:{...boat.sailing!,heading}};
      if(distanceToHull(dock,shore)>passenger.radius+BOARDING_GAP || !clear(point.x,point.y))continue;
      return {...berth,...point,heading};
    }
  }
  return undefined;
}

// Where the transport's passenger number `index` of `count` steps ashore: the land nearest a point on the transport's side,
// the passengers spread round it; undefined when no land is near enough.
export function landingSpot(map: Pick<GameMap, "terrain" | "width" | "height">, transport: Unit, index: number, count: number, units:readonly Unit[]=[], passenger?:Unit) {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const profile=shipProfile(transport);
  const radius=passenger?.radius??12;
  const edge=localToWorld(transport,{x:detCos(angle)*((profile?.length ?? transport.radius*2)/2+radius+2),y:detSin(angle)*((profile?.beam ?? transport.radius*2)/2+radius+2)});
  const shore=transport.order.type==="unload"?walkableGoal(map,transport.order.x,transport.order.y):undefined;
  const preferred=shore??edge;
  const clear=(p:{x:number;y:number})=>p.x>=0&&p.y>=0&&p.x<=map.width&&p.y<=map.height
    && isOpenGround(map,p.x,p.y) && (!shore || sameGround(map,shore,p))
    && distanceToHull(transport,p)>=radius+1 && distanceToHull(transport,p)<=LANDING_REACH
    && !units.some(u=>u!==passenger&&!u.deck&&unitMover(u.kind)==="land"&&Math.hypot(p.x-u.x,p.y-u.y)<radius+u.radius+1);
  const nearest=walkableGoal(map,preferred.x,preferred.y);
  if(clear(nearest))return nearest;
  const span=(profile?.length??transport.radius*2)/2+LANDING_REACH;
  const step=map.terrain?map.terrain.cell/4:Math.max(8,radius);
  let best:{x:number;y:number}|undefined,score=Infinity;
  for(let y=Math.max(step/2,Math.floor((transport.y-span)/step)*step+step/2);y<Math.min(map.height,transport.y+span);y+=step)
    for(let x=Math.max(step/2,Math.floor((transport.x-span)/step)*step+step/2);x<Math.min(map.width,transport.x+span);x+=step) {
      const p={x,y},value=Math.hypot(x-preferred.x,y-preferred.y);
      if(value<score && clear(p)){best=p;score=value;}
    }
  return best;
}

export function passengerLandingSpot(map: Pick<GameMap, "terrain" | "width" | "height">, transport: Unit, passengerId: string, units: readonly Unit[] = []) {
  const passengers = transport.cargo ?? shipPassengers(units,transport);
  const index = passengers.findIndex(passenger => passenger.id === passengerId);
  return index < 0 ? undefined : landingSpot(map, transport, index, passengers.length,units,passengers[index]);
}

/** Portraits execute immediately without replacing a ferry's helm order.
 * Check the existing native unload and its intended landmass, then reserve
 * each actual landing body in command order against this immutable frame.
 * This proves only the returned landings, not completion of the whole crew.
 */
export function currentBerthLandings(map: Pick<GameMap, "terrain" | "width" | "height">, transport: Unit,
  intended: { x: number; y: number }, units: readonly Unit[]): { passengerId: string; point: { x: number; y: number } }[] {
  const motion = transport.sailing;
  if (transport.order.type !== 'unload' || !shipProfile(transport) || !motion || Math.abs(motion.speed) > .1
    || Math.hypot(motion.velocityX ?? 0, motion.velocityY ?? 0) > 1e-6) return [];
  const passengers = shipPassengers(units, transport).filter(passenger => passenger.owner === transport.owner && !isInCabin(passenger));
  if (!passengers.length) return [];
  const shore = walkableGoal(map, intended.x, intended.y);
  if (!sameGround(map, shore, walkableGoal(map, transport.order.x, transport.order.y))) return [];
  const shadow = units.slice(), failedRadii = new Set<number>(), landings: ReturnType<typeof currentBerthLandings> = [];
  for (const passenger of passengers) {
    if (failedRadii.has(passenger.radius)) continue;
    const point = passengerLandingSpot(map, transport, passenger.id, shadow);
    if (!point || !sameGround(map, shore, point)) {
      // With an explicit unload, the preferred shore ignores crew index and
      // count. Remaining deck bodies never block landingSpot; radius is the
      // only passenger parameter. Adding landed bodies cannot clear a failure.
      failedRadii.add(passenger.radius);
      continue;
    }
    landings.push({ passengerId: passenger.id, point });
    shadow[shadow.indexOf(passenger)] = { ...passenger, ...point, deck: undefined, cabin: undefined };
  }
  return landings;
}
