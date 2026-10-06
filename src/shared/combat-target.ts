import type { Building, Unit, Owner } from "./types";
import {shipProfile} from './ship-geometry';

export type CombatTarget = Unit | Building;
export type TargetThreat = "none" | "ally" | "self";
/** Boarding an empty hull is an intentional claim. Automatic guards should not
 * destroy it under friendly boarders; an explicit player attack still prevails. */
export function automaticTargetAllowed(units:readonly Unit[],owner:Owner,target:CombatTarget){
  if(!('order' in target)||!shipProfile(target))return true;
  if(units.some(unit=>unit.hp>0&&unit.deck?.shipId===target.id))return true;
  return !units.some(unit=>unit.hp>0&&unit.owner===owner&&unit.deck&&unit.order.type==='board'&&unit.order.transportId===target.id);
}

// Mechanical target choice shared by automatic combat, neutrals and AI. Ownership, reachability, orders and
// strategic assignments belong to the caller; this function never changes an order or knows an AI version.
export function combatTargetScore(target: CombatTarget, gap: number, threat: TargetThreat = "none", remainingHp = target.hp): number {
  if (remainingHp <= 0) return -Infinity;
  const unit = "order" in target;
  const value = unit ? (target.kind === "worker" ? 260 : 430) : target.attackDamage > 0 ? 360 : target.kind === "townHall" ? 120 : 220;
  const vulnerable = unit ? Math.min(120, Math.max(0, target.maxHp - remainingHp) * 1.4) : 0;
  const weapon = target.attackDamage * 2 + (unit && target.attackRange > 100 ? 20 : 0);
  return value + vulnerable + weapon + (threat === "self" ? 150 : threat === "ally" ? 90 : 0) - gap * .9;
}

// A materially better target can interrupt a fight. Small changes in distance or alternating hits cannot.
export function shouldSwitchCombatTarget(currentScore: number, nextScore: number): boolean {
  return nextScore > currentScore + 60;
}

export function combatVictimId(target: CombatTarget): string | undefined {
  if (!("order" in target)) return undefined;
  const order = target.order;
  return order.type === "attack" || order.type === "attackMove" || order.type === "cast" || order.type === "charge" ? order.targetId : undefined;
}
