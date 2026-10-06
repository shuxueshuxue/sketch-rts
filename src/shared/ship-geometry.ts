import geometry from "./generated/ship-geometry.json";
import { detCos, detSin } from "./det-math";
import type { Unit, UnitKind } from "./types";

export type ShipKind = keyof typeof geometry.ships;
export type Point = { x: number; y: number };
export const SHIP_CAMERA = geometry.camera;
export const SHIP_KINDS = Object.keys(geometry.ships) as ShipKind[];

export function isShipKind(kind: UnitKind): kind is ShipKind { return kind in geometry.ships; }
export function shipScale(ship: Unit) {
  return ship.deckScale ?? (ship.cargoCapacity === undefined ? 1 : Math.sqrt(ship.cargoCapacity / (ship.kind === "carrier" ? 24 : 8)));
}
export function shipProfile(ship: Unit) {
  if (!isShipKind(ship.kind)) return undefined;
  const raw = geometry.ships[ship.kind], scale = shipScale(ship);
  return { ...raw, length: raw.length*scale, beam: raw.beam*scale, deckHeight: raw.deckHeight*scale,
    hullMass: raw.hullMass*scale**3, loadCapacity: raw.loadCapacity*scale**2,
    hull: raw.hull.map(([x,y]) => ({ x:x!*scale, y:y!*scale })),
    deck: raw.deck.map(([x,y]) => ({ x:x!*scale, y:y!*scale })),
    weaponMount: raw.weaponMount?.map(value => value*scale) ?? null,
    obstacles: raw.obstacles.map(o => ({ ...o, x:o.x*scale, y:o.y*scale, radius:o.radius*scale })) };
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
    const depth=Math.min(Math.max(...av),Math.max(...bv))-Math.max(Math.min(...av),Math.min(...bv));
    if (depth<=0) return undefined;
    if (depth<overlap) { overlap=depth;normal=axis; }
  }
  if((b.x-a.x)*normal.x+(b.y-a.y)*normal.y<0) normal={x:-normal.x,y:-normal.y};
  return { ...normal, overlap };
}
