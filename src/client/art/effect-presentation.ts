import { BUILDING_DEFS, UNIT_DEFS, hasSpell } from "../../shared/catalog";
import type { RaceId, UnitKind, WorldEffect } from "../../shared/types";
import { unitArtFaction } from "./unit-appearance";
type Point = { x: number; y: number };
type Rgb = { r: number; g: number; b: number };

export type ProjectileLook = "arrow" | "orb" | "streak" | "fire" | "spear" | "stone" | "shell";

// @@@projectile-look - The shooter's rules pick the missile: a unit with a spell throws a small spell orb (its weapon is
// weak), any other ranged unit and a tower shoot an arrow (a rider's charge is no spell). Item blasts carry no shooter
// and keep the old streak.
export function projectileLook(sourceKind: WorldEffect["sourceKind"], attackKind?: WorldEffect["attackKind"]): ProjectileLook {
  if(attackKind) return attackKind==="magic" ? "orb" : attackKind==="cannon" || attackKind==="mortar" ? "shell" : attackKind==="bolt" ? "arrow" : attackKind==="flame" ? "fire" : ["arrow","spear","stone","fire"].includes(attackKind) ? attackKind as ProjectileLook : "streak";
  if (!sourceKind) return "streak";
  if (sourceKind === "redDragon" || sourceKind === "dragonWhelp" || sourceKind === "fireShip") return "fire";
  if (sourceKind === "murlocHunter") return "spear";
  if (sourceKind === "thornSlinger") return "stone";
  if (sourceKind === "warship" || sourceKind === "shipOfTheLine" || sourceKind === "bombardShip" || sourceKind === "catapult" || sourceKind === "organGun") return "shell";
  if (sourceKind === "archer" || sourceKind === "horseArcher" || sourceKind === "sparkArcher" || sourceKind === "contractArcher" || sourceKind === "defenseTower" || sourceKind === "cutter" || sourceKind === "ballista") return "arrow";
  if (isUnitKind(sourceKind) && hasSpell(sourceKind)) return "orb";
  return "stone";
}


export function isUnitKind(kind: NonNullable<WorldEffect["sourceKind"]>): kind is UnitKind {
  return kind in UNIT_DEFS;
}

const LAUNCH_REACH = 0.8;

/** Missiles leave from the shooter's edge (its catalog radius toward the target), not from the middle of its body. */
export function launchPoint(from: Point, to: Point, sourceKind: NonNullable<WorldEffect["sourceKind"]>): Point {
  const radius = isUnitKind(sourceKind) ? UNIT_DEFS[sourceKind].radius : BUILDING_DEFS[sourceKind].radius;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return from;
  const reach = Math.min(radius * LAUNCH_REACH, length / 2);
  return { x: from.x + (dx / length) * reach, y: from.y + (dy / length) * reach };
}

const ARROW_LENGTH = 22;
export const TOWER_ARROW_SCALE = 1.2;
const ARROW_ARC_RATIO = 0.12;
const ARROW_MAX_ARC = 36;

export type ArrowFrame = { tip: Point; tail: Point; angle: number; length: number };

/** An arrow lobbed along a shallow arc from shooter to target: its tip rides the arc and it points along its path. */
export function arrowFrame(from: Point, to: Point, progress: number, scale = 1): ArrowFrame {
  const p = Math.max(0, Math.min(1, progress));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(ARROW_MAX_ARC, Math.hypot(dx, dy) * ARROW_ARC_RATIO);
  const tip = { x: from.x + dx * p, y: from.y + dy * p - 4 * lift * p * (1 - p) };
  const angle = Math.atan2(dy - 4 * lift * (1 - 2 * p), dx);
  const length = ARROW_LENGTH * scale;
  return { tip, tail: { x: tip.x - Math.cos(angle) * length, y: tip.y - Math.sin(angle) * length }, angle, length };
}


export type SpellOrbPalette = { glow: Rgb; core: Rgb };

