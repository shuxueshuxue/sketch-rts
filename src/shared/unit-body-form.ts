import { UNIT_DEFS, unitRules } from "./catalog";
import type { GameSnapshot, Unit } from "./types";

/** Physical form belongs to the unit definition, independent of its weapon or how it was recruited. */
export type UnitBodyForm = "foot" | "mounted" | "beast" | "machine" | "spirit";

export function unitBodyFormOf(unit: Pick<Unit, "kind" | "variant">, snapshot: Pick<GameSnapshot, "variants"> = {}): UnitBodyForm {
  // Older saved variants inherit the explicitly declared form of their catalog base.
  return unitRules(snapshot, unit).bodyForm ?? UNIT_DEFS[unit.kind].bodyForm;
}
