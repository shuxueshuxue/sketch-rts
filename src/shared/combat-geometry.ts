import { circleInPolygon, localToWorld, shipProfile, worldToLocal, type Point } from "./ship-geometry";
import type { Building, Obstacle, Unit } from "./types";

export type StrikeTarget = Unit | Building | Obstacle | Point;
/** Selection, range, aiming and projectile travel share the same strike point.
 * Troops are aimed at their center; solid hulls and structures at their surface. */
export function strikePoint(from: Point, target: StrikeTarget): Point {
  if ("order" in target) {
    const profile = shipProfile(target);
    if (!profile) return target;
    const origin = worldToLocal(target, from);
    if (circleInPolygon(origin, 0, profile.hull)) return from;
    let nearest = profile.hull[0]!, gap = Infinity;
    for (let i = 0; i < profile.hull.length; i++) {
      const a = profile.hull[i]!, b = profile.hull[(i + 1) % profile.hull.length]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((origin.x - a.x) * dx + (origin.y - a.y) * dy) / (dx * dx + dy * dy)));
      const point = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (distance < gap) { gap = distance; nearest = point; }
    }
    return localToWorld(target, nearest);
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
