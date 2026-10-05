import type { UnitDef } from "./catalog";

export const VETERANCY_GAIN_PER_STAR = 1 / 3;
export const EXPERIENCE_BOOK_XP = 160;

// Purchased units use their replacement cost. Neutral creatures use food power and
// the same threat modifier that AI uses to assess their armor and special attacks.
export function unitValue(def: Pick<UnitDef, "cost" | "creepFoodPower" | "threat">) {
  return def.cost > 0 ? def.cost : (def.creepFoodPower ?? 2) * 36 * (def.threat ?? 1);
}

export function xpStarThresholds(def: Pick<UnitDef, "cost" | "creepFoodPower" | "threat">) {
  const value = unitValue(def);
  return [0.6, 1.3, 2.6].map(share => Math.max(1, Math.round(value * share)));
}

export function killXpReward(def: UnitDef, level: number) {
  return Math.round(def.xpReward * (1 + Math.min(3, Math.max(0, level)) * VETERANCY_GAIN_PER_STAR));
}

export function creepGoldBounty(foodPower: number, threat = 1) {
  return Math.max(20, Math.round((20 * foodPower + 1.25 * foodPower ** 2) * threat / 5) * 5);
}
