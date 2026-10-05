import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS, requiredSupplyCap } from "../shared/catalog";
import { unitRegenPerSecond } from "../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { AbilityKind, BuildingKind, GameSnapshot, ItemKind, TrainableUnitKind, Unit, UnitKind, UpgradeKind } from "../shared/types";
import type { AutocastSwitch } from "./command-button-state";
import { ABILITY_CARDS } from "./content/abilities";
import { BUILDING_CARDS } from "./content/buildings";
import { TRAINED_UNIT_CARDS } from "./content/units";
import { createI18n, type LabelKey, type Locale } from "./i18n";

export type GameplayTooltip = {
  title: string;
  body: string;
  stats: string[];
  requirements: string[];
  // How the player works the button beyond a click (a spell's autocast switch).
  notes?: string[];
  hotkey?: string | undefined;
};

type I18n = ReturnType<typeof createI18n>;

const DEFAULT_I18N = createI18n("en");

export function unitTooltip(kind: TrainableUnitKind, hotkey?: string, i18n: I18n = DEFAULT_I18N): GameplayTooltip {
  const stats = UNIT_DEFS[kind];
  return {
    title: labelKind(kind, i18n),
    body: TRAINED_UNIT_CARDS[kind].description[i18n.locale],
    stats: [
      tooltipLine(i18n.locale, "cost", stats.cost),
      tooltipLine(i18n.locale, "supply", stats.supplyUsed),
      tooltipLine(i18n.locale, "hp", stats.hp),
      tooltipLine(i18n.locale, "attack", stats.attackDamage),
      tooltipLine(i18n.locale, "range", stats.weapon?.minRange ? `${stats.weapon.minRange}-${stats.attackRange}` : stats.attackRange),
      ...(stats.carries ? [i18n.locale === "zh" ? `运载人口：${stats.carries}` : `Cargo supply: ${stats.carries}`] : []),
      ...(stats.weapon?.buildingMultiplier ? [i18n.locale === "zh" ? `对建筑伤害 ×${stats.weapon.buildingMultiplier}` : `Structure damage ×${stats.weapon.buildingMultiplier}`] : []),
      tooltipLine(i18n.locale, "train", formatSeconds(stats.trainTime)),
    ],
    requirements: [...(stats.tier ? [tierRequirement(stats.tier, requiredSupplyCap(kind), i18n)] : []), ...(stats.abilities.length > 0 ? [abilityListRequirement(stats.abilities, i18n)] : [])],
    hotkey: formatHotkey(hotkey),
  };
}

export function unitSelectionTooltip(kind: UnitKind, units: Unit[], snapshot: GameSnapshot, i18n: I18n = DEFAULT_I18N): GameplayTooltip {
  const representative = units[0];
  const title = `${labelKind(kind, i18n)}${units.length > 1 ? ` x${units.length}` : ""}`;
  if (!representative) return { title, body: "", stats: [], requirements: [] };
  const totalHp = units.reduce((sum, unit) => sum + unit.hp, 0);
  const totalMaxHp = units.reduce((sum, unit) => sum + unit.maxHp, 0);
  const regenValues = units.map((unit) => unitRegenPerSecond(snapshot, unit)).filter((regen) => regen > 0);
  const maxRegen = Math.max(0, ...regenValues);
  return {
    title,
    body: "",
    stats: [
      tooltipLine(i18n.locale, "currentHp", `${formatStatNumber(totalHp)}/${formatStatNumber(totalMaxHp)}`),
      tooltipLine(i18n.locale, "attack", statRange(units.map((unit) => unit.attackDamage))),
      tooltipLine(i18n.locale, "range", statRange(units.map((unit) => unit.attackRange))),
      tooltipLine(i18n.locale, "speed", statRange(units.map((unit) => unit.speed))),
      ...(maxRegen > 0 ? [tooltipLine(i18n.locale, "currentRegen", `+${formatStatNumber(maxRegen)}`)] : []),
      ...cargoLines(kind, units, i18n.locale),
    ],
    requirements: [],
  };
}

