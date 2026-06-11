import { XP_STAR_THRESHOLDS } from "../../shared/catalog";
import type { Unit } from "../../shared/types";
import type { PresetAiPolicyOptions } from "./types";
import { isV5HybridPolicy } from "./versions";

export function veteranRecoveryHpRatio(unit: Unit, options: PresetAiPolicyOptions) {
  if (unit.level >= 2) return 0.55;
  if (!isNearStarCoreUnit(unit, options)) return 0;
  return 0.5;
}

function isNearStarCoreUnit(unit: Unit, options: PresetAiPolicyOptions) {
  const nextStar = XP_STAR_THRESHOLDS.find((threshold) => unit.xp < threshold);
  // @@@near-star-core - V5 needs accumulated veteran cores in 1v2; a unit one kill from a star is not routine detachment supply.
  return isV5HybridPolicy(options) && nextStar !== undefined && nextStar - unit.xp <= 16 && unit.xp >= 45;
}
