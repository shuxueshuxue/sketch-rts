import { abilityCooldown } from "../shared/ability-cooldowns";
import { autocastEnabled, canAutocast } from "../shared/autocast";
import { UNIT_DEFS, requiredSupplyCap } from "../shared/catalog";
import type { AbilityKind, MercenaryCamp, PlayerState, TrainableUnitKind, Unit } from "../shared/types";

export type CommandButtonDisabledReason = "cooldown" | "stock" | "gold" | "supply" | "position" | "missing" | "tier";

// An ability's autocast switch across the selected units that have it: all on, all off, or some of each.
export type AutocastSwitch = "on" | "off" | "mixed";

export type CommandButtonState = {
  visible: boolean;
  enabled: boolean;
  cooldownTicks?: number;
  reason?: CommandButtonDisabledReason;
  // The supply cap a locked unit waits for (reason "tier").
  supplyCap?: number;
  // A spell the player can switch to autocast (right-click on its button), and how it stands.
  autocast?: AutocastSwitch;
};

export const HIDDEN_COMMAND_STATE: CommandButtonState = { visible: false, enabled: false };
export const ENABLED_COMMAND_STATE: CommandButtonState = { visible: true, enabled: true };

export function booleanCommandState(enabled: boolean): CommandButtonState {
  return enabled ? ENABLED_COMMAND_STATE : HIDDEN_COMMAND_STATE;
}

// `units` are the focused ones (the card shows their buttons); `selected` all the selected ones, whose switches the
// button's autocast state reports and a right-click flips (see autocastToggle).
export function abilityCommandState(units: readonly Unit[], ability: AbilityKind, selected: readonly Unit[] = units): CommandButtonState {
  const casters = units.filter((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability));
  if (casters.length === 0) return HIDDEN_COMMAND_STATE;
  const autocast = autocastSwitch(selected, ability);
  const withAutocast = (state: CommandButtonState): CommandButtonState => (autocast ? { ...state, autocast } : state);
  const ready = casters.find((unit) => abilityCooldown(unit, ability) <= 0);
  if (ready) return withAutocast(ENABLED_COMMAND_STATE);
  const cooldownTicks = Math.min(...casters.map((unit) => abilityCooldown(unit, ability)));
  return withAutocast({ visible: true, enabled: false, cooldownTicks, reason: "cooldown" });
}

// @@@autocast-toggle - Warcraft III's right-click on a spell button: if any selected unit with the ability has its
// autocast off, all of them switch on; only when every one is on do they all switch off.
export function autocastSwitch(units: readonly Unit[], ability: AbilityKind): AutocastSwitch | undefined {
  const casters = autocastCasters(units, ability);
  if (casters.length === 0) return undefined;
  const on = casters.filter((unit) => autocastEnabled(unit, ability)).length;
  return on === casters.length ? "on" : on === 0 ? "off" : "mixed";
}

export function autocastToggle(units: readonly Unit[], ability: AbilityKind): { unitIds: string[]; enabled: boolean } | undefined {
  const state = autocastSwitch(units, ability);
  if (!state) return undefined;
  return { unitIds: autocastCasters(units, ability).map((unit) => unit.id), enabled: state !== "on" };
}

function autocastCasters(units: readonly Unit[], ability: AbilityKind) {
  return canAutocast(ability) ? units.filter((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability)) : [];
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
