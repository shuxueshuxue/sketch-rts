import type { UnitDef } from "./catalog";

/** Only unmodified weapon definitions may be compared with this boundary. */
export const RANGED_ATTACK_RANGE_THRESHOLD = 80;
export function weaponClass(rules: Pick<UnitDef, "attackRange">): "melee" | "ranged" {
  return rules.attackRange > RANGED_ATTACK_RANGE_THRESHOLD ? "ranged" : "melee";
}
