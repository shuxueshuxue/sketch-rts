import type { CommandRefusal } from "../shared/command-refusal";
import { abilityCooldown } from "../shared/ability-cooldowns";
import { autocastEnabled, canAutocast } from "../shared/autocast";
import { unitAbilities } from "../shared/unit-abilities";
import { canTakeStance } from "../shared/push";
import type { AbilityKind, MeleeStance, Unit } from "../shared/types";
import type { CommandLegalityError, CommandRefusalReason } from "../shared/sim/command-validation";
import { readyAbilityCasters, type CastCommand } from "./ability-targeting";
import { isInCabin } from '../shared/ship-cabin';
import { abilityCooldownLength } from "./cooldown-sweep";

export type CommandButtonDisabledReason = CommandRefusalReason | "missing";

// An ability's autocast switch across the selected units that have it: all on, all off, or some of each.
export type AutocastSwitch = "on" | "off" | "mixed";

export type CommandButtonState = {
  visible: boolean;
  enabled: boolean;
  cooldownTicks?: number;
  // The whole cooldown the ticks above are part of, for its sweep (see @@@cooldown-sweep).
  cooldownLength?: number;
  reason?: CommandButtonDisabledReason;
  detail?:string;
  refusal?: CommandRefusal;
  // The supply cap a locked unit waits for (reason "tier").
  supplyCap?: number;
  // A spell the player can switch to autocast (right-click on its button), and how it stands.
  autocast?: AutocastSwitch;
  // A mode button (a melee stance) that all the selected units it applies to are in, or only some.
  pressed?: "all" | "some";
  // How many a seller has left of a good, shown in the button's corner.
  stock?: number;
};

export const HIDDEN_COMMAND_STATE: CommandButtonState = { visible: false, enabled: false };
export const ENABLED_COMMAND_STATE: CommandButtonState = { visible: true, enabled: true };

export function booleanCommandState(enabled: boolean): CommandButtonState {
  return enabled ? ENABLED_COMMAND_STATE : HIDDEN_COMMAND_STATE;
}

// Focus controls which buttons appear; availability, cooldown and autocast read every applicable selected unit.
export function abilityCommandState(units: readonly Unit[], ability: AbilityKind, selected: readonly Unit[] = units, pending: readonly CastCommand[] = []): CommandButtonState {
  if (!units.some(unit => !isInCabin(unit) && unitAbilities(unit).includes(ability))) return HIDDEN_COMMAND_STATE;
  const casters = selected.filter((unit) => !isInCabin(unit) && unitAbilities(unit).includes(ability));
  const autocast = autocastSwitch(selected, ability);
  const withAutocast = (state: CommandButtonState): CommandButtonState => (autocast ? { ...state, autocast } : state);
  if (readyAbilityCasters(casters, ability, pending).length) return withAutocast(ENABLED_COMMAND_STATE);
  if (casters.some(unit => abilityCooldown(unit, ability) <= 0)) return withAutocast({ visible: true, enabled: false, reason: "missing" });
  const cooldownTicks = Math.min(...casters.map((unit) => abilityCooldown(unit, ability)));
  const cooldownLength = abilityCooldownLength(ability);
  return withAutocast({ visible: true, enabled: false, cooldownTicks, ...(cooldownLength ? { cooldownLength } : {}), reason: "cooldown" });
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
  return canAutocast(ability) ? units.filter((unit) => !isInCabin(unit) && unitAbilities(unit).includes(ability)) : [];
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
  return units.filter((unit) => !isInCabin(unit) && canTakeStance(unit));
}

// An order the card offers (train, research, hire, buy), greyed exactly when the sim would refuse it, for the reason the
// sim gives (see @@@command-refusal). A unit whose tier is still locked stays on the card with the supply cap it waits for.
export function legalityCommandState(refusal: CommandLegalityError | undefined): CommandButtonState {
  if (!refusal) return ENABLED_COMMAND_STATE;
  return {
    visible: true, enabled: false, reason: refusal.reason,
    ...(refusal.refusal ? { refusal: refusal.refusal } : {}),
    ...(refusal.cooldownTicks !== undefined ? { cooldownTicks: refusal.cooldownTicks } : {}),
    ...(refusal.cooldownLength !== undefined ? { cooldownLength: refusal.cooldownLength } : {}),
    ...(refusal.supplyCap !== undefined ? { supplyCap: refusal.supplyCap } : {}),
  };
}
