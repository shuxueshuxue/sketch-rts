import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from "../shared/catalog";
import type { AbilityKind, BuildingKind, ItemKind, TrainableUnitKind, UpgradeKind } from "../shared/types";
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
    body: UNIT_DESCRIPTIONS[i18n.locale][kind],
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
    : level.attackBonus > 0
      ? tooltipLine(i18n.locale, "attackBonus", level.attackBonus)
      : tooltipLine(i18n.locale, "maxHpBonus", level.maxHpBonus);
  const requirements = level.buildingMaxHpMultiplier
    ? [researchAtRequirement(upgrade.buildingKind, i18n), TEXT[i18n.locale].requirements.affectsBuildings]
    : [researchAtRequirement(upgrade.buildingKind, i18n), TEXT[i18n.locale].requirements.affectsCombatUnits, affected];
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
    body: BUILDING_DESCRIPTIONS[i18n.locale][kind],
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

function researchAtRequirement(buildingKind: BuildingKind, i18n: I18n) {
  return TEXT[i18n.locale].requirements.researchAt.replace("{building}", labelKind(buildingKind, i18n));
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
      maxHpBonus: "+{value} max HP",
      range: "Range {value}",
      research: "Research {value}",
      supply: "Supply {value}",
      supplyBonus: "Supply +{value}",
      train: "Train {value}",
    },
    requirements: {
      abilities: "Abilities: {abilities}.",
      affectsBuildings: "Affects buildings.",
      affectsCombatUnits: "Affects combat units.",
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
      maxHpBonus: "+{value} 最大生命",
      range: "射程 {value}",
      research: "研究 {value}",
      supply: "人口 {value}",
      supplyBonus: "人口 +{value}",
      train: "训练 {value}",
    },
    requirements: {
      abilities: "技能：{abilities}。",
      affectsBuildings: "影响建筑。",
      affectsCombatUnits: "影响作战单位。",
      provides: "提供：{production}。",
      researchAt: "在{building}研究。",
    },
  },
} as const;

const UNIT_DESCRIPTIONS: Record<Locale, Record<TrainableUnitKind, string>> = {
  en: {
    worker: "Worker. Gathers gold, builds structures, repairs the economy, and can defend itself only in a pinch.",
    footman: "Front-line melee soldier for early fights and body-blocking fragile units.",
    archer: "Light ranged unit. Strong when kept behind melee units, fragile if caught.",
    raider: "Fast melee harasser for chasing workers and punishing isolated targets.",
    lancer: "Reach melee fighter with a slightly longer attack range than ordinary infantry.",
    groveWarden: "Durable grove infantry that holds the line better than basic soldiers.",
    emberRavager: "Aggressive ember infantry with strong close-range damage.",
    cinderRunner: "Fast ember melee unit for chasing weak targets and forcing fights.",
    sparkArcher: "Fragile ember ranged unit with quick pressure and shorter reach.",
    emberAcolyte: "Ember support caster with a targeted heal for wounded allies.",
    ashHexer: "Ember debuff caster that weakens enemy damage through curse.",
    pyreCaller: "Ember summoner that creates temporary spirits near the fight.",
    knight: "Heavy cavalry for decisive fights and base pressure.",
    priest: "Support caster with a targeted heal for wounded allies.",
    summoner: "Caster that creates a temporary spirit at a target point.",
    witch: "Debuff caster that weakens enemy damage through curse.",
    golem: "Slow heavy siege body with high health and strong melee damage.",
  },
  zh: {
    worker: "农民。采集金矿、建造建筑、修理经济体系，紧急时也能勉强自卫。",
    footman: "前排近战士兵，用于早期交战并保护脆弱单位。",
    archer: "轻型远程单位。站在近战单位后方时很强，被贴身时很脆。",
    raider: "高速近战骚扰单位，用于追击农民并惩罚落单目标。",
    lancer: "长柄近战单位，攻击距离比普通步兵稍长。",
    groveWarden: "耐久的林地步兵，比基础士兵更适合顶线。",
    emberRavager: "进攻性的余烬步兵，近距离伤害很强。",
    cinderRunner: "高速余烬近战单位，用于追击弱目标并强行开战。",
    sparkArcher: "脆弱的余烬远程单位，压制速度快但射程较短。",
    emberAcolyte: "余烬支援施法者，可以对受伤友军进行定点治疗。",
    ashHexer: "余烬减益施法者，通过诅咒削弱敌方伤害。",
    pyreCaller: "余烬召唤者，可以在战斗附近召唤临时灵体。",
    knight: "重骑兵，用于决定性会战和基地压制。",
    priest: "支援施法者，可以对受伤友军进行定点治疗。",
    summoner: "施法者，可以在目标点召唤临时灵体。",
    witch: "减益施法者，通过诅咒削弱敌方伤害。",
    golem: "缓慢的重型攻坚单位，生命值高，近战伤害强。",
  },
};

const BUILDING_DESCRIPTIONS: Record<Locale, Record<BuildingKind, string>> = {
  en: {
    townHall: "Main economy building. Trains workers, receives gold, researches building durability, and provides base supply.",
    barracks: "Core military building that trains melee soldiers and researches army upgrades.",
    archeryRange: "Ranged production building that trains archers.",
    stables: "Mounted unit production building for fast raiders and heavy knights.",
    sanctum: "Caster production building for priests, summoners, and witches.",
    workshop: "Heavy unit production building that trains golems.",
    defenseTower: "Static defense that fires at nearby enemy units.",
    moonWell: "Support building that periodically heals wounded friendly soldiers nearby.",
    emberForge: "Ember military building that trains ravagers and cinder runners.",
    cinderSpire: "Ember support building that trains ranged units and casters.",
    emberShrine: "Ember support building that periodically heals wounded friendly soldiers nearby.",
    farm: "Supply building. Build more farms before training past the cap.",
  },
  zh: {
    townHall: "主要经济建筑。训练农民、接收金矿、研究建筑耐久，并提供基础人口。",
    barracks: "核心军事建筑。训练近战士兵，并研究军队升级。",
    archeryRange: "远程生产建筑，用于训练弓箭手。",
    stables: "骑乘单位生产建筑，用于高速掠袭者和重骑士。",
    sanctum: "施法者生产建筑，用于牧师、召唤师和女巫。",
    workshop: "重型单位生产建筑，用于训练魔像。",
    defenseTower: "静态防御建筑，会攻击附近敌方单位。",
    moonWell: "支援建筑，会周期性治疗附近受伤友方士兵。",
    emberForge: "余烬军事建筑，用于训练劫掠者和奔袭者。",
    cinderSpire: "余烬支援建筑，用于训练远程单位和施法者。",
    emberShrine: "余烬支援建筑，会周期性治疗附近受伤友方士兵。",
    farm: "人口建筑。超过人口上限前需要建造更多农场。",
  },
};

const ABILITY_TOOLTIPS: Record<Locale, Record<AbilityKind, GameplayTooltip>> = {
  en: {
    heal: {
      title: "Heal",
      body: "Restores health to an allied unit in range.",
      stats: ["Restores 55 HP", "Range 240", "Cooldown 4.0s"],
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
  },
  zh: {
    heal: {
      title: "治疗",
      body: "为射程内的友方单位恢复生命。",
      stats: ["恢复 55 生命", "射程 240", "冷却 4.0s"],
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
  },
  zh: {
    weaponTraining: "提升普通作战单位的攻击伤害。",
    reinforcedPlating: "提升普通作战单位的最大生命。",
    buildingDurability: "提升己方建筑的最大生命。",
  },
};
