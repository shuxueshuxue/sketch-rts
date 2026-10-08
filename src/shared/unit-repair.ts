import { unitRules } from "./catalog";
import { shipProfile } from "./ship-geometry";
import { shipNeedsRepair } from "./ship-equipment";
import { isMechanicalUnit } from "./unit-targeting";
import type { GameSnapshot, Unit } from "./types";

type RepairSnapshot = Pick<GameSnapshot, "items" | "variants">;

export const UNIT_REPAIR_RULES = {
  fullCostFraction: 0.35,
  /** Captured/scripted constructs have no training price; they still cost gold to mend. */
  unpricedHpPerGold: 5,
} as const;

/** One predicate for order validation, right-click affordances and actual work. */
export function unitNeedsRepair(snapshot: RepairSnapshot, unit: Unit): boolean {
  return unit.hp > 0 && isMechanicalUnit(unit, snapshot)
    && (shipProfile(unit) ? shipNeedsRepair(snapshot, unit) : unit.hp < unit.maxHp);
}

/** Preserve ship repair pricing; give unpriced constructs a finite repair budget. */
export function unitRepairHpPerGold(snapshot: RepairSnapshot, unit: Unit): number {
  const cost = unitRules(snapshot, unit).cost;
  const fullCost = Math.max(1, cost > 0
    ? Math.round(cost * UNIT_REPAIR_RULES.fullCostFraction)
    : Math.ceil(unit.maxHp / UNIT_REPAIR_RULES.unpricedHpPerGold));
  return Math.max(1, unit.maxHp / fullCost);
}
