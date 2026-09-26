import type { AbilityKind, BuildingKind, MercenaryUnitKind, RaceId, TrainableUnitKind, UnitKind, UpgradeKind } from "./types";
import { seconds } from "./time";

export const MERCENARY_HIRE_RANGE = 220;

// @@@catalog-rules - A unit's rules say where it comes from: the building that trains it and the race that owns it (no
// race: every race). Unit kinds, each building's training list, each race's units and buildings, and the lists command
// validation checks against are all derived from these rows, so a new unit or building is one row here (plus its card
// in client/content for how it looks); nothing else in shared/ needs to be told.
export type UnitDef = {
  trainedAt?: BuildingKind;
  race?: RaceId;
  hp: number;
  speed: number;
  radius: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  cost: number;
  trainTime: number;
  supplyUsed: number;
  xpReward: number;
  creepFoodPower?: number;
  goldBounty?: number;
  abilities: AbilityKind[];
  armor?: "heavy";
  // Damage multiplier against summoned units and casters (units with an ability).
  casterSlayer?: number;
  // Innate health regeneration, on top of leadership's.
  regenPerSecond?: number;
  // Advanced (2) and elite (3) units; see TIER_SUPPLY_CAP. No tier: trainable from the start.
  tier?: 2 | 3;
};

// @@@unit-tiers - Advanced and elite units are locked until the player's supply cap (halls and farms built, not supply in
// use) reaches a bar: the tech a player buys is supply, the way a Warcraft III player buys a keep and a castle. Early
// fights are fought with the basic line (footmen, archers, ravagers, runners, spark archers). Measured over 16 AI games
// at a farm's 120 gold: V6, which buys farms ahead of need, fields its first caster at about 5:00, V3 and V5 their first
// advanced unit at 7:00-8:30; no AI reached the elite bar inside 12 minutes.
export const TIER_SUPPLY_CAP = { 2: 42, 3: 60 } as const;

// Heavy armor (knights, golems, ash chieftains and cinder revenants): a shooter's or caster's attack deals half damage, a defense
// tower's 70%. Melee blows land in full.
export const HEAVY_ARMOR_DAMAGE = { rangedUnit: 0.5, tower: 0.7 } as const;

export type AbilityDef =
  | { behavior: "heal"; range: number; plannerRange: number; cooldown: number; healAmount: number; effectType: "heal" }
  | { behavior: "summon"; range: number; plannerRange: number; cooldown: number; summonKind: UnitKind; summonDuration: number; effectType: "summon" }
  | {
      behavior: "curse";
      range: number;
      plannerRange: number;
      cooldown: number;
      effectDuration: number;
      damageMultiplier: number;
      scorchedDamageMultiplier?: number;
      // Damage dealt at once to a summoned target (a spirit has 85 hp): the witch's answer to a summoner's free army.
      summonedDamage?: number;
      statusType: "curse";
      effectType: "curse" | "scorch";
    };

export type BuildingRules = {
  race?: RaceId;
  hp: number;
  radius: number;
  cost: number;
  buildTime: number;
  researches: UpgradeKind[];
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  supplyProvided: number;
};

// What the building trains is derived from the units' trainedAt, in catalog order.
export type BuildingDef = BuildingRules & { trains: TrainableUnitKind[] };

export type UpgradeDef = {
  researchBuildingKinds: BuildingKind[];
  affectedUnitKinds: TrainableUnitKind[];
  levels: readonly UpgradeLevelDef[];
};

export type UpgradeLevelDef = {
  cost: number;
  researchTime: number;
  attackBonus: number;
  maxHpBonus: number;
  buildingMaxHpMultiplier?: number;
  speedMultiplier?: number;
  attackRangeMultiplier?: number;
  veteranRegenPerStar?: number;
};

export type RaceDef = {
  id: RaceId;
  name: string;
  note: string;
  trainableUnits: TrainableUnitKind[];
  buildableBuildings: BuildingKind[];
  upgrades: UpgradeKind[];
};

