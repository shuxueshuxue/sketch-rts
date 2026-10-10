import { unitAbilities } from "./unit-abilities";
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
export function canCast(unit: Pick<Unit, "kind" | "abilityCooldowns" | "veteranSkill">): boolean {
  return unitAbilities(unit).some((ability) => abilityCooldown(unit, ability) <= 0);
}

export function withAbilityCooldown(unit: Pick<Unit, "abilityCooldowns">, ability: AbilityKind, ticks: number): NonNullable<Unit["abilityCooldowns"]> {
  return { ...unit.abilityCooldowns, [ability]: ticks };
}

// One tick later: what is left of each cooldown, or undefined once none is.
export function tickedAbilityCooldowns(cooldowns: Unit["abilityCooldowns"]): Unit["abilityCooldowns"] {
  if (!cooldowns) return undefined;
  let left: NonNullable<Unit["abilityCooldowns"]> | undefined;
  for (const ability of Object.keys(cooldowns)) {
    const ticks = cooldowns[ability as AbilityKind] ?? 0;
    if (!(ticks > 1)) continue;
    left ??= {};
    if (ability === "__proto__") {
      Object.defineProperty(left, ability, { value: ticks - 1, writable: true, enumerable: true, configurable: true });
    } else left[ability as AbilityKind] = ticks - 1;
  }
  return left;
}
