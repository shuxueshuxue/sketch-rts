import type { Unit } from "../../shared/types";

export function armyPower(units: Unit[]) {
  return units.reduce((total, unit) => total + Math.max(1, unit.hp / Math.max(1, unit.maxHp)) * (1 + unit.attackDamage / 18 + rangePowerBonus(unit.attackRange)), 0);
}

function rangePowerBonus(attackRange: number) {
  // @@@range-power-cap - Long range creates tactical uptime, but strategic power checks must not count 600 range as several extra bodies.
  return Math.min(attackRange, 260) / 520;
}
