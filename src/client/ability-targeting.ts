import { abilityCooldown } from "../shared/ability-cooldowns";
import { ABILITY_DEFS, UNIT_DEFS } from "../shared/catalog";
import { checkCommandLegality } from "../shared/sim/command-validation";
import type { AbilityKind, GameCommand, GameSnapshot, PlayerId, Unit } from "../shared/types";
import { chargeRiderFor, chargeWindow } from "./charge-targeting";

export type CastCommand = Extract<GameCommand, { type: "cast" }>;
type SpellTarget = { targetId: string } | { x: number; y: number };

// A cast walking to its target, queued on shift, or awaiting its network frame already owns this caster's next spell.
export function readyAbilityCasters(units: readonly Unit[], ability: AbilityKind, pending: readonly CastCommand[] = []) {
  return units.filter(unit => UNIT_DEFS[unit.kind].abilities.includes(ability)
    && abilityCooldown(unit, ability) <= 0
    && !(unit.order.type === "cast" && unit.order.ability === ability)
    && !unit.orderQueue?.some(order => order.type === "cast" && order.ability === ability)
    && !pending.some(command => command.unitId === unit.id && command.ability === ability));
}

// One click casts once. Re-evaluate the whole selection at the target click, including cooldown and target changes.
export function castCommandForSelection(snapshot: GameSnapshot, owner: PlayerId, units: readonly Unit[], ability: AbilityKind,
  target: SpellTarget, preferredId?: string, queued = false, pending: readonly CastCommand[] = []): CastCommand | undefined {
  const at = "targetId" in target
    ? [...snapshot.units, ...snapshot.buildings, ...(snapshot.obstacles ?? [])].find(entity => entity.id === target.targetId)
    : target;
  if (!at) return undefined;
  const commandFor = (unit: Unit): CastCommand => ({ type: "cast", unitId: unit.id, ability, ...target, queued });
  const ready = readyAbilityCasters(units, ability, pending)
    .filter(unit => !checkCommandLegality(snapshot, owner, commandFor(unit)));
  const window = chargeWindow(ability);
  if (window) {
    const rider = chargeRiderFor(ready, at, window, preferredId);
    return rider ? commandFor(rider) : undefined;
  }
  const def = ABILITY_DEFS[ability];
  const gap = (unit: Unit) => Math.hypot(unit.x - at.x, unit.y - at.y)
    - (def.behavior === "weapon" && "radius" in at && typeof at.radius === "number" && !("order" in at) ? at.radius : 0);
  const inRange = ready.filter(unit => gap(unit) <= def.range);
  const preferred = inRange.find(unit => unit.id === preferredId);
  const caster = preferred ?? (inRange.length ? inRange : ready)
    .reduce<Unit | undefined>((best, unit) => !best || gap(unit) < gap(best) ? unit : best, undefined);
  return caster ? commandFor(caster) : undefined;
}
