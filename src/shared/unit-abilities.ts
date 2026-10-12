import { UNIT_DEFS } from "./catalog";
import { isVeteranActiveSkillId } from "./veteran-skills";
import type { AbilityKind, Unit } from "./types";

export function isStunned(unit: Pick<Unit, "effects">): boolean {
  return unit.effects.some(effect => effect.type === "stun" && effect.remaining > 0);
}

/** Learned active skills use the same casting, cooldown and autocast rules as innate abilities. */
export function unitAbilities(unit: Pick<Unit, "kind" | "veteranSkill">): readonly AbilityKind[] {
  const innate = UNIT_DEFS[unit.kind].abilities;
  return isVeteranActiveSkillId(unit.veteranSkill) ? [...innate, unit.veteranSkill] : innate;
}