// A spell's words come from its card, its numbers from the catalog; `autocast` is how its switch stands on the selected
// units, when the player can switch it.
export function abilityTooltip(ability: AbilityKind, hotkey?: string, i18n: I18n = DEFAULT_I18N, autocast?: AutocastSwitch): GameplayTooltip {
  const text = TEXT[i18n.locale];
  return {
    title: labelKind(ability, i18n),
    body: ABILITY_CARDS[ability].description[i18n.locale],
    stats: abilityStats(ability, i18n.locale),
    requirements: ABILITY_REQUIREMENTS[i18n.locale][ability].map((line) => fillAbilityNumbers(line, ability)),
    ...(autocast ? { notes: [text.autocast[autocast], text.autocast.toggle] } : {}),
    hotkey: formatHotkey(hotkey),
  };
}

function abilityStats(ability: AbilityKind, locale: Locale) {
  const def = ABILITY_DEFS[ability];
  const cooldown = tooltipLine(locale, "cooldown", formatSeconds(def.cooldown));
  if (def.behavior === "weapon") return [tooltipLine(locale,"attack",def.damage),tooltipLine(locale,"range",`${def.weapon.minRange??0}-${def.range}`),cooldown];
  if (def.behavior === "heal") return [tooltipLine(locale, "restoresHp", def.healAmount), tooltipLine(locale, "range", def.range), cooldown];
  if (def.behavior === "summon") return [TEXT[locale].stats.summonsSpirit, tooltipLine(locale, "range", def.range), tooltipLine(locale, "duration", formatSeconds(def.summonDuration)), cooldown];
  if (def.behavior === "charge") return [tooltipLine(locale, "chargeDamage", def.damageMultiplier), tooltipLine(locale, "range", `${def.minRange}-${def.range}`), cooldown];
  if (def.behavior === "stomp" || def.behavior === "bloodlust" || def.behavior === "web") return [tooltipLine(locale, "range", def.range), tooltipLine(locale, "duration", formatSeconds(def.effectDuration)), cooldown];
  return [
    tooltipLine(locale, "enemyDamage", def.damageMultiplier),
    ...(def.summonedDamage ? [tooltipLine(locale, "summonedDamage", def.summonedDamage)] : []),
    ...(def.scorchedDamageMultiplier ? [tooltipLine(locale, "scorchedDamage", def.scorchedDamageMultiplier)] : []),
    tooltipLine(locale, "range", def.range),
    tooltipLine(locale, "duration", formatSeconds(def.effectDuration)),
    cooldown,
  ];
}

function fillAbilityNumbers(line: string, ability: AbilityKind) {
  const def = ABILITY_DEFS[ability];
  return def.behavior === "charge" ? line.replace("{min}", String(def.minRange)).replace("{max}", String(def.range)) : line;
}

export function itemTooltip(kind: ItemKind, hotkey?: string, i18n: I18n = DEFAULT_I18N): GameplayTooltip {
  const tooltip = ITEM_TOOLTIPS[i18n.locale][kind];
  return { ...tooltip, hotkey: formatHotkey(hotkey) };
}

export function upgradeTooltip(kind: UpgradeKind, hotkey?: string, currentLevel = 0, i18n: I18n = DEFAULT_I18N): GameplayTooltip {
  const upgrade = UPGRADE_DEFS[kind];
  const targetLevel = Math.min(upgrade.levels.length, currentLevel + 1);
  const level = upgrade.levels[targetLevel - 1] ?? upgrade.levels[upgrade.levels.length - 1]!;
  const affected = upgrade.affectedUnitKinds.map((unitKind) => labelKind(unitKind, i18n)).join(", ");
  const effect = level.buildingMaxHpMultiplier
    ? tooltipLine(i18n.locale, "buildingHpBonus", Math.round((level.buildingMaxHpMultiplier - 1) * 100))
    : level.speedMultiplier
      ? tooltipLine(i18n.locale, "speedBonus", Math.round((level.speedMultiplier - 1) * 100))
      : level.attackRangeMultiplier
        ? tooltipLine(i18n.locale, "unitRangeBonus", Math.round((level.attackRangeMultiplier - 1) * 100))
        : level.veteranRegenByStars
          ? tooltipLine(i18n.locale, "veteranRegenByStars", level.veteranRegenByStars.join("/"))
    : level.attackMultiplier
      ? tooltipLine(i18n.locale, "attackBonus", Math.round((level.attackMultiplier - 1) * 100))
      : tooltipLine(i18n.locale, "maxHpBonus", Math.round(((level.maxHpMultiplier ?? 1) - 1) * 100));
  const requirements = level.buildingMaxHpMultiplier
    ? [researchAtRequirement(upgrade.researchBuildingKinds, i18n), TEXT[i18n.locale].requirements.affectsBuildings]
    : level.veteranRegenByStars
      ? [researchAtRequirement(upgrade.researchBuildingKinds, i18n), TEXT[i18n.locale].requirements.affectsStarredUnits]
    : [researchAtRequirement(upgrade.researchBuildingKinds, i18n), TEXT[i18n.locale].requirements.affectsCombatUnits, affected];
  return {
    title: `${labelKind(kind, i18n)} ${romanLevel(targetLevel)}`,
    body: UPGRADE_DESCRIPTIONS[i18n.locale][kind],
    stats: [
      tooltipLine(i18n.locale, "cost", level.cost),
      tooltipLine(i18n.locale, "research", formatSeconds(level.researchTime)),
      effect,
    ],
    requirements,
    hotkey: formatHotkey(hotkey),
  };
}

