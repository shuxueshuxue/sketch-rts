import { ABILITY_DEFS, UNIT_DEFS } from "./catalog";
import type { AbilityKind, Unit } from "./types";

// @@@autocast - As in Warcraft III, a unit casts its abilities on its own: the engine, not the player's AI, looks for a
// moment and a target each time an ability is ready (see autocastStep in the sim). Nearly every unit ability starts
// switched on; the player switches one off or back on per unit (right-click on the command card sends setAutocast).
// `unit.autocast` holds only the switches that differ from the ability's default.

export function canAutocast(ability: AbilityKind) {
  return ABILITY_DEFS[ability].autocast !== "none";
}

export function autocastEnabled(unit: Pick<Unit, "kind" | "autocast">, ability: AbilityKind) {
  if (!canAutocast(ability) || !UNIT_DEFS[unit.kind].abilities.includes(ability)) return false;
  return unit.autocast?.[ability] ?? ABILITY_DEFS[ability].autocast === "on";
}

// The unit's switches with `ability` set to `enabled`, keeping only what differs from the defaults (undefined when nothing does).
export function withAutocast(unit: Pick<Unit, "autocast">, ability: AbilityKind, enabled: boolean): Unit["autocast"] {
  const next: NonNullable<Unit["autocast"]> = { ...unit.autocast };
  if (enabled === (ABILITY_DEFS[ability].autocast === "on")) delete next[ability];
  else next[ability] = enabled;
  return Object.keys(next).length > 0 ? next : undefined;
}
