import type { BUILDING_RULES, UNIT_RULES, VariantRules, WeaponDef } from "./catalog";
import type { AttackKind } from "./attack-presentation";
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
// The creep families of the camp templates (see shared/camps.ts).
export type CreepFamilyUnitKind =
  | "murlocPeon" | "murlocHunter" | "tidePriest" | "deepSnapper"
  | "rubbleGolem" | "rockGolem" | "graniteGolem"
  | "ogreWarrior" | "ogreMage" | "ogreLord"
  | "spiderling" | "venomSpider" | "spiderQueen"
  | "dragonWhelp" | "redDragon";
export type MercenaryUnitKind = "mercenary" | "contractArcher" | "fieldMedic";
export type TrainableUnitKind = { [K in UnitKind]: (typeof UNIT_RULES)[K] extends { trainedAt: string } ? K : never }[UnitKind];
export type BuildingKind = keyof typeof BUILDING_RULES;
export type ResourceKind = "goldMine";
export type AbilityKind = "pinningBolt" | "incendiaryFlume" | "heal" | "summon" | "curse" | "emberMend" | "cinderSoul" | "ashCurse" | "charge" | "stomp" | "bloodlust" | "web";
export type EquipmentSlot = "head" | "body" | "feet" | "carry0" | "carry1" | "carry2" | "carry3";
export type ShipEquipmentKind = "shipCannon" | "shipMortar" | "flameProjector";
export type ItemKind = ShipEquipmentKind | "issuedWeapon" | "flameCloak" | "lightningRod" | "stormStaff" | "guardianScroll" | "experienceBook" | "breachCharge" | ShopItemKind;
// What only a shop sells (see @@@shop); the guardian scroll it sells too, and camps drop.
export type ShopItemKind = "leatherArmor" | "roundShield" | "greatSword" | "speedBoots" | "regenRing" | "healingScroll" | "ivoryTower";
export type UpgradeKind = "weaponTraining" | "reinforcedPlating" | "buildingDurability" | "speedTraining" | "rangeTraining" | "leadership";

export type UnitStatusEffect = {
  // @@@creep-status - slow (a murloc's net), stun (a golem's stomp), root (a spider queen's web), poison (a venom spider's
  // bite), bloodlust (an ogre mage's): see sim updateUnitStatusEffects and statusPace.
  type: "curse" | "guardian" | "scorch" | "slow" | "stun" | "root" | "poison" | "bloodlust";
  remaining: number;
  damageMultiplier?: number;
  // Who poisoned the unit, credited with what the poison does.
  sourceId?: string;
};

export type WorldEffect = {
  id: string;
  type:
    | "siegeImpact" | "shellFlight" | "siegeBolt" | "grapeshot" | "burningGround" | "muzzleFlash"
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
    | "itemReceived"
    | "board" | "unload" | "boardingBlocked"
    | "goldBounty"
    | "flameBurn"
    | "scorch"
    | "storm"
    | "chargeTrail"
    | "chargeImpact"
    | "stomp"
    | "web"
    | "bloodlust";
  x: number;
  y: number;
  remaining: number;
  duration: number;
  fromX?: number;
  fromY?: number;
  /** Visual launch height; ballistic damage still uses the planar weapon rules. */
  fromHeight?: number;
  toHeight?: number;
  toX?: number;
  toY?: number;
  owner?: Owner;
  damage?: number;
  amount?: number;
  radius?: number;
  tickEvery?: number;
  /** Who fired a weapon projectile, so the client can draw an arrow or a spell bolt, or whose weapon dealt a hit, so the
   * client can sound the blow. Presentation only. */
  sourceKind?: UnitKind | BuildingKind;
  attackKind?: AttackKind;
  /** The unit an effect follows (a charging rider's trail), or the unit or building a hit struck. Presentation only. */
  unitId?: string;
  itemId?: string;
};

export type Projectile = {
  id: string;
  owner: Owner;
  attackerId: string;
  /** Captured at launch, including the shooter's weapon if it dies before impact. */
  hullDamageShare?: number;
  targetId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  damage: number;
  remaining: number;
  duration: number;
  weapon?: WeaponDef;
  sourceKind?: UnitKind;
  attackKind?: AttackKind;
  rootTicks?: number;
  burnTicks?: number;
};

