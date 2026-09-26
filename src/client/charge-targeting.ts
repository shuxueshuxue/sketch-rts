import { abilityCooldown } from "../shared/ability-cooldowns";
import { ABILITY_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { AbilityKind, Unit } from "../shared/types";

type Point = { x: number; y: number };

export type ChargeWindow = { minRange: number; range: number };

// The distances a charge can be started from (the engine refuses a target outside them), or undefined for any other ability.
export function chargeWindow(ability: AbilityKind): ChargeWindow | undefined {
  const def = ABILITY_DEFS[ability];
  return def.behavior === "charge" ? { minRange: def.minRange, range: def.range } : undefined;
}

export function inChargeWindow(rider: Point, target: Point, window: ChargeWindow) {
  const gap = Math.hypot(target.x - rider.x, target.y - rider.y);
  return gap >= window.minRange && gap <= window.range;
}

// The selected riders ready to charge: those that have the ability and whose charge has cooled down.
export function readyChargers(units: readonly Unit[], ability: AbilityKind) {
  return units.filter((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability) && abilityCooldown(unit, ability) <= 0);
}

// @@@charge-rider - Who charges a clicked target: the rider the player armed the charge with, if the target lies in its
// window; otherwise the ready rider nearest the target among those whose window holds it. None, and the target is out of reach.
export function chargeRiderFor(riders: readonly Unit[], target: Point, window: ChargeWindow, preferredId?: string) {
  const inReach = riders.filter((rider) => inChargeWindow(rider, target, window));
  const preferred = inReach.find((rider) => rider.id === preferredId);
  if (preferred) return preferred;
  let best: Unit | undefined;
  for (const rider of inReach) {
    if (!best || Math.hypot(rider.x - target.x, rider.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y)) best = rider;
  }
  return best;
}
