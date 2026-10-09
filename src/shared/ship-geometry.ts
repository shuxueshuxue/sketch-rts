import geometry from "./generated/ship-geometry.json";
import { detCos, detSin } from "./det-math";
import type { Unit, UnitKind, UnitOrder } from "./types";

export type ShipKind = keyof typeof geometry.ships;
export type Point = { x: number; y: number };
export const SHIP_CAMERA = geometry.camera;
export const SHIP_KINDS = Object.keys(geometry.ships) as ShipKind[];
/** Stored campaign scales retain their authored units; the fleet-wide size change is applied once here. */
export const SHIP_SIZE_MULTIPLIER = 1.2;
export const AUTHORED_DEFAULT_SHIP_SCALE = 1.1;
export const DEFAULT_SHIP_SCALE = AUTHORED_DEFAULT_SHIP_SCALE * SHIP_SIZE_MULTIPLIER;
export const SHIP_SIZE_VERSION = 1;

export function isShipKind(kind: UnitKind): kind is ShipKind { return kind in geometry.ships; }
export function authoredShipScale(ship: Unit) {
  return ship.deckScale ?? (ship.cargoCapacity === undefined ? AUTHORED_DEFAULT_SHIP_SCALE : Math.sqrt(ship.cargoCapacity / (ship.kind === "carrier" ? 24 : 8)));
}
export function shipScale(ship: Unit) { return authoredShipScale(ship) * SHIP_SIZE_MULTIPLIER; }

/** Upgrade saved physical coordinates once, before restoring cargo or checking enlarged hull berths. */
export function migrateShipSizes(units: readonly Unit[]) {
  const allUnits = [...units], seen = new Set(allUnits), enlarged = new Set<string>();
  for (const unit of allUnits) for (const passenger of unit.cargo ?? []) if (!seen.has(passenger)) {
    seen.add(passenger); allUnits.push(passenger);
  }
  for (const ship of allUnits) {
    if (!isShipKind(ship.kind) || ship.shipSizeVersion === SHIP_SIZE_VERSION) continue;
    ship.radius *= SHIP_SIZE_MULTIPLIER;
    if (ship.bodyRadius !== undefined) ship.bodyRadius *= SHIP_SIZE_MULTIPLIER;
    if (ship.fittings) ship.fittings = ship.fittings.map(fitting => ({ ...fitting,
      x: fitting.x * SHIP_SIZE_MULTIPLIER, y: fitting.y * SHIP_SIZE_MULTIPLIER, radius: fitting.radius * SHIP_SIZE_MULTIPLIER }));
    if (ship.sailing) ship.sailing.route = undefined;
    ship.shipSizeVersion = SHIP_SIZE_VERSION;
    enlarged.add(ship.id);
  }
  if (!enlarged.size) return;
  const scaled = new Set<Point>();
  const scalePoint = (point: Point) => {
    if (scaled.has(point)) return;
    point.x *= SHIP_SIZE_MULTIPLIER; point.y *= SHIP_SIZE_MULTIPLIER; scaled.add(point);
  };
  const migrateOrder = (order: UnitOrder, parentId?: string) => {
    if (order.type === 'charge') { migrateOrder(order.resume, parentId); return; }
    if (order.type === 'board') {
      if (enlarged.has(order.transportId) && order.deckPoint) scalePoint(order.deckPoint);
      if (enlarged.has(order.transportId) || parentId && enlarged.has(parentId) || order.rendezvous && enlarged.has(order.rendezvous.sourceId)) {
        delete order.berth; delete order.rendezvous;
      }
    } else if ((order.type === 'move' || order.type === 'attackMove') && order.deckPoint
      && enlarged.has(order.deckShipId ?? parentId ?? '')) scalePoint(order.deckPoint);
  };
  for (const unit of allUnits) {
    if (unit.deck && enlarged.has(unit.deck.shipId)) {
      scalePoint(unit.deck);
      if (unit.aim?.anchorDeckX !== undefined) unit.aim.anchorDeckX *= SHIP_SIZE_MULTIPLIER;
      if (unit.aim?.anchorDeckY !== undefined) unit.aim.anchorDeckY *= SHIP_SIZE_MULTIPLIER;
    }
    migrateOrder(unit.order, unit.deck?.shipId);
    for (const order of unit.orderQueue ?? []) migrateOrder(order, unit.deck?.shipId);
  }
}
type ShipProfile = ReturnType<typeof computeShipProfile>;
const profiles=new WeakMap<Unit,{kind:ShipKind;scale:number;fittings:Unit['fittings'];profile:ShipProfile}>();
/** Profiles are local geometry; only scale or a replaced fitting layout changes them. */
export function shipProfile(ship: Unit) {
  if (!isShipKind(ship.kind)) return undefined;
  const scale=shipScale(ship),cached=profiles.get(ship);
  if(cached && cached.kind===ship.kind && cached.scale===scale && cached.fittings===ship.fittings)return cached.profile;
  const profile=computeShipProfile(ship,ship.kind,scale);
  profiles.set(ship,{kind:ship.kind,scale,fittings:ship.fittings,profile});return profile;
}
/** Predicted poses retain identical local geometry. Reuse that immutable
 * profile without retaining either temporary pose or its original hull. */