const SPELL_ORB_PALETTES: Record<"grove" | "ember" | "unaligned", SpellOrbPalette> = {
  grove: { glow: { r: 64, g: 164, b: 136 }, core: { r: 228, g: 255, b: 242 } },
  ember: { glow: { r: 222, g: 108, b: 48 }, core: { r: 255, g: 238, b: 204 } },
  unaligned: { glow: { r: 132, g: 112, b: 196 }, core: { r: 242, g: 236, b: 255 } },
};

/** Projectiles carry their shooter owner. Resolve its faction first; previews
 * without an owner use authored art metadata, never production eligibility. */
export function spellOrbPalette(sourceKind: WorldEffect["sourceKind"], race?: RaceId): SpellOrbPalette {
  const faction = race ?? (sourceKind && isUnitKind(sourceKind) ? unitArtFaction(sourceKind) : undefined);
  return SPELL_ORB_PALETTES[faction === "common" ? "grove" : faction === "grove" || faction === "ember" ? faction : "unaligned"];
}


// @@@charge-trail - A charging rider leaves speed lines streaming off its back and a wake of dust kicked up along the
// ground it has covered, the newest puffs small and thick at its hooves, the older ones spread and thin; both fade as
// the dash runs out. On impact (chargeImpact) a flash of gold rays and sparks thrown forward bursts on the target inside
// a ring of dust rolling outward. Everything is placed from the effect's own numbers (no randomness, no clock), so a
// frame drawn twice is drawn the same, in the browser and in recordings alike.
const CHARGE_STREAKS = [
  { side: -0.85, length: 0.72 },
  { side: -0.4, length: 1 },
  { side: 0.05, length: 0.86 },
  { side: 0.45, length: 0.96 },
  { side: 0.9, length: 0.66 },
] as const;
const CHARGE_STREAK_REACH = 96;
const CHARGE_DUST_SPACING = 24;
const CHARGE_DUST_REACH = 260;
export type ChargeTrailFrame = {
  streaks: { from: Point; to: Point; alpha: number; width: number }[];
  puffs: { x: number; y: number; rx: number; ry: number; alpha: number }[];
};

export function chargeTrailFrame(start: Point, rider: Point, target: Point, life: number, radius: number): ChargeTrailFrame {
  const heading = unitVector(start, target) ?? unitVector(start, rider) ?? { x: 1, y: 0 };
  const across = { x: -heading.y, y: heading.x };
  const traveled = Math.hypot(rider.x - start.x, rider.y - start.y);
  // Full strength while the rider runs, easing out over the dash's last third.
  const strength = Math.max(0, Math.min(1, life * 3));
  const back = { x: rider.x - heading.x * radius * 0.7, y: rider.y - heading.y * radius * 0.7 };
  const streakReach = Math.min(CHARGE_STREAK_REACH, traveled + radius);
  const streaks = CHARGE_STREAKS.map((streak, index) => {
    const from = { x: back.x + across.x * streak.side * radius, y: back.y + across.y * streak.side * radius };
    const length = streakReach * streak.length;
    return {
      from,
      to: { x: from.x - heading.x * length, y: from.y - heading.y * length },
      alpha: (0.34 + 0.18 * (index % 2)) * strength,
      width: index === 2 ? 2.4 : 1.6,
    };
  }).filter((streak) => streak.alpha > 0.01 && streakReach > 2);
  const ground = radius * 0.72;
  const puffs: ChargeTrailFrame["puffs"] = [];
  const wake = Math.min(traveled, CHARGE_DUST_REACH);
  for (let behind = CHARGE_DUST_SPACING * 0.5, index = 0; behind <= wake; behind += CHARGE_DUST_SPACING, index += 1) {
    const age = behind / CHARGE_DUST_REACH;
    const sway = Math.sin(index * 2.39 + 0.7) * radius * 0.35;
    const rx = radius * (0.34 + age * 0.9);
    puffs.push({
      x: rider.x - heading.x * behind + across.x * sway,
      y: rider.y - heading.y * behind + across.y * sway + ground,
      rx,
      ry: rx * 0.5,
      alpha: (0.46 * (1 - age) + 0.04) * strength,
    });
  }
  return { streaks, puffs: puffs.filter((puff) => puff.alpha > 0.01) };
}

