import type { BUILDING_RULES, UNIT_RULES, VariantRules } from "./catalog";
import type { MAP_IDS } from "./map-ids";
import type { Terrain } from "./terrain";

export type PlayerId = string;
export type Owner = PlayerId | "neutral";
export type MapId = (typeof MAP_IDS)[number];
export type RaceId = "grove" | "ember";
// Unit and building kinds are the rows of the catalog's rule tables (shared/catalog.ts); a trainable unit is one with a
// building that trains it.
export type UnitKind = keyof typeof UNIT_RULES;
export type WildlingUnitKind = "wildling" | "mossGnawer" | "thornSlinger" | "barkMender" | "stonebackBrute" | "gladeWitch" | "ancientStag";
export type MercenaryUnitKind = "mercenary" | "contractArcher" | "fieldMedic";
export type TrainableUnitKind = { [K in UnitKind]: (typeof UNIT_RULES)[K] extends { trainedAt: string } ? K : never }[UnitKind];
export type BuildingKind = keyof typeof BUILDING_RULES;
export type ResourceKind = "goldMine";
export type AbilityKind = "heal" | "summon" | "curse" | "emberMend" | "cinderSoul" | "ashCurse" | "charge";
export type ItemKind = "flameCloak" | "lightningRod" | "stormStaff" | "guardianScroll" | "experienceBook" | "breachCharge";
export type UpgradeKind = "weaponTraining" | "reinforcedPlating" | "buildingDurability" | "speedTraining" | "rangeTraining" | "leadership";

export type UnitStatusEffect = {
  type: "curse" | "guardian" | "scorch";
  remaining: number;
  damageMultiplier?: number;
};

export type WorldEffect = {
  id: string;
  type:
    | "heal"
    | "summon"
    | "curse"
    | "move"
    | "queuedMove"
    | "mine"
    | "queuedMine"
    | "repair"
    | "queuedRepair"
    | "attack"
    | "queuedAttack"
    | "attackTarget"
    | "queuedAttackTarget"
    | "build"
    | "projectile"
    | "melee"
    | "hit"
    | "chainLightning"
    | "guardianField"
    | "experienceBurst"
    | "flameBurn"
    | "scorch"
    | "storm"
    | "chargeTrail"
    | "chargeImpact";
  x: number;
  y: number;
  remaining: number;
  duration: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  owner?: Owner;
  damage?: number;
  radius?: number;
  tickEvery?: number;
  /** Who fired a weapon projectile, so the client can draw an arrow or a spell bolt. Presentation only. */
  sourceKind?: UnitKind | BuildingKind;
  /** The unit an effect follows (a charging rider's trail), or the unit or building a hit struck. Presentation only. */
  unitId?: string;
};

export type Projectile = {
  id: string;
  owner: Owner;
  attackerId: string;
  targetId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  damage: number;
  remaining: number;
  duration: number;
};

export type UnitOrder =
  | { type: "idle" }
  | { type: "move"; x: number; y: number }
  | { type: "follow"; targetId: string }
  | { type: "attackMove"; x: number; y: number; targetId?: string }
  | { type: "attack"; targetId: string; leashX?: number; leashY?: number }
  | { type: "mine"; resourceId: string; phase: "toMine" | "gather" | "return"; timer: number }
  | { type: "repair"; buildingId: string }
  | { type: "pickupItem"; itemId: string }
  // Holding its ground (see hold-position): strikes what comes within its reach, never walks.
  | { type: "hold"; x: number; y: number }
  // Dashing at a unit (see charge): `ticks` the dash has run, `resume` the order the unit takes up once it lands.
  | { type: "charge"; targetId: string; resume: SettledUnitOrder };

// Any order but a charge.
export type SettledUnitOrder = Exclude<UnitOrder, { type: "charge" }>;

export type RallyTarget =
  | { type: "point" }
  | { type: "resource"; resourceId: string }
  | { type: "unit"; unitId: string };

// How a melee fighter lands its blow (see @@@melee-stances).
export type MeleeStance = "pursue" | "brace" | "shock";

