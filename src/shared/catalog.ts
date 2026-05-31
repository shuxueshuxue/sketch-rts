import type { AbilityKind, BuildingKind, RaceId, TrainableUnitKind, UnitKind } from "./types";

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
  abilities: AbilityKind[];
};

export type BuildingDef = {
  hp: number;
  radius: number;
  cost: number;
  buildTime: number;
  trains: TrainableUnitKind[];
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  supplyProvided: number;
};

export type RaceDef = {
  id: RaceId;
  name: string;
  note: string;
  productionPlan: Exclude<BuildingKind, "townHall" | "farm" | "defenseTower">[];
  preferredUnits: TrainableUnitKind[];
};

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  worker: { hp: 70, speed: 3, radius: 15, attackDamage: 5, attackRange: 36, attackCooldown: 34, cost: 90, trainTime: 150, supplyUsed: 1, xpReward: 20, abilities: [] },
  footman: { hp: 145, speed: 3.1, radius: 18, attackDamage: 16, attackRange: 48, attackCooldown: 22, cost: 120, trainTime: 180, supplyUsed: 2, xpReward: 32, abilities: [] },
  archer: { hp: 85, speed: 3, radius: 16, attackDamage: 12, attackRange: 190, attackCooldown: 30, cost: 130, trainTime: 170, supplyUsed: 2, xpReward: 30, abilities: [] },
  raider: { hp: 115, speed: 4.1, radius: 18, attackDamage: 14, attackRange: 48, attackCooldown: 20, cost: 145, trainTime: 190, supplyUsed: 2, xpReward: 32, abilities: [] },
  lancer: { hp: 130, speed: 3.4, radius: 18, attackDamage: 18, attackRange: 74, attackCooldown: 28, cost: 155, trainTime: 200, supplyUsed: 2, xpReward: 34, abilities: [] },
  knight: { hp: 220, speed: 3.6, radius: 22, attackDamage: 24, attackRange: 52, attackCooldown: 26, cost: 240, trainTime: 260, supplyUsed: 3, xpReward: 45, abilities: [] },
  priest: { hp: 90, speed: 3, radius: 16, attackDamage: 6, attackRange: 120, attackCooldown: 36, cost: 170, trainTime: 210, supplyUsed: 2, xpReward: 35, abilities: ["heal"] },
  summoner: { hp: 95, speed: 2.8, radius: 17, attackDamage: 7, attackRange: 130, attackCooldown: 38, cost: 190, trainTime: 240, supplyUsed: 2, xpReward: 35, abilities: ["summon"] },
  witch: { hp: 92, speed: 3.1, radius: 16, attackDamage: 8, attackRange: 150, attackCooldown: 34, cost: 180, trainTime: 220, supplyUsed: 2, xpReward: 35, abilities: ["curse"] },
  golem: { hp: 340, speed: 2.1, radius: 28, attackDamage: 34, attackRange: 58, attackCooldown: 42, cost: 310, trainTime: 320, supplyUsed: 4, xpReward: 60, abilities: [] },
  spirit: { hp: 85, speed: 3.5, radius: 15, attackDamage: 13, attackRange: 55, attackCooldown: 24, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 0, abilities: [] },
  mercenary: { hp: 155, speed: 3.7, radius: 18, attackDamage: 28, attackRange: 62, attackCooldown: 18, cost: 185, trainTime: 1, supplyUsed: 2, xpReward: 36, abilities: [] },
  wildling: { hp: 76, speed: 2.5, radius: 17, attackDamage: 7, attackRange: 42, attackCooldown: 40, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 18, creepFoodPower: 1, abilities: [] },
  mossGnawer: { hp: 54, speed: 3.4, radius: 13, attackDamage: 6, attackRange: 34, attackCooldown: 26, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 12, creepFoodPower: 1, abilities: [] },
  thornSlinger: { hp: 72, speed: 2.8, radius: 15, attackDamage: 10, attackRange: 165, attackCooldown: 34, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 22, creepFoodPower: 2, abilities: [] },
  barkMender: { hp: 68, speed: 2.6, radius: 15, attackDamage: 5, attackRange: 110, attackCooldown: 42, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 24, creepFoodPower: 2, abilities: ["heal"] },
  stonebackBrute: { hp: 210, speed: 2.0, radius: 24, attackDamage: 22, attackRange: 48, attackCooldown: 38, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 42, creepFoodPower: 3, abilities: [] },
  gladeWitch: { hp: 110, speed: 2.7, radius: 17, attackDamage: 9, attackRange: 150, attackCooldown: 36, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 42, creepFoodPower: 3, abilities: ["curse"] },
  ancientStag: { hp: 360, speed: 3.1, radius: 28, attackDamage: 32, attackRange: 68, attackCooldown: 30, cost: 0, trainTime: 1, supplyUsed: 0, xpReward: 70, creepFoodPower: 5, abilities: [] },
};

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  townHall: { hp: 900, radius: 48, cost: 390, buildTime: 360, trains: ["worker"], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 10 },
  barracks: { hp: 620, radius: 40, cost: 220, buildTime: 240, trains: ["footman", "lancer"], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 0 },
  archeryRange: { hp: 520, radius: 38, cost: 190, buildTime: 220, trains: ["archer"], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 0 },
  stables: { hp: 560, radius: 42, cost: 240, buildTime: 260, trains: ["raider", "knight"], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 0 },
  sanctum: { hp: 500, radius: 38, cost: 230, buildTime: 250, trains: ["priest", "summoner", "witch"], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 0 },
  workshop: { hp: 580, radius: 42, cost: 260, buildTime: 280, trains: ["golem"], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 0 },
  defenseTower: { hp: 430, radius: 30, cost: 160, buildTime: 140, trains: [], attackDamage: 18, attackRange: 260, attackCooldown: 24, supplyProvided: 0 },
  farm: { hp: 320, radius: 30, cost: 90, buildTime: 160, trains: [], attackDamage: 0, attackRange: 0, attackCooldown: 1, supplyProvided: 6 },
};

export const TRAINABLE_UNIT_KINDS: TrainableUnitKind[] = [
  "worker",
  "footman",
  "archer",
  "raider",
  "lancer",
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
  "farm",
];

export const RACE_IDS: RaceId[] = ["grove", "ember"];

export const RACE_DEFS: Record<RaceId, RaceDef> = {
  grove: {
    id: "grove",
    name: "Grove Kin",
    note: "Balanced grass-paper clan: shield line first, then bows, cavalry, and support casters.",
    productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
    preferredUnits: ["footman", "lancer", "archer", "raider", "knight", "priest", "summoner", "witch", "golem", "worker"],
  },
  ember: {
    id: "ember",
    name: "Ember Pact",
    note: "Aggressive sketch clan: lancers and raiders pressure early, witches arrive before priests, workshops appear in rich games.",
    productionPlan: ["barracks", "stables", "archeryRange", "sanctum", "workshop"],
    preferredUnits: ["lancer", "raider", "archer", "witch", "knight", "summoner", "priest", "golem", "footman", "worker"],
  },
};
