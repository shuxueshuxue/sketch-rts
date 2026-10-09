import { SHIP_WEAPONS,isShipEquipment,shipMounts } from "../shared/ship-equipment";
import { ITEM_DEFS } from "../shared/equipment";
import { shipProfile, shipPassengers, isShipKind } from "../shared/ship-geometry";
import { shipCabinUsage } from '../shared/ship-cabin';
import { cabinQuotaText } from './cabin-controls';
import { shipBoardingStatus } from './ship-boarding-controls';
import { isTransportKind, TRANSPORT_COMBAT } from '../shared/transport-role';
import { bodyMass } from "../shared/physical-body";
import { EXPERIENCE_BOOK_XP, VETERANCY_GAIN_PER_STAR, killXpReward, xpStarThresholds } from "../shared/unit-value";
import { VETERAN_SKILLS, type VeteranSkillId } from "../shared/veteran-skills";
import { attackDamageProfile, type DamageProfile } from "../shared/damage-types";
import { unitAttackDamageProfile } from "../shared/damage";
import { unitClassOf, type UnitClass } from "../shared/unit-targeting";
import { BREACH_CHARGE, FLAME_CLOAK, GUARDIAN_SCROLL, IVORY_TOWER_HP_SHARE, LIGHTNING_ROD, STORM_STAFF } from "../shared/item-rules";
import { BOOTS_SPEED, RING_REGEN_PER_SECOND, HEALING_SCROLL_RADIUS, HEALING_SCROLL_HEAL, IVORY_TOWER_REACH, SHOP_GOODS } from "../shared/shop";
import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS, requiredSupplyCap, unitRules, DOCK_REPAIR, SUPPORT_BUILDING_HEAL, isHealingBuildingKind, HEAVY_ARMOR_DAMAGE, SLOW_PACE, SLOW_TICKS, POISON_DAMAGE, POISON_TICKS, SPLASH_RADIUS, SPLASH_SHARE } from "../shared/catalog";
import { aimingProfile } from "../shared/aiming";
import { unitRegenPerSecond } from "../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { AbilityKind, BuildingKind, GameSnapshot, ItemKind, RaceId, TrainableUnitKind, Unit, UnitKind, UpgradeKind } from "../shared/types";
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
      damageProfileLabel(attackDamageProfile(kind, stats.weapon), i18n.locale),
      tooltipLine(i18n.locale, "speed", stats.speed),
      tooltipLine(i18n.locale, "cooldown", formatSeconds(stats.attackCooldown)),
      ...unitRuleLines(stats, i18n.locale),
      tooltipLine(i18n.locale, "range", stats.weapon?.minRange ? `${stats.weapon.minRange}-${stats.attackRange}` : stats.attackRange),
      ...(aimingProfile(stats) ? [
        i18n.locale === "zh" ? `准心速度：${Math.round(aimingProfile(stats)!.speed)} / 秒` : `Reticle speed: ${Math.round(aimingProfile(stats)!.speed)} / second`,
        i18n.locale === "zh" ? `瞄准位移容错：${aimingProfile(stats)!.moveTolerance}` : `Aim movement tolerance: ${aimingProfile(stats)!.moveTolerance}`,
      ] : []),
      ...(isShipKind(kind) ? [i18n.locale === "zh" ? "可登船作战；甲板空间与载重共同限制人数" : "Crew can fight aboard; deck space and payload limit boarding"] : []),
      ...(stats.weapon?.buildingMultiplier ? [i18n.locale === "zh" ? `对建筑伤害 ×${stats.weapon.buildingMultiplier}` : `Structure damage ×${stats.weapon.buildingMultiplier}`] : []),
      tooltipLine(i18n.locale, "train", formatSeconds(stats.trainTime)),
    ],
    requirements: [...(stats.tier ? [tierRequirement(stats.tier, requiredSupplyCap(kind), i18n)] : []), ...(stats.abilities.length > 0 ? [abilityListRequirement(stats.abilities, i18n)] : [])],
    ...(aimingProfile(stats) ? { notes: [localized(i18n.locale, "先瞄准再射击；超过上次瞄准或射击站位的位移容错后重置准心，换目标可沿用准心位置。", "Aim before firing. Moving beyond the tolerance from the last aim or shot resets the reticle; switching targets can reuse its position.")] } : {}),
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
  const authoredRules = unitRules(snapshot, representative);
  const rules = isTransportKind(kind) ? { ...authoredRules,
    rangedDamageTaken: authoredRules.rangedDamageTaken ?? TRANSPORT_COMBAT.rangedDamageTaken,
    passengerDamageMultiplier: authoredRules.passengerDamageMultiplier ?? TRANSPORT_COMBAT.passengerDamageMultiplier } : authoredRules;
  const bridgeStatus = units.length === 1 && isShipKind(kind) ? shipBoardingStatus(representative, snapshot.tick, i18n.locale === 'zh') : '';
  const earnsStars = representative.owner !== "neutral" && !(representative.variant && snapshot.variants?.[representative.variant]?.heroic);
  return {
    title,
    body: unitDescription(kind, i18n),
    stats: [
      tooltipLine(i18n.locale, "currentHp", `${formatStatNumber(totalHp)}/${formatStatNumber(totalMaxHp)}`),
      tooltipLine(i18n.locale, "attack", statRange(units.map((unit) => unit.attackDamage))),
      ...new Set(units.map(unit => damageProfileLabel(unitAttackDamageProfile(snapshot, unit), i18n.locale))),
      tooltipLine(i18n.locale, "range", statRange(units.map((unit) => unit.attackRange))),
      tooltipLine(i18n.locale, "speed", statRange(units.map((unit) => unit.speed))),
      ...(maxRegen > 0 ? [tooltipLine(i18n.locale, "currentRegen", `+${formatStatNumber(maxRegen)}`)] : []),
      ...cargoLines(kind, units, snapshot, i18n.locale),
      ...(bridgeStatus ? [bridgeStatus] : []),
      ...unitRuleLines(rules, i18n.locale, representative.level, false, unitClassOf(representative, snapshot)),
      ...(units.length === 1 && earnsStars ? [
        i18n.locale === "zh" ? `星级 ${representative.level}；经验 ${representative.xp}/${xpStarThresholds(unitRules(snapshot, representative))[representative.level] ?? "MAX"}` : `Stars ${representative.level}; XP ${representative.xp}/${xpStarThresholds(unitRules(snapshot, representative))[representative.level] ?? "MAX"}`,
      ] : []),
      ...(units.length === 1 && representative.veteranSkill ? [VETERAN_SKILLS[representative.veteranSkill].name[i18n.locale], VETERAN_SKILLS[representative.veteranSkill].description[i18n.locale]] : []),
    ],
    requirements: [],
  };
}