export type UnitOrder =
  | { type: "build"; buildingKind: BuildingKind; x: number; y: number; progressTick?: number; progressX?: number; progressY?: number }
  | { type: "idle" }
  | { type: "move"; x: number; y: number; heading?: number; rendezvousFor?: string; avoidCombat?: boolean; deckPoint?: { x: number; y: number }; deckShipId?: string }
  | { type: "follow"; targetId: string }
  | { type: "attackMove"; x: number; y: number; targetId?: string; deckPoint?: { x: number; y: number }; deckShipId?: string }
  | { type: "attack"; targetId: string; leashX?: number; leashY?: number }
  | { type: "mine"; resourceId: string; phase: "toMine" | "gather" | "return"; timer: number }
  | { type: "repair"; buildingId: string }
  | { type: "repairShip"; targetId: string }
  | { type: "pickupItem"; itemId: string }
  // Holding its ground (see hold-position): strikes what comes within its reach, never walks.
  | { type: "hold"; x: number; y: number }
  // Walk into weapon range, then prepare a reticle at a point and engage enemies entering range.
  | { type: "aim"; x: number; y: number }
  // Walking to a transport to go aboard, and a transport sailing to unload (see @@@transport).
  | { type: "board"; transportId: string; deckPoint?: {x:number;y:number}; rendezvous?: import("./crew-rendezvous").CrewRendezvous; berth?: { x: number; y: number; heading?: number; shore?: {x:number;y:number} } }
  | { type: "unload"; x: number; y: number; avoidCombat?: boolean }
  // Dashing at a unit (see charge): `ticks` the dash has run, `resume` the order the unit takes up once it lands.
  | { type: "charge"; targetId: string; resume: SettledUnitOrder }
  // Walking within reach of a spell's unit or point to cast it there (see @@@cast-order).
  | { type: "cast"; ability: AbilityKind; targetId?: string; x?: number; y?: number };

// Any order but a charge.
export type SettledUnitOrder = Exclude<UnitOrder, { type: "charge" }>;

export type RallyTarget =
  | { type: "point" }
  | { type: "resource"; resourceId: string }
  | { type: "unit"; unitId: string };

// How a melee fighter lands its blow (see @@@melee-stances).
export type MeleeStance = "pursue" | "brace" | "shock";

/** A private reticle in world coordinates. Its anchor is the last shot's standing position. */
export type UnitAim = {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  tracking: boolean;
  updatedTick: number;
  anchorDeckX?: number;
  anchorDeckY?: number;
};

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
  /** Movement distance per second. */
  speed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  // Ticks until the weapon can fire again (the repair interval for a worker repairing).
  cooldown: number;
  aim?: UnitAim | undefined;
  /** Hand references point into the four shared carried positions. */
  hands?: { right?: string; left?: string };
  gearMass?: number;
  holdMass?: number;
  shipParts?: { rigging:number; rudder:number };
  fittings?: { id:string; x:number; y:number; radius:number; bearing:number; halfArc:number; accepts:ShipEquipmentKind[] }[];
  bodyRadius?: number;
  /** Simulation-facing angle in radians while aiming or firing. */
  facing?: number | undefined;
  // Ticks until each ability still cooling down can be cast again, apart from the weapon (see ability-cooldowns).
  abilityCooldowns?: Partial<Record<AbilityKind, number>> | undefined;
  // Autocast switched away from its ability's default (see autocast): true on, false off; an absent ability keeps the default.
  autocast?: Partial<Record<AbilityKind, boolean>> | undefined;
  // A melee fighter's stance (see @@@melee-stances); absent is pursue.
  stance?: Exclude<MeleeStance, "pursue"> | undefined;
  // The velocity a shove gave the unit, in distance per second (see @@@push); absent when it is not sliding.
  pushX?: number | undefined;
  pushY?: number | undefined;
  // The point of the last walk (a move or an attack-move) the unit ended by coming there (see @@@group-arrival).
  arrivedAt?: { x: number; y: number } | undefined;
  /** Old-format save data only; restored into ordinary units with deck coordinates. */
  cargo?: Unit[] | undefined;
  /** Old-format mission hull scale, expressed in the old cargo capacity. */
  cargoCapacity?: number;
  /** Position on a moving ship, in its local physical coordinate system. */
  deck?: { shipId: string; x: number; y: number } | undefined;
  /** Continuous heading and rates, shared by physical motion and real-time rendering. */
  sailing?: { heading: number; speed: number; load: number; balance: number;
    route?: { goalX: number; goalY: number; points: { x: number; y: number; heading: number; pivot?: {x:number;y:number} }[]; end: { x: number; y: number }; trafficKey?: string; partial?: boolean; startX?: number; startY?: number; startHeading?: number } | undefined;
  } | undefined;
  /** Physical scaling for unusually large campaign hulls. */
  deckScale?: number;
  radius: number;
  carryingGold: number;
  /** Reserved gold-mine workstation, released when the haul order ends. */
  mineSlot?: string;
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
  /** A mission ward; normal matches leave this absent. */
  invulnerable?: boolean;
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
  id?: string;
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

