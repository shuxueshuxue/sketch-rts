import { detCos, detSin } from "./det-math";
import { hypot2 } from "./hypot";
import { shipProfile, type Point } from "./ship-geometry";
import { RANGED_ATTACK_RANGE_THRESHOLD } from "./aiming";
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
// @@@band-aim - A weapon with a minimum range aims at the part of a hull lying in its band and its traverse: the nearest
// point of the hull at least `minimum` and at most `maximum` away, within `arc` when given, so a ship lying across the
// dead zone is still struck on its far side. Any other body is struck where it is aimed or not at all (undefined), and
// so is a hull no part of which lies in the band.
export function strikePointInBand(from: Point, target: StrikeTarget, minimum: number, maximum: number, arc?: { bearing: number; halfArc: number }): Point | undefined {
  if (!("order" in target)) return undefined;
  const profile = shipProfile(target);
  if (!profile) return undefined;
  const angle = target.sailing?.heading ?? 0, c = detCos(angle), s = detSin(angle);
  const hull = profile.hull.map(p => ({ x: target.x + p.x * c - p.y * s, y: target.y + p.x * s + p.y * c }));
  let best: Point | undefined, bestGap = Infinity;
  const consider = (p: Point) => {
    const dx = p.x - from.x, dy = p.y - from.y, gap = Math.hypot(dx, dy);
    if (gap < minimum || gap > maximum || gap >= bestGap) return;
    if (arc) {
      let off = Math.atan2(dy, dx) - arc.bearing;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > arc.halfArc + 1e-7) return;
    }
    best = p; bestGap = gap;
  };
  const rays = arc ? [arc.bearing - arc.halfArc, arc.bearing + arc.halfArc] : [];
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index]!, b = hull[(index + 1) % hull.length]!, dx = b.x - a.x, dy = b.y - a.y, fx = a.x - from.x, fy = a.y - from.y;
    consider(a);
    // Where the edge crosses the dead zone's rim and the band's outer rim, a hair inside the band so every exact
    // range check downstream agrees.
    for (const radius of [minimum + 1e-6, maximum - 1e-6]) {
      const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - radius * radius, disc = B * B - 4 * A * C;
      if (A > 0 && disc >= 0) for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) if (t >= 0 && t <= 1) consider({ x: a.x + dx * t, y: a.y + dy * t });
    }
    // Where the edge crosses the traverse's edges.
    for (const ray of rays) {
      const ux = Math.cos(ray), uy = Math.sin(ray), denominator = dx * uy - dy * ux;
      if (Math.abs(denominator) < 1e-12) continue;
      const t = (fy * ux - fx * uy) / denominator;
      if (t >= 0 && t <= 1) consider({ x: a.x + dx * t, y: a.y + dy * t });
    }
  }
  return best;
}
export function strikeGap(from: Point, target: StrikeTarget) {
  const point = strikePoint(from, target);
  return Math.hypot(point.x - from.x, point.y - from.y);
}
// @@@contact-reach - A melee blow lands on any unit its striker stands pressed against, as in Warcraft III, where melee
// range is counted between the two bodies' edges. Range here counts between centers (troops are aimed at their centers),
// and bodies never overlap, so a short reach could never touch a broad body: a worker (reach 36, body 15) pushed an
// ogre (body 22) across the map without one blow. A melee striker (a reach the sim does not aim: see
// RANGED_ATTACK_RANGE_THRESHOLD) reaches a unit at least as far as their two bodies touching, and a little more; aimed
// weapons, buildings and hulls keep their reach. Every range test of a strike reads this.
export const CONTACT_SLACK = 4;
// A melee blow never crosses between a fortified tower's top and anything off it, either way (see @@@tower-garrison): such a
// target is out of reach at any distance, whatever range a search asks with, so neither a strike, a chase nor a target
// search ever takes it up.
export function strikeReach(attacker: { radius: number; attackRange: number; garrison?: { buildingId: string } | undefined }, target: StrikeTarget, range = attacker.attackRange) {
  if (attacker.attackRange <= RANGED_ATTACK_RANGE_THRESHOLD && attacker.garrison?.buildingId !== ("order" in target ? target.garrison?.buildingId : undefined)) return -Infinity;
  if (range > RANGED_ATTACK_RANGE_THRESHOLD || !("order" in target) || shipProfile(target)) return range;
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
