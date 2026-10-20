import { detCos, detSin } from "./det-math";
import { hypot2 } from "./hypot";
import { shipProfile, type Point } from "./ship-geometry";
import { isRangedUnit } from "./unit-weapon-class";
import type { Building, Obstacle, Unit } from "./types";

export type StrikeTarget = Unit | Building | Obstacle | Point;
type HullEdge = { x: number; y: number; dx: number; dy: number; length: number; squared: number };
// Profiles expose immutable local hulls. Keep only their numeric edges, so
// repeated ballistic probes neither allocate a point per edge nor recompute
// edge lengths. A changed scale/profile naturally receives a new hull key.
const hullEdges = new WeakMap<readonly Point[], readonly HullEdge[]>();
function edgesFor(hull: readonly Point[]) {
  let edges = hullEdges.get(hull);
  if (!edges) {
    edges = hull.map((a, index) => {
      const b = hull[(index + 1) % hull.length]!, dx = b.x - a.x, dy = b.y - a.y;
      return { x: a.x, y: a.y, dx, dy, length: Math.hypot(dx, dy), squared: dx * dx + dy * dy };
    });
    hullEdges.set(hull, edges);
  }
  return edges;
}
/** Selection, range, aiming and projectile travel share the same strike point.
 * Troops are aimed at their center; solid hulls and structures at their surface. */
export function strikePoint(from: Point, target: StrikeTarget): Point {
  if ("order" in target) {
    const profile = shipProfile(target);
    if (!profile) return target;
    const angle = target.sailing?.heading ?? 0, c = detCos(angle), s = detSin(angle);
    const dx = from.x - target.x, dy = from.y - target.y;
    const originX = dx * c + dy * s, originY = -dx * s + dy * c, edges = edgesFor(profile.hull);
    let inside = true;
    for (const edge of edges) {
      if ((edge.dx * (originY - edge.y) - edge.dy * (originX - edge.x)) / edge.length < -1e-6) { inside = false; break; }
    }
    if (inside) return from;
    let nearestX = profile.hull[0]!.x, nearestY = profile.hull[0]!.y, gap = Infinity;
    for (const edge of edges) {
      const t = Math.max(0, Math.min(1, ((originX - edge.x) * edge.dx + (originY - edge.y) * edge.dy) / edge.squared));
      const x = edge.x + edge.dx * t, y = edge.y + edge.dy * t;
      const distance = (x - originX)**2 + (y - originY)**2;
      if (distance < gap) { gap = distance; nearestX = x; nearestY = y; }
    }
    return { x: target.x + nearestX * c - nearestY * s, y: target.y + nearestX * s + nearestY * c };
  }
  if (!("radius" in target)) return target;
  const dx = from.x - target.x, dy = from.y - target.y, gap = Math.hypot(dx, dy);
  if (gap <= target.radius) return from;
  return { x: target.x + dx * target.radius / gap, y: target.y + dy * target.radius / gap };
}
// @@@hull-reach - A weapon with a minimum range reckons whatever is aboard a ship by that whole ship: while the nearest
// point of the hull lies inside its dead zone, nothing on board, neither the hull nor a troop on its deck, may be taken up.
// Otherwise it aims as any weapon does, at the hull's nearest point or at the troop. Two hulls lie as far from each other
// either way, so both broadsides can fire or neither can. A body on no ship is reckoned by itself. `units` finds the
// ship a troop stands on; a target that was led for a moving shot carries its ship with it by the same offset.
export function deadZoneAim(from: Point, target: StrikeTarget, minimum: number, units: readonly Unit[] = []): Point | undefined {
  const point = strikePoint(from, target);
  if (minimum <= 0) return point;
  const carrier = carrierOf(target, units);
  // The led hull is the standing one moved by the troop's offset: the gun moves the other way instead of copying a ship.
  const seen = carrier ? { x: from.x - carrier.dx, y: from.y - carrier.dy } : from;
  const near = carrier ? strikePoint(seen, carrier.ship) : point;
  return Math.hypot(near.x - seen.x, near.y - seen.y) < minimum ? undefined : point;
}
/** The ship a troop stands on, and how far a led copy of that troop lies from it standing. */
function carrierOf(target: StrikeTarget, units: readonly Unit[]) {
  if (!("order" in target) || !target.deck || shipProfile(target)) return undefined;
  const ship = units.find(unit => unit.id === target.deck!.shipId);
  if (!ship) return undefined;
  const standing = target.id === undefined ? undefined : units.find(unit => unit.id === target.id);
  return { ship, dx: standing ? target.x - standing.x : 0, dy: standing ? target.y - standing.y : 0 };
}
/** The ship a troop stands on. */
export function carryingHull(target: StrikeTarget, units: readonly Unit[]): Unit | undefined {
  return carrierOf(target, units)?.ship;
}
export function strikeGap(from: Point, target: StrikeTarget) {
  const point = strikePoint(from, target);
  return Math.hypot(point.x - from.x, point.y - from.y);
}
// @@@contact-reach - A melee blow lands on any unit its striker stands pressed against, as in Warcraft III, where melee
// range is counted between the two bodies' edges. Range here counts between centers (troops are aimed at their centers),
// and bodies never overlap, so a short reach could never touch a broad body: a worker (reach 36, body 15) pushed an
// ogre (body 22) across the map without one blow. A melee striker, classified from its unmodified weapon definition,
// reaches a unit at least as far as their two bodies touching, and a little more; aimed
// weapons, buildings and hulls keep their reach. Every range test of a strike reads this.
export const CONTACT_SLACK = 4;
// A melee blow never crosses between a fortified tower's top and anything off it, either way (see @@@tower-garrison): such a
// target is out of reach at any distance, whatever range a search asks with, so neither a strike, a chase nor a target
// search ever takes it up.
export function strikeReach(attacker: Pick<Unit, "kind" | "attackClass" | "radius" | "attackRange" | "garrison">, target: StrikeTarget, range = attacker.attackRange) {
  const ranged = isRangedUnit(attacker);
  if (!ranged && attacker.garrison?.buildingId !== ("order" in target ? target.garrison?.buildingId : undefined)) return -Infinity;
  if (ranged || !("order" in target) || shipProfile(target)) return range;
  return Math.max(range, attacker.radius + target.radius + CONTACT_SLACK);
}

/** Blast overlap uses the whole body, while troops aim at another troop's center. */
export function bodyGap(from:Point,target:Unit|Building|Obstacle) {
  return 'order' in target && !shipProfile(target) ? Math.max(0,Math.hypot(from.x-target.x,from.y-target.y)-target.radius) : strikeGap(from,target);
}

/** Center geometry for a ground area cast; neither walking distance nor hull overlap.
 * Beyond the cast range, use the middle of the radial interval shared by both
 * disks. A tangent has no interior casting point. */
export function areaCastPoint(from: Point, target: Point, castRange: number, areaRadius: number): Point | undefined {
  const dx = target.x - from.x, dy = target.y - from.y, gap = hypot2(dx, dy);
  if (gap <= castRange) return { x: target.x, y: target.y };
  if (gap >= castRange + areaRadius) return undefined;
  const reach = (gap - areaRadius + castRange) / 2;
  return { x: from.x + dx * reach / gap, y: from.y + dy * reach / gap };
}