export const UNIT_RULES = {
  worker: { trainedAt: "townHall", hp: 70, speed: 3, radius: 15, attackDamage: 10, attackRange: 36, attackCooldown: seconds(1.7), cost: 75, trainTime: seconds(7), supplyUsed: 1, xpReward: 20, abilities: [] },
  footman: { trainedAt: "barracks", race: "grove", hp: 145, speed: 3.1, radius: 18, attackDamage: 16, attackRange: 48, attackCooldown: seconds(1.1), cost: 100, trainTime: seconds(8), supplyUsed: 2, xpReward: 32, abilities: [] },
  archer: { trainedAt: "archeryRange", race: "grove", hp: 72, speed: 3, radius: 16, attackDamage: 13, attackRange: 399, attackCooldown: seconds(1.5), cost: 115, trainTime: seconds(7.75), supplyUsed: 2, xpReward: 30, abilities: [] },
  raider: { trainedAt: "stables", race: "grove", hp: 115, speed: 4.1, radius: 18, attackDamage: 14, attackRange: 48, attackCooldown: seconds(1), cost: 115, trainTime: seconds(8.5), supplyUsed: 2, xpReward: 32, abilities: [], tier: 2 },
  lancer: { trainedAt: "barracks", race: "grove", hp: 130, speed: 3.4, radius: 18, attackDamage: 18, attackRange: 74, attackCooldown: seconds(1.4), cost: 110, trainTime: seconds(8.75), supplyUsed: 2, xpReward: 34, abilities: [] },
  groveWarden: { trainedAt: "barracks", race: "grove", hp: 165, speed: 3.0, radius: 19, attackDamage: 15, attackRange: 52, attackCooldown: seconds(1.15), cost: 120, trainTime: seconds(9), supplyUsed: 2, xpReward: 36, abilities: [] },
  emberRavager: { trainedAt: "emberForge", race: "ember", hp: 118, speed: 3.8, radius: 18, attackDamage: 20, attackRange: 52, attackCooldown: seconds(1.25), cost: 120, trainTime: seconds(9), supplyUsed: 2, xpReward: 36, abilities: [] },
  cinderRunner: { trainedAt: "emberForge", race: "ember", hp: 96, speed: 4.35, radius: 17, attackDamage: 14, attackRange: 48, attackCooldown: seconds(0.95), cost: 110, trainTime: seconds(8), supplyUsed: 2, xpReward: 32, abilities: [] },
  sparkArcher: { trainedAt: "cinderSpire", race: "ember", hp: 65, speed: 3.15, radius: 16, attackDamage: 12, attackRange: 360, attackCooldown: seconds(1.35), cost: 110, trainTime: seconds(7.25), supplyUsed: 2, xpReward: 30, abilities: [] },
  emberAcolyte: { trainedAt: "cinderSpire", race: "ember", hp: 78, speed: 3.1, radius: 16, attackDamage: 6, attackRange: 240, attackCooldown: seconds(1.8), cost: 130, trainTime: seconds(8.75), supplyUsed: 2, xpReward: 34, abilities: ["emberMend"], tier: 2 },
  ashHexer: { trainedAt: "cinderSpire", race: "ember", hp: 82, speed: 3.2, radius: 16, attackDamage: 7, attackRange: 300, attackCooldown: seconds(1.7), cost: 140, trainTime: seconds(9), supplyUsed: 2, xpReward: 34, abilities: ["ashCurse"], tier: 2 },
  pyreCaller: { trainedAt: "cinderSpire", race: "ember", hp: 88, speed: 2.95, radius: 17, attackDamage: 7, attackRange: 260, attackCooldown: seconds(1.9), cost: 174, trainTime: seconds(9.5), supplyUsed: 2, xpReward: 35, abilities: ["cinderSoul"], tier: 2 },
  knight: { trainedAt: "stables", race: "grove", hp: 220, speed: 3.6, radius: 22, attackDamage: 24, attackRange: 52, attackCooldown: seconds(1.3), cost: 190, trainTime: seconds(11.5), supplyUsed: 3, xpReward: 45, abilities: [], armor: "heavy", tier: 3 },
  priest: { trainedAt: "sanctum", race: "grove", hp: 90, speed: 3, radius: 16, attackDamage: 7, attackRange: 252, attackCooldown: seconds(1.8), cost: 135, trainTime: seconds(9.25), supplyUsed: 2, xpReward: 35, abilities: ["heal"], tier: 2 },
  summoner: { trainedAt: "sanctum", race: "grove", hp: 95, speed: 2.8, radius: 17, attackDamage: 8, attackRange: 273, attackCooldown: seconds(1.9), cost: 180, trainTime: seconds(10.5), supplyUsed: 2, xpReward: 35, abilities: ["summon"], tier: 2 },
  witch: { trainedAt: "sanctum", race: "grove", hp: 92, speed: 3.1, radius: 16, attackDamage: 8, attackRange: 315, attackCooldown: seconds(1.7), cost: 145, trainTime: seconds(9.75), supplyUsed: 2, xpReward: 35, abilities: ["curse"], tier: 2 },
  golem: { trainedAt: "workshop", race: "grove", hp: 340, speed: 2.1, radius: 28, attackDamage: 34, attackRange: 58, attackCooldown: seconds(2.1), cost: 230, trainTime: seconds(14), supplyUsed: 4, xpReward: 60, abilities: [], armor: "heavy", tier: 3 },
  // Ember's heavies, raised in the ashen hall and heavy-armored like the grove's knight and golem, but built for
  // other jobs. The chieftain hunts casters and what they summon (half again as much damage to both); the revenant is
  // light for an elite and burns its wounds away, back to full health in about twenty seconds.
  ashChieftain: { trainedAt: "ashenHall", race: "ember", hp: 210, speed: 3.3, radius: 20, attackDamage: 22, attackRange: 52, attackCooldown: seconds(1.2), cost: 190, trainTime: seconds(11), supplyUsed: 3, xpReward: 45, abilities: [], armor: "heavy", casterSlayer: 1.5, tier: 3 },
  cinderRevenant: { trainedAt: "ashenHall", race: "ember", hp: 150, speed: 3.5, radius: 19, attackDamage: 21, attackRange: 52, attackCooldown: seconds(1.15), cost: 210, trainTime: seconds(12), supplyUsed: 3, xpReward: 50, abilities: [], armor: "heavy", regenPerSecond: 7, tier: 3 },
  spirit: { hp: 85, speed: 3.5, radius: 15, attackDamage: 13, attackRange: 55, attackCooldown: seconds(1.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 0, abilities: [] },
  mercenary: { hp: 155, speed: 3.7, radius: 18, attackDamage: 28, attackRange: 62, attackCooldown: seconds(0.9), cost: 160, trainTime: seconds(0.05), supplyUsed: 2, xpReward: 36, abilities: [] },
  contractArcher: { hp: 81, speed: 3.2, radius: 16, attackDamage: 19, attackRange: 441, attackCooldown: seconds(1.35), cost: 145, trainTime: seconds(0.05), supplyUsed: 2, xpReward: 34, abilities: [] },
  fieldMedic: { hp: 105, speed: 3.1, radius: 16, attackDamage: 8, attackRange: 263, attackCooldown: seconds(1.7), cost: 155, trainTime: seconds(0.05), supplyUsed: 2, xpReward: 36, abilities: ["heal"] },
  wildling: { hp: 76, speed: 2.5, radius: 15, attackDamage: 7, attackRange: 42, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 18, creepFoodPower: 1, goldBounty: 20, abilities: [] },
  mossGnawer: { hp: 54, speed: 3.4, radius: 13, attackDamage: 6, attackRange: 34, attackCooldown: seconds(1.3), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 12, creepFoodPower: 1, goldBounty: 20, abilities: [] },
  thornSlinger: { hp: 72, speed: 2.8, radius: 18, attackDamage: 10, attackRange: 165, attackCooldown: seconds(1.7), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 22, creepFoodPower: 2, goldBounty: 35, abilities: [] },
  barkMender: { hp: 68, speed: 2.6, radius: 18, attackDamage: 5, attackRange: 110, attackCooldown: seconds(2.1), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 24, creepFoodPower: 2, goldBounty: 35, abilities: ["heal"] },
  stonebackBrute: { hp: 210, speed: 2.0, radius: 24, attackDamage: 22, attackRange: 48, attackCooldown: seconds(1.9), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 42, creepFoodPower: 3, goldBounty: 50, abilities: [] },
  gladeWitch: { hp: 110, speed: 2.7, radius: 22, attackDamage: 9, attackRange: 150, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 42, creepFoodPower: 3, goldBounty: 50, abilities: ["curse"] },
  ancientStag: { hp: 360, speed: 3.1, radius: 32, attackDamage: 32, attackRange: 68, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 70, creepFoodPower: 5, goldBounty: 85, abilities: [] },
} satisfies Record<string, UnitDef>;

export const UNIT_DEFS: Record<UnitKind, UnitDef> = UNIT_RULES;

// The supply cap a player needs before it can train this kind (0 for the basic line, workers and hired units).
export function requiredSupplyCap(kind: UnitKind): number {
  const tier = UNIT_DEFS[kind].tier;
  return tier ? TIER_SUPPLY_CAP[tier] : 0;
}
const UNIT_KINDS = Object.keys(UNIT_DEFS) as UnitKind[];

export const TRAINABLE_UNIT_KINDS = UNIT_KINDS.filter((kind) => UNIT_DEFS[kind].trainedAt !== undefined) as TrainableUnitKind[];

export const MERCENARY_UNIT_KINDS: MercenaryUnitKind[] = ["mercenary", "contractArcher", "fieldMedic"];

export const ABILITY_KINDS: AbilityKind[] = ["heal", "summon", "curse", "emberMend", "cinderSoul", "ashCurse"];

export const ABILITY_DEFS: Record<AbilityKind, AbilityDef> = {
  heal: { behavior: "heal", range: 240, plannerRange: 220, cooldown: seconds(6), healAmount: 55, effectType: "heal" },
  summon: { behavior: "summon", range: 260, plannerRange: 240, cooldown: seconds(40), summonKind: "spirit", summonDuration: seconds(60), effectType: "summon" },
  curse: { behavior: "curse", range: 280, plannerRange: 260, cooldown: seconds(7.5), effectDuration: seconds(18), damageMultiplier: 0.4, summonedDamage: 100, statusType: "curse", effectType: "curse" },
  emberMend: { behavior: "heal", range: 240, plannerRange: 220, cooldown: seconds(6), healAmount: 55, effectType: "heal" },
  cinderSoul: { behavior: "summon", range: 260, plannerRange: 240, cooldown: seconds(40), summonKind: "spirit", summonDuration: seconds(60), effectType: "summon" },
  ashCurse: { behavior: "curse", range: 280, plannerRange: 260, cooldown: seconds(7.5), effectDuration: seconds(18), damageMultiplier: 0.45, scorchedDamageMultiplier: 0.3, statusType: "curse", effectType: "scorch" },
};

export const BUILDING_RULES = {
  townHall: { hp: 900, radius: 48, cost: 400, buildTime: seconds(28), researches: ["buildingDurability"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 8 },
  barracks: { race: "grove", hp: 620, radius: 40, cost: 170, buildTime: seconds(11), researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  archeryRange: { race: "grove", hp: 520, radius: 38, cost: 150, buildTime: seconds(10), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  stables: { race: "grove", hp: 560, radius: 42, cost: 175, buildTime: seconds(11.5), researches: ["speedTraining"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  sanctum: { race: "grove", hp: 500, radius: 38, cost: 175, buildTime: seconds(11.25), researches: ["leadership"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  workshop: { race: "grove", hp: 580, radius: 42, cost: 205, buildTime: seconds(12.5), researches: ["rangeTraining"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  defenseTower: { hp: 200, radius: 30, cost: 125, buildTime: seconds(6.5), researches: [], attackDamage: 16, attackRange: 480, attackCooldown: seconds(1.5), supplyProvided: 0 },
  moonWell: { race: "grove", hp: 300, radius: 30, cost: 115, buildTime: seconds(8.5), researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  emberForge: { race: "ember", hp: 560, radius: 40, cost: 165, buildTime: seconds(10.5), researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  cinderSpire: { race: "ember", hp: 500, radius: 38, cost: 170, buildTime: seconds(10.75), researches: ["speedTraining", "rangeTraining", "leadership"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  emberShrine: { race: "ember", hp: 280, radius: 30, cost: 115, buildTime: seconds(8.5), researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  // Ember's heavy-unit hall, its stables and workshop in one: one building for both heavies, priced above either.
  ashenHall: { race: "ember", hp: 600, radius: 42, cost: 215, buildTime: seconds(13), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  // Supply is the tech (see unit-tiers), so it is dear: a farm's 6 cost 120, a hall's 8 are priced the same inside its 400.
  farm: { hp: 320, radius: 30, cost: 120, buildTime: seconds(7), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 6 },
} satisfies Record<string, BuildingRules>;

export const BUILDABLE_BUILDING_KINDS = Object.keys(BUILDING_RULES) as BuildingKind[];

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = Object.fromEntries(
  BUILDABLE_BUILDING_KINDS.map((kind) => [kind, { ...BUILDING_RULES[kind], trains: TRAINABLE_UNIT_KINDS.filter((unit) => UNIT_DEFS[unit].trainedAt === kind) }]),
) as Record<BuildingKind, BuildingDef>;

const ORDINARY_COMBAT_UNITS = TRAINABLE_UNIT_KINDS.filter((kind) => kind !== "worker");

export const UPGRADE_DEFS: Record<UpgradeKind, UpgradeDef> = {
  weaponTraining: {
    researchBuildingKinds: ["barracks", "emberForge"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 140, researchTime: seconds(34.5), attackBonus: 2, maxHpBonus: 0 },
      { cost: 215, researchTime: seconds(46.5), attackBonus: 3, maxHpBonus: 0 },
      { cost: 320, researchTime: seconds(60), attackBonus: 3, maxHpBonus: 0 },
    ],
  },
  reinforcedPlating: {
    researchBuildingKinds: ["barracks", "emberForge"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 165, researchTime: seconds(40.5), attackBonus: 0, maxHpBonus: 10 },
      { cost: 250, researchTime: seconds(52.5), attackBonus: 0, maxHpBonus: 15 },
      { cost: 360, researchTime: seconds(66), attackBonus: 0, maxHpBonus: 20 },
    ],
  },
  buildingDurability: {
    researchBuildingKinds: ["townHall"],
    affectedUnitKinds: [],
    levels: [
      { cost: 260, researchTime: seconds(54), attackBonus: 0, maxHpBonus: 0, buildingMaxHpMultiplier: 1.2 },
    ],
  },
  speedTraining: {
    researchBuildingKinds: ["stables", "cinderSpire"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 185, researchTime: seconds(46), attackBonus: 0, maxHpBonus: 0, speedMultiplier: 1.25 },
      { cost: 285, researchTime: seconds(60), attackBonus: 0, maxHpBonus: 0, speedMultiplier: 1.38 },
      { cost: 420, researchTime: seconds(76), attackBonus: 0, maxHpBonus: 0, speedMultiplier: 1.5 },
    ],
  },
  rangeTraining: {
    researchBuildingKinds: ["workshop", "cinderSpire"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 195, researchTime: seconds(48), attackBonus: 0, maxHpBonus: 0, attackRangeMultiplier: 1.15 },
      { cost: 305, researchTime: seconds(64), attackBonus: 0, maxHpBonus: 0, attackRangeMultiplier: 1.25 },
      { cost: 450, researchTime: seconds(82), attackBonus: 0, maxHpBonus: 0, attackRangeMultiplier: 1.35 },
    ],
  },
  leadership: {
    researchBuildingKinds: ["sanctum", "cinderSpire"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 220, researchTime: seconds(52), attackBonus: 0, maxHpBonus: 0, veteranRegenPerStar: 1 },
      { cost: 340, researchTime: seconds(70), attackBonus: 0, maxHpBonus: 0, veteranRegenPerStar: 2 },
      { cost: 500, researchTime: seconds(90), attackBonus: 0, maxHpBonus: 0, veteranRegenPerStar: 3 },
    ],
  },
};

export const UPGRADE_KINDS: UpgradeKind[] = ["weaponTraining", "reinforcedPlating", "buildingDurability", "speedTraining", "rangeTraining", "leadership"];
export const MAX_UPGRADE_LEVEL = 3;
export function maxUpgradeLevel(upgradeKind: UpgradeKind) {
  return UPGRADE_DEFS[upgradeKind].levels.length;
}
export const XP_STAR_THRESHOLDS = [60, 130, 260] as const;

export const RACE_IDS: RaceId[] = ["grove", "ember"];

function raceDef(id: RaceId, name: string, note: string): RaceDef {
  const owns = (race: RaceId | undefined) => race === undefined || race === id;
  return {
    id,
    name,
    note,
    trainableUnits: TRAINABLE_UNIT_KINDS.filter((kind) => owns(UNIT_DEFS[kind].race)),
    buildableBuildings: BUILDABLE_BUILDING_KINDS.filter((kind) => owns(BUILDING_DEFS[kind].race)),
    upgrades: UPGRADE_KINDS,
  };
}

export const RACE_DEFS: Record<RaceId, RaceDef> = {
  grove: raceDef("grove", "Grove Kin", "Durable line holders, conventional ranged units, heavy tech, and moon-well recovery."),
  ember: raceDef("ember", "Ember Pact", "Faster fragile fighters, early support casters, ashen-hall heavies, and ember-shrine recovery."),
};

export const HEALING_BUILDING_KINDS: BuildingKind[] = ["moonWell", "emberShrine"];

export function isHealingBuildingKind(kind: string): kind is BuildingKind {
  return (HEALING_BUILDING_KINDS as readonly string[]).includes(kind);
}

export function healingBuildingKindForRace(race: RaceId): BuildingKind {
  return race === "ember" ? "emberShrine" : "moonWell";
}
