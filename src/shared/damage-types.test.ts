import { describe, expect, it } from "vitest";
import { UNIT_DEFS, resolveVariant } from "./catalog";
import { armorDamageProtection, resolveDamage, resolveUnitDamage } from "./damage";
import { ABILITY_DAMAGE_PROFILES, DAMAGE_PROFILES as P, ITEM_DAMAGE_PROFILES, UNIT_DAMAGE_PROFILES, attackDamageProfile, matchesDamageProfile, weaponDamageProfile, type DamageProfile } from "./damage-types";
import { createUnit } from "./map";
import type { WorldItem } from "./types";

describe("damage profiles and selective protection", () => {
  it("declares every roster attack independently of its range and ability list", () => {
    expect(Object.keys(UNIT_DAMAGE_PROFILES).sort()).toEqual(Object.keys(UNIT_DEFS).sort());
    expect(attackDamageProfile("lancer")).toMatchObject({ school: "physical", delivery: "melee", physicalType: "pierce" });
    expect(attackDamageProfile("archer")).toMatchObject({ school: "physical", delivery: "ranged", physicalType: "pierce" });
    expect(attackDamageProfile("priest")).toMatchObject({ school: "magic", delivery: "ranged", origin: "unit" });
    expect(attackDamageProfile("spirit")).toMatchObject({ school: "magic", delivery: "melee" });
    expect(attackDamageProfile("defenseTower")).toEqual(P.TOWER_ARROW);
  });

  it("follows borrowed weapons, installed guns and explicit weapon profiles", () => {
    expect(attackDamageProfile("archer", undefined, { kind: "greatSword" })).toEqual(P.MELEE_CUT);
    expect(attackDamageProfile("footman", undefined, { kind: "issuedWeapon", weaponKind: "priest" })).toEqual(P.MAGIC_RANGED);
    expect(weaponDamageProfile({ delivery: "ram", presentation: "melee" })).toEqual(P.MELEE_BLUNT);
    expect(weaponDamageProfile({ delivery: "bolt", presentation: "cannon" })).toEqual(P.RANGED_BLUNT);
    expect(weaponDamageProfile({ delivery: "bolt", presentation: "bolt" })).toEqual(P.RANGED_PIERCE);
    expect(weaponDamageProfile({ delivery: "cone", presentation: "flame" })).toEqual(P.FIRE_RANGED);
    const enchanted: DamageProfile = { school: "magic", delivery: "ranged", element: "lightning", origin: "unit" };
    expect(weaponDamageProfile({ delivery: "bolt", presentation: "cannon", damageProfile: enchanted })).toEqual(enchanted);
  });

  it("keeps a magical projectile distinct from a caster's basic attack", () => {
    const reductions = armorDamageProtection("heavy");
    expect(resolveDamage(40, { profile: P.MAGIC_RANGED, reductions }).damage).toBe(20);
    expect(resolveDamage(40, { profile: ITEM_DAMAGE_PROFILES.lightningRod, reductions }).damage).toBe(40);
    expect(resolveDamage(40, { profile: ABILITY_DAMAGE_PROFILES.curse, reductions }).damage).toBe(40);
    expect(resolveDamage(40, { profile: P.TOWER_ARROW, reductions }).damage).toBe(28);
  });

  it("ANDs dimensions while accepting alternatives within a dimension", () => {
    const filter = { school: "physical", delivery: ["melee", "ranged"], physicalType: "pierce" } as const;
    expect(matchesDamageProfile(P.RANGED_PIERCE, filter)).toBe(true);
    expect(matchesDamageProfile(P.MELEE_PIERCE, filter)).toBe(true);
    expect(matchesDamageProfile(P.RANGED_BLUNT, filter)).toBe(false);
    expect(matchesDamageProfile(P.MAGIC_RANGED, filter)).toBe(false);
    expect(matchesDamageProfile(P.FIRE_ARROW, { element: "fire", school: "physical" })).toBe(true);
    expect(matchesDamageProfile(P.FIRE_RANGED, { element: "fire", school: "physical" })).toBe(false);
    expect(matchesDamageProfile(P.RANGED_PIERCE, { element: "fire" })).toBe(false);
  });

  it("filters each source before choosing the strongest source in that protection group", () => {
    const reductions = [
      { group: "ward", amount: 0.4, filter: { school: "physical" } },
      { group: "ward", amount: 0.2 },
      { group: "passive", amount: 0.1, filter: { element: "fire" } },
    ] as const;
    expect(resolveDamage(100, { profile: P.MELEE_CUT, reductions }).damage).toBe(60);
    expect(resolveDamage(100, { profile: P.MAGIC_RANGED, reductions }).damage).toBe(80);
    expect(resolveDamage(100, { profile: P.FIRE_RANGED, reductions }).damage).toBe(72);
    expect(resolveDamage(100, { reductions }).damage).toBe(80);
  });

  it("makes leather and shields physical protection while skills protect both schools", () => {
    const target = createUnit("armored", "player", "footman", 500, 500);
    target.hands = { left: "shield" };
    const items: WorldItem[] = [
      { id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 },
      { id: "shield", kind: "roundShield", carrierId: target.id, slot: "carry0", x: 0, y: 0, cooldownRemaining: 0 },
    ];
    target.effects = [{ type: "protection", damageReduction: 0.2, protectionGroup: "ward", remaining: 50 }];
    const snapshot = { items };
    expect(resolveUnitDamage(snapshot, target, 100, P.MELEE_CUT).damage).toBeCloseTo(64);
    expect(resolveUnitDamage(snapshot, target, 100, P.MAGIC_RANGED).damage).toBe(80);
    expect(resolveUnitDamage(snapshot, target, 100, P.POISON).damage).toBe(80);
    expect(resolveUnitDamage(snapshot, target, 100, P.LIGHTNING, [{ group: "aura", amount: 0.08 }]).damage).toBeCloseTo(73.6);
  });

  it("reads variant armor and applies its rounding before the other layers once", () => {
    const target = createUnit("campaign-guard", "player", "footman", 500, 500);
    target.variant = "heavy-guard";
    const snapshot = { items: [], variants: { "heavy-guard": resolveVariant({ base: "footman", armor: "heavy" }) } };
    expect(resolveUnitDamage(snapshot, target, 27, P.RANGED_PIERCE, [{ group: "ward", amount: 0.2 }]).damage).toBeCloseTo(11.2);
    expect(resolveUnitDamage(snapshot, target, 27, P.ARCANE, [{ group: "ward", amount: 0.2 }]).damage).toBeCloseTo(21.6);
  });

  it("only skips the armor layer for migrated in-flight damage already reduced by old armor", () => {
    const target = createUnit("old-shot-target", "enemy", "knight", 500, 500);
    const items: WorldItem[] = [
      { id: "armor", kind: "leatherArmor", carrierId: target.id, slot: "body", x: 0, y: 0, cooldownRemaining: 0 },
    ];
    const reductions = [{ group: "ward", amount: 0.2 }] as const;
    const context = { armorAlreadyApplied: true };
    expect(resolveUnitDamage({ items }, target, 14, P.RANGED_PIERCE, reductions, context).damage).toBeCloseTo(14 * 0.92 * 0.8);
    expect(resolveUnitDamage({ items }, target, 14, P.RANGED_PIERCE, reductions).damage).toBeCloseTo(7 * 0.92 * 0.8);
    target.effects = [{ type: "guardian", remaining: 10 }];
    expect(resolveUnitDamage({ items }, target, 14, P.RANGED_PIERCE, reductions, context).blocked).toBe(true);
  });
});