// A spell's words come from its card, its numbers from the catalog; `autocast` is how its switch stands on the selected
// units, when the player can switch it.
export function abilityTooltip(ability: AbilityKind, hotkey?: string, i18n: I18n = DEFAULT_I18N, autocast?: AutocastSwitch): GameplayTooltip {
  const text = TEXT[i18n.locale];
  const definition = ABILITY_DEFS[ability];
  if (definition.behavior === "veteran") {
    const tooltip = veteranSkillTooltip(definition.skill, i18n, hotkey);
    return { ...tooltip, ...(autocast ? { notes: [...(tooltip.notes ?? []), `${text.autocast[autocast]} · ${text.autocast.toggle}`] } : {}) };
  }
  return {
    title: labelKind(ability, i18n),
    body: ABILITY_CARDS[ability].description[i18n.locale],
    stats: abilityStats(ability, i18n.locale),
    requirements: ABILITY_REQUIREMENTS[i18n.locale][ability].map((line) => fillAbilityNumbers(line, ability)),
    ...(autocast ? { notes: [`${text.autocast[autocast]} · ${text.autocast.toggle}`] } : {}),
    hotkey: formatHotkey(hotkey),
  };
}

export function veteranSkillTooltip(skill: VeteranSkillId, i18n: I18n = DEFAULT_I18N, hotkey?: string): GameplayTooltip {
  const definition = VETERAN_SKILLS[skill];
  const active = definition.effect.type === "active";
  const protection = "modifiers" in definition.effect && definition.effect.modifiers.damageReduction;
  return {
    title: definition.name[i18n.locale],
    body: definition.description[i18n.locale],
    stats: protection ? [localized(i18n.locale, "防护同时适用于物理和魔法伤害", "Protection applies to both physical and magic damage")] : [],
    requirements: [],
    ...(active ? { notes: [localized(i18n.locale, "以自身为中心施放", "Centered on this soldier")] } : {}),
    hotkey: formatHotkey(hotkey),
  };
}

