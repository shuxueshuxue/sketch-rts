import type { UnitDef } from "./catalog";
import type { Unit } from "./types";
import { perTick } from "./time";

type Point = { x: number; y: number };
export const RANGED_ATTACK_RANGE_THRESHOLD = 80;
export const DEFAULT_AIM_MOVE_TOLERANCE = 6;
export const AIM_SPEED_MULTIPLIER = 2 / 3;

export function aimingProfile(rules: UnitDef) {
  if (rules.naval && !rules.intrinsicAttack || rules.attackDamage <= 0 || rules.attackRange <= RANGED_ATTACK_RANGE_THRESHOLD) return undefined;
  return {
    speed: (rules.aimSpeed ?? (rules.weapon?.delivery === "shell" ? 400 : 480)) * AIM_SPEED_MULTIPLIER,
    moveTolerance: rules.aimMoveTolerance ?? DEFAULT_AIM_MOVE_TOLERANCE,
  };
}

/** Walking, crowd separation, shoves and unloading all invalidate the same displacement budget. */
export function invalidateMovedAim(unit: Unit, rules: UnitDef) {
  if (!unit.aim) return;
  const profile = aimingProfile(rules);
  if (!profile) { unit.aim = undefined; return; }
  const tolerance = profile.moveTolerance;
  const displacement = unit.deck
    ? Math.hypot(unit.deck.x-(unit.aim.anchorDeckX ?? unit.deck.x),unit.deck.y-(unit.aim.anchorDeckY ?? unit.deck.y))
    : Math.hypot(unit.x-unit.aim.anchorX,unit.y-unit.aim.anchorY);
  if (displacement > tolerance) unit.aim = undefined;
}

/** Advance only when the weapon is ready. Repeating an order never buys extra aim ticks. */
export function aimAt(unit: Unit, rules: UnitDef, target: Point, tick: number) {
  const profile = aimingProfile(rules);
  if (!profile) { unit.aim = undefined; return true; }
  invalidateMovedAim(unit, rules);
  if (!unit.aim) {
    unit.aim = { x: unit.x, y: unit.y, anchorX: unit.x, anchorY: unit.y, tracking: true, updatedTick: tick - 1 };
    if(unit.deck){unit.aim.anchorDeckX=unit.deck.x;unit.aim.anchorDeckY=unit.deck.y;}
  }
  const aim = unit.aim;
  if (aim.updatedTick !== tick) {
    // Identity is irrelevant: use the shortest route even after changing enemies or a prepared point.
    if (Math.hypot(target.x - unit.x, target.y - unit.y) < Math.hypot(target.x - aim.x, target.y - aim.y)) {
      aim.x = unit.x;
      aim.y = unit.y;
    }
    const dx = target.x - aim.x, dy = target.y - aim.y;
    const gap = Math.hypot(dx, dy);
    const step = perTick(profile.speed);
    if (gap <= step) { aim.x = target.x; aim.y = target.y; }
    else { aim.x += dx / gap * step; aim.y += dy / gap * step; }
    aim.updatedTick = tick;
  }
  aim.tracking = aim.x !== target.x || aim.y !== target.y;
  unit.facing = Math.atan2(aim.y - unit.y, aim.x - unit.x);
  return aim.x === target.x && aim.y === target.y;
}

/** Each successful shot renews the anchor; movement commands and cooldown ticks do not. */
export function markAimShot(unit: Unit) {
  if (!unit.aim) return;
  unit.aim.anchorX = unit.x;
  unit.aim.anchorY = unit.y;
  if(unit.deck){unit.aim.anchorDeckX=unit.deck.x;unit.aim.anchorDeckY=unit.deck.y;}
  unit.aim.tracking = false;
}
