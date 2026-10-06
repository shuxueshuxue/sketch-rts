import type { Building, Unit } from "./types";

export type CombatTarget = Unit | Building;
export type TargetThreat = "none" | "ally" | "self";

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
