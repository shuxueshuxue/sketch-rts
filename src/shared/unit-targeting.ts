import { UNIT_DEFS, unitRules } from "./catalog";
import type { GameSnapshot, Unit } from "./types";

export type UnitClass = "mechanical" | "nonMechanical";
export type UnitTargetFilter = { unitClasses?: readonly UnitClass[] };
type TargetUnit = Pick<Unit, "kind" | "variant">;
type TargetSnapshot = Pick<GameSnapshot, "variants">;

/** Classification belongs to the unit, independent of its armor, weapon, passengers or movement. */
export function unitClassOf(unit: TargetUnit, snapshot: TargetSnapshot = {}): UnitClass {
  // Saved campaign variants made before classification inherit their base unit's class.
  return unitRules(snapshot, unit).unitClass ?? UNIT_DEFS[unit.kind].unitClass;
}

export function isMechanicalUnit(unit: TargetUnit, snapshot?: TargetSnapshot): boolean {
  return unitClassOf(unit, snapshot) === "mechanical";
}

/** Relationship, range, health and ability-specific requirements are checked by the caller. */
export function matchesUnitTarget(unit: TargetUnit, filter: UnitTargetFilter | undefined, snapshot?: TargetSnapshot): boolean {
  return !filter?.unitClasses || filter.unitClasses.includes(unitClassOf(unit, snapshot));
}

export const NON_MECHANICAL_TARGETS = { unitClasses: ["nonMechanical"] } as const satisfies UnitTargetFilter;
export const MECHANICAL_TARGETS = { unitClasses: ["mechanical"] } as const satisfies UnitTargetFilter;
