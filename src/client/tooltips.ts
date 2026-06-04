import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from "../shared/catalog";
import type { AbilityKind, BuildingKind, ItemKind, TrainableUnitKind, UpgradeKind } from "../shared/types";

export type GameplayTooltip = {
  title: string;
  body: string;
  stats: string[];
  requirements: string[];
  hotkey?: string | undefined;
};

export function unitTooltip(_kind: TrainableUnitKind, hotkey?: string): GameplayTooltip {
  const kind = _kind;
  const stats = UNIT_DEFS[kind];
  return {
    title: labelKind(kind),
    body: UNIT_DESCRIPTIONS[kind],
    stats: [
      `Cost ${stats.cost} gold`,
      `Supply ${stats.supplyUsed}`,
      `HP ${stats.hp}`,
      `Attack ${stats.attackDamage}`,
      `Range ${stats.attackRange}`,
      `Train ${formatSeconds(stats.trainTime)}`,
    ],
    requirements: stats.abilities.length > 0 ? [`Abilities: ${stats.abilities.map(labelKind).join(", ")}.`] : [],
    hotkey: formatHotkey(hotkey),
  };
}

export function abilityTooltip(ability: AbilityKind, hotkey?: string): GameplayTooltip {
  const tooltip = ABILITY_TOOLTIPS[ability];
  return { ...tooltip, hotkey: formatHotkey(hotkey) };
}

export function itemTooltip(kind: ItemKind, hotkey?: string): GameplayTooltip {
  const tooltip = ITEM_TOOLTIPS[kind];
  return { ...tooltip, hotkey: formatHotkey(hotkey) };
}

export function upgradeTooltip(kind: UpgradeKind, hotkey?: string, currentLevel = 0): GameplayTooltip {
  const upgrade = UPGRADE_DEFS[kind];
  const targetLevel = Math.min(upgrade.levels.length, currentLevel + 1);
  const level = upgrade.levels[targetLevel - 1] ?? upgrade.levels[upgrade.levels.length - 1]!;
  const affected = upgrade.affectedUnitKinds.map(labelKind).join(", ");
  const effect = level.buildingMaxHpMultiplier
    ? `+${Math.round((level.buildingMaxHpMultiplier - 1) * 100)}% building HP`
    : level.attackBonus > 0
      ? `+${level.attackBonus} attack`
      : `+${level.maxHpBonus} max HP`;
  const requirements = level.buildingMaxHpMultiplier
    ? [`Research at ${labelKind(upgrade.buildingKind)}.`, "Affects buildings."]
    : [`Research at ${labelKind(upgrade.buildingKind)}.`, "Affects combat units.", affected];
  return {
    title: `${labelKind(kind)} ${romanLevel(targetLevel)}`,
    body: UPGRADE_DESCRIPTIONS[kind],
    stats: [
      `Cost ${level.cost} gold`,
      `Research ${formatSeconds(level.researchTime)}`,
      effect,
    ],
    requirements,
    hotkey: formatHotkey(hotkey),
  };
}

export function buildingTooltip(kind: BuildingKind, hotkey?: string): GameplayTooltip {
  const def = BUILDING_DEFS[kind];
  const production = [
    ...def.trains.map(labelKind),
    ...def.researches.map(labelKind),
  ];
  return {
    title: labelKind(kind),
    body: BUILDING_DESCRIPTIONS[kind],
    stats: [
      `Cost ${def.cost} gold`,
      `Build ${formatSeconds(def.buildTime)}`,
      `HP ${def.hp}`,
      ...(def.supplyProvided > 0 ? [`Supply +${def.supplyProvided}`] : []),
      ...(def.attackDamage > 0 ? [`Attack ${def.attackDamage}`, `Range ${def.attackRange}`] : []),
    ],
    requirements: production.length > 0 ? [`Provides: ${production.join(", ")}.`] : [],
    hotkey: formatHotkey(hotkey),
  };
}

export function tooltipText(tooltip: GameplayTooltip) {
  return [tooltip.title, tooltip.body, ...tooltip.stats, ...tooltip.requirements].filter(Boolean).join("\n");
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

function labelKind(kind: string) {
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function formatSeconds(ticks: number) {
  return `${(ticks / 20).toFixed(1)}s`;
}

function romanLevel(level: number) {
  return level === 1 ? "I" : level === 2 ? "II" : level === 3 ? "III" : String(level);
}

const UNIT_DESCRIPTIONS: Record<TrainableUnitKind, string> = {
  worker: "Worker. Gathers gold, builds structures, repairs the economy, and can defend itself only in a pinch.",
  footman: "Front-line melee soldier for early fights and body-blocking fragile units.",
  archer: "Light ranged unit. Strong when kept behind melee units, fragile if caught.",
  raider: "Fast melee harasser for chasing workers and punishing isolated targets.",
  lancer: "Reach melee fighter with a slightly longer attack range than ordinary infantry.",
  groveWarden: "Durable grove infantry that holds the line better than basic soldiers.",
  emberRavager: "Aggressive ember infantry with strong close-range damage.",
  knight: "Heavy cavalry for decisive fights and base pressure.",
  priest: "Support caster with a targeted heal for wounded allies.",
  summoner: "Caster that creates a temporary spirit at a target point.",
  witch: "Debuff caster that weakens enemy damage through curse.",
  golem: "Slow heavy siege body with high health and strong melee damage.",
};

const BUILDING_DESCRIPTIONS: Record<BuildingKind, string> = {
  townHall: "Main economy building. Trains workers, receives gold, researches building durability, and provides base supply.",
  barracks: "Core military building that trains melee soldiers and researches army upgrades.",
  archeryRange: "Ranged production building that trains archers.",
  stables: "Mounted unit production building for fast raiders and heavy knights.",
  sanctum: "Caster production building for priests, summoners, and witches.",
  workshop: "Heavy unit production building that trains golems.",
  defenseTower: "Static defense that fires at nearby enemy units.",
  moonWell: "Support building that periodically heals wounded friendly soldiers nearby.",
  farm: "Supply building. Build more farms before training past the cap.",
};

const ABILITY_TOOLTIPS: Record<AbilityKind, GameplayTooltip> = {
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
};

const ITEM_TOOLTIPS: Record<ItemKind, GameplayTooltip> = {
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
};

const UPGRADE_DESCRIPTIONS: Record<UpgradeKind, string> = {
  weaponTraining: "Improves attack damage for ordinary combat units.",
  reinforcedPlating: "Improves maximum health for ordinary combat units.",
  buildingDurability: "Improves maximum health for owned buildings.",
};