// @@@obstacle - Rocks or a stone gate across a way, as Warcraft III's destructible rocks and gates: it stands in the way as
// a building does (see @@@building-pathing) until it is broken, and then the way is open. It is nobody's: nobody strikes it
// unbidden (no unit or tower seeks it out), only a player's attack order; it strikes nobody, and breaking it pays nothing
// and counts as no kill. `along`: the way it stands across, a unit vector (its art lies across it).
export type ObstacleKind = "rocks" | "gate";
export type Obstacle = { id: string; kind: ObstacleKind; owner: "neutral"; x: number; y: number; radius: number; hp: number; maxHp: number; along: { x: number; y: number } };

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

// @@@shop - A neutral post where any player's units buy goods with their owner's gold, as at a Warcraft III goblin
// merchant: it is struck by nobody and stands in nobody's way, and each of its goods has a stock that comes back one at a
// time, `restock` ticks after it last ran short (see shared/shop.ts).
export type ShopGood = { kind: ItemKind; cost: number; stock: number; maxStock: number; restock: number; restockRemaining: number };
export type Shop = { id: string; x: number; y: number; radius: number; goods: ShopGood[] };

// A spot a generated map sets aside for a post of the game's (see @@@shop): the generator says where, the game makes it.
export type MapSite = { kind: "shop"; x: number; y: number };