export function damageProfileLabel(profile: DamageProfile, locale: Locale) {
  const school = localized(locale, profile.school === "physical" ? "物理" : "魔法", profile.school === "physical" ? "Physical" : "Magic");
  const deliveries = { melee: ["近战", "Melee"], ranged: ["远程", "Ranged"], effect: ["效果", "Effect"] } as const;
  const subtypes = { cut: ["斩击", "Cutting"], pierce: ["穿刺", "Piercing"], blunt: ["钝击", "Blunt"],
    fire: ["火焰", "Fire"], poison: ["毒素", "Poison"], lightning: ["闪电", "Lightning"], arcane: ["奥术", "Arcane"] } as const;
  const detail = profile.school === "physical" ? profile.physicalType : profile.element;
  const delivery = deliveries[profile.delivery];
  const subtype = detail ? subtypes[detail] : undefined;
  const labels = [school, localized(locale, delivery[0], delivery[1]), ...(subtype ? [localized(locale, subtype[0], subtype[1])] : [])];
  return `${localized(locale, "伤害", "Damage")}: ${labels.join(" · ")}`;
}

export function unitClassLabel(classification: UnitClass, locale: Locale) {
  return localized(locale, classification === "mechanical" ? "机械" : "非机械", classification === "mechanical" ? "Mechanical" : "Non-mechanical");
}

