import type { Unit } from "./types";
import { isVeteranSkillId, VETERAN_SKILLS } from "./veteran-skills";

/** Apply a learned personal bonus to an unmodified weapon range. Do not pass already-derived unit.attackRange. */
export function veteranWeaponRange(unit: Pick<Unit, "veteranSkill">, baseRange: number): number {
  if (!isVeteranSkillId(unit.veteranSkill)) return baseRange;
  const effect = VETERAN_SKILLS[unit.veteranSkill].effect;
  return baseRange * (effect.type === "passive" ? effect.modifiers.attackRangeMultiplier ?? 1 : 1);
}
