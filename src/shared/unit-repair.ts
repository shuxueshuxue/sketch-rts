import { unitRules } from "./catalog";
import { shipProfile } from "./ship-geometry";
import { shipNeedsRepair } from "./ship-equipment";
import { isMechanicalUnit } from "./unit-targeting";
import type { GameSnapshot, Unit } from "./types";

type RepairSnapshot = Pick<GameSnapshot, "items" | "variants">;

// @@@repair-under-fire - A ship's hull is mended at a quarter of the pace for a few seconds after each enemy blow, by
// however many hands: workers on a deck mended a transport faster (two of them 29 hp/s) than a ship of the line's
// broadside breaks it (25 hp/s), so it never sank. The gold paid for each point mended is the same; it is the work
// that slows. Out of the fire repair keeps its full pace.
export const REPAIR_UNDER_FIRE = { rate: 0.25, seconds: 5 } as const;

/** The share of the repair pace a ship gets now: REPAIR_UNDER_FIRE.rate within its window after a hull hit, else 1. */
export function repairPace(tick: number, unit: Pick<Unit, "sailing">) {
  const hit = unit.sailing?.hullHitTick;
  return hit !== undefined && tick - hit < REPAIR_UNDER_FIRE.seconds * 20 ? REPAIR_UNDER_FIRE.rate : 1;
}

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
