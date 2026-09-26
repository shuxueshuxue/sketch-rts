import type { AbilityKind } from "../../shared/types";
import type { AbilityCard } from "./cards";

// The command card's spell buttons, in catalog order (see ABILITY_KINDS). Two abilities one race's units carry never
// share a hotkey: a selection can show all of them at once.
export const ABILITY_CARDS: Record<AbilityKind, AbilityCard> = {
  heal: {
    name: { en: "Heal", zh: "治疗" },
    description: { en: "Restores health to an allied unit in range.", zh: "为射程内的友方单位恢复生命。" },
    command: { icon: "+", hotkey: "h" },
  },
  summon: {
    name: { en: "Summon", zh: "召唤" },
    description: { en: "Creates a spirit at a nearby ground point.", zh: "在附近地面目标点召唤一个灵体。" },
    command: { icon: "◎", hotkey: "u" },
  },
  curse: {
    name: { en: "Curse", zh: "诅咒" },
    description: {
      en: "Weakens an enemy unit so its attacks deal less damage. A summoned unit also takes 100 damage.",
      zh: "削弱敌方单位，使其攻击造成更少伤害。召唤物还会受到 100 点伤害。",
    },
    command: { icon: "☾", hotkey: "c" },
  },
  emberMend: {
    name: { en: "Ember Mend", zh: "余烬疗愈" },
    description: { en: "Quickly restores health to an allied unit at shorter range.", zh: "以较短射程快速治疗友方单位。" },
    command: { icon: "+", hotkey: "m" },
  },
  cinderSoul: {
    name: { en: "Cinder Soul", zh: "余火魂灵" },
    description: { en: "Creates a shorter-lived spirit at a nearby ground point.", zh: "在附近地面目标点召唤一个持续时间较短的灵体。" },
    command: { icon: "◎", hotkey: "o" },
  },
  ashCurse: {
    name: { en: "Ash Curse", zh: "灰烬诅咒" },
    description: { en: "Weakens an enemy unit, and burns scorched targets down to a harsher damage penalty.", zh: "削弱敌方单位；若目标已被灼烧，则进一步压低其伤害。" },
    command: { icon: "☾", hotkey: "x" },
  },
  charge: {
    name: { en: "Charge", zh: "冲锋" },
    description: {
      en: "Gallops at an enemy unit from a distance and strikes it for twice a normal blow.",
      zh: "从远处策马冲向一个敌方单位，造成两倍普通攻击的伤害。",
    },
    command: { icon: "↠", hotkey: "r" },
  },
};

export function mapAbilityCards<T>(pick: (card: AbilityCard) => T): Record<AbilityKind, T> {
  return Object.fromEntries(Object.entries(ABILITY_CARDS).map(([kind, card]) => [kind, pick(card)])) as Record<AbilityKind, T>;
}