// Without the rider's drawn position (an effect drawn on its own), guess it from the dash's progress.
export function estimatedRider(from: Point, to: Point, life: number, sourceKind: WorldEffect["sourceKind"]): Point {
  const heading = unitVector(from, to);
  if (!heading) return from;
  const run = Math.max(0, Math.hypot(to.x - from.x, to.y - from.y) - riderRadius(sourceKind) * 2) * Math.max(0, Math.min(1, 1 - life));
  return { x: from.x + heading.x * run, y: from.y + heading.y * run };
}

export function riderRadius(sourceKind: WorldEffect["sourceKind"]) {
  return sourceKind && isUnitKind(sourceKind) ? UNIT_DEFS[sourceKind].radius : 18;
}

// The blow lands hard but it is only two blows' worth: a short flash, a few sparks, a puff of dust.
const CHARGE_RAYS = 6;
const CHARGE_SPARKS = [-0.6, -0.2, 0.2, 0.6] as const;
const CHARGE_CLODS = 4;

export type ChargeImpactFrame = {
  ring: { x: number; y: number; rx: number; ry: number; alpha: number };
  rays: { from: Point; to: Point; alpha: number }[];
  sparks: { from: Point; to: Point; alpha: number }[];
  clods: { x: number; y: number; r: number; alpha: number }[];
};

export function chargeImpactFrame(point: Point, rider: Point, life: number): ChargeImpactFrame {
  const clamped = Math.max(0, Math.min(1, life));
  const burst = 1 - clamped;
  const heading = unitVector(rider, point) ?? { x: 1, y: 0 };
  const angle = Math.atan2(heading.y, heading.x);
  const flash = Math.max(0, (clamped - 0.5) / 0.5);
  const rays = flash > 0
    ? Array.from({ length: CHARGE_RAYS }, (_, index) => {
        const ray = angle + (index / CHARGE_RAYS) * Math.PI * 2;
        const inner = 6 + burst * 6;
        const outer = inner + 6 + burst * 12 * (index % 2 === 0 ? 1 : 0.6);
        return {
          from: { x: point.x + Math.cos(ray) * inner, y: point.y + Math.sin(ray) * inner * 0.8 },
          to: { x: point.x + Math.cos(ray) * outer, y: point.y + Math.sin(ray) * outer * 0.8 },
          alpha: flash * 0.6,
        };
      })
    : [];
  const sparks = CHARGE_SPARKS.map((spread, index) => {
    const direction = angle + spread;
    const reach = 8 + burst * (20 + (index % 2) * 8);
    const fall = burst * burst * 6;
    const head = { x: point.x + Math.cos(direction) * reach, y: point.y + Math.sin(direction) * reach * 0.8 + fall };
    return { from: { x: head.x - Math.cos(direction) * 6, y: head.y - Math.sin(direction) * 5 }, to: head, alpha: clamped * 0.8 };
  });
  const ringRx = 12 + burst * 26;
  const clods = Array.from({ length: CHARGE_CLODS }, (_, index) => {
    const around = angle + Math.PI * (0.3 + index * 0.45);
    return {
      x: point.x + Math.cos(around) * ringRx * 0.9,
      y: point.y + 12 + Math.sin(around) * ringRx * 0.36,
      r: 1.5 + (index % 2) + burst * 1.5,
      alpha: clamped * 0.6,
    };
  });
  return { ring: { x: point.x, y: point.y + 12, rx: ringRx, ry: ringRx * 0.38, alpha: clamped * 0.7 }, rays, sparks, clods };
}

function unitVector(from: Point, to: Point): Point | undefined {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0.001 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : undefined;
}

export function hasEffectVector(effect: WorldEffect): effect is WorldEffect & Required<Pick<WorldEffect, "fromX" | "fromY" | "toX" | "toY">> {
  return (
    typeof effect.fromX === "number" &&
    typeof effect.fromY === "number" &&
    typeof effect.toX === "number" &&
    typeof effect.toY === "number"
  );
}