export function shareShipProfile(source:Unit,pose:Unit) {
  if(source.kind!==pose.kind || source.fittings!==pose.fittings || shipScale(source)!==shipScale(pose))return;
  if(shipProfile(source))profiles.set(pose,profiles.get(source)!);
}
function computeShipProfile(ship:Unit,kind:ShipKind,scale:number){
  const raw = geometry.ships[kind];
  return { ...raw, length: raw.length*scale, beam: raw.beam*scale, deckHeight: raw.deckHeight*scale, mastHeight: raw.mastHeight*scale,
    hullMass: raw.hullMass*scale**3, loadCapacity: raw.loadCapacity*scale**2,
    hull: raw.hull.map(([x,y]) => ({ x:x!*scale, y:y!*scale })),
    deck: raw.deck.map(([x,y]) => ({ x:x!*scale, y:y!*scale })),
    weaponMount: raw.weaponMount?.map(value => value*scale) ?? null,
    weaponPivot: raw.weaponPivot?.map(value => value*scale) ?? null,
    obstacles: [...raw.obstacles.filter(o=>!["gun","mortar","flame"].includes(o.type) || !ship.fittings),...(ship.fittings ?? []).map(fitting=>({...fitting,type:"weapon"}))].map(o => ({ ...o, x:o.x*("accepts" in o?1:scale), y:o.y*("accepts" in o?1:scale), radius:o.radius*("accepts" in o?1:scale) })) };
}
const shipLists=new WeakMap<readonly Unit[],{length:number;ships:Unit[]}>();
/** Units change kind only when created; additions and a new simulation list invalidate this view. */
export function shipsIn(units:readonly Unit[]){
  const cached=shipLists.get(units);if(cached?.length===units.length)return cached.ships;
  const ships=units.filter(unit=>isShipKind(unit.kind));shipLists.set(units,{length:units.length,ships});return ships;
}
/** The mounted gun traverses around this deck mount independently of the sailing hull. */
export function shipWeaponPose(ship: Unit) {
  const profile = shipProfile(ship), mount = profile?.weaponMount;
  if (!mount) return undefined;
  const pivot = profile.weaponPivot;
  const heading = pivot ? (ship.facing ?? ship.sailing?.heading ?? 0) : (ship.sailing?.heading ?? 0);
  const base = localToWorld(ship, { x: pivot?.[0] ?? mount[0]!, y: pivot?.[1] ?? mount[1]! });
  const reach = pivot ? mount[0]! - pivot[0]! : 0;
  const lateral = pivot ? mount[1]! - pivot[1]! : 0;
  return { pivot: base, pivotHeight: pivot?.[2] ?? mount[2]!, heading,
    muzzle: { x: base.x+reach*detCos(heading)-lateral*detSin(heading), y: base.y+reach*detSin(heading)+lateral*detCos(heading) }, height: mount[2]! };
}
export function localToWorld(ship: Unit, point: Point): Point {
  const angle=ship.sailing?.heading ?? 0, c=detCos(angle), s=detSin(angle);
  return { x:ship.x+point.x*c-point.y*s, y:ship.y+point.x*s+point.y*c };
}
export function worldToLocal(ship: Unit, point: Point): Point {
  const angle=ship.sailing?.heading ?? 0, c=detCos(angle), s=detSin(angle), x=point.x-ship.x, y=point.y-ship.y;
  return { x:x*c+y*s, y:-x*s+y*c };
}
/** A circular body must fit entirely inside every edge of a convex polygon. */
export function circleInPolygon(point: Point, radius: number, polygon: readonly Point[]) {
  for (let i=0;i<polygon.length;i++) {
    const a=polygon[i]!, b=polygon[(i+1)%polygon.length]!, dx=b.x-a.x, dy=b.y-a.y;
    if ((dx*(point.y-a.y)-dy*(point.x-a.x))/Math.hypot(dx,dy) < radius-1e-6) return false;
  }
  return true;
}
export function shipPassengers(units: readonly Unit[], ship: Unit) {
  return units.filter(unit=>unit.deck?.shipId===ship.id);
}
export function distanceToHull(ship:Unit,world:Point) {
  const profile=shipProfile(ship);
  if(!profile)return Math.hypot(world.x-ship.x,world.y-ship.y);
  const point=worldToLocal(ship,world);
  if(circleInPolygon(point,0,profile.hull))return 0;
  let gap=Infinity;
  for(let i=0;i<profile.hull.length;i++) {
    const a=profile.hull[i]!,b=profile.hull[(i+1)%profile.hull.length]!,dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy)));
    gap=Math.min(gap,Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t));
  }
  return gap;
}
export function hullGap(a:Unit,b:Unit) {
  const aa=shipProfile(a),bb=shipProfile(b);
  if(!aa || !bb)return Infinity;
  if(hullContact(a,b))return 0;
  return Math.min(...aa.hull.map(point=>distanceToHull(b,localToWorld(a,point))),...bb.hull.map(point=>distanceToHull(a,localToWorld(b,point))));
}
/** SAT contact between convex hulls, using the same outline exported by Blender. */
export function hullContact(a: Unit, b: Unit) {
  const aa=shipProfile(a), bb=shipProfile(b);
  if (!aa || !bb) return undefined;
  const ap=aa.hull.map(p=>localToWorld(a,p)), bp=bb.hull.map(p=>localToWorld(b,p));
  let overlap=Infinity, normal={x:1,y:0};
  for (const polygon of [ap,bp]) for(let i=0;i<polygon.length;i++) {
    const p=polygon[i]!, q=polygon[(i+1)%polygon.length]!, length=Math.hypot(q.x-p.x,q.y-p.y);
    const axis={x:-(q.y-p.y)/length,y:(q.x-p.x)/length};
    const av=ap.map(p=>p.x*axis.x+p.y*axis.y), bv=bp.map(p=>p.x*axis.x+p.y*axis.y);
    const forward=Math.max(...av)-Math.min(...bv),backward=Math.max(...bv)-Math.min(...av);
    const depth=Math.min(forward,backward);
    if (depth<=0) return undefined;
    if (depth<overlap) { overlap=depth;normal=forward<=backward?axis:{x:-axis.x,y:-axis.y}; }
  }
  return { ...normal, overlap };
}
