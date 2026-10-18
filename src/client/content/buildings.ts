import type { BuildingKind } from "../../shared/types";
import type { BuildingCard } from "./cards";

export const BUILDING_CARDS: Record<BuildingKind, BuildingCard> = {
  townHall: {
    name: { en: "Town Hall", zh: "城镇大厅" },
    description: { en: "Main economy building. Trains workers, receives gold, researches building durability, and provides base supply.", zh: "主要经济建筑。训练农民、接收金矿、研究建筑耐久，并提供基础人口。" },
    command: { icon: "⌂", hotkey: "h" },
    glyph: { frame: "town-hall", marks: ["roof", "banner", "door"] },
  },
  barracks: {
    name: { en: "Barracks", zh: "兵营" },
    description: { en: "Core military building that trains melee soldiers and researches army upgrades.", zh: "核心军事建筑。训练近战士兵，并研究军队升级。" },
    command: { icon: "▱", hotkey: "b" },
    glyph: { frame: "barracks-yard", marks: ["crossedBlades", "banner", "door"] },
  },
  archeryRange: {
    name: { en: "Archery Range", zh: "靶场" },
    description: { en: "Grove ranged production for a protected firing line.", zh: "林地远程生产建筑，为有前排保护的射击阵线提供兵力。" },
    command: { icon: "⌁", hotkey: "r" },
    glyph: { frame: "archery-range", marks: ["target", "bowRack", "banner"] },
  },
  stables: {
    name: { en: "Stables", zh: "马厩" },
    description: { en: "Mounted troops for mobile harassment, skirmishing and heavy cavalry assaults.", zh: "骑乘部队的生产建筑，支持机动骚扰、骑射和重骑突击。" },
    command: { icon: "⌂", hotkey: "s" },
    glyph: { frame: "stables-gate", marks: ["horseshoe", "rail", "door"] },
  },
  sanctum: {
    name: { en: "Sanctum", zh: "圣所" },
    description: { en: "Grove spellcaster production for healing, summons and curses.", zh: "林地施法者生产建筑，提供治疗、召唤和诅咒支援。" },
    command: { icon: "✣", hotkey: "c" },
    glyph: { frame: "sanctum-dome", marks: ["moonRune", "sparkRune", "banner"] },
  },
  workshop: {
    name: { en: "Workshop", zh: "工坊" },
    description: { en: "Heavy military workshop. Its roster depends on your faction.", zh: "重型军事工坊，生产的兵种随阵营而异。" },
    command: { icon: "⚙", hotkey: "o" },
    glyph: { frame: "workshop-gear", marks: ["cog", "hammer", "door"] },
  },
  defenseTower: {
    name: { en: "Defense Tower", zh: "防御塔" },
    description: { en: "Static defense that fires at nearby enemy units.", zh: "静态防御建筑，会攻击附近敌方单位。" },
    command: { icon: "⌖", hotkey: "t" },
    glyph: { frame: "tower-spire", marks: ["arrowSlit", "watchEye", "banner"] },
  },
  fortifiedTower: {
    name: { en: "Fortified Tower", zh: "加固防御塔" },
    description: { en: "A defense tower fortified: broader and twice as sturdy, with no weapon of its own. Up to 4 supply of troops stand on its top: melee cannot strike them, every other damage reaches them at 40%, and ranged troops there reach 20% farther.", zh: "加固后的防御塔：更宽、生命翻倍，自身不再攻击。塔顶最多站 4 人口的单位：近战打不到，其他伤害只受 40%，远程单位射程 +20%。" },
    command: { icon: "▲", hotkey: "f" },
    glyph: { frame: "tower-spire", marks: ["crossedBlades", "watchEye", "banner"] },
  },
  moonWell: {
    name: { en: "Moon Well", zh: "月井" },
    description: { en: "Support building that periodically heals nearby wounded non-mechanical allies. Has no effect on mechanical units.", zh: "支援建筑，会周期性治疗附近受伤的非机械友军；对机械单位无效。" },
    command: { icon: "◐", hotkey: "m" },
    glyph: { frame: "moon-well", marks: ["moonRune", "sparkRune", "door"] },
  },
  emberForge: {
    name: { en: "Ember Forge", zh: "余烬熔炉" },
    description: { en: "Ember front-line production for holding ground, assault and pursuit.", zh: "灰烬前排生产建筑，支持坚守、强攻和追击。" },
    command: { icon: "▰", hotkey: "b" },
    glyph: { frame: "ember-forge", marks: ["crossedBlades", "sparkRune", "hammer"] },
  },
  cinderSpire: {
    name: { en: "Cinder Spire", zh: "烬火尖塔" },
    description: { en: "Ember support building that trains ranged units and casters.", zh: "余烬支援建筑，用于训练远程单位和施法者。" },
    command: { icon: "♢", hotkey: "c" },
    glyph: { frame: "cinder-spire", marks: ["sparkRune", "watchEye", "banner"] },
  },
  emberShrine: {
    name: { en: "Ember Shrine", zh: "余烬神龛" },
    description: { en: "Ember support building that periodically heals nearby wounded non-mechanical allies. Has no effect on mechanical units.", zh: "余烬支援建筑，会周期性治疗附近受伤的非机械友军；对机械单位无效。" },
    command: { icon: "◒", hotkey: "m" },
    glyph: { frame: "ember-shrine", marks: ["sparkRune", "moonRune", "door"] },
  },
  ashenHall: {
    name: { en: "Ashen Hall", zh: "灰烬战殿" },
    description: { en: "Ember elite production for hunting casters and sustained front-line fighting.", zh: "灰烬精英生产建筑，支持猎杀法师和持久的前排战斗。" },
    command: { icon: "♨", hotkey: "a" },
    glyph: { frame: "ashen-hall", marks: ["crossedBlades", "sparkRune", "banner"] },
  },
  farm: {
    name: { en: "Farm", zh: "农场" },
    description: { en: "Supply building. Build more farms before training past the cap.", zh: "人口建筑。超过人口上限前需要建造更多农场。" },
    command: { icon: "⌗", hotkey: "e" },
    glyph: { frame: "farm-plot", marks: ["furrows", "scareMark", "door"] },
  },
  shipyard: {
    name: { en: "Shipyard", zh: "船坞" },
    description: { en: "Naval production and repair on the coast. Ships receive paid repairs nearby when not attacking.", zh: "海岸舰队生产和维修建筑；附近未进攻的船只可付费修复。" },
    command: { icon: "⚓", hotkey: "y" },
    glyph: { frame: "shipyard-dock", marks: ["anchor", "waves", "banner"] },
  },
};

export function mapBuildingCards<T>(pick: (card: BuildingCard) => T): Record<BuildingKind, T> {
  return Object.fromEntries(Object.entries(BUILDING_CARDS).map(([kind, card]) => [kind, pick(card)])) as Record<BuildingKind, T>;
}
