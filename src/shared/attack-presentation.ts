import type { BuildingKind, UnitKind } from "./types";
import { hasSpell, UNIT_DEFS } from "./catalog";

/** Captured when an attack leaves, independent of its carrier's hull/model. */
export type AttackKind = "melee" | "arrow" | "spear" | "stone" | "magic" | "fire" | "bolt" | "cannon" | "mortar" | "flame" | "grapeshot";
export function innateMissile(kind: UnitKind | BuildingKind): AttackKind {
  if (["redDragon", "dragonWhelp"].includes(kind)) return "fire";
  if (kind === "murlocHunter") return "spear";
  if (["archer", "horseArcher", "sparkArcher", "contractArcher", "defenseTower", "cutter"].includes(kind)) return "arrow";
  if (kind in UNIT_DEFS && hasSpell(kind as UnitKind)) return "magic";
  return "stone";
}