export type WorldItem = {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  carrierId?: string;
  slot?: EquipmentSlot;
  weaponKind?: UnitKind;
  shipId?: string;
  /** Loose, unowned floor item supported by a moving deck. */
  deck?: { shipId: string; x: number; y: number };
  holdSlot?: number;
  mountId?: string;
  durability?: number;
  facing?: number;
  aim?: UnitAim;
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
// The ideas a generated map is drawn on (see @@@generated-ideas; MAP_IDEAS lists them).
export type MapIdea =
  | "openRing"
  | "openSides"
  | "fountainRing"
  | "turtleIsle"
  | "twistedPaths"
  | "outerSea"
  | "oneMarket"
  | "floodedValley"
  | "hiddenHill"
  | "bridgeStand"
  | "deepJungle"
  | "northIsles"
  | "riverValley"
  | "twoShores"
  | "islandStarts";
export type GeneratedLayoutOptions = {
  seed: string;
  // Drawn from the seed (or the idea) when absent; "sides" needs exactly two teams.
  kind?: GeneratedLayoutKind;
  // Drawn from the seed when absent, among the ideas that take the kind and the seats.
  idea?: MapIdea;
  // The map's side, one of the sizes the generator draws for the kind and player count; drawn from the seed when absent.
  size?: number;
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
  addShops?: Shop[];
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

// Scenery for the eye only: no unit is stopped or slowed by any of it. A generated map dresses its ground in the small kinds
// (see @@@generated-decor).
export type TerrainLandmark = {
  id: string;
  kind:
    | "grove"
    | "ridge"
    | "ruin"
    | "ditch"
    | "road"
    | "campMark"
    | "mineScar"
    | "bannerStone"
    | "flowers"
    | "bush"
    | "stump"
    | "log"
    | "mushrooms"
    | "pebbles"
    | "bones"
    | "reeds"
    | "lilies"
    | "wreck"
    | "campfire"
    | "signpost"
    | "pillar";
  x: number;
  y: number;
  size: number;
  rotation: number;
  straight?: boolean;
};

export type GameCommand =
  | { type: "cancelTraining"; buildingId: string; jobId: string }
  | { type: "move"; unitIds: string[]; x: number; y: number; avoidCombat?: boolean; queued?: boolean }
  | { type: "attackMove"; unitIds: string[]; x: number; y: number; queued?: boolean }
  | { type: "attack"; unitIds: string[]; targetId: string; queued?: boolean }
  | { type: "follow"; unitIds: string[]; targetId: string; queued?: boolean }
  | { type: "stop"; unitIds: string[] }
  | { type: "holdPosition"; unitIds: string[]; queued?: boolean }
  | { type: "aim"; unitIds: string[]; x: number; y: number; queued?: boolean }
  | { type: "mine"; unitIds: string[]; resourceId: string; queued?: boolean }
  | { type: "repair"; unitIds: string[]; buildingId: string; queued?: boolean }
  | { type: "repairShip"; unitIds: string[]; targetId: string; queued?: boolean }
  | { type: "build"; unitId: string; buildingKind: BuildingKind; x: number; y: number }
  | { type: "setRally"; buildingIds: string[]; x: number; y: number; target?: RallyTarget }
  | { type: "train"; buildingId: string; unitKind: TrainableUnitKind }
  | { type: "research"; buildingId: string; upgradeKind: UpgradeKind }
  | { type: "hire"; campId: string }
  | { type: "buyShipEquipment"; buildingId:string; item:ShipEquipmentKind; recipientId?:string }
  | { type: "buy"; shopId: string; item: ItemKind; recipientId?:string }
  | { type: "setAutocast"; unitIds: string[]; ability: AbilityKind; enabled: boolean }
  | { type: "setStance"; unitIds: string[]; stance: MeleeStance }
  | { type: "board"; unitIds: string[]; transportId: string; queued?: boolean }
  | { type: "unload"; unitIds: string[]; x: number; y: number; avoidCombat?: boolean; queued?: boolean }
  | { type: "unloadPassenger"; transportId: string; passengerId: string }
  | { type: "cast"; unitId: string; ability: AbilityKind; targetId?: string; x?: number; y?: number; queued?: boolean }
  | { type: "pickupItem"; unitId: string; itemId: string; queued?: boolean }
  | { type: "dropItem"; unitId: string; itemId: string; x: number; y: number }
  | { type: "transferItem"; itemId: string; destination: { unitId: string; slot: EquipmentSlot } | { shipId: string; slot: number } | { shipId:string; mountId:string; installerId?:string } }
  | { type: "wieldItem"; unitId: string; itemId?: string; hand: "right" | "left" }
  | { type: "useItem"; unitId: string; itemId: string; targetId?: string; x?: number; y?: number };

/** Persistent battlefield remains. Separate from live entities and transient effects. */
export type Corpse = {
  id: string;
  unitId: string;
  kind: UnitKind;
  owner: Owner;
  x: number;
  y: number;
  radius: number;
  diedAtTick: number;
  variant?: string;
};

export type GameSnapshot = {
  /** Equipment migration is applied once; current saves restore byte-for-byte. */
  equipmentVersion?: 1;
  /** Unmarked older snapshots store movement and push rates per tick at 20 Hz. */
  rateUnits?: "perSecond";
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
  corpses?: Corpse[];
  // A campaign game's own units' rules, by variant id (see unit-variants). A standard match has none.
  variants?: Record<string, VariantRules>;
  // The map's shops (see @@@shop); a map without one has none, and no key.
  shops?: Shop[];
  // The rocks and gates still standing (see @@@obstacle); a map without any has none, and no key.
  obstacles?: Obstacle[];
};

export type LocalUserProfile = {
  id: string;
  name: string;
};

export type SlotController = "human" | "ai" | "open" | "closed";

// The computer players a room offers, per AI slot.
export type RoomAiVersion = "v5" | "v7" | "v8";
// A seat's race or computer player, or one drawn when the match starts (see resolvedRoomSlots).
export type RaceChoice = RaceId | "random";
export type RoomAiChoice = RoomAiVersion | "random";

export type RoomSlot = {
  id: string;
  playerId: PlayerId;
  controller: SlotController;
  // An AI slot's computer player (unset: the room default).
  aiVersion?: RoomAiChoice;
  userId?: string;
  name: string;
  team: string;
  race: RaceChoice;
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
  layoutSeed?: string;
  status: RoomStatus;
  autoTick: boolean;
  slots: RoomSlot[];
  result?: RoomResult;
};
