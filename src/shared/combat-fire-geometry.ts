import { strikeGap } from './combat-geometry';
import { weaponRules } from './equipment';
import { canReach } from './naval';
import { isInCabin } from './ship-cabin';
import { installedWeapons, mountedFireLaneClear, mountedTargetPoint, mountedWeaponPose, SHIP_WEAPONS, shipGunCanAim } from './ship-equipment';
import { shipProfile, shipsIn } from './ship-geometry';
import { areEnemyOwners } from './sim/command-validation';
import type { Building, GameSnapshot, ShipEquipmentKind, Unit } from './types';
import { veteranWeaponRange } from './veteran-stats';

export type WorkingWeaponGeometry = {
  kind: ShipEquipmentKind | 'intrinsic';
  itemId?: string;
  gap: number;
  minimumGap: number;
  range: number;
  minimum: number;
  belowMinimum: boolean;
  withinRange: boolean;
  withinArc: boolean;
  clearLane: boolean;
  covers: boolean;
};

/** Working weapons at this actual pose. A cooldown or unfinished reticle does
 * not remove a weapon; this describes geometry, not a shot or future damage.
 * Mounted guns use the same pivot, predicted point, arc and allied-hull lane
 * queries as native firing. Intrinsic weapons also require current range and
 * native terrain/deck reach, rather than reachability from a future shore.
 * Native intrinsic minRange uses center distance, while its maximum range
 * uses the strike point. Mounted guns use pivot-to-point for both bounds. */
export function workingWeaponGeometry(snapshot: GameSnapshot, attacker: Unit, target: Unit | Building): WorkingWeaponGeometry[] {
  if (attacker.hp <= 0 || isInCabin(attacker) || 'order' in target && isInCabin(target)) return [];
  const rules = weaponRules(snapshot, attacker), ship = shipProfile(attacker);
  const blockers = ship ? shipsIn(snapshot.units).filter(other => other.id !== attacker.id && other.hp > 0
    && !areEnemyOwners(snapshot, attacker.owner, other.owner)) : [];
  const weapons: WorkingWeaponGeometry[] = ship ? installedWeapons(snapshot, attacker)
    .filter(item => (item.durability ?? 1) > 0)
    .map(item => {
      const definition = SHIP_WEAPONS[item.kind as ShipEquipmentKind], pose = mountedWeaponPose(attacker, item)!;
      const point = mountedTargetPoint(snapshot, attacker, item, target, pose);
      const gap = Math.hypot(pose.pivot.x - point.x, pose.pivot.y - point.y);
      const range = veteranWeaponRange(attacker, definition.range), minimum = definition.weapon.minRange ?? 0;
      const minimumGap = gap, belowMinimum = minimumGap < minimum;
      const withinRange = !belowMinimum && gap <= range, withinArc = shipGunCanAim(attacker, item, point);
      const clearLane = !blockers.length || mountedFireLaneClear(attacker, item, point, blockers);
      return { kind: item.kind as ShipEquipmentKind, itemId: item.id, gap, minimumGap, range, minimum, belowMinimum, withinRange, withinArc, clearLane,
        covers: withinRange && withinArc && clearLane };
    }) : [];
  if ((!ship || rules.intrinsicAttack) && attacker.attackDamage > 0) {
    const gap = strikeGap(attacker, target), range = attacker.attackRange, minimum = rules.weapon?.minRange ?? 0;
    const minimumGap = Math.hypot(attacker.x - target.x, attacker.y - target.y), belowMinimum = minimumGap < minimum;
    const withinRange = !belowMinimum && gap <= range, clearLane = canReach(snapshot.map, attacker, target, snapshot.units, range);
    weapons.push({ kind: 'intrinsic', gap, minimumGap, range, minimum, belowMinimum, withinRange, withinArc: true, clearLane, covers: withinRange && clearLane });
  }
  return weapons;
}
