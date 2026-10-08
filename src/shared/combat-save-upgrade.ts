import { attackDamageProfile, weaponDamageProfile } from "./damage-types";
import type { GameSnapshot } from "./types";

/**
 * One-time migration for pre-profile saves. The loader selects the old checksum
 * version before calling this; new matches never use a parallel combat runtime.
 * Ordinary old shots already settled heavy armor when fired; old siege shots
 * did not. Their remaining flight preserves that distinction for one impact.
 *
 * Returns a new snapshot and new projectile records without mutating the input.
 * Unrelated snapshot arrays retain their references; the loader owns deep-copying
 * the complete restored state as usual.
 */
export function upgradeSavedCombat(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    projectiles: snapshot.projectiles.map(projectile => {
      if (projectile.damageProfile) return { ...projectile, damageProfile: { ...projectile.damageProfile } };
      if (projectile.weapon) return { ...projectile, damageProfile: { ...weaponDamageProfile(projectile.weapon) } };
      return {
        ...projectile,
        damageProfile: { ...attackDamageProfile(projectile.sourceKind ?? "defenseTower") },
        armorAlreadyApplied: true,
      };
    }),
  };
}
