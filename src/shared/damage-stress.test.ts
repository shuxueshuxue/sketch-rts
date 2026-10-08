import { describe, expect, it } from "vitest";
import { resolveDamage, type DamageReductionSource } from "./damage-reduction";
import { DAMAGE_PROFILES, type DamageFilter } from "./damage-types";

const STRESS_CASES = 5_000;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return (size: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % size;
  };
}

describe("damage protection invariants", () => {
  it("keeps 5,000 seeded mixed-protection scenarios finite, nonnegative and bounded by incoming damage", () => {
    const next = seededRandom(0x8d36a721);
    const profiles = Object.values(DAMAGE_PROFILES);
    const groups = ["armor", "equipment", "passive", "aura", "ward"] as const;
    const amounts = [-0.2, 0, 0.08, 0.12, 0.2, 0.3, 0.5, 0.9, 1, 1.2, Number.NaN, Number.POSITIVE_INFINITY];
    const filters: (DamageFilter | undefined)[] = [undefined, { school: "physical" }, { school: "magic" }, { delivery: "ranged" }, { physicalType: "pierce" }, { element: "fire" }, { school: "magic", delivery: ["melee", "effect"] }];
    for (let sample = 0; sample < STRESS_CASES; sample++) {
      const damage = 1 + next(10_000);
      const profile = profiles[next(profiles.length)]!;
      const reductions: DamageReductionSource[] = Array.from({ length: next(15) }, () => {
        const filter = filters[next(filters.length)];
        return { group: groups[next(groups.length)]!, amount: amounts[next(amounts.length)]!, ...(filter ? { filter } : {}) };
      });
      const result = resolveDamage(damage, { profile, reductions });
      expect(Number.isFinite(result.damage)).toBe(true);
      expect(result.damage).toBeGreaterThanOrEqual(0);
      expect(result.damage).toBeLessThanOrEqual(damage);
      expect(result.multiplier).toBeGreaterThanOrEqual(0);
      expect(result.multiplier).toBeLessThanOrEqual(1);
      expect(resolveDamage(damage, { profile, reductions: [...reductions].reverse() }).damage).toBeCloseTo(result.damage, 9);
      const protectedAgain = resolveDamage(damage, { profile, reductions: [...reductions, { group: "ward", amount: 0.2 }] });
      expect(protectedAgain.damage).toBeLessThanOrEqual(result.damage + 1e-9);
      const duplicateWard = resolveDamage(damage, { profile, reductions: [...reductions, { group: "ward", amount: 0.2 }, { group: "ward", amount: 0.2 }] });
      expect(duplicateWard).toEqual(protectedAgain);
      expect(resolveDamage(damage, { profile, reductions, invulnerable: true })).toEqual({ damage: 0, multiplier: 0, blocked: true });
    }
  });

  it.each(["cut", "pierce", "blunt"] as const)("only a matching %s defense changes damage across all physical deliveries", physicalType => {
    for (const delivery of ["melee", "ranged", "effect"] as const) {
      for (const actualType of ["cut", "pierce", "blunt"] as const) {
        const profile = { school: "physical", delivery, physicalType: actualType, origin: "unit" } as const;
        const result = resolveDamage(100, { profile, reductions: [{ group: "ward", amount: 0.2, filter: { school: "physical", physicalType } }] });
        expect(result.damage).toBe(actualType === physicalType ? 80 : 100);
      }
      expect(resolveDamage(100, { profile: { school: "magic", delivery, origin: "spell" }, reductions: [{ group: "ward", amount: 0.2, filter: { physicalType } }] }).damage).toBe(100);
    }
  });
});
