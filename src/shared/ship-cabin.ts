import { unitMover } from './catalog';
import { deckPlacement, deckPointFits, deckStaticPathExists, moveOnDeck } from './decks';
import { capsuleClearsCircles, diskInConvex } from './navigation-math';
import { GANGWAY_MAX_RADIUS } from './ship-gangway';
import { cabinSpaceRequired, shipCabinCapacity, shipCabinUsage } from './ship-cabin-quota';
export { cabinSpaceRequired, shipCabinCapacity, shipCabinUsage } from './ship-cabin-quota';
import { localToWorld, shipPassengers, shipProfile, type Point } from './ship-geometry';
import { unitClassOf } from './unit-targeting';
import type { GameSnapshot, Unit } from './types';

type CabinSnapshot = Pick<GameSnapshot, 'units' | 'teams'> & Partial<Pick<GameSnapshot, 'variants' | 'tick'>>;
const cabinFrames = new WeakMap<readonly Unit[], { tick:number; moved:Set<string>; active:Map<string,string> }>();
function cabinFrame(snapshot:CabinSnapshot) {
  if (snapshot.tick === undefined) return undefined;
  let frame=cabinFrames.get(snapshot.units);
  if (!frame || frame.tick!==snapshot.tick) { frame={tick:snapshot.tick,moved:new Set(),active:new Map()}; cabinFrames.set(snapshot.units,frame); }
  return frame;
}
/** Courtesy walking consumes the same movement allowance as the crew member's own order. */
export function cabinCrewMovedThisTick(snapshot:CabinSnapshot,unit:Unit):boolean {
  const frame=cabinFrames.get(snapshot.units);
  return frame!==undefined && frame.tick===snapshot.tick && frame.moved.has(unit.id);
}
const NON_WALKING_CREW = new Set<Unit['kind']>(['knight','raider','horseArcher','spirit','ancientStag','dragonWhelp','redDragon','mossGnawer','stonebackBrute','deepSnapper','spiderling','venomSpider','spiderQueen']);
const compareIds=(a:Unit,b:Unit)=>a.id<b.id?-1:a.id>b.id?1:0;
const cabinRoutes = new WeakMap<Unit, { profile:NonNullable<ReturnType<typeof shipProfile>>; radius:number; shipId:string; x:number; y:number; reachable:boolean }>();

export function isInCabin(unit: Pick<Unit, 'deck' | 'cabin'>): boolean {
  return !!unit.cabin && unit.cabin.shipId === unit.deck?.shipId;
}
function enemies(snapshot: CabinSnapshot, a: Unit['owner'], b: Unit['owner']) {
  return a !== b && (a === 'neutral' || b === 'neutral' || (snapshot.teams?.[a] ?? a) !== (snapshot.teams?.[b] ?? b));
}
/** Shelter is lost as soon as the compartment breaks or hostile boarders reach its deck. */
export function cabinAvailable(snapshot: CabinSnapshot, ship: Unit): boolean {
  return ship.hp > 0 && shipCabinCapacity(ship) > 0 && (ship.shipParts?.cabin ?? ship.maxHp*.4) > 0
    && !shipPassengers(snapshot.units, ship).some(unit => unit.hp > 0 && !isInCabin(unit) && enemies(snapshot, ship.owner, unit.owner));
}
export function isCabinProtected(snapshot: CabinSnapshot, unit: Unit): boolean {
  if (!isInCabin(unit) || unit.cabin?.breached) return false;
  const ship = snapshot.units.find(ship => ship.id === unit.cabin!.shipId);
  return !!ship && cabinAvailable(snapshot, ship);
}
/** The door is reached from the open deck, outside the cabin's physical obstacle. */
export function cabinDoor(ship: Unit): Point | undefined {
  const profile = shipProfile(ship), cabin = profile?.obstacles.find(obstacle => obstacle.type === 'cabin');
  if (!profile || !cabin || shipCabinCapacity(ship) === 0) return undefined;
  return { x:cabin.x+cabin.radius+21, y:cabin.y };
}
/** The hatch serves its immediate deck approach, never an unrelated free point at the bow. */
export function cabinExitPoint(snapshot: CabinSnapshot, ship: Unit, unit: Unit): Point | undefined {
  const door = cabinDoor(ship);
  if (!door) return undefined;
  const point = deckPlacement(ship,unit,snapshot.units,door,true,2);
  return point && Math.hypot(point.x-door.x,point.y-door.y) <= unit.radius*2+6 ? point : undefined;
}
export function isCabinCrew(snapshot: Partial<Pick<GameSnapshot,'variants'>>, unit: Unit): boolean {
  return unitMover(unit.kind) === 'land' && unitClassOf(unit,snapshot) === 'nonMechanical' && !NON_WALKING_CREW.has(unit.kind);
}
/** A valid hatch endpoint alone does not connect the aft and foredeck. Fixed
 * batteries may separate them for a larger body. Crew can yield, so this test
 * ignores their temporary positions and uses only the current scaled fittings.
 * Reuse a successful route only while the current body fits this hull's deck
 * and a static-clear segment connects it to the previously proven start.
 * Connected surface walking may otherwise enter a different floor component.
 */
