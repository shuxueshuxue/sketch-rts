import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from "../shared/catalog";
import { unitRegenPerSecond } from "../shared/sim";
import type { AbilityKind, BuildingKind, GameSnapshot, ItemKind, TrainableUnitKind, Unit, UnitKind, UpgradeKind } from "../shared/types";
import { BUILDING_CARDS } from "./content/buildings";
import { TRAINED_UNIT_CARDS } from "./content/units";
import { createI18n, type LabelKey, type Locale } from "./i18n";

export type GameplayTooltip = {
  title: string;
  body: string;
  stats: string[];
  requirements: string[];
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
      tooltipLine(i18n.locale, "range", stats.attackRange),
      tooltipLine(i18n.locale, "train", formatSeconds(stats.trainTime)),
    ],
    requirements: stats.abilities.length > 0 ? [abilityListRequirement(stats.abilities, i18n)] : [],
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
    ],
    requirements: [],
  };
}

export function abilityTooltip(ability: AbilityKind, hotkey?: string, i18n: I18n = DEFAULT_I18N): GameplayTooltip {
  const tooltip = ABILITY_TOOLTIPS[i18n.locale][ability];
  return { ...tooltip, hotkey: formatHotkey(hotkey) };
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
        : level.veteranRegenPerStar
          ? tooltipLine(i18n.locale, "veteranRegenPerStar", level.veteranRegenPerStar)
    : level.attackBonus > 0
      ? tooltipLine(i18n.locale, "attackBonus", level.attackBonus)
      : tooltipLine(i18n.locale, "maxHpBonus", level.maxHpBonus);
  const requirements = level.buildingMaxHpMultiplier
    ? [researchAtRequirement(upgrade.researchBuildingKinds, i18n), TEXT[i18n.locale].requirements.affectsBuildings]
    : level.veteranRegenPerStar
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
  return [tooltip.title, tooltip.body, ...tooltip.stats, ...tooltip.requirements].filter(Boolean).join("\n");
}

function tooltipLine(locale: Locale, key: keyof typeof TEXT.en.stats, value: number | string) {
  return TEXT[locale].stats[key].replace("{value}", String(value));
}

function labelKind(kind: string, i18n: I18n) {
  return i18n.label(kind as LabelKey);
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
    hotkey: tooltip.hotkey ?? "",
  };
}

function formatSeconds(ticks: number) {
  return `${(ticks / 20).toFixed(1)}s`;
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
      attackBonus: "+{value} attack",
      build: "Build {value}",
      buildingHpBonus: "+{value}% building HP",
      cost: "Cost {value} gold",
      hp: "HP {value}",
      currentHp: "HP {value}",
      maxHpBonus: "+{value} max HP",
      range: "Range {value}",
      research: "Research {value}",
      currentRegen: "Regen {value} HP/s",
      speedBonus: "+{value}% move speed",
      speed: "Speed {value}",
      supply: "Supply {value}",
      supplyBonus: "Supply +{value}",
      train: "Train {value}",
      unitRangeBonus: "+{value}% unit range",
      veteranRegenPerStar: "+{value} HP/s per star",
    },
    requirements: {
      abilities: "Abilities: {abilities}.",
      affectsBuildings: "Affects buildings.",
      affectsCombatUnits: "Affects combat units.",
      affectsStarredUnits: "Affects starred units.",
      provides: "Provides: {production}.",
      researchAt: "Research at {building}.",
    },
  },
  zh: {
    stats: {
      attack: "攻击 {value}",
      attackBonus: "+{value} 攻击",
      build: "建造 {value}",
      buildingHpBonus: "+{value}% 建筑生命",
      cost: "花费 {value} 金",
      hp: "生命 {value}",
      currentHp: "生命 {value}",
      maxHpBonus: "+{value} 最大生命",
      range: "射程 {value}",
      research: "研究 {value}",
      currentRegen: "回复 {value} 生命/秒",
      speedBonus: "+{value}% 移动速度",
      speed: "移速 {value}",
      supply: "人口 {value}",
      supplyBonus: "人口 +{value}",
      train: "训练 {value}",
      unitRangeBonus: "+{value}% 单位射程",
      veteranRegenPerStar: "每颗星 +{value} 生命/秒",
    },
    requirements: {
      abilities: "技能：{abilities}。",
      affectsBuildings: "影响建筑。",
      affectsCombatUnits: "影响作战单位。",
      affectsStarredUnits: "影响有星单位。",
      provides: "提供：{production}。",
      researchAt: "在{building}研究。",
    },
  },
} as const;