export function buildingTooltip(kind: BuildingKind, hotkey?: string, i18n: I18n = DEFAULT_I18N): GameplayTooltip {
  const def = BUILDING_DEFS[kind];
  const production = [
    ...def.trains.map((unitKind) => labelKind(unitKind, i18n)),
    ...def.researches.map((upgradeKind) => labelKind(upgradeKind, i18n)),
  ];
  return {
    title: labelKind(kind, i18n),
    body: BUILDING_CARDS[kind].description[i18n.locale],
    stats: [
      tooltipLine(i18n.locale, "cost", def.cost),
      tooltipLine(i18n.locale, "build", formatSeconds(def.buildTime)),
      tooltipLine(i18n.locale, "hp", def.hp),
      ...(def.supplyProvided > 0 ? [tooltipLine(i18n.locale, "supplyBonus", def.supplyProvided)] : []),
      ...(def.attackDamage > 0 ? [tooltipLine(i18n.locale, "attack", def.attackDamage), tooltipLine(i18n.locale, "range", def.attackRange)] : []),
    ],
    requirements: production.length > 0 ? [providesRequirement(production, i18n.locale)] : [],
    hotkey: formatHotkey(hotkey),
  };
}

export function tooltipText(tooltip: GameplayTooltip) {
  return [tooltip.title, tooltip.body, ...tooltip.stats, ...tooltip.requirements, ...(tooltip.notes ?? [])].filter(Boolean).join("\n");
}

// Transports: the supply of passengers aboard against what they carry (see @@@transport).
function cargoLines(kind: UnitKind, units: Unit[], locale: Locale) {
  const carries = UNIT_DEFS[kind].carries;
  if (!carries) return [];
  const aboard = units.flatMap((unit) => unit.cargo ?? []).reduce((total, passenger) => total + UNIT_DEFS[passenger.kind].supplyUsed, 0);
  return [tooltipLine(locale, "cargo", `${aboard}/${carries * units.length}`)];
}

function tooltipLine(locale: Locale, key: keyof typeof TEXT.en.stats, value: number | string) {
  return TEXT[locale].stats[key].replace("{value}", String(value));
}

function labelKind(kind: string, i18n: I18n) {
  return i18n.label(kind as LabelKey);
}

function tierRequirement(tier: 2 | 3, cap: number, i18n: I18n) {
  return TEXT[i18n.locale].requirements[tier === 2 ? "tierAdvanced" : "tierElite"].replace("{cap}", String(cap));
}

function abilityListRequirement(abilities: readonly AbilityKind[], i18n: I18n) {
  return TEXT[i18n.locale].requirements.abilities.replace("{abilities}", abilities.map((ability) => labelKind(ability, i18n)).join(", "));
}

function researchAtRequirement(buildingKinds: readonly BuildingKind[], i18n: I18n) {
  return TEXT[i18n.locale].requirements.researchAt.replace("{building}", buildingKinds.map((buildingKind) => labelKind(buildingKind, i18n)).join(" / "));
}

function providesRequirement(production: string[], locale: Locale) {
  return TEXT[locale].requirements.provides.replace("{production}", production.join(", "));
}

function formatHotkey(hotkey?: string) {
  return hotkey?.toUpperCase();
}

export function formatTooltipDataset(tooltip: GameplayTooltip) {
  return {
    title: tooltip.title,
    body: tooltip.body,
    stats: tooltip.stats.join("|"),
    requirements: tooltip.requirements.join("|"),
    notes: (tooltip.notes ?? []).join("|"),
    hotkey: tooltip.hotkey ?? "",
  };
}

