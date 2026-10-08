import { matchesDamageProfile, type DamageFilter, type DamageProfile } from "./damage-types";

/** Heavy bodies keep their ranged attack matchup; active spells bypass it. */
export const HEAVY_ARMOR_DAMAGE = { rangedUnit: 0.5, tower: 0.7 } as const;

/** Sources in one group share a stacking rule; different groups multiply. */
export const DAMAGE_REDUCTION_RULES = {
  armor: { stacking: "highest", cap: 1 },
  equipment: { stacking: "add", cap: 0.3 },
  passive: { stacking: "highest", cap: 1 },
  aura: { stacking: "highest", cap: 1 },
  ward: { stacking: "highest", cap: 1 },
} as const;

export type DamageReductionGroup = keyof typeof DAMAGE_REDUCTION_RULES;
export type DamageReductionSource = {
  group: DamageReductionGroup;
  /** A fraction of incoming damage prevented: 0.2 means 20%. */
  amount: number;
  /** Absent means protection against every damage school and delivery. */
  filter?: DamageFilter;
};

export type DamageResolution = {
  damage: number;
  /** A blocked hit cannot apply on-hit statuses or hull collateral. */
  blocked: boolean;
  multiplier: number;
};

const GROUPS = Object.keys(DAMAGE_REDUCTION_RULES) as DamageReductionGroup[];

function fraction(amount: number): number {
  return Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
}

export function reductionForGroup(group: DamageReductionGroup, amounts: readonly number[]): number {
  const rule = DAMAGE_REDUCTION_RULES[group];
  const combined = amounts.reduce((total, amount) => stackReduction(group, total, amount), 0);
  return Math.min(rule.cap, combined);
}

function stackReduction(group: DamageReductionGroup, total: number, amount: number): number {
  return DAMAGE_REDUCTION_RULES[group].stacking === "add"
    ? total + fraction(amount)
    : Math.max(total, fraction(amount));
}

/**
 * Armor, equipment, personal passives, auras and temporary wards are independent layers. Examples:
 * 50% armor + 20% equipment + 8% aura + 20% ward leaves 29.44% damage.
 * Multiple wards only use the strongest ward, as do multiple protection auras.
 * Rounding is explicit because existing armor and shock stance round at their
 * own boundaries, while equipment and ordinary protection keep fractional HP.
 */
export function resolveDamage(damage: number, options: {
  profile?: DamageProfile;
  reductions?: readonly DamageReductionSource[];
  invulnerable?: boolean;
  damageTakenMultiplier?: number;
  round?: boolean;
} = {}): DamageResolution {
  if (options.invulnerable) return { damage: 0, blocked: true, multiplier: 0 };
  const sources = options.reductions ?? [];
  let vulnerability = options.damageTakenMultiplier ?? 1;
  if (!Number.isFinite(vulnerability)) vulnerability = 1;
  vulnerability = Math.max(0, vulnerability);
  let multiplier = vulnerability;
  let taken = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  const combined: Record<DamageReductionGroup, number> = { armor: 0, equipment: 0, passive: 0, aura: 0, ward: 0 };
  for (const source of sources) if (matchesDamageProfile(options.profile, source.filter)) {
    combined[source.group] = stackReduction(source.group, combined[source.group], source.amount);
  }
  // Every call applies the protection layers in the same order.
  for (const group of GROUPS) {
    const reduction = Math.min(DAMAGE_REDUCTION_RULES[group].cap, combined[group]);
    multiplier *= 1 - reduction;
    taken *= 1 - reduction;
    if (group === "armor" && reduction > 0 && taken > 0) taken = Math.max(1, Math.round(taken));
  }
  if (multiplier === 0) return { damage: 0, blocked: true, multiplier: 0 };
  taken *= vulnerability;
  return {
    damage: options.round && taken > 0 ? Math.max(1, Math.round(taken)) : taken,
    blocked: false,
    multiplier,
  };
}