const ABILITY_TOOLTIPS: Record<Locale, Record<AbilityKind, GameplayTooltip>> = {
  en: {
    heal: {
      title: "Heal",
      body: "Restores health to an allied unit in range.",
      stats: ["Restores 55 HP", "Range 240", "Cooldown 6.0s"],
      requirements: ["Priest or field medic must be ready."],
    },
    summon: {
      title: "Summon",
      body: "Creates a spirit at a nearby ground point.",
      stats: ["Summons 1 spirit", "Range 260", "Cooldown 11.0s"],
      requirements: ["Summoner must be ready.", "Target a nearby point."],
    },
    curse: {
      title: "Curse",
      body: "Weakens an enemy unit so its attacks deal less damage.",
      stats: ["Enemy damage x0.4", "Range 280", "Duration 18.0s", "Cooldown 7.5s"],
      requirements: ["Witch must be ready.", "Target an enemy unit."],
    },
    emberMend: {
      title: "Ember Mend",
      body: "Quickly restores health to an allied unit at shorter range.",
      stats: ["Restores 55 HP", "Range 240", "Cooldown 6.0s"],
      requirements: ["Ember acolyte must be ready."],
    },
    cinderSoul: {
      title: "Cinder Soul",
      body: "Creates a shorter-lived spirit at a nearby ground point.",
      stats: ["Summons 1 spirit", "Range 260", "Duration 45.0s", "Cooldown 11.0s"],
      requirements: ["Pyre caller must be ready.", "Target a nearby point."],
    },
    ashCurse: {
      title: "Ash Curse",
      body: "Weakens an enemy unit, and burns scorched targets down to a harsher damage penalty.",
      stats: ["Enemy damage x0.45", "Scorched enemy damage x0.3", "Range 280", "Duration 18.0s", "Cooldown 7.5s"],
      requirements: ["Ash hexer must be ready.", "Target an enemy unit."],
    },
  },
  zh: {
    heal: {
      title: "治疗",
      body: "为射程内的友方单位恢复生命。",
      stats: ["恢复 55 生命", "射程 240", "冷却 6.0s"],
      requirements: ["牧师或战地医师必须准备就绪。"],
    },
    summon: {
      title: "召唤",
      body: "在附近地面目标点召唤一个灵体。",
      stats: ["召唤 1 个灵体", "射程 260", "冷却 11.0s"],
      requirements: ["召唤师必须准备就绪。", "目标必须是附近点位。"],
    },
    curse: {
      title: "诅咒",
      body: "削弱敌方单位，使其攻击造成更少伤害。",
      stats: ["敌方伤害 x0.4", "射程 280", "持续 18.0s", "冷却 7.5s"],
      requirements: ["女巫必须准备就绪。", "目标必须是敌方单位。"],
    },
    emberMend: {
      title: "余烬疗愈",
      body: "以较短射程快速治疗友方单位。",
      stats: ["恢复 55 生命", "射程 240", "冷却 6.0s"],
      requirements: ["余烬侍僧必须准备就绪。"],
    },
    cinderSoul: {
      title: "余火魂灵",
      body: "在附近地面目标点召唤一个持续时间较短的灵体。",
      stats: ["召唤 1 个灵体", "射程 260", "持续 45.0s", "冷却 11.0s"],
      requirements: ["烬火召唤者必须准备就绪。", "目标必须是附近点位。"],
    },
    ashCurse: {
      title: "灰烬诅咒",
      body: "削弱敌方单位；若目标已被灼烧，则进一步压低其伤害。",
      stats: ["敌方伤害 x0.45", "灼烧目标伤害 x0.3", "射程 280", "持续 18.0s", "冷却 7.5s"],
      requirements: ["灰烬巫师必须准备就绪。", "目标必须是敌方单位。"],
    },
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
