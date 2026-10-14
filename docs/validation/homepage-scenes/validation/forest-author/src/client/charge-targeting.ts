import { abilityCooldown } from "../shared/ability-cooldowns";
import { ABILITY_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { AbilityKind, Unit } from "../shared/types";

type Point = { x: number; y: number };

export type ChargeWindow = { minRange: number; range: number };

// The distances a charge can be started from (a farther target is ridden up to first, a nearer one refused), or undefined
// for any other ability.
export function chargeWindow(ability: AbilityKind): ChargeWindow | undefined {
  const def = ABILITY_DEFS[ability];
  return def.behavior === "charge" ? { minRange: def.minRange, range: def.range } : undefined;
}

// The selected riders ready to charge: those that have the ability and whose charge has cooled down.
export function readyChargers(units: readonly Unit[], ability: AbilityKind) {
  return units.filter((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability) && abilityCooldown(unit, ability) <= 0);
}

// @@@charge-rider - Who charges a clicked target: the rider the player armed the charge with, unless the target is
// nearer it than the shortest charge; otherwise the ready rider nearest the target among those it is not too near. A rider
// the target lies beyond rides up into its window first (see @@@cast-order). None, and the target is too near every rider.
export function chargeRiderFor(riders: readonly Unit[], target: Point, window: ChargeWindow, preferredId?: string) {
  const able = riders.filter((rider) => Math.hypot(target.x - rider.x, target.y - rider.y) >= window.minRange);
  const preferred = able.find((rider) => rider.id === preferredId);
  if (preferred) return preferred;
  let best: Unit | undefined;
  for (const rider of able) {
    if (!best || Math.hypot(rider.x - target.x, rider.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y)) best = rider;
  }
  return best;
}
