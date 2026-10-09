import { activeItem, equipmentProtection, weaponRules } from "./equipment";
import { HEAVY_ARMOR_DAMAGE, resolveDamage, type DamageReductionGroup, type DamageReductionSource } from "./damage-reduction";
import { attackDamageProfile, type DamageFilter, type DamageProfile } from "./damage-types";
import { unitRules } from "./catalog";
import { SHOCK_DAMAGE_TAKEN } from "./push";
import type { GameSnapshot, Unit } from "./types";
import { isTransportKind, TRANSPORT_COMBAT } from './transport-role';

export { resolveDamage, reductionForGroup, DAMAGE_REDUCTION_RULES, HEAVY_ARMOR_DAMAGE } from "./damage-reduction";
export type { DamageReductionGroup, DamageReductionSource, DamageResolution } from "./damage-reduction";

/** Additional incoming protection fields shared by status effects and skills. */
export type ProtectionEffect = {
  type: string;
  remaining: number;
  damageReduction?: number;
  protectionGroup?: DamageReductionGroup;
  damageFilter?: DamageFilter;
};

export type DamageResolutionContext = {
  /** Only old ordinary projectiles have already settled armor before being saved. */
  armorAlreadyApplied?: boolean;
};

/** Armor joins the common hit-time pipeline exactly once, never at launch. */
export function armorDamageProtection(armor: "heavy" | undefined): DamageReductionSource[] {
  return armor === "heavy" ? [
    { group: "armor", amount: 1 - HEAVY_ARMOR_DAMAGE.rangedUnit, filter: { delivery: "ranged", origin: "unit" } },
    { group: "armor", amount: 1 - HEAVY_ARMOR_DAMAGE.tower, filter: { delivery: "ranged", origin: "tower" } },
  ] : [];
}

/** Hull ranged protection and authored heavy armor share one strongest-value
 * group. A campaign armor upgrade remains effective without multiplying both. */
export function rangedDamageProtection(damageTaken: number | undefined): DamageReductionSource[] {
  return damageTaken === undefined ? [] : [{ group: 'armor', amount: 1 - damageTaken, filter: { delivery: 'ranged', origin: ['unit', 'tower'] } }];
}

/** Actual wielded gear determines damage type even when another troop carries it. */
export function unitAttackDamageProfile(snapshot: GameSnapshot, unit: Unit): DamageProfile {
  return attackDamageProfile(unit.kind, weaponRules(snapshot, unit).weapon, activeItem(snapshot, unit, "right"));
}

/** Expired effects do not protect; separate ward casters share one strongest-value group. */
export function statusDamageProtection(effects: readonly ProtectionEffect[]): {
  invulnerable: boolean;
  reductions: DamageReductionSource[];
} {
  let invulnerable = false;
  const reductions: DamageReductionSource[] = [];
  for (const effect of effects) {
    if (effect.remaining <= 0) continue;
    if (effect.type === "guardian") invulnerable = true;
    if (effect.damageReduction !== undefined) reductions.push({
      group: effect.protectionGroup ?? "ward",
      amount: effect.damageReduction,
      ...(effect.damageFilter ? { filter: effect.damageFilter } : {}),
    });
  }
  return { invulnerable, reductions };
}

/** Common protection for weapon, spell, damage-over-time and scripted hits. */
export function resolveUnitDamage(snapshot: Pick<GameSnapshot, "items" | "variants">, target: Unit, damage: number, profile: DamageProfile, extraSources: readonly DamageReductionSource[] = [], context: DamageResolutionContext = {}) {
  const status = statusDamageProtection(target.effects);
  const rules = unitRules(snapshot, target);
  return resolveDamage(damage, {
    profile,
    reductions: [
      ...(context.armorAlreadyApplied ? [] : [...armorDamageProtection(rules.armor), ...rangedDamageProtection(rules.rangedDamageTaken ?? (isTransportKind(target.kind) ? TRANSPORT_COMBAT.rangedDamageTaken : undefined))]),
      { group: "equipment", amount: equipmentProtection(snapshot, target), filter: { school: "physical" } },
      ...status.reductions,
      ...extraSources,
    ],
    invulnerable: Boolean(target.invulnerable || status.invulnerable),
    damageTakenMultiplier: target.stance === "shock" ? SHOCK_DAMAGE_TAKEN : 1,
    round: target.stance === "shock",
  });
}