function abilityStats(ability: AbilityKind, locale: Locale) {
  const def = ABILITY_DEFS[ability];
  const cooldown = tooltipLine(locale, "cooldown", formatSeconds(def.cooldown));
  if (def.behavior === "veteran") return [cooldown];
  if (def.behavior === "weapon") return [tooltipLine(locale,"attack",def.damage),tooltipLine(locale,"range",`${def.weapon.minRange??0}-${def.range}`),cooldown,
    ...(def.rootTicks ? [localized(locale, `定身 ${formatSeconds(def.rootTicks)}`, `Root ${formatSeconds(def.rootTicks)}`)] : []),
    ...(def.burnTicks ? [tooltipLine(locale, "duration", formatSeconds(def.burnTicks))] : []),
  ];
  if (def.behavior === "heal") return [localized(locale, "仅治疗非机械友军；对机械单位无效", "Heals only non-mechanical allies; has no effect on mechanical units"), tooltipLine(locale, "restoresHp", def.healAmount), tooltipLine(locale, "range", def.range), cooldown];
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
  return { ...tooltip, stats: itemStats(kind, i18n.locale), hotkey: formatHotkey(hotkey) };
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

export function buildingTooltip(kind: BuildingKind, hotkey?: string, i18n: I18n = DEFAULT_I18N, race?: RaceId): GameplayTooltip {
  const def = BUILDING_DEFS[kind];
  const production = [
    ...def.trains.filter(unitKind => !race || !UNIT_DEFS[unitKind].race || UNIT_DEFS[unitKind].race === race).map((unitKind) => labelKind(unitKind, i18n)),
    ...def.researches.map((upgradeKind) => labelKind(upgradeKind, i18n)),
  ];
  return {
    title: labelKind(kind, i18n),
    body: BUILDING_CARDS[kind].description[i18n.locale],
    stats: [
      tooltipLine(i18n.locale, "cost", def.cost),
      tooltipLine(i18n.locale, "build", formatSeconds(def.buildTime)),
      tooltipLine(i18n.locale, "hp", def.hp),
      ...(isHealingBuildingKind(kind) ? [tooltipLine(i18n.locale, "restoresHp", SUPPORT_BUILDING_HEAL), tooltipLine(i18n.locale, "range", def.attackRange), tooltipLine(i18n.locale, "cooldown", formatSeconds(def.attackCooldown))] : []),
      ...(kind === "shipyard" ? [localized(i18n.locale, `维修：每秒 ${DOCK_REPAIR.goldPerSecond} 金恢复 ${DOCK_REPAIR.hpPerSecond} 生命，范围 ${DOCK_REPAIR.range}`, `Repair: ${DOCK_REPAIR.goldPerSecond} gold for ${DOCK_REPAIR.hpPerSecond} HP/s, range ${DOCK_REPAIR.range}`)] : []),
      ...(def.neutralDamageMultiplier !== undefined ? [localized(i18n.locale, `对野怪伤害：${Math.round(def.neutralDamageMultiplier * 100)}%（再计算护甲）`, `Damage to neutral creatures: ${Math.round(def.neutralDamageMultiplier * 100)}% (before armor)`)] : []),
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

/** A live command refusal may already be supplied by its purchase tooltip. */
export function withTooltipRequirement(tooltip: GameplayTooltip, reason: string | undefined): GameplayTooltip {
  if (!reason) return tooltip;
  return { ...tooltip, requirements: [...new Set([reason, ...tooltip.requirements].map(line => line.trim()).filter(Boolean))] };
}

// Ships show physical payload and the separate sheltered crew capacity.
function cargoLines(kind: UnitKind, units: Unit[], snapshot:GameSnapshot, locale: Locale) {
  if(!isShipKind(kind))return [];
  const load=units.reduce((sum,ship)=>sum+shipPassengers(snapshot.units,ship).reduce((n,u)=>n+bodyMass(u),0)+(ship.holdMass ?? 0),0);
  const limit=units.reduce((sum,ship)=>sum+shipProfile(ship)!.loadCapacity,0);
  const profile=shipProfile(units[0]!)!,mounts=shipMounts(units[0]!);
  const cabin=units.reduce((sum,ship)=>{const usage=shipCabinUsage(snapshot,ship);return {used:sum.used+usage.used,capacity:sum.capacity+usage.capacity,required:0};},{used:0,capacity:0,required:0});
  const bows=mounts.filter(mount=>mount.id==='bow').length,sides=mounts.length-bows;
  return [locale==="zh" ? `总载重：${Math.round(load)}/${Math.round(limit)} kg` : `Payload: ${Math.round(load)}/${Math.round(limit)} kg`,
    ...(cabin.capacity?[cabinQuotaText(cabin,locale==='zh')]:[]),
    localized(locale,`空载转向 ${Math.round(profile.turnRate*180/Math.PI)}°/秒；载重和船舵损伤会降低转向`,`${Math.round(profile.turnRate*180/Math.PI)}°/s unloaded; cargo and rudder damage slow turning`),
    localized(locale,`船首 ${bows} 个炮位，舷侧 ${sides} 个${bows?'；船首射界 ±30°，舷侧 ±35°':'；舷侧射界 ±35°'}`,`${bows} bow fittings, ${sides} broadside fittings${bows?'; bow ±30°, broadside ±35°':'; broadside ±35°'}`)];
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
      speed: "Speed {value}/s",
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
      affectsStarredUnits: "Affects non-mechanical starred units.",
      provides: "Provides: {production}.",
      researchAt: "Research at {building}.",
      tierAdvanced: "Advanced unit: needs a supply cap of {cap}.",
      tierElite: "Elite unit: needs a supply cap of {cap}.",
    },
    autocast: {
      on: "Autocast: on",
      off: "Autocast: off",
      mixed: "Autocast: on for some",
      toggle: "Right-click to toggle",
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
      speed: "移速 {value}/秒",
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
      affectsStarredUnits: "影响非机械有星单位。",
      provides: "提供：{production}。",
      researchAt: "在{building}研究。",
      tierAdvanced: "进阶兵种：人口上限需达到 {cap}。",
      tierElite: "高级兵种：人口上限需达到 {cap}。",
    },
    autocast: {
      on: "自动施法：开",
      off: "自动施法：关",
      mixed: "自动施法：部分开启",
      toggle: "右键切换",
    },
  },
} as const;

// What a spell's button needs besides a ready caster ({min} and {max}: a charge's window, filled from the catalog).
const ABILITY_REQUIREMENTS: Record<Locale, Record<AbilityKind, string[]>> = {
  en: {
    veteranRally: ["Learned at three stars; affects nearby allies."],
    veteranHealingWave: ["Learned at three stars; affects nearby injured non-mechanical allies."],
    veteranInnerFire: ["Learned at three stars; affects nearby allies."],
    pinningBolt:["Target an enemy unit or structure."], incendiaryFlume:["Target a point."],
    heal: [],
    summon: ["Target a point; a far one is walked to first."],
    curse: ["Target an enemy unit."],
    emberMend: [],
    cinderSoul: ["Target a point; a far one is walked to first."],
    ashCurse: ["Target an enemy unit."],
    charge: ["Target an enemy unit at least {min} away; a farther one is ridden up to first."],
    stomp: ["Cast by a granite golem on its own."],
    bloodlust: ["Cast by an ogre mage on its own."],
    web: ["Cast by a spider queen on its own."],
  },
  zh: {
    veteranRally: ["三星学习后可用；影响身边友军。"],
    veteranHealingWave: ["三星学习后可用；影响身边受伤的非机械友军。"],
    veteranInnerFire: ["三星学习后可用；影响身边友军。"],
    pinningBolt:["目标必须是敌方单位或建筑。"], incendiaryFlume:["选择燃油弹落点。"],
    heal: [],
    summon: ["目标是一个点位，远了会先走过去。"],
    curse: ["目标必须是敌方单位。"],
    emberMend: [],
    cinderSoul: ["目标是一个点位，远了会先走过去。"],
    ashCurse: ["目标必须是敌方单位。"],
    charge: ["目标是至少 {min} 外的敌方单位，更远的会先骑过去再冲。"],
    stomp: ["花岗岩魔像自己施放。"],
    bloodlust: ["食人魔法师自己施放。"],
    web: ["蛛后自己施放。"],
  },
};

const ITEM_TOOLTIPS: Record<Locale, Record<ItemKind, GameplayTooltip>> = {
  en: {
    shipCannon:{title:"Deck Cannon",body:"A tradable naval weapon. Hauling it takes all four carrying positions; installed guns fire automatically.",stats:[],requirements:["Needs a compatible ship fitting."]},
    shipMortar:{title:"Ship Mortar",body:"A heavy naval siege weapon. Its blast and minimum range are retained when transferred to a compatible ship.",stats:[],requirements:["Needs a compatible ship fitting."]},
    flameProjector:{title:"Flame Projector",body:"A short-range naval weapon. Carries over its condition and cooldown when moved.",stats:[],requirements:["Needs a compatible ship fitting."]},
    issuedWeapon:{title:"Service Weapon",body:"The unit's trained weapon. Stow or exchange it using the four shared carrying positions.",stats:[],requirements:[]},
    leatherArmor:{title:"Leather Armor",body:"Reduces incoming physical damage while worn on the body. Does not reduce magic damage.",stats:[],requirements:[]},
    roundShield:{title:"Round Shield",body:"Reduces incoming physical damage while held. Does not reduce magic damage; cannot be held alongside a two-handed weapon.",stats:[],requirements:[]},
    greatSword:{title:"Greatsword",body:"A melee weapon occupying both hands. Your other weapons stay in their carrying positions.",stats:[],requirements:[]},
    lightningRod: {
      title: "Lightning Rod",
      body: "Strikes an enemy unit, then jumps to nearby enemies with reduced damage.",
      stats: [],
      requirements: ["Needs a visible enemy unit in range."],
    },
    stormStaff: {
      title: "Storm Staff",
      body: "Calls a storm at a target point, damaging enemies on impact and over time.",
      stats: [],
      requirements: ["Target a visible enemy or nearby point."],
    },
    flameCloak: {
      title: "Flame Cloak",
      body: "Passive aura that burns nearby enemies while worn.",
      stats: [],
      requirements: ["Passive item. No manual use."],
    },
    guardianScroll: {
      title: "Guardian Scroll",
      body: "Makes nearby allied units immune to incoming damage for a short time.",
      stats: [],
      requirements: ["Carrier must not be neutral."],
    },
    experienceBook: {
      title: "Experience Book",
      body: "Consumed by the carrier to gain veteran experience immediately.",
      stats: [],
      requirements: ["Carrier must not be neutral."],
    },
    breachCharge: {
      title: "Breach Charge",
      body: "Consumed to blast an enemy building at close range.",
      stats: [],
      requirements: ["Needs an enemy building in range.", "Carrier must not be neutral."],
    },
    speedBoots: {
      title: "Boots of Speed",
      body: "Moves its wearer faster while worn on the feet.",
      stats: [],
      requirements: ["Passive item. No manual use."],
    },
    regenRing: {
      title: "Regeneration Circlet",
      body: "Heals a non-mechanical wearer over time while worn on the head. Has no effect on mechanical units.",
      stats: [],
      requirements: ["Passive item. No manual use."],
    },
    healingScroll: {
      title: "Scroll of Healing",
      body: "Consumed to heal nearby non-mechanical allied units at once. Has no effect on mechanical units.",
      stats: [],
      requirements: ["Carrier must not be neutral."],
    },
    ivoryTower: {
      title: "Ivory Tower",
      body: "Consumed to raise a finished defense tower with partial health near its carrier.",
      stats: [],
      requirements: ["Target open ground near the carrier."],
    },
  },
  zh: {
    shipCannon:{title:"甲板火炮",body:"可以流通的船用武器；搬运占满四个携行位，安装到炮位后自动开火。",stats:[],requirements:["需要兼容炮位和附近的己方人员。"]},
    shipMortar:{title:"舰载臼炮",body:"重型船用攻城武器；转装到兼容船只后保留爆炸效果和最小射程。",stats:[],requirements:["需要兼容炮位和附近的己方人员。"]},
    flameProjector:{title:"喷火装置",body:"近距离船用武器；搬运和换装保留耐久与射击冷却。",stats:[],requirements:["需要兼容炮位和附近的己方人员。"]},
    issuedWeapon:{title:"制式武器",body:"单位训练时配发的武器。可以收起或转交，同样占用四个携行位之一。",stats:[],requirements:[]},
    leatherArmor:{title:"皮甲",body:"穿在身体位置时减少受到的物理伤害，不减免魔法伤害。",stats:[],requirements:[]},
    roundShield:{title:"圆盾",body:"拿在手中时减少受到的物理伤害，不减免魔法伤害；不能和双手武器同时持用。",stats:[],requirements:[]},
    greatSword:{title:"双手剑",body:"占用双手的近战武器；其它武器仍保留在各自的携行位。",stats:[],requirements:[]},
    lightningRod: {
      title: "闪电权杖",
      body: "打击一个敌方单位，然后以较低伤害跳向附近敌人。",
      stats: [],
      requirements: ["需要射程内可见的敌方单位。"],
    },
    stormStaff: {
      title: "风暴法杖",
      body: "在目标点召唤风暴，对敌人造成落点伤害和持续伤害。",
      stats: [],
      requirements: ["目标必须是可见敌人或附近点位。"],
    },
    flameCloak: {
      title: "烈焰斗篷",
      body: "携带时产生被动光环，灼烧附近敌人。",
      stats: [],
      requirements: ["被动物品，无法手动使用。"],
    },
    guardianScroll: {
      title: "守护卷轴",
      body: "短时间保护附近友方单位，免疫受到的伤害。",
      stats: [],
      requirements: ["携带者不能是中立单位。"],
    },
    experienceBook: {
      title: "经验书",
      body: "由携带者消耗，立即获得老兵经验。",
      stats: [],
      requirements: ["携带者不能是中立单位。"],
    },
    breachCharge: {
      title: "破城炸药",
      body: "消耗后近距离爆破一个敌方建筑。",
      stats: [],
      requirements: ["需要射程内敌方建筑。", "携带者不能是中立单位。"],
    },
    speedBoots: {
      title: "速度之靴",
      body: "携带者移速提高。带两双不叠加。",
      stats: [],
      requirements: ["被动物品，无法手动使用。"],
    },
    regenRing: {
      title: "回春头环",
      body: "穿在头部位置时为非机械单位持续恢复生命，对机械单位无效。收进携行位或船舱后停止生效。",
      stats: [],
      requirements: ["被动物品，无法手动使用。"],
    },
    healingScroll: {
      title: "治疗卷轴",
      body: "消耗后，使用者身边的非机械友军立即回血，对机械单位无效。",
      stats: [],
      requirements: ["携带者不能是中立单位。"],
    },
    ivoryTower: {
      title: "象牙塔",
      body: "消耗后，在携带者身边立起一座防御塔（初始生命见数值），立即可用。",
      stats: [],
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
    leadership: "Lets non-mechanical veteran owned units regenerate health based on their star level. Mechanical units require repairs.",
  },
  zh: {
    weaponTraining: "提升普通作战单位的攻击伤害。",
    reinforcedPlating: "提升普通作战单位的最大生命。",
    buildingDurability: "提升己方建筑的最大生命。",
    speedTraining: "提升普通作战单位的移动速度。",
    rangeTraining: "提升普通作战单位的攻击射程，不影响防御塔。",
    leadership: "让己方非机械有星级单位按星级持续回复生命；机械单位需要维修。",
  },
};

function localized(locale: Locale, zh: string, en: string) { return locale === "zh" ? zh : en; }

function unitDescription(kind: UnitKind, i18n: I18n) {
  if (kind in TRAINED_UNIT_CARDS) return TRAINED_UNIT_CARDS[kind as TrainableUnitKind].description[i18n.locale];
  return localized(i18n.locale, UNIT_DEFS[kind].creepFoodPower ? "中立营地守卫；受攻击会呼叫附近同伴，追击受营地范围限制。" : "雇佣兵提供即时支援；临时召唤物会在持续时间结束后消失。", UNIT_DEFS[kind].creepFoodPower ? "Neutral camp guardian. Calls nearby allies when attacked and remains within its camp leash." : "Hired troops provide immediate support; temporary summons expire after their duration.");
}

function unitRuleLines(def: typeof UNIT_DEFS[UnitKind], locale: Locale, level = 0, showStarProgression = true, classification = def.unitClass) {
  const lines: string[] = [classification === "mechanical"
    ? localized(locale, "机械 · 工人维修；治疗和生命回复无效", "Mechanical · worker repairs; no healing or regeneration")
    : unitClassLabel(classification, locale)];
  if(def.naval)lines.push(localized(locale,"攻击舰船优先打可攻击的乘员；命中乘员也会按武器破坏船体。空闲农民会花费金币自动修船。","Ship attacks prioritize reachable crew; hits also damage the hull according to the weapon. Idle workers automatically repair their ship using gold."));
  if (def.rangedDamageTaken !== undefined && def.armor !== 'heavy') lines.push(localized(locale,
    `船体远程／攻城普攻及塔伤害 ${def.rangedDamageTaken * 100}%（含魔法）${def.passengerDamageMultiplier !== undefined ? `；乘员输出 ${def.passengerDamageMultiplier * 100}%` : ''}`,
    `Hull ranged/siege/tower attack damage ${def.rangedDamageTaken * 100}% (including magic)${def.passengerDamageMultiplier !== undefined ? `; passenger damage ${def.passengerDamageMultiplier * 100}%` : ''}`));
  else if (def.passengerDamageMultiplier !== undefined) lines.push(localized(locale, `乘员攻击伤害 ${def.passengerDamageMultiplier * 100}%`, `Passenger attack damage ${def.passengerDamageMultiplier * 100}%`));
  if (def.armor === "heavy") {
    const ranged = Math.min(HEAVY_ARMOR_DAMAGE.rangedUnit, def.rangedDamageTaken ?? 1), tower = Math.min(HEAVY_ARMOR_DAMAGE.tower, def.rangedDamageTaken ?? 1);
    lines.push(localized(locale, `重甲 · 远程／攻城普攻 ×${ranged * 100}%（含魔法），塔 ×${tower * 100}%；主动法术／道具不减伤`, `Heavy armor · ranged/siege attacks ×${ranged * 100}% (including magic), towers ×${tower * 100}%; no reduction to active spells/items`));
  }
  if (def.casterSlayer) lines.push(localized(locale, `对法师／召唤物伤害 ×${def.casterSlayer}`, `Caster/summon damage ×${def.casterSlayer}`));
  if (def.regenPerSecond && classification !== "mechanical") lines.push(localized(locale, `天生回复 ${def.regenPerSecond} 生命/秒`, `Innate regeneration ${def.regenPerSecond} HP/s`));
  if (def.slowOnHit) lines.push(localized(locale, `命中减速至 ${SLOW_PACE * 100}%，持续 ${formatSeconds(SLOW_TICKS)}`, `Hit slows to ${SLOW_PACE * 100}% for ${formatSeconds(SLOW_TICKS)}`));
  if (def.poisonOnHit) lines.push(localized(locale, `中毒 ${POISON_DAMAGE} 伤害/秒，持续 ${formatSeconds(POISON_TICKS)}`, `Poison ${POISON_DAMAGE} damage/s for ${formatSeconds(POISON_TICKS)}`));
  if (def.splash) lines.push(localized(locale, `溅射 ${SPLASH_SHARE * 100}% 伤害，半径 ${SPLASH_RADIUS}`, `Splash ${SPLASH_SHARE * 100}% damage, radius ${SPLASH_RADIUS}`));
  if (def.weapon?.maxHits && def.weapon.maxHits > 1) lines.push(localized(locale, `穿透最多 ${def.weapon.maxHits} 个目标`, `Pierces up to ${def.weapon.maxHits} targets`));
  if (def.weapon?.burst) lines.push(localized(locale, `每轮 ${def.weapon.burst} 发`, `${def.weapon.burst} shots per volley`));
  if (def.goldBounty) lines.push(localized(locale, `击败奖励 ${def.goldBounty} 金`, `Defeat bounty ${def.goldBounty} gold`));
  if (def.xpReward > 0) lines.push(localized(locale, `击杀经验 ${killXpReward(def, level)}`, `Kill reward ${killXpReward(def, level)} XP`));
  if (showStarProgression && def.cost > 0) lines.push(localized(locale, `1/2/3 星累计经验 ${xpStarThresholds(def).join(" / ")}；每星最大生命 +${(VETERANCY_GAIN_PER_STAR * 100).toFixed(1)}%；三星可从三个候选中学习一个技能`, `1/2/3-star XP ${xpStarThresholds(def).join(" / ")}; each star +${(VETERANCY_GAIN_PER_STAR * 100).toFixed(1)}% maximum HP; at three stars choose one of three skills`));
  return lines;
}

function itemStats(kind: ItemKind, locale: Locale) {
  const range = (n: number) => tooltipLine(locale, "range", n);
  const radius = (n: number) => localized(locale, `半径 ${n}`, `Radius ${n}`);
  const consumed = localized(locale, "使用后消耗", "Consumed on use");
  let stats: string[] = [];
  switch (kind) {
    case "lightningRod": stats = [localized(locale, `初始伤害 ${LIGHTNING_ROD.damage}`, `${LIGHTNING_ROD.damage} initial damage`), localized(locale, `最多命中 ${LIGHTNING_ROD.hits} 个目标`, `Up to ${LIGHTNING_ROD.hits} targets`), range(LIGHTNING_ROD.range), localized(locale, `弹跳范围 ${LIGHTNING_ROD.bounceRange}`, `Bounce range ${LIGHTNING_ROD.bounceRange}`), tooltipLine(locale, "cooldown", formatSeconds(LIGHTNING_ROD.cooldown))]; break;
    case "stormStaff": stats = [localized(locale, `落点伤害 ${STORM_STAFF.impactDamage}`, `${STORM_STAFF.impactDamage} impact damage`), localized(locale, `每 ${formatSeconds(STORM_STAFF.pulseEvery)} 造成 ${STORM_STAFF.pulseDamage} 伤害`, `${STORM_STAFF.pulseDamage} damage every ${formatSeconds(STORM_STAFF.pulseEvery)}`), radius(STORM_STAFF.radius), range(STORM_STAFF.range), tooltipLine(locale, "duration", formatSeconds(STORM_STAFF.duration)), tooltipLine(locale, "cooldown", formatSeconds(STORM_STAFF.cooldown))]; break;
    case "flameCloak": stats = [localized(locale, `每 ${formatSeconds(FLAME_CLOAK.interval)} 造成 ${FLAME_CLOAK.damage} 伤害`, `${FLAME_CLOAK.damage} damage every ${formatSeconds(FLAME_CLOAK.interval)}`), radius(FLAME_CLOAK.radius)]; break;
    case "guardianScroll": stats = [radius(GUARDIAN_SCROLL.radius), tooltipLine(locale, "duration", formatSeconds(GUARDIAN_SCROLL.duration)), consumed]; break;
    case "experienceBook": stats = [localized(locale, `获得 ${EXPERIENCE_BOOK_XP} 经验`, `Grants ${EXPERIENCE_BOOK_XP} XP`), consumed]; break;
    case "breachCharge": stats = [localized(locale, `建筑伤害 ${BREACH_CHARGE.damage}`, `${BREACH_CHARGE.damage} building damage`), range(BREACH_CHARGE.range), consumed]; break;
    case "speedBoots": stats = [tooltipLine(locale, "speedBonus", Math.round((BOOTS_SPEED - 1) * 100))]; break;
    case "regenRing": stats = [tooltipLine(locale, "currentRegen", `+${RING_REGEN_PER_SECOND}`)]; break;
    case "healingScroll": stats = [localized(locale, "仅治疗非机械友军", "Heals only non-mechanical allies"), tooltipLine(locale, "restoresHp", HEALING_SCROLL_HEAL), radius(HEALING_SCROLL_RADIUS), consumed]; break;
    case "ivoryTower": stats = [range(IVORY_TOWER_REACH), localized(locale, `初始生命 ${IVORY_TOWER_HP_SHARE * 100}%`, `Starting HP ${IVORY_TOWER_HP_SHARE * 100}%`), consumed]; break;
  }
  if(isShipEquipment(kind)){const weapon=SHIP_WEAPONS[kind];stats.push(tooltipLine(locale,"attack",weapon.damage),range(weapon.range),tooltipLine(locale,"cooldown",formatSeconds(weapon.cooldown)),localized(locale,"占满 4 个携行位／4 个船舱格","Uses all 4 carrying positions / 4 hold cells"));}
  const equipment=ITEM_DEFS[kind];
  const positions={head:["头部","Head"],body:["身体","Body"],legs:["腿部","Legs"],feet:["脚部","Feet"]} as const;
  stats.push(equipment.slot ? localized(locale,`${positions[equipment.slot as keyof typeof positions]?.[0]}穿戴位；也可收在携行位`,`${positions[equipment.slot as keyof typeof positions]?.[1]} equipment; can also be stowed`) : equipment.span===4 ? localized(locale,"搬运时不能持用其它物品","Cannot hold other items while hauling") : localized(locale,`${equipment.hands===2?"双手":"单手"}物品 · 占 1 个携行位`,`${equipment.hands===2?"Two-handed":"One-handed"} · 1 carrying position`));
  if(equipment.protection)stats.push(localized(locale,`物理减伤 ${equipment.protection*100}%`,`${equipment.protection*100}% physical damage reduction`));
  if(equipment.weapon)stats.push(localized(locale,`攻击 ${equipment.weapon.damage} · 射程 ${equipment.weapon.range}`,`Attack ${equipment.weapon.damage} · Range ${equipment.weapon.range}`));
  stats.push(localized(locale,`重量 ${equipment.mass} kg`,`${equipment.mass} kg`));
  const good = SHOP_GOODS.find(good => good.kind === kind);
  if (good) stats.push(tooltipLine(locale, "cost", good.cost), localized(locale, `补货 ${formatSeconds(good.restock)}`, `Restock ${formatSeconds(good.restock)}`));
  return stats;
}
