import type { AbilityKind, BuildingKind, MercenaryUnitKind, RaceId, TrainableUnitKind, UnitKind, UpgradeKind } from "./types";
import { seconds } from "./time";

export const MERCENARY_HIRE_RANGE = 220;

export type UnitDef = {
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
};

export type BuildingDef = {
  hp: number;
  radius: number;
  cost: number;
  buildTime: number;
  trains: TrainableUnitKind[];
  researches: UpgradeKind[];
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  supplyProvided: number;
};

export type UpgradeDef = {
  buildingKind: BuildingKind;
  affectedUnitKinds: TrainableUnitKind[];
  levels: readonly UpgradeLevelDef[];
};

export type UpgradeLevelDef = {
  cost: number;
  researchTime: number;
  attackBonus: number;
  maxHpBonus: number;
  buildingMaxHpMultiplier?: number;
};

export type RaceDef = {
  id: RaceId;
  name: string;
  note: string;
  trainableUnits: TrainableUnitKind[];
  buildableBuildings: BuildingKind[];
  upgrades: UpgradeKind[];
};

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  worker: { hp: 70, speed: 3, radius: 15, attackDamage: 5, attackRange: 36, attackCooldown: seconds(1.7), cost: 75, trainTime: seconds(7), supplyUsed: 1, xpReward: 20, abilities: [] },
  footman: { hp: 145, speed: 3.1, radius: 18, attackDamage: 16, attackRange: 48, attackCooldown: seconds(1.1), cost: 100, trainTime: seconds(8), supplyUsed: 2, xpReward: 32, abilities: [] },
  archer: { hp: 85, speed: 3, radius: 16, attackDamage: 12, attackRange: 190, attackCooldown: seconds(1.5), cost: 105, trainTime: seconds(7.75), supplyUsed: 2, xpReward: 30, abilities: [] },
  raider: { hp: 115, speed: 4.1, radius: 18, attackDamage: 14, attackRange: 48, attackCooldown: seconds(1), cost: 115, trainTime: seconds(8.5), supplyUsed: 2, xpReward: 32, abilities: [] },
  lancer: { hp: 130, speed: 3.4, radius: 18, attackDamage: 18, attackRange: 74, attackCooldown: seconds(1.4), cost: 110, trainTime: seconds(8.75), supplyUsed: 2, xpReward: 34, abilities: [] },
  groveWarden: { hp: 165, speed: 3.0, radius: 19, attackDamage: 15, attackRange: 52, attackCooldown: seconds(1.15), cost: 120, trainTime: seconds(9), supplyUsed: 2, xpReward: 36, abilities: [] },
  emberRavager: { hp: 118, speed: 3.8, radius: 18, attackDamage: 20, attackRange: 52, attackCooldown: seconds(1.25), cost: 120, trainTime: seconds(9), supplyUsed: 2, xpReward: 36, abilities: [] },
  knight: { hp: 220, speed: 3.6, radius: 22, attackDamage: 24, attackRange: 52, attackCooldown: seconds(1.3), cost: 190, trainTime: seconds(11.5), supplyUsed: 3, xpReward: 45, abilities: [] },
  priest: { hp: 90, speed: 3, radius: 16, attackDamage: 6, attackRange: 120, attackCooldown: seconds(1.8), cost: 135, trainTime: seconds(9.25), supplyUsed: 2, xpReward: 35, abilities: ["heal"] },
  summoner: { hp: 95, speed: 2.8, radius: 17, attackDamage: 7, attackRange: 130, attackCooldown: seconds(1.9), cost: 150, trainTime: seconds(10.5), supplyUsed: 2, xpReward: 35, abilities: ["summon"] },
  witch: { hp: 92, speed: 3.1, radius: 16, attackDamage: 8, attackRange: 150, attackCooldown: seconds(1.7), cost: 145, trainTime: seconds(9.75), supplyUsed: 2, xpReward: 35, abilities: ["curse"] },
  golem: { hp: 340, speed: 2.1, radius: 28, attackDamage: 34, attackRange: 58, attackCooldown: seconds(2.1), cost: 230, trainTime: seconds(14), supplyUsed: 4, xpReward: 60, abilities: [] },
  spirit: { hp: 85, speed: 3.5, radius: 15, attackDamage: 13, attackRange: 55, attackCooldown: seconds(1.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 0, abilities: [] },
  mercenary: { hp: 155, speed: 3.7, radius: 18, attackDamage: 28, attackRange: 62, attackCooldown: seconds(0.9), cost: 160, trainTime: seconds(0.05), supplyUsed: 2, xpReward: 36, abilities: [] },
  contractArcher: { hp: 95, speed: 3.2, radius: 16, attackDamage: 17, attackRange: 210, attackCooldown: seconds(1.35), cost: 145, trainTime: seconds(0.05), supplyUsed: 2, xpReward: 34, abilities: [] },
  fieldMedic: { hp: 105, speed: 3.1, radius: 16, attackDamage: 7, attackRange: 125, attackCooldown: seconds(1.7), cost: 155, trainTime: seconds(0.05), supplyUsed: 2, xpReward: 36, abilities: ["heal"] },
  wildling: { hp: 76, speed: 2.5, radius: 17, attackDamage: 7, attackRange: 42, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 18, creepFoodPower: 1, goldBounty: 20, abilities: [] },
  mossGnawer: { hp: 54, speed: 3.4, radius: 13, attackDamage: 6, attackRange: 34, attackCooldown: seconds(1.3), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 12, creepFoodPower: 1, goldBounty: 20, abilities: [] },
  thornSlinger: { hp: 72, speed: 2.8, radius: 15, attackDamage: 10, attackRange: 165, attackCooldown: seconds(1.7), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 22, creepFoodPower: 2, goldBounty: 35, abilities: [] },
  barkMender: { hp: 68, speed: 2.6, radius: 15, attackDamage: 5, attackRange: 110, attackCooldown: seconds(2.1), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 24, creepFoodPower: 2, goldBounty: 35, abilities: ["heal"] },
  stonebackBrute: { hp: 210, speed: 2.0, radius: 24, attackDamage: 22, attackRange: 48, attackCooldown: seconds(1.9), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 42, creepFoodPower: 3, goldBounty: 50, abilities: [] },
  gladeWitch: { hp: 110, speed: 2.7, radius: 17, attackDamage: 9, attackRange: 150, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 42, creepFoodPower: 3, goldBounty: 50, abilities: ["curse"] },
  ancientStag: { hp: 360, speed: 3.1, radius: 28, attackDamage: 32, attackRange: 68, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, xpReward: 70, creepFoodPower: 5, goldBounty: 85, abilities: [] },
};

