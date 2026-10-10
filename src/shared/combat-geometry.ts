import { detCos, detSin } from "./det-math";
import { shipProfile, type Point } from "./ship-geometry";
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
export function strikeGap(from: Point, target: StrikeTarget) {
  const point = strikePoint(from, target);
  return Math.hypot(point.x - from.x, point.y - from.y);
}
/** Blast overlap uses the whole body, while troops aim at another troop's center. */
export function bodyGap(from:Point,target:Unit|Building|Obstacle) {
  return 'order' in target && !shipProfile(target) ? Math.max(0,Math.hypot(from.x-target.x,from.y-target.y)-target.radius) : strikeGap(from,target);
}