export type Unit = {
  id: string;
  owner: Owner;
  kind: UnitKind;
  // A campaign unit's variant id (see unit-variants): it plays by its variant's numbers and is drawn by its own model.
  variant?: string | undefined;
  x: number;
  y: number;
  homeX?: number;
  homeY?: number;
  hp: number;
  maxHp: number;
  speed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  // Ticks until the weapon can fire again (the repair interval for a worker repairing).
  cooldown: number;
  // Ticks until each ability still cooling down can be cast again, apart from the weapon (see ability-cooldowns).
  abilityCooldowns?: Partial<Record<AbilityKind, number>> | undefined;
  // Autocast switched away from its ability's default (see autocast): true on, false off; an absent ability keeps the default.
  autocast?: Partial<Record<AbilityKind, boolean>> | undefined;
  // A melee fighter's stance (see @@@melee-stances); absent is pursue.
  stance?: Exclude<MeleeStance, "pursue"> | undefined;
  // The velocity a shove gave the unit, in units a tick (see @@@push); absent when it is not sliding.
  pushX?: number | undefined;
  pushY?: number | undefined;
  // The point of the last walk (a move or an attack-move) the unit ended by coming there (see @@@group-arrival).
  arrivedAt?: { x: number; y: number } | undefined;
  radius: number;
  carryingGold: number;
  kills: number;
  xp: number;
  level: number;
  expiresTick?: number | undefined;
  effects: UnitStatusEffect[];
  order: UnitOrder;
  orderQueue?: UnitOrder[];
};

export type Building = {
  id: string;
  owner: Exclude<Owner, "neutral">;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  complete: boolean;
  buildProgress: number;
  buildTime: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  cooldown: number;
  rallyX: number;
  rallyY: number;
  rallyTarget?: RallyTarget;
  queue: TrainingJob[];
  researchQueue: ResearchJob[];
};

export type TrainingJob = {
  unitKind: TrainableUnitKind;
  remaining: number;
};

export type ResearchJob = {
  upgradeKind: UpgradeKind;
  targetLevel: number;
  remaining: number;
};

export type ResourceNode = {
  id: string;
  kind: ResourceKind;
  x: number;
  y: number;
  amount: number;
  harvestCooldownRemaining?: number;
};

export type MercenaryCamp = {
  id: string;
  x: number;
  y: number;
  radius: number;
  hireKind: MercenaryUnitKind;
  cost: number;
  stock: number;
  cooldown: number;
  cooldownRemaining: number;
};

export type WorldItem = {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  carrierId?: string;
  cooldownRemaining: number;
};

export type PlayerState = {
  race: RaceId;
  gold: number;
  supplyUsed: number;
  supplyCap: number;
  upgrades: UpgradeLevels;
};

export type UpgradeLevels = Record<UpgradeKind, number>;

export type PlayerStateMap = Record<PlayerId, PlayerState> & {
  player: PlayerState;
  enemy: PlayerState;
  enemy2: PlayerState;
};

export type PlayerNumberMap = Record<PlayerId, number> & {
  player: number;
  enemy: number;
  enemy2: number;
};

export type OwnerNumberMap = Record<Owner, number> & {
  player: number;
  enemy: number;
  enemy2: number;
  neutral: number;
};

export type AiScriptVersion = "v1" | "v2" | "v2-prod" | "v3" | "v3-grove" | "v3-ember" | "v4-tr" | "v5" | "v6" | "v7" | "v8" | "v9";

// A seeded layout generated for the game instead of the map id's own (see @@@generated-map).
export type GeneratedLayoutKind = "ring" | "sides";
export type GeneratedLayoutOptions = {
  seed: string;
  // Drawn from the seed when absent; "sides" needs exactly two teams.
  kind?: GeneratedLayoutKind;
  // A sea in the middle of a ring, with a shore for every player (see @@@generated-sea); absent, the map has none.
  sea?: boolean;
};

export type GameSetupOptions = {
  layout?: GeneratedLayoutOptions;
  aiPlayers?: PlayerId[];
  aiVersions?: Partial<Record<PlayerId, AiScriptVersion>>;
  players?: PlayerId[];
  teams?: Partial<Record<PlayerId, string>>;
  races?: Partial<Record<PlayerId, RaceId>>;
  scenario?: ScenarioOverride;
};

export type ScenarioUnitSeed = {
  id: string;
  owner: Owner;
  kind: UnitKind;
  x: number;
  y: number;
  hp?: number;
  // Health as a share of the unit's maximum once its upgrades and level are applied.
  hpRatio?: number;
  xp?: number;
  order?: UnitOrder;
};

export type ScenarioBuildingSeed = {
  id: string;
  owner: PlayerId;
  kind: BuildingKind;
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
  complete?: boolean;
};

export type ScenarioPlayerSeed = {
  gold?: number;
  upgrades?: Partial<Record<UpgradeKind, number>>;
};

export type ScenarioOverride = {
  // Applied before units are added, so seeded units start with these upgrades.
  players?: Partial<Record<PlayerId, ScenarioPlayerSeed>>;
  replaceDefaultUnits?: boolean;
  replaceDefaultBuildings?: boolean;
  replaceDefaultResources?: boolean;
  replaceDefaultMercenaryCamps?: boolean;
  replaceDefaultLandmarks?: boolean;
  addResources?: ResourceNode[];
  addMercenaryCamps?: MercenaryCamp[];
  addItems?: WorldItem[];
  addUnits?: ScenarioUnitSeed[];
  addBuildings?: ScenarioBuildingSeed[];
  addLandmarks?: TerrainLandmark[];
};