export const MERCENARY_UNIT_KINDS: MercenaryUnitKind[] = ["mercenary", "contractArcher", "fieldMedic"];

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  townHall: { hp: 900, radius: 48, cost: 320, buildTime: seconds(28), trains: ["worker"], researches: ["buildingDurability"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 10 },
  barracks: { hp: 620, radius: 40, cost: 170, buildTime: seconds(11), trains: ["footman", "lancer", "groveWarden", "emberRavager"], researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  archeryRange: { hp: 520, radius: 38, cost: 150, buildTime: seconds(10), trains: ["archer"], researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  stables: { hp: 560, radius: 42, cost: 175, buildTime: seconds(11.5), trains: ["raider", "knight"], researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  sanctum: { hp: 500, radius: 38, cost: 175, buildTime: seconds(11.25), trains: ["priest", "summoner", "witch"], researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  workshop: { hp: 580, radius: 42, cost: 205, buildTime: seconds(12.5), trains: ["golem"], researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  defenseTower: { hp: 160, radius: 30, cost: 125, buildTime: seconds(6.5), trains: [], researches: [], attackDamage: 10, attackRange: 270, attackCooldown: seconds(1.5), supplyProvided: 0 },
  moonWell: { hp: 300, radius: 30, cost: 115, buildTime: seconds(8.5), trains: [], researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  farm: { hp: 320, radius: 30, cost: 65, buildTime: seconds(7), trains: [], researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 6 },
};

const ORDINARY_COMBAT_UNITS: TrainableUnitKind[] = ["footman", "archer", "raider", "lancer", "groveWarden", "emberRavager", "knight", "priest", "summoner", "witch", "golem"];

export const UPGRADE_DEFS: Record<UpgradeKind, UpgradeDef> = {
  weaponTraining: {
    buildingKind: "barracks",
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 280, researchTime: seconds(11.5), attackBonus: 2, maxHpBonus: 0 },
      { cost: 430, researchTime: seconds(15.5), attackBonus: 3, maxHpBonus: 0 },
      { cost: 640, researchTime: seconds(20), attackBonus: 3, maxHpBonus: 0 },
    ],
  },
  reinforcedPlating: {
    buildingKind: "barracks",
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 330, researchTime: seconds(13.5), attackBonus: 0, maxHpBonus: 10 },
      { cost: 500, researchTime: seconds(17.5), attackBonus: 0, maxHpBonus: 15 },
      { cost: 720, researchTime: seconds(22), attackBonus: 0, maxHpBonus: 20 },
    ],
  },
  buildingDurability: {
    buildingKind: "townHall",
    affectedUnitKinds: [],
    levels: [
      { cost: 520, researchTime: seconds(18), attackBonus: 0, maxHpBonus: 0, buildingMaxHpMultiplier: 1.2 },
    ],
  },
};

export const UPGRADE_KINDS: UpgradeKind[] = ["weaponTraining", "reinforcedPlating", "buildingDurability"];
export const MAX_UPGRADE_LEVEL = 3;
export function maxUpgradeLevel(upgradeKind: UpgradeKind) {
  return UPGRADE_DEFS[upgradeKind].levels.length;
}
export const XP_STAR_THRESHOLDS = [60, 130, 260] as const;

export const TRAINABLE_UNIT_KINDS: TrainableUnitKind[] = [
  "worker",
  "footman",
  "archer",
  "raider",
  "lancer",
  "groveWarden",
  "emberRavager",
  "knight",
  "priest",
  "summoner",
  "witch",
  "golem",
];

export const BUILDABLE_BUILDING_KINDS: BuildingKind[] = [
  "townHall",
  "barracks",
  "archeryRange",
  "stables",
  "sanctum",
  "workshop",
  "defenseTower",
  "moonWell",
  "farm",
];

export const RACE_IDS: RaceId[] = ["grove", "ember"];

export const RACE_DEFS: Record<RaceId, RaceDef> = {
  grove: {
    id: "grove",
    name: "Grove Kin",
    note: "Grass-paper clan with the current shared prototype tech tree.",
    trainableUnits: TRAINABLE_UNIT_KINDS.filter((kind) => kind !== "emberRavager"),
    buildableBuildings: BUILDABLE_BUILDING_KINDS,
    upgrades: UPGRADE_KINDS,
  },
  ember: {
    id: "ember",
    name: "Ember Pact",
    note: "Ember-themed clan with the current shared prototype tech tree.",
    trainableUnits: TRAINABLE_UNIT_KINDS.filter((kind) => kind !== "groveWarden"),
    buildableBuildings: BUILDABLE_BUILDING_KINDS,
    upgrades: UPGRADE_KINDS,
  },
};
