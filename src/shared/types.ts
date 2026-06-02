import type { MAP_IDS } from "./map-ids";

export type PlayerId = string;
export type Owner = PlayerId | "neutral";
export type MapId = (typeof MAP_IDS)[number];
export type RaceId = "grove" | "ember";
export type UnitKind =
  | "worker"
  | "footman"
  | "archer"
  | "raider"
  | "lancer"
  | "groveWarden"
  | "emberRavager"
  | "knight"
  | "priest"
  | "summoner"
  | "witch"
  | "golem"
  | "spirit"
  | "mercenary"
  | "contractArcher"
  | "fieldMedic"
  | "wildling"
  | "mossGnawer"
  | "thornSlinger"
  | "barkMender"
  | "stonebackBrute"
  | "gladeWitch"
  | "ancientStag";
export type WildlingUnitKind = "wildling" | "mossGnawer" | "thornSlinger" | "barkMender" | "stonebackBrute" | "gladeWitch" | "ancientStag";
export type MercenaryUnitKind = "mercenary" | "contractArcher" | "fieldMedic";
export type TrainableUnitKind = Exclude<UnitKind, "spirit" | MercenaryUnitKind | WildlingUnitKind>;
export type BuildingKind = "townHall" | "barracks" | "archeryRange" | "stables" | "sanctum" | "workshop" | "defenseTower" | "moonWell" | "farm";
export type ResourceKind = "goldMine";
export type AbilityKind = "heal" | "summon" | "curse";
export type ItemKind = "flameCloak" | "lightningRod" | "stormStaff" | "guardianScroll" | "experienceBook";
export type UpgradeKind = "weaponTraining" | "reinforcedPlating";

export type UnitStatusEffect = {
  type: "curse" | "guardian";
  remaining: number;
};

export type WorldEffect = {
  id: string;
  type:
    | "heal"
    | "summon"
    | "curse"
    | "move"
    | "mine"
    | "attack"
    | "attackTarget"
    | "build"
    | "projectile"
    | "melee"
    | "hit"
    | "chainLightning"
    | "guardianField"
    | "experienceBurst"
    | "flameBurn"
    | "levelUp"
    | "storm";
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
};

export type UnitOrder =
  | { type: "idle" }
  | { type: "move"; x: number; y: number }
  | { type: "follow"; targetId: string }
  | { type: "attackMove"; x: number; y: number; targetId?: string }
  | { type: "attack"; targetId: string }
  | { type: "mine"; resourceId: string; phase: "toMine" | "gather" | "return"; timer: number }
  | { type: "pickupItem"; itemId: string };

export type RallyTarget =
  | { type: "point" }
  | { type: "resource"; resourceId: string }
  | { type: "unit"; unitId: string };

export type Unit = {
  id: string;
  owner: Owner;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  cooldown: number;
  radius: number;
  carryingGold: number;
  kills: number;
  xp: number;
  level: number;
  effects: UnitStatusEffect[];
  order: UnitOrder;
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

export type AiScriptVersion = "v1" | "v2";

export type GameSetupOptions = {
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
  order?: UnitOrder;
};

export type ScenarioBuildingSeed = {
  id: string;
  owner: PlayerId;
  kind: BuildingKind;
  x: number;
  y: number;
  complete?: boolean;
};

export type ScenarioOverride = {
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
  | { type: "startMap"; mapId: MapId }
  | { type: "move"; unitIds: string[]; x: number; y: number }
  | { type: "attackMove"; unitIds: string[]; x: number; y: number }
  | { type: "attack"; unitIds: string[]; targetId: string }
  | { type: "mine"; unitIds: string[]; resourceId: string }
  | { type: "build"; unitId: string; buildingKind: BuildingKind; x: number; y: number }
  | { type: "setRally"; buildingIds: string[]; x: number; y: number; target?: RallyTarget }
  | { type: "train"; buildingId: string; unitKind: TrainableUnitKind }
  | { type: "research"; buildingId: string; upgradeKind: UpgradeKind }
  | { type: "hire"; campId: string }
  | { type: "cast"; unitId: string; ability: AbilityKind; targetId?: string; x?: number; y?: number }
  | { type: "pickupItem"; unitId: string; itemId: string }
  | { type: "dropItem"; unitId: string; itemId: string; x: number; y: number }
  | { type: "useItem"; unitId: string; itemId: string; targetId?: string; x?: number; y?: number };

export type GameSnapshot = {
  tick: number;
  match: MatchState;
  map: GameMap;
  players: PlayerStateMap;
  units: Unit[];
  buildings: Building[];
  resources: ResourceNode[];
  mercenaryCamps: MercenaryCamp[];
  items: WorldItem[];
  effects: WorldEffect[];
};

export type LocalUserProfile = {
  id: string;
  name: string;
};

export type SlotController = "human" | "ai" | "open" | "closed";

export type RoomSlot = {
  id: string;
  playerId: PlayerId;
  controller: SlotController;
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
  status: RoomStatus;
  autoTick: boolean;
  slots: RoomSlot[];
  result?: RoomResult;
};
