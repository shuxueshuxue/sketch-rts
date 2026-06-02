import type { Unit } from "../../shared/types";

export function armyPower(units: Unit[]) {
  return units.reduce((total, unit) => total + Math.max(1, unit.hp / Math.max(1, unit.maxHp)) * (1 + unit.attackDamage / 18 + unit.attackRange / 260), 0);
}
