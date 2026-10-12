import { describe, expect, it } from "vitest";
import { resolveVariant, UNIT_DEFS, type VariantRules } from "./catalog";
import { isMechanicalUnit, matchesUnitTarget, MECHANICAL_TARGETS, NON_MECHANICAL_TARGETS, unitClassOf } from "./unit-targeting";
import { canReceiveHealing } from "./healing";
import type { UnitKind } from "./types";

const mechanical: UnitKind[] = ["golem", "rubbleGolem", "rockGolem", "graniteGolem", "siegeRam", "ballista", "catapult", "organGun", "transport", "warship", "shipOfTheLine", "cutter", "bombardShip", "fireShip", "carrier"];

describe("unit classes and effect targets", () => {
  it("explicitly classifies every catalog unit, including magic constructs and land siege engines", () => {
    for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
      const expected = mechanical.includes(kind);
      expect(UNIT_DEFS[kind].unitClass, kind).toBe(expected ? "mechanical" : "nonMechanical");
      expect(isMechanicalUnit({ kind }), kind).toBe(expected);
      expect(canReceiveHealing({ kind }), kind).toBe(!expected);
    }
  });

  it("keeps class independent of armor and movement and permits unrestricted effects on both classes", () => {
    for (const kind of ["golem", "knight", "spirit", "siegeRam", "transport"] as const) {
      expect(matchesUnitTarget({ kind }, undefined)).toBe(true);
      expect(matchesUnitTarget({ kind }, { unitClasses: [] })).toBe(false);
      expect(matchesUnitTarget({ kind }, { unitClasses: ["mechanical", "nonMechanical"] })).toBe(true);
      expect(matchesUnitTarget({ kind }, MECHANICAL_TARGETS)).toBe(!matchesUnitTarget({ kind }, NON_MECHANICAL_TARGETS));
    }
    expect(UNIT_DEFS.knight.armor).toBe(UNIT_DEFS.golem.armor);
    expect(canReceiveHealing({ kind: "knight" })).toBe(true);
    expect(canReceiveHealing({ kind: "golem" })).toBe(false);
  });

  it("respects per-game variant overrides without changing the base catalog", () => {
    const snapshot = { variants: {
      machine: resolveVariant({ base: "footman", unitClass: "mechanical" }),
      creature: resolveVariant({ base: "golem", unitClass: "nonMechanical" }),
    } };
    expect(canReceiveHealing({ kind: "footman", variant: "machine" }, snapshot)).toBe(false);
    expect(canReceiveHealing({ kind: "golem", variant: "creature" }, snapshot)).toBe(true);
    expect(unitClassOf({ kind: "footman" }, snapshot)).toBe("nonMechanical");
    expect(unitClassOf({ kind: "golem" }, snapshot)).toBe("mechanical");
  });

  it("inherits classification when reading an older variant without the new field", () => {
    const { unitClass: _removed, ...olderRules } = resolveVariant({ base: "golem", hp: 900 });
    expect(unitClassOf({ kind: "golem", variant: "old" }, { variants: { old: olderRules as VariantRules } })).toBe("mechanical");
  });
});