function formatSeconds(ticks: number) {
  return `${(ticks / SIM_TICKS_PER_SECOND).toFixed(1)}s`;
}

function statRange(values: number[]) {
  const sorted = values.map(formatStatNumber).sort((a, b) => Number(a) - Number(b));
  const first = sorted[0] ?? "0";
  const last = sorted[sorted.length - 1] ?? first;
  return first === last ? first : `${first}-${last}`;
}

function formatStatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function romanLevel(level: number) {
  return level === 1 ? "I" : level === 2 ? "II" : level === 3 ? "III" : String(level);
}

const TEXT = {
  en: {
    stats: {
      attack: "Attack {value}",
      attackBonus: "+{value}% attack",
      build: "Build {value}",
      buildingHpBonus: "+{value}% building HP",
      cost: "Cost {value} gold",
      hp: "HP {value}",
      currentHp: "HP {value}",
      maxHpBonus: "+{value}% max HP",
      range: "Range {value}",
      research: "Research {value}",
      currentRegen: "Regen {value} HP/s",
      cargo: "Aboard {value} supply",
      speedBonus: "+{value}% move speed",
      speed: "Speed {value}",
      supply: "Supply {value}",
      supplyBonus: "Supply +{value}",
      train: "Train {value}",
      unitRangeBonus: "+{value}% unit range",
      veteranRegenByStars: "+{value} HP/s at 1/2/3 stars",
      restoresHp: "Restores {value} HP",
      summonsSpirit: "Summons 1 spirit",
      enemyDamage: "Enemy damage x{value}",
      summonedDamage: "{value} damage to summoned units",
      scorchedDamage: "Scorched enemy damage x{value}",
      chargeDamage: "Strikes for x{value} its attack",
      duration: "Duration {value}",
      cooldown: "Cooldown {value}",
    },
    requirements: {
      abilities: "Abilities: {abilities}.",
      affectsBuildings: "Affects buildings.",
      affectsCombatUnits: "Affects combat units.",
      affectsStarredUnits: "Affects starred units.",
      provides: "Provides: {production}.",
      researchAt: "Research at {building}.",
      tierAdvanced: "Advanced unit: needs a supply cap of {cap}.",
      tierElite: "Elite unit: needs a supply cap of {cap}.",
    },
    autocast: {
      on: "Autocast: on",
      off: "Autocast: off",
      mixed: "Autocast: on for some",
      toggle: "Right-click: autocast on/off",
    },
  },
  zh: {
    stats: {
      attack: "攻击 {value}",
      attackBonus: "+{value}% 攻击",
      build: "建造 {value}",
      buildingHpBonus: "+{value}% 建筑生命",
      cost: "花费 {value} 金",
      hp: "生命 {value}",
      currentHp: "生命 {value}",
      maxHpBonus: "+{value}% 最大生命",
      range: "射程 {value}",
      research: "研究 {value}",
      currentRegen: "回复 {value} 生命/秒",
      cargo: "载 {value} 人口",
      speedBonus: "+{value}% 移动速度",
      speed: "移速 {value}",
      supply: "人口 {value}",
      supplyBonus: "人口 +{value}",
      train: "训练 {value}",
      unitRangeBonus: "+{value}% 单位射程",
      veteranRegenByStars: "1/2/3 星 +{value} 生命/秒",
      restoresHp: "恢复 {value} 生命",
      summonsSpirit: "召唤 1 个灵体",
      enemyDamage: "敌方伤害 x{value}",
      summonedDamage: "对召唤物 {value} 伤害",
      scorchedDamage: "灼烧目标伤害 x{value}",
      chargeDamage: "伤害为普攻 x{value}",
      duration: "持续 {value}",
      cooldown: "冷却 {value}",
    },
    requirements: {
      abilities: "技能：{abilities}。",
      affectsBuildings: "影响建筑。",
      affectsCombatUnits: "影响作战单位。",
      affectsStarredUnits: "影响有星单位。",
      provides: "提供：{production}。",
      researchAt: "在{building}研究。",
      tierAdvanced: "进阶兵种：人口上限需达到 {cap}。",
      tierElite: "高级兵种：人口上限需达到 {cap}。",
    },
    autocast: {
      on: "自动施法：开",
      off: "自动施法：关",
      mixed: "自动施法：部分开启",
      toggle: "右键：开/关自动施法",
    },
  },
} as const;

