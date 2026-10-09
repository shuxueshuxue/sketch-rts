import { strikePoint, type StrikeTarget } from './combat-geometry';
import type { WeaponDef } from './catalog';
import { detCos, detSin } from './det-math';
import { localToWorld, shipProfile, shareShipProfile, type Point } from './ship-geometry';
import { perTick, seconds, SIM_TICKS_PER_SECOND } from './time';
import type { Unit } from './types';
import { boltIntersection } from './weapons';

/** Low, direct fire needs a clear lane through the actual friendly hulls.
 * Mortar shells pass over them; a cannon barrel's protruding muzzle, rather
 * than its deck pivot, begins the lane. The caller owns alliance selection. */
export function shipFireLaneClear(from: Point, to: Point, weapon: WeaponDef, blockers: readonly Unit[], excludedId?: string): boolean {
  if (weapon.delivery !== 'bolt' && weapon.delivery !== 'cone') return true;
  const width = weapon.delivery === 'bolt' ? weapon.radius ?? 12 : 0;
  const left = Math.min(from.x, to.x) - width, right = Math.max(from.x, to.x) + width;
  const top = Math.min(from.y, to.y) - width, bottom = Math.max(from.y, to.y) + width;
  for (const unit of blockers) {
    if (unit.id === excludedId) continue;
    const profile = unit.hp > 0 && shipProfile(unit);
    if (!profile) continue;
    // The circumscribed rectangle is a cheap rejection only. The final check
    // clips the complete rotated polygon, including its tapered bow/stern.
    const radius = Math.hypot(profile.length, profile.beam) / 2;
    if (unit.x + radius < left || unit.x - radius > right || unit.y + radius < top || unit.y - radius > bottom) continue;
    if (boltIntersection(from, to, unit, width) !== undefined) return false;
  }
  return true;
}

export function targetSailingVelocity(target: StrikeTarget, units?: readonly Unit[]): Point {
  if (!('order' in target)) return { x: 0, y: 0 };
  const hull = target.deck ? units?.find(unit => unit.id === target.deck!.shipId && unit.hp > 0) : target;
  return { x: hull?.sailing?.velocityX ?? 0, y: hull?.sailing?.velocityY ?? 0 };
}

/** Constant-velocity lead for the finite, fixed-world-course shot. The barrel
 * starts at its muzzle, but gun arc and range are measured from its pivot.
 * Launch happens after unit movement and impact before movement, so a shot
 * lasting n ticks observes n - 1 further movement steps at impact. */
export function ballisticTarget(pivot: Point, target: StrikeTarget, velocity: Point, weapon: WeaponDef, barrelReach = 0): StrikeTarget {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (weapon.delivery !== 'bolt' && weapon.delivery !== 'shell' || speed < 1e-7) return target;
  const step = perTick(weapon.delivery === 'shell' ? 240 : 560);
  const at = (ticks: number): StrikeTarget => {
    const time = (ticks - 1) / SIM_TICKS_PER_SECOND;
    const pose={ ...target, x: target.x + velocity.x * time, y: target.y + velocity.y * time };
    if('order' in target && 'order' in pose)shareShipProfile(target,pose);
    return pose;
  };
  const reaches = (ticks: number) => {
    const time = (ticks - 1) / SIM_TICKS_PER_SECOND;
    const relative = { x: pivot.x - velocity.x * time, y: pivot.y - velocity.y * time };
    const point = strikePoint(relative, target);
    return Math.max(0, Math.hypot(point.x - relative.x, point.y - relative.y) - barrelReach) <= ticks * step;
  };
  let low = seconds(.2), high = low;
  // With ordinary vessel speed below projectile speed, this predicate is
  // monotonic. Find the first discrete flight duration, without a homing shot
  // or an extension of the mount's permitted range.
  while (!reaches(high) && high < seconds(30)) high *= 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (reaches(middle)) high = middle; else low = middle + 1;
  }
  return at(low);
}

/** Arc and range boundaries partition hull headings into firing intervals.
 * A minimum range can split an interval, so searching from one bearing toward
 * another with a monotonic binary search can miss a usable firing angle. */
export function firingBoundaryHeadings(origin: Point, mount: Point, target: StrikeTarget, bearing: number, halfArc: number, minimum: number, maximum: number): number[] {
  const headings: number[] = [];
  // A pivot already inside a solid target has a zero-length strike vector;
  // strikePoint/atan2 give that vector a world bearing of zero.
  if (minimum <= 0) headings.push(-bearing - halfArc, -bearing + halfArc);
  const arm = Math.hypot(mount.x, mount.y), armBearing = Math.atan2(mount.y, mount.x);
  const cosineRoots = (center: number, cosine: number) => {
    if (cosine < -1 - 1e-10 || cosine > 1 + 1e-10) return;
    const offset = Math.acos(Math.max(-1, Math.min(1, cosine)));
    headings.push(center - offset, center + offset);
  };
  const arcs = [bearing - halfArc, bearing + halfArc].map(angle => {
    const c = detCos(angle), s = detSin(angle);
    return { c, s, projection: mount.x * c + mount.y * s };
  });
  const pointBoundaries = (point: Point, radius = 0) => {
    const dx = point.x - origin.x, dy = point.y - origin.y;
    const distance = Math.hypot(dx, dy), direction = Math.atan2(dy, dx);
    for (const {c,s,projection} of arcs) {
      const discriminant = projection * projection + distance * distance - arm * arm;
      if (discriminant < -1e-7) continue;
      const root = Math.sqrt(Math.max(0, discriminant));
      for (const reach of [-projection - root, -projection + root]) {
        if (reach < -1e-7) continue;
        // In hull coordinates the target lies on the ray from the mount.
        headings.push(direction - Math.atan2(mount.y + reach * s, mount.x + reach * c));
      }
    }
    if (arm > 1e-9 && distance > 1e-9) for (const range of [minimum + radius, maximum + radius]) {
      cosineRoots(direction - armBearing, (distance * distance + arm * arm - range * range) / (2 * distance * arm));
    }
  };
  const profile = 'order' in target ? shipProfile(target) : undefined;
  if (!profile || !('order' in target)) {
    pointBoundaries(target, !('order' in target) && 'radius' in target ? target.radius : 0);
    return headings;
  }

  const hull = profile.hull.map(point => localToWorld(target, point));
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index]!, b = hull[(index + 1) % hull.length]!;
    // The nearest surface point is either a vertex or an edge projection.
    pointBoundaries(a);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length <= 1e-9) continue;
    const nx = -dy / length, ny = dx / length, normal = Math.atan2(ny, nx);
    for (const facing of [normal, normal + Math.PI]) {
      headings.push(facing - bearing - halfArc, facing - bearing + halfArc);
    }
    if (arm <= 1e-9) continue;
    const offset = (a.x - origin.x) * nx + (a.y - origin.y) * ny;
    for (const range of [minimum, maximum]) for (const side of [-1, 1]) {
      cosineRoots(normal - armBearing, (offset + side * range) / arm);
    }
  }
  return headings;
}
