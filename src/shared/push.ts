import { UNIT_DEFS } from "./catalog";
import { isWalkable } from "./terrain";
import type { GameMap, MeleeStance, Unit, UnitKind } from "./types";

// @@@push - A shove (a blow that knocks back, a lunge) gives a unit a velocity of its own beside its walk: pushX/pushY, in
// units a tick. The unit slides off in a straight line and the ground slows it by PUSH_FRICTION a tick every tick (uniform
// deceleration), so a shove of strength F, with nothing in the way, carries it exactly F before it stops: it sets off at
// sqrt(2 * PUSH_FRICTION * F). Shoves add as vectors, so blows from opposite sides cancel out. While its pushed speed is over
// STAND_SPEED the unit has lost its footing (staggered): it neither walks, strikes nor casts; below it the unit stands and
// fights while the rest of the slide runs out. A unit beaten on from every side is shoved every way at once and keeps its
// feet. A slide that runs into another unit shares its momentum with it along the line between them, as two bodies that
// stick together (mass by the square of the body's radius): the one in front is carried along, the one behind stops
// sooner, and through a crowd the shove passes from body to body. Ground a unit cannot stand on (see @@@terrain) and the
// map's edge stop the part of a slide that heads into them.
// 100 slides in 0.4 s, 500 in 0.9 s.
export const PUSH_FRICTION = 3.125;
// Walking is 2 to 4.35 a tick: a unit carried faster than about twice that is off its feet.
export const STAND_SPEED = 6;

// @@@melee-stances - How a melee fighter (not a worker) lands its blow. pursue, the default, is the plain blow of before.
// brace: the blow shoves the target back by KNOCKBACK times the damage over the target's full health (a lancer's 18 on a
// footman's 145 is 159, a golem's 34 on an 85-health spirit 512), for a fifth less damage. shock: the blow shoves the
// target as brace's does and the striker after it by the same strength, so the two drive on together; a fighter in shock
// takes a fifth more damage from everything. Eight lancers holding their ground in brace against eight footmen won 37 of
// 40 jittered fights at this strength, 14 at 640 and 3 at 320 (12 holding in pursue): a shove pays for the fifth only
// when the shoved must walk back into a longer reach than its own.
export const KNOCKBACK = 1280;
export const BRACE_DAMAGE_SHARE = 0.8;
export const SHOCK_DAMAGE_TAKEN = 1.2;
const MELEE_RANGE = 90;

export function canTakeStance(kind: UnitKind) {
  const def = UNIT_DEFS[kind];
  return kind !== "worker" && def.attackDamage > 0 && def.attackRange <= MELEE_RANGE;
}

export function isMeleeStance(value: unknown): value is MeleeStance {
  return value === "pursue" || value === "brace" || value === "shock";
}

// The speed a shove of this strength sets a unit off at.
export function pushSpeed(strength: number) {
  return strength > 0 ? Math.sqrt(2 * PUSH_FRICTION * strength) : 0;
}

export function pushedSpeed(unit: Unit) {
  const x = unit.pushX ?? 0;
  const y = unit.pushY ?? 0;
  return Math.sqrt(x * x + y * y);
}

export function isStaggered(unit: Unit) {
  return unit.pushX !== undefined && pushedSpeed(unit) > STAND_SPEED;
}

export function unitMass(unit: Unit) {
  return unit.radius * unit.radius;
}

// Shoves the unit toward (dx, dy) with this strength (see @@@push); a zero direction shoves it east.
export function shove(unit: Unit, dx: number, dy: number, strength: number) {
  const speed = pushSpeed(strength);
  if (speed <= 0) return;
  const length = Math.sqrt(dx * dx + dy * dy);
  const nx = length === 0 ? 1 : dx / length;
  const ny = length === 0 ? 0 : dy / length;
  unit.pushX = (unit.pushX ?? 0) + nx * speed;
  unit.pushY = (unit.pushY ?? 0) + ny * speed;
}

// The shove of a blow that dealt this damage (see @@@melee-stances).
export function blowStrength(damage: number, target: Unit) {
  return (KNOCKBACK * damage) / Math.max(1, target.maxHp);
}

// One tick of a unit's slide. Each tick it covers its speed less half the tick's slowing, the last tick what remains of
// speed² / 2a, so the whole slide is exactly (starting speed)² / 2a. No tick covers more than MAX_SLIDE_STEP: a faster
// slide covers that much and keeps the speed whose own slide is the rest (speed² - 2a * step = speed'²), so it runs longer
// and just as far. Two bodies (radius 13 at the least) never pass through each other inside one tick.
const MAX_SLIDE_STEP = 24;

export function slide(unit: Unit, map: GameMap) {
  const vx = unit.pushX;
  const vy = unit.pushY;
  if (vx === undefined || vy === undefined) return;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const last = speed <= PUSH_FRICTION;
  const capped = speed > MAX_SLIDE_STEP + PUSH_FRICTION / 2;
  const step = last ? (speed * speed) / (2 * PUSH_FRICTION) : capped ? MAX_SLIDE_STEP : speed - PUSH_FRICTION / 2;
  const kept = last ? 0 : capped ? Math.sqrt(speed * speed - 2 * PUSH_FRICTION * MAX_SLIDE_STEP) / speed : (speed - PUSH_FRICTION) / speed;
  let px = vx * kept;
  let py = vy * kept;
  let x = speed === 0 ? unit.x : unit.x + (vx / speed) * step;
  let y = speed === 0 ? unit.y : unit.y + (vy / speed) * step;
  if (x < 0 || x > map.width) {
    x = Math.min(map.width, Math.max(0, x));
    px = 0;
  }
  if (y < 0 || y > map.height) {
    y = Math.min(map.height, Math.max(0, y));
    py = 0;
  }
  if (map.terrain && !isWalkable(map, x, y) && isWalkable(map, unit.x, unit.y)) {
    if (isWalkable(map, x, unit.y)) {
      y = unit.y;
      py = 0;
    } else if (isWalkable(map, unit.x, y)) {
      x = unit.x;
      px = 0;
    } else {
      x = unit.x;
      y = unit.y;
      px = 0;
      py = 0;
    }
  }
  unit.x = x;
  unit.y = y;
  if (px === 0 && py === 0) {
    unit.pushX = undefined;
    unit.pushY = undefined;
  } else {
    unit.pushX = px;
    unit.pushY = py;
  }
}

// Two overlapping units, (nx, ny) the way from a to b, at least one of them sliding: when they close on each other along
// that line both leave it at their common speed, momentum kept; across it each keeps its own.
export function pushContact(a: Unit, b: Unit, nx: number, ny: number) {
  const av = (a.pushX ?? 0) * nx + (a.pushY ?? 0) * ny;
  const bv = (b.pushX ?? 0) * nx + (b.pushY ?? 0) * ny;
  if (av <= bv) return;
  const ma = unitMass(a);
  const mb = unitMass(b);
  const common = (ma * av + mb * bv) / (ma + mb);
  a.pushX = (a.pushX ?? 0) + (common - av) * nx;
  a.pushY = (a.pushY ?? 0) + (common - av) * ny;
  b.pushX = (b.pushX ?? 0) + (common - bv) * nx;
  b.pushY = (b.pushY ?? 0) + (common - bv) * ny;
}