function cabinRouteExists(snapshot:CabinSnapshot,ship:Unit,unit:Unit):boolean {
  const profile=shipProfile(ship), start=unit.deck;
  if(!profile || !start || start.shipId!==ship.id || unit.gangway || !deckPointFits(ship,unit,start,snapshot.units,false))return false;
  const cached=cabinRoutes.get(unit);
  if(cached?.profile===profile && cached.radius===unit.radius && cached.shipId===ship.id) {
    if(cached.x===start.x && cached.y===start.y)return cached.reachable;
    if(cached.reachable && capsuleClearsCircles(start,cached,unit.radius+1,profile.obstacles))return true;
  }
  const point=cabinExitPoint({...snapshot,units:[ship,unit]},ship,unit);
  const reachable=!!point && deckStaticPathExists(ship,unit,point);
  cabinRoutes.set(unit,{profile,radius:unit.radius,shipId:ship.id,x:start.x,y:start.y,reachable});
  return reachable;
}
export function canEnterCabin(snapshot: CabinSnapshot, unit: Unit, ship = snapshot.units.find(ship => ship.id === unit.deck?.shipId)): boolean {
  return cabinEntryRefusal(snapshot,unit,ship) === undefined;
}
export type CabinEntryRefusal = 'unavailable' | 'unsupported' | 'capacity' | 'door' | 'crossing';
export function cabinEntryRefusal(snapshot: CabinSnapshot, unit: Unit, ship = snapshot.units.find(ship => ship.id === unit.deck?.shipId)): CabinEntryRefusal | undefined {
  if(unit.gangway)return 'crossing';
  const profile=ship && shipProfile(ship);
  if(profile && unit.radius<=GANGWAY_MAX_RADIUS && unit.deck?.shipId===ship!.id && !isInCabin(unit)
    && !diskInConvex(unit.deck,unit.radius+1,profile.deck)) {
    const connectedPassage=ship?.sailing?.gangway?.phase==='ready' || snapshot.units.some(source=>source.sailing?.gangway?.phase==='ready' && source.sailing.gangway.targetId===ship!.id);
    if(connectedPassage)return 'crossing';
  }
  if (!ship || unit.hp <= 0 || isInCabin(unit) || unit.deck?.shipId !== ship.id || enemies(snapshot,ship.owner,unit.owner) || !isCabinCrew(snapshot,unit)) return 'unsupported';
  if (!cabinAvailable(snapshot,ship) || !cabinDoor(ship)) return 'unavailable';
  if (shipCabinUsage(snapshot,ship).used + cabinSpaceRequired(snapshot,unit) > shipCabinCapacity(ship)) return 'capacity';
  if (!cabinRouteExists(snapshot,ship,unit)) return 'door';
  if (cabinExitPoint(snapshot,ship,unit)) return undefined;
  // Idle companions and crew already waiting for this hatch can walk aside. Their
  // temporary presence must not discard a later member of the same group order.
  return cabinExitPoint({...snapshot,units:snapshot.units.filter(other=>!canYieldCabinApproach(snapshot,unit,other))},ship,unit) ? undefined : 'door';
}
/** A group shares its hull's remaining budget in command order. Different
 * hulls reserve independently, and an oversized first choice cannot block a
 * later smaller companion that actually fits. */
