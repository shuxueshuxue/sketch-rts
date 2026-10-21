import { resolveUnitDamage, unitAttackDamageProfile } from '../../shared/damage';
import type { GameSnapshot, Unit } from '../../shared/types';

/** The existing land counter gate: range advantage or enough movement speed.
 * This is capability, not a claim that the target has already been defeated. */
export function canLandIntercept(unit: Unit, target: Unit): boolean {
  return unit.attackRange > target.attackRange || unit.speed >= target.speed;
}

export function landInterceptionShotDamage(snapshot: GameSnapshot, unit: Unit, target: Unit): number {
  return resolveUnitDamage(snapshot, target, unit.attackDamage, unitAttackDamageProfile(snapshot, unit)).damage;
}
