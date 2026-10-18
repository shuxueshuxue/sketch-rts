import { ABILITY_DEFS } from "../shared/catalog";
import { FLAME_CLOAK, LIGHTNING_ROD, STORM_STAFF } from "../shared/item-rules";
import { SHIP_WEAPONS } from "../shared/ship-equipment";
import type { AbilityKind, ItemKind } from "../shared/types";
import { VETERAN_SKILLS, type VeteranSkillId } from "../shared/veteran-skills";
import { formatRemaining } from "./format-remaining";

// @@@cooldown-sweep - A cooldown on a button (docs/art/progress-display.zh.md §1, §4): a dark wedge from twelve o'clock
// that shrinks clockwise as the cooldown runs out, with the time left in its middle. The wedge needs the whole length of
// the cooldown, not only what is left of it.

/** How long an ability's cooldown is when it starts: its catalog cooldown, or a veteran skill's. */
export function abilityCooldownLength(ability: AbilityKind): number | undefined {
  const def = (ABILITY_DEFS as Partial<Record<string, { cooldown?: number }>>)[ability];
  if (def?.cooldown) return def.cooldown;
  const effect = VETERAN_SKILLS[ability as VeteranSkillId]?.effect;
  return effect && "cooldown" in effect ? effect.cooldown : undefined;
}

/** How long an item's recharge is when it starts (see the item rules and ship weapons). */
export function itemCooldownLength(kind: ItemKind): number | undefined {
  if (kind === "lightningRod") return LIGHTNING_ROD.cooldown;
  if (kind === "stormStaff") return STORM_STAFF.cooldown;
  if (kind === "flameCloak") return FLAME_CLOAK.interval;
  return (SHIP_WEAPONS as Partial<Record<string, { cooldown: number }>>)[kind]?.cooldown;
}

/** The share of the cooldown still to run, 0 to 1. Without a known length the wedge is whole until the time is up. */
export function cooldownLeft(remaining: number, length: number | undefined): number {
  if (!(remaining > 0)) return 0;
  return length && length > 0 ? Math.min(1, remaining / length) : 1;
}

/** Puts a cooldown on a button: the wedge's share and the time left, or takes them off when it is over. */
export function applyCooldownSweep(element: HTMLElement, remaining: number | undefined, length: number | undefined) {
  if (remaining === undefined || !(remaining > 0)) {
    element.style.removeProperty("--cooldown-left");
    delete element.dataset.cooldownLabel;
    return;
  }
  element.style.setProperty("--cooldown-left", cooldownLeft(remaining, length).toFixed(3));
  element.dataset.cooldownLabel = formatRemaining(remaining);
}
