import { UNIT_DEFS, requiredSupplyCap } from "../shared/catalog";
import type { AbilityKind, MercenaryCamp, PlayerState, TrainableUnitKind, Unit } from "../shared/types";

export type CommandButtonDisabledReason = "cooldown" | "stock" | "gold" | "supply" | "position" | "missing" | "tier";

export type CommandButtonState = {
  visible: boolean;
  enabled: boolean;
  cooldownTicks?: number;
  reason?: CommandButtonDisabledReason;
  // The supply cap a locked unit waits for (reason "tier").
  supplyCap?: number;
};

export const HIDDEN_COMMAND_STATE: CommandButtonState = { visible: false, enabled: false };
export const ENABLED_COMMAND_STATE: CommandButtonState = { visible: true, enabled: true };

export function booleanCommandState(enabled: boolean): CommandButtonState {
  return enabled ? ENABLED_COMMAND_STATE : HIDDEN_COMMAND_STATE;
}

export function abilityCommandState(units: readonly Unit[], ability: AbilityKind): CommandButtonState {
  const casters = units.filter((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability));
  if (casters.length === 0) return HIDDEN_COMMAND_STATE;
  const ready = casters.find((unit) => unit.cooldown <= 0);
  if (ready) return ENABLED_COMMAND_STATE;
  const cooldownTicks = Math.min(...casters.map((unit) => unit.cooldown));
  return { visible: true, enabled: false, cooldownTicks, reason: "cooldown" };
}

// A unit the player could train but whose tier is still locked stays on the card, greyed, with the supply cap it waits for.
export function trainCommandState(unitKind: TrainableUnitKind, player: PlayerState | undefined, trainable: boolean): CommandButtonState {
  if (!trainable) return HIDDEN_COMMAND_STATE;
  const supplyCap = requiredSupplyCap(unitKind);
  if (player && player.supplyCap < supplyCap) return { visible: true, enabled: false, reason: "tier", supplyCap };
  return ENABLED_COMMAND_STATE;
}

export function mercenaryHireCommandState(input: {
  camp: MercenaryCamp | undefined;
  player: PlayerState | undefined;
  hasFriendlyUnitAtCamp: boolean;
}): CommandButtonState {
  const { camp, player, hasFriendlyUnitAtCamp } = input;
  if (!camp) return HIDDEN_COMMAND_STATE;
  if (!player) return { visible: true, enabled: false, reason: "missing" };
  if (camp.stock <= 0) return { visible: true, enabled: false, reason: "stock" };
  if (camp.cooldownRemaining > 0) return { visible: true, enabled: false, cooldownTicks: camp.cooldownRemaining, reason: "cooldown" };
  if (player.gold < camp.cost) return { visible: true, enabled: false, reason: "gold" };
  if (player.supplyUsed + UNIT_DEFS[camp.hireKind].supplyUsed > player.supplyCap) return { visible: true, enabled: false, reason: "supply" };
  if (!hasFriendlyUnitAtCamp) return { visible: true, enabled: false, reason: "position" };
  return ENABLED_COMMAND_STATE;
}