export type MatchStats = {
  unitsKilled: OwnerNumberMap;
  unitsLost: OwnerNumberMap;
  buildingsDestroyed: PlayerNumberMap;
  nonBaseBuildingsDestroyed: PlayerNumberMap;
  goldSpent: PlayerNumberMap;
  mercenaryKills: PlayerNumberMap;
  neutralUnitsKilled: PlayerNumberMap;
  unitsKilledByNeutral: PlayerNumberMap;
};

export type MatchState = {
  winner: PlayerId | null;
  endedAtTick: number | null;
  stats: MatchStats;
};

export type GameMap = {
  id: MapId;
  name: string;
  width: number;
  height: number;
  landmarks: TerrainLandmark[];
  // Ground a unit cannot cross (see @@@terrain); a map without it is open everywhere.
  terrain?: Terrain;
};

export type TerrainLandmark = {
  id: string;
  kind: "grove" | "ridge" | "ruin" | "ditch" | "road" | "campMark" | "mineScar" | "bannerStone";
  x: number;
  y: number;
  size: number;
  rotation: number;
};

export type GameCommand =
  | { type: "move"; unitIds: string[]; x: number; y: number; queued?: boolean }
  | { type: "attackMove"; unitIds: string[]; x: number; y: number; queued?: boolean }
  | { type: "attack"; unitIds: string[]; targetId: string; queued?: boolean }
  | { type: "stop"; unitIds: string[] }
  | { type: "holdPosition"; unitIds: string[]; queued?: boolean }
  | { type: "mine"; unitIds: string[]; resourceId: string; queued?: boolean }
  | { type: "repair"; unitIds: string[]; buildingId: string; queued?: boolean }
  | { type: "build"; unitId: string; buildingKind: BuildingKind; x: number; y: number }
  | { type: "setRally"; buildingIds: string[]; x: number; y: number; target?: RallyTarget }
  | { type: "train"; buildingId: string; unitKind: TrainableUnitKind }
  | { type: "research"; buildingId: string; upgradeKind: UpgradeKind }
  | { type: "hire"; campId: string }
  | { type: "setAutocast"; unitIds: string[]; ability: AbilityKind; enabled: boolean }
  | { type: "setStance"; unitIds: string[]; stance: MeleeStance }
  | { type: "cast"; unitId: string; ability: AbilityKind; targetId?: string; x?: number; y?: number }
  | { type: "pickupItem"; unitId: string; itemId: string; queued?: boolean }
  | { type: "dropItem"; unitId: string; itemId: string; x: number; y: number }
  | { type: "useItem"; unitId: string; itemId: string; targetId?: string; x?: number; y?: number };

export type GameSnapshot = {
  tick: number;
  match: MatchState;
  map: GameMap;
  teams?: Partial<Record<PlayerId, string>>;
  players: PlayerStateMap;
  units: Unit[];
  buildings: Building[];
  resources: ResourceNode[];
  mercenaryCamps: MercenaryCamp[];
  items: WorldItem[];
  projectiles: Projectile[];
  effects: WorldEffect[];
  // A campaign game's own units' rules, by variant id (see unit-variants). A standard match has none.
  variants?: Record<string, VariantRules>;
};

export type LocalUserProfile = {
  id: string;
  name: string;
};

export type SlotController = "human" | "ai" | "open" | "closed";

// The computer players a room offers, per AI slot.
export type RoomAiVersion = "v5" | "v7" | "v8";

export type RoomSlot = {
  id: string;
  playerId: PlayerId;
  controller: SlotController;
  // An AI slot's computer player (unset: the room default).
  aiVersion?: RoomAiVersion;
  userId?: string;
  name: string;
  team: string;
  race: RaceId;
  ready: boolean;
};

export type RoomStatus = "open" | "starting" | "inMatch" | "ended" | "closed";
export type RoomVisibility = "private" | "public";

export type RoomResult = {
  winner: PlayerId | null;
  endedAtTick: number | null;
  slots: RoomSlot[];
  stats: MatchStats;
};

export type RoomState = {
  id: string;
  name: string;
  hostUserId: string;
  visibility: RoomVisibility;
  mapId: MapId;
  // When set, the match is played on the layout generated from this seed (see @@@generated-map); the map id names it.
  layoutSeed?: string;
  status: RoomStatus;
  autoTick: boolean;
  slots: RoomSlot[];
  result?: RoomResult;
};
