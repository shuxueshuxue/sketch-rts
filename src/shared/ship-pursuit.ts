import { strikeGap } from './combat-geometry';
import { shipMotionLimits } from './ship-handling';
import { distanceToHull, hullContact, shipProfile } from './ship-geometry';
import { hullPassageClear } from './ship-navigation';
import { detCos, detSin } from './det-math';
import type { Building, GameMap, Obstacle, Unit } from './types';

type Target = Unit | Building | Obstacle;
export type PursuitGoal = { x: number; y: number; intent: 'pursuit'; targetId: string; arrivalRadius: number; targetSpeed?: number; fireHeading?: number; retreat?: boolean };

/** Gunnery may select a crew member; the navigator follows the carrying hull. */
export function shipNavigationTarget(target: Target, units: readonly Unit[]): Target {
  if ('order' in target && target.deck) return units.find(unit => unit.id === target.deck!.shipId && unit.hp > 0) ?? target;
  return target;
}

/** A bounded constant-velocity intercept. An escaping faster quarry still has
 * a finite lead; a distant turn cannot send the pursuer across the whole map. */
export function interceptTime(dx: number, dy: number, vx: number, vy: number, speed: number): number {
  const a = vx * vx + vy * vy - speed * speed, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  let time = Math.sqrt(c) / Math.max(1, speed);
  if (Math.abs(a) < 1e-7) {
    if (b < -1e-7) time = -c / b;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant), candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(value => value >= 0);
      if (candidates.length) time = Math.min(...candidates);
    }
  }
  return Math.min(6, Math.max(0, time));
}

/** The tactical layer owns range bands and target identity. It never supplies
 * a docking heading, changes sail state, or resets a committed sailing leg. */
