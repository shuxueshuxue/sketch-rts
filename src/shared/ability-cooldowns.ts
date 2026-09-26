import { UNIT_DEFS } from "./catalog";
import type { AbilityKind, Unit } from "./types";

// @@@ability-cooldowns - As in Warcraft III, every ability keeps its own cooldown, apart from the weapon's: a caster casts
// whenever its spell is back, whatever its weapon is doing, and a cast leaves the weapon free. The two once shared the one
// `cooldown`, and a weapon with a target in reach fires on the tick that runs out: five witches among enemy spirits cursed
// four times in a whole battle, and a summoner that had just summoned could not swing its staff for forty seconds.
// `abilityCooldowns` holds only the abilities still cooling down (ticks left); it is replaced, never changed in place.
export function abilityCooldown(unit: Pick<Unit, "abilityCooldowns">, ability: AbilityKind): number {
  return unit.abilityCooldowns?.[ability] ?? 0;
}

// Whether the unit can cast any of its abilities now.
export function canCast(unit: Pick<Unit, "kind" | "abilityCooldowns">): boolean {
  return UNIT_DEFS[unit.kind].abilities.some((ability) => abilityCooldown(unit, ability) <= 0);
}

export function withAbilityCooldown(unit: Pick<Unit, "abilityCooldowns">, ability: AbilityKind, ticks: number): NonNullable<Unit["abilityCooldowns"]> {
  return { ...unit.abilityCooldowns, [ability]: ticks };
}

// One tick later: what is left of each cooldown, or undefined once none is.
export function tickedAbilityCooldowns(cooldowns: Unit["abilityCooldowns"]): Unit["abilityCooldowns"] {
  if (!cooldowns) return undefined;
  const left = Object.entries(cooldowns).filter(([, ticks]) => (ticks ?? 0) > 1).map(([ability, ticks]) => [ability, (ticks ?? 0) - 1] as const);
  return left.length > 0 ? (Object.fromEntries(left) as NonNullable<Unit["abilityCooldowns"]>) : undefined;
}