// What a spell's button needs besides a ready caster ({min} and {max}: a charge's window, filled from the catalog).
const ABILITY_REQUIREMENTS: Record<Locale, Record<AbilityKind, string[]>> = {
  en: {
    ramBreach: ["Target an enemy structure."], pinningBolt:["Target an enemy unit or structure."], siegeBarrage:["Target a point outside the dead zone."], grapeshot:["Target a direction."], incendiaryFlume:["Target a point."],
    heal: ["Priest or field medic must be ready."],
    summon: ["Summoner must be ready.", "Target a point; a far one is walked to first."],
    curse: ["Witch must be ready.", "Target an enemy unit."],
    emberMend: ["Ember acolyte must be ready."],
    cinderSoul: ["Pyre caller must be ready.", "Target a point; a far one is walked to first."],
    ashCurse: ["Ash hexer must be ready.", "Target an enemy unit."],
    charge: ["Raider or knight must be ready.", "Target an enemy unit at least {min} away; a farther one is ridden up to first."],
    stomp: ["Cast by a granite golem on its own."],
    bloodlust: ["Cast by an ogre mage on its own."],
    web: ["Cast by a spider queen on its own."],
  },
  zh: {
    ramBreach: ["目标必须是敌方建筑或路障。"], pinningBolt:["目标必须是敌方单位或建筑。"], siegeBarrage:["选择近程死角之外的落点。"], grapeshot:["选择射击方向。"], incendiaryFlume:["选择燃油弹落点。"],
    heal: ["牧师或战地医师必须准备就绪。"],
    summon: ["召唤师必须准备就绪。", "目标是一个点位，远了会先走过去。"],
    curse: ["女巫必须准备就绪。", "目标必须是敌方单位。"],
    emberMend: ["余烬侍僧必须准备就绪。"],
    cinderSoul: ["烬火召唤者必须准备就绪。", "目标是一个点位，远了会先走过去。"],
    ashCurse: ["灰烬巫师必须准备就绪。", "目标必须是敌方单位。"],
    charge: ["掠袭者或骑士必须准备就绪。", "目标是至少 {min} 外的敌方单位，更远的会先骑过去再冲。"],
    stomp: ["花岗岩魔像自己施放。"],
    bloodlust: ["食人魔法师自己施放。"],
    web: ["蛛后自己施放。"],
  },
};