export function shipPursuitGoal(ship: Unit, requested: Target, units: readonly Unit[], range: number, minimum = 0, following = false, stationaryFire?: () => boolean, map?: GameMap, fireHeading?: number): PursuitGoal | undefined {
  const target = shipNavigationTarget(requested, units), motion = ship.sailing!;
  const targetMotion = 'order' in target ? target.sailing : undefined;
  const vx = targetMotion?.velocityX ?? 0, vy = targetMotion?.velocityY ?? 0, speed = Math.hypot(vx, vy);
  const previous = motion.pursuit?.targetId === target.id ? motion.pursuit : undefined;
  const underway = 'order' in target && (target.order.type === 'move' || target.order.type === 'unload'
    || target.order.type === 'attackMove' && !target.order.targetId);
  const moving = underway || speed > (previous?.moving ? 1 : 4);
  const dx = target.x - ship.x, dy = target.y - ship.y, distance = Math.hypot(dx, dy);
  const ownLength = shipProfile(ship)!.length, targetLength = 'order' in target ? shipProfile(target)?.length ?? 0 : 0;
  const safeGap = (ownLength + targetLength) * .55 + 12;
  // Following ends at a center separation with room to brake. Comparing this
  // to weapon-style edge distance asks the follower to enter its own stand-off
  // circle, so a stopped leader can become the center of an endless orbit.
  const gap = strikeGap(ship, target), phaseGap = following ? distance : gap;
  const enter = following ? safeGap + ownLength * .35 : range * .82;
  const leave = following ? safeGap + ownLength * .6 : range * 1.05;
  const firing = !following ? stationaryFire?.() : undefined;
  const phase = firing !== undefined ? firing ? 'engage' : 'approach'
    : previous?.phase === 'engage' ? phaseGap > leave || gap < minimum ? 'approach' : 'engage' : phaseGap <= enter && gap >= minimum ? 'engage' : 'approach';
  motion.pursuit = { targetId: target.id, phase, moving };
  if (phase === 'engage' && !moving && motion.speed <= 1) return undefined;

  const limits = shipMotionLimits(ship);
  // An opponent closing to fight is not an escaping constant-velocity quarry.
  // Leading each other's pursuit by several seconds makes equal ships run
  // side by side forever without closing to a useful firing position.
  const mutual = 'order' in target && (target.order.type === 'attack' || target.order.type === 'attackMove')
    && (target.order.targetId === ship.id || targetMotion?.pursuit?.targetId === ship.id);
  const lead = moving && !mutual ? interceptTime(dx, dy, vx, vy, Math.max(limits.speed * .8, motion.speed)) : 0;
  const at = !moving && !following ? requested : target;
  const predicted = { x: at.x + vx * lead, y: at.y + vy * lead };
  // The nearest hull edge defines weapon reach, while the navigation goal is
  // a center position. Keep enough center separation for both complete hulls.
  const edgeOffset = Math.max(0, distance - gap);
  if (!following && minimum > 0 && !firing && gap < minimum + ownLength * .45) {
    // Keep a bow mortar facing the opponent while backing out of its dead
    // zone. A full sailing turn only brings its stern closer to the danger.
    const separation = Math.max(safeGap, edgeOffset + minimum + ownLength * .45);
    return { x: target.x - dx / (distance || 1) * separation, y: target.y - dy / (distance || 1) * separation,
      intent: 'pursuit', targetId: target.id, arrivalRadius: Math.max(4, ownLength * .04),
      fireHeading: Math.atan2(dy, dx), retreat: true, targetSpeed: limits.reverseSpeed };
  }
  // A stationary occupied deck can put the actual fighting crew farther than
  // its nearest hull edge. Its firing approach aims at that fighting position;
  // ordinary hull sweep validation still prevents penetration.
  const standoff = !moving && !following && stationaryFire !== undefined
    ? Math.max(minimum + 24, range * .9) : Math.max(safeGap, edgeOffset + Math.max(minimum + 24, range * .68));
  // Keep the waiting station astern when the leader stops. Basing it on the
  // follower's own position makes the destination orbit with every correction.
  const followHeading = speed > 1 ? Math.atan2(vy, vx) : targetMotion?.heading ?? Math.atan2(dy, dx);
  const bearingX = following ? detCos(followHeading) : predicted.x - ship.x;
  const bearingY = following ? detSin(followHeading) : predicted.y - ship.y;
  const bearingLength = Math.hypot(bearingX, bearingY) || 1;
  const goal: PursuitGoal = {
    x: predicted.x - bearingX / bearingLength * standoff,
    y: predicted.y - bearingY / bearingLength * standoff,
    intent: 'pursuit', targetId: target.id, arrivalRadius: Math.max(4, ownLength * .04),
  };
  if(moving && !following && 'order' in target && shipProfile(target)){
    const heading=fireHeading ?? Math.atan2(goal.y-ship.y,goal.x-ship.x);
    const station={...ship,x:goal.x,y:goal.y,sailing:{...motion,heading}};
    if(hullContact(station,target)){
      // A long intercept can put its trailing firing station inside the
      // quarry's present hull. Static route admission then replaces a useful
      // chase with repeated precision pivots. Keep a clear station on our
      // side of the real hull until a farther predicted station is available.
      goal.x=target.x-dx/(distance || 1)*standoff;
      goal.y=target.y-dy/(distance || 1)*standoff;
    }
  }
  if (!moving && !following && stationaryFire !== undefined && !firing) {
    // A firing station needs room to rotate the hull. A point on the nearest
    // edge of the target's deck is a berth and can trap the broadside battery.
    const radius = Math.max(...shipProfile(ship)!.hull.map(point => Math.hypot(point.x, point.y))) + 4;
    const bearing = Math.atan2(ship.y - predicted.y, ship.x - predicted.x);
    let best: { x: number; y: number } | undefined, bestDistance = Infinity;
    for (const offset of [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const candidate = { x: predicted.x + standoff * detCos(bearing + offset), y: predicted.y + standoff * detSin(bearing + offset) };
      if (units.some(other => other !== ship && other.hp > 0 && shipProfile(other) && distanceToHull(other, candidate) < radius)) continue;
      if (map && (!hullPassageClear(map, ship, { ...candidate, heading: 0 }, { ...candidate, heading: Math.PI })
        || !hullPassageClear(map, ship, { ...candidate, heading: Math.PI }, { ...candidate, heading: Math.PI * 2 }))) continue;
      const distance = Math.hypot(candidate.x - ship.x, candidate.y - ship.y);
      if (distance < bestDistance - 1e-7) { best = candidate; bestDistance = distance; }
    }
    if (best) { goal.x = best.x; goal.y = best.y; }
  }
  if (moving && phase === 'engage') {
    // Closing error changes speed continuously. A target moving away remains
    // a voyage even while the guns already have range.
    const closingGap = following ? distance - safeGap : gap - range * .68;
    if (fireHeading !== undefined && !following) {
      goal.fireHeading = fireHeading;
      const along = vx * detCos(fireHeading) + vy * detSin(fireHeading);
      goal.targetSpeed = Math.min(limits.speed, Math.max(0, along + closingGap * .2));
    } else goal.targetSpeed = Math.min(limits.speed, Math.max(speed * .55, speed + closingGap * .2));
  }
  if (!moving && phase === 'engage') goal.targetSpeed = 0;
  return goal;
}

export function shipCanTurnForAttack(ship: Unit): boolean {
  return ship.sailing?.pursuit?.phase === 'engage' && !ship.sailing.pursuit.moving && ship.sailing.speed <= 1;
}
