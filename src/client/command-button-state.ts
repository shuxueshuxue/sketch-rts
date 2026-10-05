import { abilityCooldown } from "../shared/ability-cooldowns";
import { autocastEnabled, canAutocast } from "../shared/autocast";
import { UNIT_DEFS, requiredSupplyCap } from "../shared/catalog";
import { canTakeStance } from "../shared/push";
import type { AbilityKind, MeleeStance, MercenaryCamp, PlayerState, TrainableUnitKind, Unit } from "../shared/types";
import { readyAbilityCasters, type CastCommand } from "./ability-targeting";

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
  // A mode button (a melee stance) that all the selected units it applies to are in, or only some.
  pressed?: "all" | "some";
};

export const HIDDEN_COMMAND_STATE: CommandButtonState = { visible: false, enabled: false };
export const ENABLED_COMMAND_STATE: CommandButtonState = { visible: true, enabled: true };

export function booleanCommandState(enabled: boolean): CommandButtonState {
  return enabled ? ENABLED_COMMAND_STATE : HIDDEN_COMMAND_STATE;
}

// Focus controls which buttons appear; availability, cooldown and autocast read every applicable selected unit.
export function abilityCommandState(units: readonly Unit[], ability: AbilityKind, selected: readonly Unit[] = units, pending: readonly CastCommand[] = []): CommandButtonState {
  if (!units.some(unit => UNIT_DEFS[unit.kind].abilities.includes(ability))) return HIDDEN_COMMAND_STATE;
  const casters = selected.filter((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability));
  const autocast = autocastSwitch(selected, ability);
  const withAutocast = (state: CommandButtonState): CommandButtonState => (autocast ? { ...state, autocast } : state);
  if (readyAbilityCasters(casters, ability, pending).length) return withAutocast(ENABLED_COMMAND_STATE);
  if (casters.some(unit => abilityCooldown(unit, ability) <= 0)) return withAutocast({ visible: true, enabled: false, reason: "missing" });
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

// @@@stance-buttons - The melee stances fold into one button on the card, shown whenever a focused unit can take a stance;
// it wears the autocast ring while the selected fighters are out of the default pursue (all of them, or some). Pressing it
// opens the three stances in place of the card, as the build button opens the buildings; the stance the selected fighters
// are in wears the ring, and choosing one sets it for every selected fighter and folds the card back.
export function stanceMenuCommandState(units: readonly Unit[], selected: readonly Unit[] = units): CommandButtonState {
  if (stanceFighters(units).length === 0) return HIDDEN_COMMAND_STATE;
  const fighters = stanceFighters(selected);
  const special = fighters.filter((unit) => unit.stance !== undefined).length;
  if (special === 0) return ENABLED_COMMAND_STATE;
  return { ...ENABLED_COMMAND_STATE, pressed: special === fighters.length ? "all" : "some" };
}

// The stance the selected fighters share, or undefined when they differ (or there are none).
export function sharedStance(selected: readonly Unit[]): MeleeStance | undefined {
  const stances = new Set(stanceFighters(selected).map((unit) => unit.stance ?? "pursue"));
  return stances.size === 1 ? [...stances][0] : undefined;
}

export function stanceCommandState(units: readonly Unit[], stance: MeleeStance, selected: readonly Unit[] = units): CommandButtonState {
  if (stanceFighters(units).length === 0) return HIDDEN_COMMAND_STATE;
  const fighters = stanceFighters(selected);
  const inStance = fighters.filter((unit) => (unit.stance ?? "pursue") === stance).length;
  if (inStance === 0) return ENABLED_COMMAND_STATE;
  return { ...ENABLED_COMMAND_STATE, pressed: inStance === fighters.length ? "all" : "some" };
}

export function stanceFighters(units: readonly Unit[]) {
  return units.filter((unit) => canTakeStance(unit.kind));
}

// A unit the player could train but whose tier is still locked stays on the card, greyed, with the supply cap it waits for.
export function trainCommandState(unitKind: TrainableUnitKind, player: PlayerState | undefined, trainable: boolean): CommandButtonState {
  if (!trainable) return HIDDEN_COMMAND_STATE;
  const supplyCap = requiredSupplyCap(unitKind);
  if (player && player.supplyCap < supplyCap) return { visible: true, enabled: false, reason: "tier", supplyCap };
  if (!player) return { visible: true, enabled: false, reason: "missing" };
  if (player.supplyUsed + UNIT_DEFS[unitKind].supplyUsed > player.supplyCap) return { visible: true, enabled: false, reason: "supply" };
  if (player.gold < UNIT_DEFS[unitKind].cost) return { visible: true, enabled: false, reason: "gold" };
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
