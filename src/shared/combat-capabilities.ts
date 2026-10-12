import { weaponRules } from "./equipment";
import { installedWeapons, SHIP_WEAPONS } from "./ship-equipment";
import { shipProfile } from "./ship-geometry";
import { SIM_TICKS_PER_SECOND } from "./time";
import type { Building, GameSnapshot, Unit } from "./types";
import { veteranWeaponRange } from "./veteran-stats";
/** Current working weapons, rather than a hull's catalog or purchase price.
 * Cooldown, aiming, firing arcs and projectiles remain execution concerns. */
export function combatCapability(
  snapshot: Pick<GameSnapshot, "items" | "variants">,
  unit: Unit | Building,
) {
  if (!("order" in unit))
    return {
      armed: unit.attackDamage > 0,
      range: unit.attackRange,
      dps:
        (unit.attackDamage * SIM_TICKS_PER_SECOND) /
        Math.max(1, unit.attackCooldown),
    };
  const rules = weaponRules(snapshot, unit);
  // Land stats already include upgrades and training; equipment still supplies
  // the weapon cooldown. Avoid building a one-weapon list for every army query.
  if (!shipProfile(unit))
    return {
      armed: unit.attackDamage > 0,
      range: Math.max(0, unit.attackRange),
      dps: 0 + (unit.attackDamage * SIM_TICKS_PER_SECOND) / Math.max(1, rules.attackCooldown),
    };
  // Saves without a fittings record retain their saved weapon stats until
  // the common restore path materializes the equipment. An empty record is
  // explicitly unarmed and must never fall back to the hull catalog.
  const intrinsic = {
    damage: shipProfile(unit) ? rules.attackDamage : unit.attackDamage,
    range: shipProfile(unit) ? veteranWeaponRange(unit, rules.attackRange) : unit.attackRange,
    cooldown: rules.attackCooldown,
  };
  const weapons =
    shipProfile(unit) && unit.fittings
      ? installedWeapons(snapshot, unit)
          .filter((item) => (item.durability ?? 1) > 0)
          .map((item) => {
            const def = SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
            return {
              damage: def.damage,
              range: veteranWeaponRange(unit, def.range),
              cooldown: def.cooldown,
            };
          })
      : [intrinsic];
  if (shipProfile(unit) && unit.fittings && rules.intrinsicAttack) weapons.push(intrinsic);
  return {
    armed: weapons.some((weapon) => weapon.damage > 0),
    range: Math.max(0, ...weapons.map((weapon) => weapon.range)),
    dps: weapons.reduce(
      (sum, weapon) =>
        sum +
        (weapon.damage * SIM_TICKS_PER_SECOND) / Math.max(1, weapon.cooldown),
      0,
    ),
  };
}