const ITEM_TOOLTIPS: Record<Locale, Record<ItemKind, GameplayTooltip>> = {
  en: {
    lightningRod: {
      title: "Lightning Rod",
      body: "Strikes an enemy unit, then jumps to nearby enemies with reduced damage.",
      stats: ["84 initial damage", "3 jumps", "Range 280", "Bounce range 170", "Cooldown 18.0s"],
      requirements: ["Needs a visible enemy unit in range."],
    },
    stormStaff: {
      title: "Storm Staff",
      body: "Calls a storm at a target point, damaging enemies on impact and over time.",
      stats: ["24 impact damage", "6 damage per tick", "Radius 145", "Range 320", "Cooldown 27.0s"],
      requirements: ["Target a visible enemy or nearby point."],
    },
    flameCloak: {
      title: "Flame Cloak",
      body: "Passive aura that burns nearby enemies while carried.",
      stats: ["12 aura damage", "Radius 90", "Cooldown 2.0s"],
      requirements: ["Passive item. No manual use."],
    },
    guardianScroll: {
      title: "Guardian Scroll",
      body: "Protects nearby allied units from incoming attack damage for a short time.",
      stats: ["Radius 280", "Duration 7.0s", "Cooldown 45.0s"],
      requirements: ["Carrier must not be neutral."],
    },
    experienceBook: {
      title: "Experience Book",
      body: "Consumed by the carrier to gain veteran experience immediately.",
      stats: ["Grants 160 XP", "Consumed on use"],
      requirements: ["Carrier must not be neutral."],
    },
    breachCharge: {
      title: "Breach Charge",
      body: "Consumed to blast an enemy building at close range.",
      stats: ["260 building damage", "Range 280", "Consumed on use"],
      requirements: ["Needs an enemy building in range.", "Carrier must not be neutral."],
    },
    speedBoots: {
      title: "Boots of Speed",
      body: "Its carrier moves a fifth faster. A second pair adds nothing.",
      stats: ["+20% move speed", "Sold at shops"],
      requirements: ["Passive item. No manual use."],
    },
    regenRing: {
      title: "Ring of Regeneration",
      body: "Its carrier heals over time. A second ring adds nothing.",
      stats: ["+2 HP per second", "Sold at shops"],
      requirements: ["Passive item. No manual use."],
    },
    healingScroll: {
      title: "Scroll of Healing",
      body: "Consumed to heal every allied unit near the reader at once.",
      stats: ["Heals 75", "Radius 300", "Consumed on use"],
      requirements: ["Carrier must not be neutral."],
    },
    ivoryTower: {
      title: "Ivory Tower",
      body: "Consumed to raise a finished defense tower at half health near its carrier.",
      stats: ["Range 200", "Consumed on use"],
      requirements: ["Target open ground near the carrier."],
    },
  },
  zh: {
    lightningRod: {
      title: "闪电权杖",
      body: "打击一个敌方单位，然后以较低伤害跳向附近敌人。",
      stats: ["初始伤害 84", "跳跃 3 次", "射程 280", "弹跳范围 170", "冷却 18.0s"],
      requirements: ["需要射程内可见的敌方单位。"],
    },
    stormStaff: {
      title: "风暴法杖",
      body: "在目标点召唤风暴，对敌人造成落点伤害和持续伤害。",
      stats: ["落点伤害 24", "每 tick 伤害 6", "半径 145", "射程 320", "冷却 27.0s"],
      requirements: ["目标必须是可见敌人或附近点位。"],
    },
    flameCloak: {
      title: "烈焰斗篷",
      body: "携带时产生被动光环，灼烧附近敌人。",
      stats: ["光环伤害 12", "半径 90", "冷却 2.0s"],
      requirements: ["被动物品，无法手动使用。"],
    },
    guardianScroll: {
      title: "守护卷轴",
      body: "短时间保护附近友方单位，降低受到的攻击伤害。",
      stats: ["半径 280", "持续 7.0s", "冷却 45.0s"],
      requirements: ["携带者不能是中立单位。"],
    },
    experienceBook: {
      title: "经验书",
      body: "由携带者消耗，立即获得老兵经验。",
      stats: ["获得 160 经验", "使用后消耗"],
      requirements: ["携带者不能是中立单位。"],
    },
    breachCharge: {
      title: "破城炸药",
      body: "消耗后近距离爆破一个敌方建筑。",
      stats: ["建筑伤害 260", "射程 280", "使用后消耗"],
      requirements: ["需要射程内敌方建筑。", "携带者不能是中立单位。"],
    },
    speedBoots: {
      title: "速度之靴",
      body: "携带者移速提高五分之一。带两双不叠加。",
      stats: ["移速 +20%", "商店出售"],
      requirements: ["被动物品，无法手动使用。"],
    },
    regenRing: {
      title: "回复戒指",
      body: "携带者持续回血。带两枚不叠加。",
      stats: ["每秒回 2 血", "商店出售"],
      requirements: ["被动物品，无法手动使用。"],
    },
    healingScroll: {
      title: "治疗卷轴",
      body: "消耗后，使用者身边所有友军立即回血。",
      stats: ["回复 75", "半径 300", "使用后消耗"],
      requirements: ["携带者不能是中立单位。"],
    },
    ivoryTower: {
      title: "象牙塔",
      body: "消耗后，在携带者身边立起一座半血的防御塔，立即可用。",
      stats: ["距离 200 以内", "使用后消耗"],
      requirements: ["目标必须是携带者附近的空地。"],
    },
  },
};

const UPGRADE_DESCRIPTIONS: Record<Locale, Record<UpgradeKind, string>> = {
  en: {
    weaponTraining: "Improves attack damage for ordinary combat units.",
    reinforcedPlating: "Improves maximum health for ordinary combat units.",
    buildingDurability: "Improves maximum health for owned buildings.",
    speedTraining: "Improves movement speed for ordinary combat units.",
    rangeTraining: "Improves attack range for ordinary combat units, excluding towers.",
    leadership: "Lets veteran owned units regenerate health based on their star level.",
  },
  zh: {
    weaponTraining: "提升普通作战单位的攻击伤害。",
    reinforcedPlating: "提升普通作战单位的最大生命。",
    buildingDurability: "提升己方建筑的最大生命。",
    speedTraining: "提升普通作战单位的移动速度。",
    rangeTraining: "提升普通作战单位的攻击射程，不影响防御塔。",
    leadership: "让己方有星级单位按星级持续回复生命。",
  },
};