export function cabinGroupSelection(snapshot: CabinSnapshot, units: readonly Unit[]): string[] {
  const free = new Map<string, number>(), selected: string[] = [], seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    const ship = snapshot.units.find(ship => ship.id === unit.deck?.shipId);
    if (!ship || !canEnterCabin(snapshot,unit,ship)) continue;
    const available = free.get(ship.id) ?? shipCabinUsage(snapshot,ship).free, required = cabinSpaceRequired(snapshot,unit);
    if (required > available) continue;
    free.set(ship.id,available-required); selected.push(unit.id);
  }
  return selected;
}
function cabinEntryAllowed(snapshot: CabinSnapshot, unit: Unit, ship:Unit|undefined): boolean {
  return !!ship && unit.hp > 0 && !isInCabin(unit) && unit.deck?.shipId === ship.id && !enemies(snapshot, ship.owner, unit.owner)
    && isCabinCrew(snapshot,unit) && cabinAvailable(snapshot, ship) && !!cabinDoor(ship)
    && shipCabinUsage(snapshot,ship).used + cabinSpaceRequired(snapshot,unit) <= shipCabinCapacity(ship)
    && cabinRouteExists(snapshot,ship,unit);
}
export function leaveCabin(snapshot: CabinSnapshot, unit: Unit): boolean {
  if (!isInCabin(unit)) return false;
  const ship = snapshot.units.find(ship => ship.id === unit.cabin!.shipId && ship.hp > 0);
  if (!ship) return false;
  const point = cabinExitPoint(snapshot,ship,unit);
  if (!point) return false;
  delete unit.cabin;
  unit.deck = { shipId:ship.id, ...point };
  Object.assign(unit, localToWorld(ship, point));
  unit.aim = undefined; unit.order = { type:'idle' }; unit.orderQueue = [];
  return true;
}
/** A failed evacuation never stacks crew or teleports them ashore. It removes protection and retries. */
export function updateCabinPassengers(snapshot: CabinSnapshot) {
  for (const unit of snapshot.units) {
    if (!unit.cabin || unit.hp <= 0) continue;
    if (!isInCabin(unit)) { delete unit.cabin; continue; }
    const ship = snapshot.units.find(ship => ship.id === unit.cabin!.shipId);
    if (!ship || ship.hp <= 0) continue; // The existing shipwreck authority kills attached passengers.
    if (unit.cabin.breached || !cabinAvailable(snapshot, ship)) {
      unit.cabin.breached = true;
      leaveCabin(snapshot, unit);
    }
  }
}
function canYieldCabinApproach(snapshot:CabinSnapshot,active:Unit,other:Unit) {
  return other.id!==active.id && other.deck?.shipId===active.deck?.shipId && other.owner===active.owner && other.hp>0 && !isInCabin(other)
    && isCabinCrew(snapshot,other) && (other.order.type==='idle' && !other.orderQueue?.length || other.order.type==='enterCabin');
}
/** Waiting crew and idle allies can make room; an explicit combat or hold order never yields. */
function yieldCabinApproach(snapshot:CabinSnapshot,ship:Unit,active:Unit,crewPace:(unit:Unit)=>number) {
  const profile=shipProfile(ship)!, frame=cabinFrame(snapshot);
  const willing=shipPassengers(snapshot.units,ship).filter(other=>canYieldCabinApproach(snapshot,active,other) && !frame?.moved.has(other.id));
  // Move the foremost body first, so a short line can clear without pushing or stacking anyone.
  willing.sort((a,b)=>b.deck!.x-a.deck!.x || compareIds(a,b));
  for (const other of willing) {
    if (Math.hypot(other.deck!.x-active.deck!.x,other.deck!.y-active.deck!.y)>180) continue;
    const goal=deckPlacement(ship,other,snapshot.units,{x:profile.length*.42,y:other.deck!.y},true,2);
    if (!goal) continue;
    const before={...other.deck!};
    moveOnDeck(other,ship,localToWorld(ship,goal),snapshot.units,crewPace(other),true);
    if (Math.hypot(other.deck!.x-before.x,other.deck!.y-before.y)>1e-7) frame?.moved.add(other.id);
  }
}
export function enterCabinStep(snapshot: CabinSnapshot, unit: Unit, pace = 1, crewPace:(unit:Unit)=>number=()=>1) {
  if (unit.order.type !== 'enterCabin') return;
  const shipId = unit.order.shipId;
  const parent = snapshot.units.find(candidate => candidate.id === shipId);
  if (!cabinEntryAllowed(snapshot, unit, parent)) { unit.order = { type:'idle' }; return; }
  const frame=cabinFrame(snapshot),door=cabinDoor(parent!)!;
  let first=frame?.active.get(shipId);
  const previous=snapshot.units.find(other=>other.id===first);
  if (!previous || previous.hp<=0 || isInCabin(previous) || previous.order.type!=='enterCabin') {
    const waiting=shipPassengers(snapshot.units,parent!).filter(other=>other.hp>0&&!isInCabin(other)&&other.order.type==='enterCabin');
    waiting.sort((a,b)=>Math.hypot(a.deck!.x-door.x,a.deck!.y-door.y)-Math.hypot(b.deck!.x-door.x,b.deck!.y-door.y) || compareIds(a,b));
    first=waiting[0]?.id; if(first)frame?.active.set(shipId,first);
  }
  if (unit.id!==first || frame?.moved.has(unit.id)) return;
  let point = cabinExitPoint(snapshot,parent!,unit);
  const before={...unit.deck!};
  if (point) moveOnDeck(unit, parent!, localToWorld(parent!, point), snapshot.units, pace,true);
  if (Math.hypot(unit.deck!.x-before.x,unit.deck!.y-before.y)<1e-7) {
    yieldCabinApproach(snapshot,parent!,unit,crewPace);
    point=cabinExitPoint(snapshot,parent!,unit);
    if(point)moveOnDeck(unit,parent!,localToWorld(parent!,point),snapshot.units,pace,true);
  }
  if (!point) return; // A temporarily occupied hatch is a queue, not a cancelled order.
  if (Math.hypot(unit.deck!.x-before.x,unit.deck!.y-before.y)>1e-7) frame?.moved.add(unit.id);
  if (Math.hypot(unit.deck!.x-point.x, unit.deck!.y-point.y) > 1) return;
  unit.cabin = { shipId };
  unit.aim = undefined; unit.pushX = undefined; unit.pushY = undefined;
  unit.order = { type:'idle' }; unit.orderQueue = [];
}
