import { UNIT_DEFS } from "./catalog";
import { weaponClass } from "./weapon-class";
import type { Unit } from "./types";

/** Cached from the current weapon definition alongside derived stats; older/imported units inherit their catalog weapon. */
export function isRangedUnit(unit: Pick<Unit, "kind" | "attackClass">): boolean {
  return (unit.attackClass ?? weaponClass(UNIT_DEFS[unit.kind])) === "ranged";
}
