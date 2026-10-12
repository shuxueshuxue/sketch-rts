import { describe, expect, it } from "vitest";
import { armorDamageProtection, resolveDamage, resolveUnitDamage, statusDamageProtection } from "./damage";
import { DAMAGE_PROFILES as P } from "./damage-types";
import { equipmentProtection } from "./equipment";
import { createUnit } from "./map";
import type { WorldItem } from "./types";

function equippedUnit() {
  const target = createUnit("veteran", "player", "footman", 500, 500);
  target.hands = { left: "shield" };
  const items: WorldItem[] = [
    { id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 },
    { id: "shield", kind: "roundShield", carrierId: target.id, slot: "carry0", x: 0, y: 0, cooldownRemaining: 0 },
  ];
  return { target, snapshot: { items } };
}

describe("incoming damage protection", () => {
  it("preserves heavy armor's shooter, tower and other-source matchups and rounding", () => {
    const reductions = armorDamageProtection("heavy");
    expect(resolveDamage(27, { profile: P.RANGED_PIERCE, reductions }).damage).toBe(14);
    expect(resolveDamage(27, { profile: P.MAGIC_RANGED, reductions }).damage).toBe(14);
    expect(resolveDamage(27, { profile: P.TOWER_ARROW, reductions }).damage).toBe(19);
    expect(resolveDamage(27, { profile: P.MELEE_CUT, reductions }).damage).toBe(27);
    expect(resolveDamage(27, { profile: P.LIGHTNING, reductions }).damage).toBe(27);
    expect(resolveDamage(27, { profile: P.RANGED_PIERCE, reductions: armorDamageProtection(undefined) }).damage).toBe(27);
    expect(resolveDamage(0.1, { profile: P.RANGED_PIERCE, reductions }).damage).toBe(1);
  });

  it("multiplies armor, equipment, aura and ward layers instead of adding to immunity", () => {
    const result = resolveDamage(100, { reductions: [
      { group: "armor", amount: 0.5 },
      { group: "equipment", amount: 0.08 },
      { group: "equipment", amount: 0.12 },
      { group: "aura", amount: 0.08 },
      { group: "ward", amount: 0.2 },
    ] });
    expect(result.blocked).toBe(false);
    expect(result.damage).toBeCloseTo(29.44);
    expect(result.multiplier).toBeCloseTo(0.2944);
  });

  it("uses the strongest passive, aura and temporary ward without stacking duplicate casters", () => {
    const result = resolveDamage(100, { reductions: [
      { group: "passive", amount: 0.1 },
      { group: "passive", amount: 0.15 },
      { group: "aura", amount: 0.08 },
      { group: "aura", amount: 0.08 },
      { group: "ward", amount: 0.12 },
      { group: "ward", amount: 0.2 },
      { group: "ward", amount: 0.2 },
    ] });
    expect(result.damage).toBeCloseTo(100 * 0.85 * 0.92 * 0.8);
  });

  it("caps combined equipment protection at 30% without capping unrelated protection", () => {
    const result = resolveDamage(100, { reductions: [
      { group: "equipment", amount: 0.2 },
      { group: "equipment", amount: 0.2 },
      { group: "ward", amount: 0.2 },
    ] });
    expect(result.damage).toBeCloseTo(56);
  });

  it("only applies armor that is worn and a shield that is actually wielded", () => {
    const { target, snapshot } = equippedUnit();
    expect(equipmentProtection(snapshot, target)).toBeCloseTo(0.2);
    expect(resolveUnitDamage(snapshot, target, 100, P.MELEE_CUT).damage).toBe(80);
    target.hands = {};
    expect(resolveUnitDamage(snapshot, target, 100, P.MELEE_CUT).damage).toBe(92);
    snapshot.items[0]!.slot = "carry1";
    expect(resolveUnitDamage(snapshot, target, 100, P.MELEE_CUT).damage).toBe(100);
  });

  it("retains fractional equipment damage and the existing shock-stance rounding", () => {
    const { target, snapshot } = equippedUnit();
    expect(resolveUnitDamage(snapshot, target, 13, P.MELEE_CUT).damage).toBeCloseTo(10.4);
    target.stance = "shock";
    expect(resolveUnitDamage(snapshot, target, 13, P.MELEE_CUT).damage).toBe(11);
    expect(resolveUnitDamage(snapshot, target, 0.1, P.MELEE_CUT).damage).toBe(1);
  });

  it("keeps guardian immunity explicit so blocked hits cannot apply on-hit effects", () => {
    const { target, snapshot } = equippedUnit();
    target.stance = "shock";
    target.effects.push({ type: "guardian", remaining: 20 });
    expect(resolveUnitDamage(snapshot, target, 100, P.MELEE_CUT, [{ group: "aura", amount: 0.08 }]))
      .toEqual({ damage: 0, blocked: true, multiplier: 0 });
    target.effects = [];
    target.invulnerable = true;
    expect(resolveUnitDamage(snapshot, target, 100, P.ARCANE).blocked).toBe(true);
  });

  it("projects only live protection effects and defaults temporary skills to the ward group", () => {
    const active = statusDamageProtection([
      { type: "guardian", remaining: 0 },
      { type: "protection", remaining: 20, damageReduction: 0.2 },
      { type: "protection", remaining: 10, damageReduction: 0.1, protectionGroup: "ward" },
      { type: "protection", remaining: 0, damageReduction: 0.9 },
      { type: "curse", remaining: 30 },
    ]);
    expect(active.invulnerable).toBe(false);
    expect(resolveDamage(100, active).damage).toBe(80);
  });

  it("does not manufacture damage from zero or turn invalid reduction values into healing", () => {
    expect(resolveDamage(0, { round: true }).damage).toBe(0);
    expect(resolveDamage(0, { profile: P.RANGED_PIERCE, reductions: armorDamageProtection("heavy") }).damage).toBe(0);
    expect(resolveDamage(100, { reductions: [
      { group: "ward", amount: -0.3 },
      { group: "passive", amount: Number.NaN },
    ] }).damage).toBe(100);
  });
});
