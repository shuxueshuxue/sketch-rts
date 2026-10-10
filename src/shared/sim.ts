import { boardingHoldShips, cancelCrewRendezvous, prepareCrewRendezvous } from './crew-rendezvous';
import { prepareShipDefenseFrame, combatHull, type ShipDefenseFrame } from './ship-defense';
import { constrainGroundShipStep, drainShipCollisionImpacts, shipBodyClearAtPose } from './ship-collisions';
import { shipLaunchPose, shipLaunchPrototype } from './ship-launch';
import { landSpawnPoint, landSpawnPrototype } from './production-spawn';
import { shipFireLaneClear } from './ship-fire-control';
import { beginShipBoarding, cancelShipBoarding, shipBoardingGoal, updateShipGangways, damageShipGangway, gangwayCrewEligible, bindGangwayCrewRules } from './ship-gangway';
import { assignPlayerColors } from './player-colors';
import { BUILDING_WORK_REACH, buildingWorkGap, constructionWorkers } from './construction';
import { GOLD_MINE_RULES, prepareMiningFrame, type MiningFrame } from "./mining";
import { canReceiveHealing } from './healing';
import { SPARK_FIRE, sparkIgnites } from './spark-fire';
import { unitNeedsRepair, unitRepairHpPerGold } from './unit-repair';
import { innateMissile, type AttackKind } from "./attack-presentation";
import { invalidateItemIndex } from "./item-index";
import { settleGroundItems } from './item-surfaces';
import { strikePoint, strikeGap, bodyGap } from "./combat-geometry";
import { purchasePlacement, type PurchasePlacement } from "./purchase";
import { SHIP_WEAPONS, PREVIOUS_SHIP_TRAIN_COST, damageShipParts, initializeShipEquipment, installedWeapons, isShipEquipment, mountedWeaponPose, mountedTargetPoint, mountedFireLaneClear, rebuildShipFittings, repairShipParts, shipPartMax, shipGunCanAim, shipMounts, bestFiringHeading, type MountedShotClear } from "./ship-equipment";
import { ITEM_DEFS, canEquip, dropRefusal, freeItemSlot, itemEquipped, normalizeEquipment, removeFromHands, transferRefusal, weaponRules, wieldRefusal, itemHands, unitItemMass, shipItemMass, itemsFor } from "./equipment";
import { BREACH_CHARGE, FLAME_CLOAK, GUARDIAN_SCROLL, IVORY_TOWER_HP_SHARE, LIGHTNING_ROD, STORM_STAFF, NEUTRAL_ITEM_TARGET_RANGE, NEUTRAL_STORM_TARGET_RANGE } from "./item-rules";
import { EXPERIENCE_BOOK_XP, VETERANCY_GAIN_PER_STAR, killXpReward, xpStarThresholds } from "./unit-value";
import { automaticTargetAllowed, combatTargetScore, combatVictimId, shouldSwitchCombatTarget, type TargetThreat } from "./combat-target";
import { boltIntersection, inWeaponCone, weaponDamage } from "./weapons";
import { aimAt, aimingProfile, invalidateMovedAim, markAimShot, RANGED_ATTACK_RANGE_THRESHOLD } from "./aiming";
export { RANGED_ATTACK_RANGE_THRESHOLD } from "./aiming";
import type { WeaponDef } from "./catalog";
import { ABILITY_DEFS, BUILDING_DEFS, DOCK_REPAIR, SUPPORT_BUILDING_HEAL, HIGH_UPKEEP_SUPPLY, LOW_UPKEEP_SUPPLY, POISON_DAMAGE, POISON_TICKS, SLOW_PACE, SLOW_TICKS, SPLASH_RADIUS, SPLASH_SHARE, MAX_UPGRADE_LEVEL, MERCENARY_HIRE_RANGE, MERCENARY_UNIT_KINDS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, UPGRADE_KINDS, constructionStartHp, hasSpell, isHealingBuildingKind, maxUpgradeLevel, requiredSupplyCap, unitMover, unitRules, type UnitDef } from "./catalog";
import { abilityCooldown, tickedAbilityCooldowns, withAbilityCooldown } from "./ability-cooldowns";
import { isStunned, unitAbilities } from "./unit-abilities";
import { matchesUnitTarget } from "./unit-targeting";
import { rollVeteranSkillChoices } from "./veteran-skills";
import { unitClassOf } from "./unit-targeting";
import { veteranWeaponRange } from "./veteran-stats";
import { buildVeteranFrame, castVeteranAbility, temporaryAttackSpeedMultiplier, type VeteranAutocastFrame, type VeteranUnitModifiers } from "./veteran-runtime";
import { checkCommandLegality } from "./sim/command-validation";
import { resolveUnitDamage, unitAttackDamageProfile } from "./damage";
import { attackDamageProfile, weaponDamageProfile, DAMAGE_PROFILES, ITEM_DAMAGE_PROFILES, type DamageProfile } from "./damage-types";
import { autocastEnabled, canAutocast, withAutocast } from "./autocast";
import { buildingPlacementBlocker, terrainBlocksPlacement } from "./build-placement";
import { sameGround, footprintHalf, groundUnder, isOpenGround, isWalkable, openGroundNear, openStep, setBuildingBodies, shareBuildingBodies, snapToFootprint, steerPoint, walkableGoal, walkDestination } from "./terrain";
import { alongside, boardingBerth, canReach, carries, landingSpot } from "./naval";
import { detCos, detSin } from "./det-math";
import { canBoard, boardUnit, deckPlacement, deckPointFits, moveOnDeck, restoreCargoDecks, syncDecks, settleGangwayCrossings } from "./decks";
import { bodyMass } from "./physical-body";
import { walkConnectedSurfaces, settleDeckSupport, decksCanTransfer } from "./connected-decks";
import { deckHullDamageShare, passengerDamageMultiplier } from "./deck-combat";
import { shipsIn, isShipKind, circleInPolygon, distanceToHull, localToWorld, shipPassengers, shipProfile, shareShipProfile, shipWeaponPose, worldToLocal, migrateShipSizes, SHIP_SIZE_MULTIPLIER } from "./ship-geometry";
import { keepShipsOnWater, sailToward, turnShipToward } from "./sailing";
import { followQueuedShipCourse } from './ship-queued-course';
import { shipCanTurnForAttack, shipNavigationTarget, shipPursuitGoal } from './ship-pursuit';
import { beginShipMotionFrame } from './ship-motion';
import { beginShipPlanningFrame, tryAdmitShipPlan } from './ship-planning-budget';
import { cancelShipPlanningJob } from './ship-planning-job';
import { DEFAULT_WIND, updateAutoTrim } from './ship-wind';
import { cabinGroupSelection, cabinCrewMovedThisTick, enterCabinStep, isCabinProtected, isInCabin, leaveCabin, updateCabinPassengers } from './ship-cabin';
import { updateWindField } from './wind-field';
import { shipTraffic } from './ship-avoidance';
import { headingDifference, hullPassageClear, nearestShipPose, type ShipPose } from "./ship-navigation";
import { BRACE_DAMAGE_SHARE, MAX_SLIDE_STEP, PUSH_FRICTION, blowStrength, canTakeStance, isStaggered, lungeStrength, pushContact, shove, slide } from "./push";
import {
  createBuilding,
  createInitialBuildings,
  createInitialItems,
  createInitialMercenaryCamps,
  createInitialResources,
  createInitialUnits,
  createUnit,
  createMap,
  DEFAULT_MAP_ID,
  LADDER_MAP_ID,
  trainTimeFor,
  withUnitShape,
} from "./map";
import { generateMap, TERRAIN_CELL } from "./generated-map";
import { BOOTS_SPEED, HEALING_SCROLL_HEAL, HEALING_SCROLL_RADIUS, IVORY_TOWER_REACH, MAX_CARRIED_ITEMS, RING_REGEN_PER_SECOND, buyRefusal, carriedItemCount, createShop, restockShops, shopBuyer } from "./shop";
import { poolMap } from "./map-pool";
import { perTick, seconds, SIM_TICKS_PER_SECOND } from "./time";
import { ownUnitLookup } from "./unit-lookup";
import type { AbilityKind, Building, GameCommand, GameMap, GameSetupOptions, GameSnapshot, MapId, MatchState, Obstacle, Owner, PlayerId, PlayerNumberMap, PlayerState, PlayerStateMap, Projectile, RallyTarget, ScenarioOverride, ScenarioPlayerSeed, SettledUnitOrder, TrainableUnitKind, Unit, UnitKind, UnitOrder, UnitStatusEffect, UpgradeKind, WorldEffect, WorldItem } from "./types";

export type CreateGameOptions = GameSetupOptions;

export type Game = GameSnapshot & {
  /** Derived at tick boundaries; never serialized or used as a source of permanent stats. */
  veteranFrame?: Map<string, VeteranUnitModifiers>;
  veteranAutocastFrame?: VeteranAutocastFrame;
  miningFrame?: MiningFrame;
  boardingHolds?: ReadonlySet<string>;
  deckDamageBatch?: Map<string, { ship: Unit; direct: number; collateral: number; source?: Unit | Building; impact?:{x:number;y:number}; blastRadius?:number; profile?:DamageProfile }>;
  nextId: number;
  activePlayers: PlayerId[];
  teams: Record<PlayerId, string>;
  unitSpatial?: SpatialIndex<Unit>;
  unitSpatialByTeam?: Map<string, SpatialIndex<Unit>>;
  shipReachPadding?: number;
  buildingSpatial?: SpatialIndex<Building>;
  buildingSpatialByTeam?: Map<string, SpatialIndex<Building>>;
  buildingSpatialCount?: number;
  // The buildings and obstacles the map's routing last took in (see @@@building-pathing).
  buildingBodiesSeen?: (Building | Obstacle)[];
  entityById?: Map<string, Unit | Building>;
  spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number, pose?: ShipPose): Unit;
  // Campaign games only (see story/); a standard match has neither (nor `variants`) and takes none of their paths.
  // Told of every hit as it lands, so a script can tell who struck whom. It watches; it never changes the game.
  observer?: SimObserver;
  // The script decides who wins: the last team standing with buildings does not end the match.
  scriptedVictory?: boolean;
};

export type SimObserver = {
  hit(attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, hpBefore: number): void;
};

export const GAME_SNAPSHOT_RESTORE_KEYS = [
  "equipmentVersion",
  "rateUnits",
  "tick",
  "match",
  "map",
  "teams",
  "players",
  "units",
  "buildings",
  "resources",
  "mercenaryCamps",
  "shops",
  "items",
  "projectiles",
  "effects",
  "corpses",
  "variants",
  "obstacles",
] as const satisfies readonly (keyof GameSnapshot)[];

type RestoredSnapshotKey = (typeof GAME_SNAPSHOT_RESTORE_KEYS)[number];
const _snapshotRestoreKeysCoverSnapshot: Exclude<keyof GameSnapshot, RestoredSnapshotKey> extends never ? true : never = true;

type SpatialEntity = {
  x: number;
  y: number;
};

type SpatialIndex<T extends SpatialEntity> = {
  team?: string | undefined;
  cellSize: number;
  buckets: Map<number, T[]>;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const MINE_RANGE = GOLD_MINE_RULES.entryRange;
const TOWN_HALL_DROP_RANGE = GOLD_MINE_RULES.dropRange;
const GOLD_PER_TRIP = GOLD_MINE_RULES.goldPerTrip;
const GATHER_DURATION = seconds(GOLD_MINE_RULES.gatherSeconds);
const GOLD_MINE_ENTRY_COOLDOWN = seconds(GOLD_MINE_RULES.entrySeconds);
const LOW_UPKEEP_GOLD_RATE = 0.7;
const HIGH_UPKEEP_GOLD_RATE = 0.4;

const ITEM_PICKUP_RANGE = 72;
const SCORCH_DURATION = seconds(8);
const FLAME_CLOAK_VISUAL_DURATION = seconds(1.7);
const MOON_WELL_HEAL_EFFECT_DURATION = seconds(1.1);
// @@@repair - A worker repairs a building as fast as a footman strikes one (the owner's word, 10-02: a tower held by its
// workers holds), at the price it always had: 1 gold for each REPAIR_FULL_COST_FRACTION-th of the building's price worth
// of its health, paid as often as that rate asks (a tower every 6 ticks, a hall every 9).
const REPAIR_FULL_COST_FRACTION = 0.35;
const REPAIR_HP_PER_SECOND = UNIT_DEFS.footman.attackDamage / (UNIT_DEFS.footman.attackCooldown/seconds(1));
const REPAIR_HAMMER_EFFECT_DURATION = seconds(3);
export const AUTO_ACQUIRE_RANGE = 230;
// Projectile rates are distance per second; only flight duration is quantized to simulation ticks.
const PROJECTILE_SPEED = 360; // Distance per second.
const NEUTRAL_LEASH_RANGE = 650;
// @@@neutral-damage-response - Damage response must cover any legal ranged hit before leash cleanup can erase the aggro.
// A new long-range siege weapon must not expand every creep's pursuit radius.
const NEUTRAL_DAMAGE_RESPONSE_RANGE = NEUTRAL_LEASH_RANGE;
const NEUTRAL_RETURN_STOP_RANGE = 8;
const NEUTRAL_ASSIST_RANGE = 360;
// @@@player-aggro - Player units answer damage the way neutral camps do: the hit unit turns on its attacker and idle
// soldiers of the same owner nearby come to help, so a shooter parked outside acquisition range is no longer free damage.
// Only self-directed behaviour answers. A move, an explicit attack or a worker job is a command and is never overridden,
// which keeps retreats, focus fire and kiting in the players' hands.
const HELP_CALL_RANGE = 300;
// Self-directed chases (idle acquisition, retaliation, answering a call) give up this far from where the unit stood, so one
// raider cannot drag a base's defenders across the map. Commanded attacks and attack-moves are not leashed.
const GUARD_LEASH_RANGE = 600;
// Threat: an enemy that is attacking our side outranks a bystander about 100px nearer.
const DEFAULT_PLAYERS: PlayerId[] = ["player", "enemy"];
const DEFAULT_TEAMS: Record<string, string> = { player: "player", enemy: "enemy", enemy2: "enemy2" };
const DEFAULT_RACES: Record<string, PlayerState["race"]> = { player: "grove", enemy: "ember", enemy2: "grove" };
// @@@runtime-id-band - Map-authored ids stay human-readable; runtime ids live above this band.
const RUNTIME_ID_START = 1000;

export function createGame(mapId: MapId = DEFAULT_MAP_ID, options: CreateGameOptions = {}): Game {
  const aiPlayers = options.aiPlayers ?? ["enemy"];
  const activePlayers = uniquePlayers(options.players ?? [...DEFAULT_PLAYERS, ...aiPlayers]);
  const teams = Object.fromEntries(activePlayers.map((owner, index) => [owner, options.teams?.[owner] ?? DEFAULT_TEAMS[owner] ?? `team-${index + 1}`]));
  // A generated layout replaces the map id's own starts, mines, camps and scenery (see @@@generated-map); the id names it.
  // A pool map is its own layout (see @@@map-pool); the ladder map has none of its own: a game on it without a layout is
  // drawn from the seed "ladder".
  const namedLayout = poolMap(mapId)?.layout;
  const layout = options.layout ?? namedLayout ?? (mapId === LADDER_MAP_ID ? { seed: "ladder" } : undefined);
  // Named two-shore maps retain their geometry when players change alliances.
  // Only the layout uses these physical sides; game diplomacy uses `teams`.
  const namedShores = namedLayout?.kind === "sides"
    && (!options.layout || options.layout.kind === namedLayout.kind && options.layout.idea === namedLayout.idea);
  const layoutTeams = namedShores
    ? Object.fromEntries(activePlayers.map((id, index) => [id, `shore-${index % 2}`])) : teams;
  const generated = layout ? generateMap(layout, activePlayers, layoutTeams) : undefined;
  const shops = (generated?.sites ?? []).filter((site) => site.kind === "shop").map((site, index) => createShop(`shop-${index + 1}`, site.x, site.y));
  const game = {
    equipmentVersion: 1,
    rateUnits: "perSecond",
    tick: 0,
    match: createMatchState(activePlayers),
    map: generated ? { ...createMap(mapId), width: generated.size, height: generated.size, landmarks: generated.landmarks, ...(generated.terrain ? { terrain: generated.terrain } : {}) } : createMap(mapId),
    players: createPlayerStates(activePlayers, options),
    units: generated?.units ?? createInitialUnits(mapId, activePlayers, teams),
    buildings: generated?.buildings ?? createInitialBuildings(activePlayers, mapId, teams),
    resources: generated?.resources ?? createInitialResources(mapId, activePlayers, teams),
    mercenaryCamps: generated?.mercenaryCamps ?? createInitialMercenaryCamps(mapId),
    ...(shops.length > 0 ? { shops } : {}),
    items: generated?.items ?? createInitialItems(mapId),
    projectiles: [],
    effects: [],
    ...(generated?.obstacles.length ? { obstacles: generated.obstacles } : {}),
    nextId: RUNTIME_ID_START,
    activePlayers,
    teams,
    spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number, launchPose?: ShipPose) {
      // A unit comes out on walkable ground (see @@@terrain): beside a hall backed onto a forest, at its nearest edge; a ship
      // on the nearest water.
      const at = launchPose ?? walkableGoal(this.map, x, y, unitMover(kind));
      const unit = createUnit(`unit-${owner}-${kind}-${this.nextId}`, owner, kind, at.x, at.y);
      if(shipProfile(unit)) {
        const traffic=shipTraffic(unit,this.units,Infinity);
        const bodies=[...this.units,...this.buildings,...(this.obstacles ?? [])];
        const clear=(pose:ShipPose)=>traffic(pose,pose) && shipBodyClearAtPose(this.map,unit,pose,bodies);
        const pose=launchPose ? clear(launchPose) ? launchPose : undefined : nearestShipPose(this.map,unit,at,unit,clear);
        if(!pose)throw new Error('No clear water berth for this ship');
        Object.assign(unit,{x:pose.x,y:pose.y});unit.sailing={heading:pose.heading,speed:0,load:0,balance:0};
      }
      this.nextId += 1;
      applyUnitUpgrades(this, unit);
      this.units.push(unit);
      initializeShipEquipment({...this,units:[unit]});
      normalizeEquipment({...this,units:[unit]},true);
      refreshEquipmentMass(this,[unit]);
      return unit;
    },
  } satisfies Game;

  game.map.wind = { ...DEFAULT_WIND };
  if (options.scenario) applyScenarioOverride(game, options.scenario);
  // Every building stands on whole cells (see @@@building-footprint), a hall the map lays or a scenario seeds as one a
  // worker lays: laid 10 off its cells' middle, a start hall had the cells beside one of its sides 77 from it, past where
  // its workers drop their gold.
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  initializeShipEquipment(game);
  normalizeEquipment(game,true);
  refreshEquipmentMass(game);
  keepShipsOnWater(game.map,game.units);
  updateSupplyState(game);
  return game;
}

function uniquePlayers(players: PlayerId[]) {
  return [...new Set(players)];
}

function createMatchState(players: PlayerId[]): MatchState {
  return {
    winner: null,
    endedAtTick: null,
    stats: {
      unitsKilled: { ...zeroPlayerRecord(players), neutral: 0 },
      unitsLost: { ...zeroPlayerRecord(players), neutral: 0 },
      buildingsDestroyed: zeroPlayerRecord(players),
      nonBaseBuildingsDestroyed: zeroPlayerRecord(players),
      goldSpent: zeroPlayerRecord(players),
      mercenaryKills: zeroPlayerRecord(players),
      neutralUnitsKilled: zeroPlayerRecord(players),
      unitsKilledByNeutral: zeroPlayerRecord(players),
    },
  };
}

function createPlayerStates(activePlayers: PlayerId[], options: CreateGameOptions): PlayerStateMap {
  const players = {} as PlayerStateMap;
  for (const [index, owner] of [...new Set([...activePlayers, "player", "enemy", "enemy2"])].entries()) {
    players[owner] = {
      race: options.races?.[owner] ?? DEFAULT_RACES[owner] ?? (index % 2 === 0 ? "grove" : "ember"),
      gold: 500,
      supplyUsed: 0,
      supplyCap: 0,
      upgrades: createEmptyUpgradeLevels(),
    };
  }
  const colors=assignPlayerColors(Object.keys(players));
  for(const [owner,player] of Object.entries(players))player.color=colors[owner]!;
  return players;
}

function createEmptyUpgradeLevels() {
  return Object.fromEntries(UPGRADE_KINDS.map((upgradeKind) => [upgradeKind, 0])) as PlayerState["upgrades"];
}

function zeroPlayerRecord(players: PlayerId[]) {
  return Object.fromEntries([...new Set([...players, "player", "enemy", "enemy2"])].map((owner) => [owner, 0])) as PlayerNumberMap;
}

function addThirdPlayerStart(game: Game) {
  game.buildings.push(createBuilding("building-enemy2-townhall", "enemy2", "townHall", game.map.width - 480, 480, true));
  game.units.push(
    createUnit("unit-enemy2-worker-1", "enemy2", "worker", game.map.width - 590, 460),
    createUnit("unit-enemy2-worker-2", "enemy2", "worker", game.map.width - 540, 545),
    createUnit("unit-enemy2-worker-3", "enemy2", "worker", game.map.width - 450, 520),
  );
  game.resources.push({ id: "gold-enemy2-main", kind: "goldMine", x: game.map.width - 590, y: 460, amount: 8000 });
}

function applyScenarioOverride(game: Game, scenario: ScenarioOverride) {
  if (scenario.replaceDefaultUnits) game.units = [];
  if (scenario.replaceDefaultBuildings) game.buildings = [];
  if (scenario.replaceDefaultResources) game.resources = [];
  if (scenario.replaceDefaultMercenaryCamps) game.mercenaryCamps = [];
  if (scenario.replaceDefaultLandmarks) game.map.landmarks = [];
  const ids = new Set([
    ...game.units.map((unit) => unit.id),
    ...game.buildings.map((building) => building.id),
    ...game.resources.map((resource) => resource.id),
    ...game.mercenaryCamps.map((camp) => camp.id),
    ...(game.shops ?? []).map((shop) => shop.id),
    ...game.items.map((item) => item.id),
    ...game.map.landmarks.map((landmark) => landmark.id),
  ]);
  const claimId = (id: string) => {
    if (ids.has(id)) throw new Error(`Duplicate scenario id ${id}`);
    ids.add(id);
  };

  for (const [owner, seed] of Object.entries(scenario.players ?? {}) as [PlayerId, ScenarioPlayerSeed][]) {
    const player = game.players[owner];
    if (!player) throw new Error(`Unknown scenario player ${owner}`);
    if (seed.gold !== undefined) {
      if (!Number.isFinite(seed.gold) || seed.gold < 0) throw new Error(`Invalid scenario gold for ${owner}`);
      player.gold = seed.gold;
    }
    for (const [upgradeKind, level] of Object.entries(seed.upgrades ?? {}) as [UpgradeKind, number][]) {
      if (!Number.isInteger(level) || level < 0) throw new Error(`Invalid scenario ${upgradeKind} level for ${owner}`);
      player.upgrades[upgradeKind] = level;
    }
  }

  for (const resource of scenario.addResources ?? []) {
    claimId(resource.id);
    game.resources.push({ ...resource });
  }
  for (const camp of scenario.addMercenaryCamps ?? []) {
    claimId(camp.id);
    game.mercenaryCamps.push({ ...camp });
  }
  for (const shop of scenario.addShops ?? []) {
    claimId(shop.id);
    (game.shops ??= []).push({ ...shop, goods: shop.goods.map((good) => ({ ...good })) });
  }
  for (const item of scenario.addItems ?? []) {
    claimId(item.id);
    game.items.push({ ...item });
  }
  for (const seed of scenario.addUnits ?? []) {
    claimId(seed.id);
    const unit = createUnit(seed.id, seed.owner, seed.kind, seed.x, seed.y);
    applyUnitUpgrades(game, unit);
    if (seed.xp !== undefined) {
      if (!Number.isFinite(seed.xp) || seed.xp < 0) throw new Error(`Invalid scenario xp for ${seed.id}`);
      unit.xp = seed.xp;
      applyXpLevel(game, unit);
    }
    if (seed.hp !== undefined) {
      if (!Number.isFinite(seed.hp) || seed.hp <= 0 || seed.hp > unit.maxHp) throw new Error(`Invalid scenario hp for ${seed.id}`);
      unit.hp = seed.hp;
    }
    if (seed.hpRatio !== undefined) {
      if (!Number.isFinite(seed.hpRatio) || seed.hpRatio <= 0 || seed.hpRatio > 1) throw new Error(`Invalid scenario hpRatio for ${seed.id}`);
      unit.hp = Math.max(1, Math.round(unit.maxHp * seed.hpRatio));
    }
    if (seed.order) unit.order = { ...seed.order };
    game.units.push(unit);
  }
  for (const seed of scenario.addBuildings ?? []) {
    claimId(seed.id);
    const building = createBuilding(seed.id, seed.owner, seed.kind, seed.x, seed.y, seed.complete ?? true);
    if (seed.maxHp !== undefined) {
      if (!Number.isFinite(seed.maxHp) || seed.maxHp <= 0) throw new Error(`Invalid scenario maxHp for ${seed.id}`);
      building.maxHp = seed.maxHp;
    }
    if (seed.hp !== undefined) {
      if (!Number.isFinite(seed.hp) || seed.hp <= 0 || seed.hp > building.maxHp) throw new Error(`Invalid scenario hp for ${seed.id}`);
      building.hp = seed.hp;
    }
    game.buildings.push(building);
  }
  for (const landmark of scenario.addLandmarks ?? []) {
    claimId(landmark.id);
    game.map.landmarks.push({ ...landmark });
  }
}

export function issueCommand(game: Game, command: GameCommand) {
  issuePlayerCommand(game, "player", command);
}

export function issuePlayerCommand(game: Game, owner: PlayerId, command: GameCommand) {
  if (!game.players[owner]) throw new Error(`Unknown player ${owner}`);
  const cabinOperands = 'unitIds' in command ? [...command.unitIds] : 'unitId' in command ? [command.unitId] : [];
  if ('targetId' in command && command.targetId) cabinOperands.push(command.targetId);
  if ('recipientId' in command && command.recipientId) cabinOperands.push(command.recipientId);
  if (command.type === 'unloadPassenger') cabinOperands.push(command.passengerId);
  if (command.type === 'transferItem') {
    const item = game.items.find(item => item.id === command.itemId);
    if (item?.carrierId) cabinOperands.push(item.carrierId);
    if ('unitId' in command.destination) cabinOperands.push(command.destination.unitId);
    else if ('installerId' in command.destination && command.destination.installerId) cabinOperands.push(command.destination.installerId);
  }
  if (command.type === 'enterCabin' || command.type === 'leaveCabin' || game.units.some(unit => cabinOperands.includes(unit.id) && isInCabin(unit))) {
    const error = checkCommandLegality(game, owner, command);
    if (error) throw new Error(error.message);
  }
  if (command.type === 'enterCabin' || command.type === 'leaveCabin') {
    const selected=unitsByIds(game,command.unitIds,owner);
    const admitted=command.type==='enterCabin' ? new Set(cabinGroupSelection(game,selected)) : undefined;
    for (const unit of selected) {
      if (command.type === 'leaveCabin') leaveCabin(game,unit);
      else if (admitted!.has(unit.id)) assignUnitOrder(unit,{type:'enterCabin',shipId:unit.deck!.shipId});
    }
    return;
  }
  if(command.type==='boardShip') {
    const error=checkCommandLegality(game,owner,command);
    if(error)throw new Error(error.message);
    const ships=unitsByIds(game,command.unitIds,owner).filter(ship=>shipProfile(ship));
    if(!command.queued)cancelCrewRendezvous(game.units,new Set(ships.map(ship=>ship.id)));
    for(const ship of ships)
      assignUnitOrder(ship,{type:'boardShip',targetId:command.targetId},command.queued);
    return;
  }
  if(command.type==='cancelBoardShip') {
    const error=checkCommandLegality(game,owner,command);
    if(error)throw new Error(error.message);
    const ships=unitsByIds(game,command.unitIds,owner).filter(ship=>shipProfile(ship));
    cancelCrewRendezvous(game.units,new Set(ships.map(ship=>ship.id)));
    for(const ship of ships) {
      cancelShipBoarding(ship);
      if(ship.order.type==='boardShip')assignUnitOrder(ship,{type:'idle'});
    }
    settleGangwayCrossings(game.units);
    return;
  }
  if (command.type === "learnVeteranSkill") {
    const error = checkCommandLegality(game, owner, command);
    if (error) throw new Error(error.message);
    const unit = game.units.find(unit => unit.id === command.unitId)!;
    unit.veteranSkill = command.skill;
    refreshVeteranFrame(game);
    return;
  }
  if("unitIds" in command && !("queued" in command && command.queued) && ["move","attackMove","stop","holdPosition","unload","follow","aim","attack"].includes(command.type)){
    const ships=new Set(unitsByIds(game,command.unitIds,owner).filter(ship=>shipProfile(ship)).map(ship=>ship.id));
    if(ships.size)cancelCrewRendezvous(game.units,ships);
  }

  if (command.type === "move") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      assignUnitOrder(unit, deckPointOrder(game, unit, { type: "move", x: command.x, y: command.y, ...(command.avoidCombat ? {avoidCombat:true} : {}) }), command.queued);
    }
    addEffect(game, command.queued ? "queuedMove" : "move", command.x, command.y, command.queued ? 38 : 24, { owner });
    return;
  }

  if (command.type === "attackMove") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      assignUnitOrder(unit, deckPointOrder(game, unit, { type: unit.attackDamage > 0 ? "attackMove" : "move", x: command.x, y: command.y }), command.queued);
    }
    addEffect(game, command.queued ? "queuedAttack" : "attack", command.x, command.y, command.queued ? 42 : 28, { owner });
    return;
  }

  if (command.type === "stop") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) assignUnitOrder(unit, { type: "idle" });
    return;
  }

  if (command.type === "aim") {
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) throw new Error("Aim requires a finite point");
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (aimingProfile(weaponRules(game, unit))) assignUnitOrder(unit, { type: "aim", x: clamp(command.x, 0, game.map.width), y: clamp(command.y, 0, game.map.height) }, command.queued);
    }
    return;
  }

  // @@@hold-position - A unit told to hold its ground stays where it stands: it strikes whatever comes within its own reach
  // and nothing further, does not turn on an attacker out of reach, and does not dash. An idle or attack-moving unit
  // chases whoever shoots it (see player-aggro), which lets a shooter draw a whole army out after it.
  if (command.type === "holdPosition") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (unit.kind === "worker") continue;
      assignUnitOrder(unit, { type: "hold", x: unit.x, y: unit.y }, command.queued);
    }
    return;
  }

  if (command.type === "attack") {
    // A unit without a weapon (a transport) has nothing to attack with.
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (unit.attackDamage > 0) assignUnitOrder(unit, { type: "attack", targetId: command.targetId }, command.queued);
    }
    const target = findStrikeTarget(game, command.targetId);
    if (target) addEffect(game, command.queued ? "queuedAttackTarget" : "attackTarget", target.x, target.y, command.queued ? 44 : 32, { owner });
    return;
  }

  // @@@follow - Units told to follow an own unit or an ally's walk after it and keep near it until it dies or they are
  // told otherwise, as in Warcraft III; a right-click on an ally's unit gives it (a rally point onto an own unit too).
  if (command.type === "follow") {
    const target = game.units.find((unit) => unit.id === command.targetId && !areEnemyOwners(game, unit.owner, owner));
    if (!target) throw new Error(`Unknown friendly unit ${command.targetId}`);
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (unit !== target) assignUnitOrder(unit, { type: "follow", targetId: target.id }, command.queued);
    }
    addEffect(game, command.queued ? "queuedMove" : "move", target.x, target.y, command.queued ? 38 : 24, { owner });
    return;
  }

  if (command.type === "mine") {
    const resource = game.resources.find((candidate) => candidate.id === command.resourceId);
    if (!resource) throw new Error(`Unknown resource ${command.resourceId}`);
    for (const unit of unitsByIds(game, command.unitIds, owner).filter((unit) => unit.kind === "worker")) {
      // Reaffirming the same mine keeps the current haul and queue position.
      // Resetting gather here discarded completed work on every right-click.
      const order: UnitOrder = !command.queued && unit.order.type === "mine" && unit.order.resourceId === resource.id
        ? unit.order
        : { type: "mine", resourceId: resource.id, phase: unit.carryingGold > 0 ? "return" : "toMine", timer: 0 };
      assignUnitOrder(unit, order, command.queued);
    }
    addEffect(game, command.queued ? "queuedMine" : "mine", resource.x, resource.y, command.queued ? 44 : 30, { owner });
    return;
  }

  if (command.type === "repair") {
    const building = game.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) throw new Error(`Unknown ${owner} building ${command.buildingId}`);
    if (building.hp >= building.maxHp) throw new Error(`${building.kind} is already fully repaired`);
    for (const unit of unitsByIds(game, command.unitIds, owner).filter((unit) => unit.kind === "worker")) {
      assignUnitOrder(unit, { type: "repair", buildingId: building.id }, command.queued);
      if (unit.order.type === "repair" && unit.order.buildingId === building.id) unit.cooldown = 0;
    }
    addRepairHammerEffect(game, building, command.queued);
    return;
  }
  if (command.type === "repairUnit" || command.type === "repairShip") {
    const target = game.units.find(candidate => candidate.id === command.targetId && candidate.owner === owner
      && (command.type !== "repairShip" || unitMover(candidate.kind) === "sea"));
    if (!target) throw new Error(`Unknown ${owner} repair target ${command.targetId}`);
    if (!unitNeedsRepair(game, target)) throw new Error(`${target.kind} cannot be repaired or is already fully repaired`);
    for (const worker of unitsByIds(game, command.unitIds, owner).filter(unit => unit.kind === "worker"))
      assignUnitOrder(worker, { type: "repairUnit", targetId: target.id }, command.queued);
    return;
  }

  if (command.type === "build") {
    const worker = game.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) throw new Error(`Unknown ${owner} worker ${command.unitId}`);
    if (!RACE_DEFS[playerState(game, owner).race].buildableBuildings.includes(command.buildingKind)) throw new Error(`${playerState(game, owner).race} race cannot build ${command.buildingKind}`);
    const blocker = buildingPlacementBlocker(game, command.buildingKind, command);
    if (blocker) throw new Error(`${command.buildingKind} placement is too close to ${blocker.kind}`);
    if (terrainBlocksPlacement(game.map, command.buildingKind, command)) throw new Error(`${command.buildingKind} placement is on blocked ground`);
    if (playerState(game, owner).gold < BUILDING_DEFS[command.buildingKind].cost) throw new Error("Not enough gold");
    const at = snapToFootprint(game.map, BUILDING_DEFS[command.buildingKind].radius, command);
    // A plan is an order, not an entity: no remote HP, vision, collision or attack target.
    assignUnitOrder(worker, { type: "build", buildingKind: command.buildingKind, ...at, progressTick: game.tick, progressX: worker.x, progressY: worker.y });

    return;
  }

  if (command.type === "cancelTraining") {
    const building = game.buildings.find(b => b.id === command.buildingId && b.owner === owner);
    if (!building) throw new Error(`Unknown ${owner} building ${command.buildingId}`);
    const index = building.queue.findIndex(job => job.id === command.jobId);
    // A delayed/duplicate click must never cancel the following soldier.
    if (index < 0) return;
    const [job] = building.queue.splice(index, 1);
    const refund=job!.paidGold ?? UNIT_DEFS[job!.unitKind].cost;
    playerState(game, owner).gold += refund;
    game.match.stats.goldSpent[owner] = Math.max(0, (game.match.stats.goldSpent[owner] ?? 0) - refund);
    updateSupplyState(game);
    return;
  }

  if (command.type === "setRally") {
    setRally(game, owner, command.buildingIds, command.x, command.y, command.target);
    return;
  }

  if (command.type === "cast") {
    const unitCount = game.units.length;
    castAbility(game, owner, command.unitId, command.ability, command.targetId, command.x, command.y, command.queued);
    if (game.units.length !== unitCount) refreshVeteranFrameAfterCommandSpawn(game);
    return;
  }

  if (command.type === "setAutocast") {
    if (!canAutocast(command.ability)) throw new Error(`${command.ability} cannot be autocast`);
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (!unitAbilities(unit).includes(command.ability)) continue;
      const autocast = withAutocast(unit, command.ability, command.enabled);
      if (autocast) unit.autocast = autocast;
      else unit.autocast = undefined;
    }
    return;
  }

  if (command.type === "setStance") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (canTakeStance(unit.kind)) unit.stance = command.stance === "pursue" ? undefined : command.stance;
    }
    return;
  }

  if (command.type === "hire") {
    hireMercenary(game, owner, command.campId);
    refreshVeteranFrameAfterCommandSpawn(game);
    return;
  }

  if (command.type === "buy") {
    buyGood(game, owner, command.shopId, command.item, command.recipientId);
    return;
  }

  // Told to board, soldiers walk to the transport, and an idle transport sails in to meet them (see @@@transport).
  if (command.type === "board") {
    const transport = game.units.find((unit) => unit.id === command.transportId && unit.hp>0 && carries(unit) > 0);
    if (!transport) throw new Error(`Unknown ${owner} transport ${command.transportId}`);
    const boarders = unitsByIds(game, command.unitIds, owner).filter((unit) => canBoard(transport,unit,game.units));
    const existing = game.units.find(unit => unit.order.type === "board" && unit.order.transportId === transport.id);
    const shoreBoarder=boarders.find(unit=>!unit.deck);
    const berth = (existing?.order.type === "board" ? existing.order.berth : undefined) ?? (shoreBoarder && boardingBerth(game.map, shoreBoarder, transport));
    for (const unit of boarders) {
      assignUnitOrder(unit, { type: "board", transportId: transport.id, ...(!unit.deck && berth ? { berth } : {}) }, command.queued);
      const source=unit.deck && game.units.find(ship=>ship.id===unit.deck!.shipId && ship.owner===owner);
      if(source && !command.queued && !source.sailing?.gangway)assignUnitOrder(source,{type:"idle"});
    }
    return;
  }

  if (command.type === "unloadPassenger") {
    const transport = unitsByIds(game, [command.transportId], owner)[0];
    if (transport) unloadCargo(game, transport, command.passengerId);
    return;
  }

  if (command.type === "unload") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (carries(unit) > 0) assignUnitOrder(unit, { type: "unload", x: command.x, y: command.y, ...(command.avoidCombat ? {avoidCombat:true} : {}) }, command.queued);
    }
    addEffect(game, command.queued ? "queuedMove" : "move", command.x, command.y, command.queued ? 38 : 24, { owner });
    return;
  }

  if (command.type === "research") {
    const building = game.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) throw new Error(`Unknown ${owner} building ${command.buildingId}`);
    queueResearch(game, building, command.upgradeKind);
    return;
  }

  if(command.type==="buyShipEquipment"){
    const dock=game.buildings.find(building=>building.id===command.buildingId && building.owner===owner && building.kind==="shipyard" && building.complete);if(!dock)throw new Error("A completed shipyard is required");
    const delivery=command.recipientId!==undefined ? purchasePlacement(game,owner,dock,command.item,command.recipientId) : undefined;
    if(delivery && "refusal" in delivery)throw new Error(delivery.refusal);
    const def=SHIP_WEAPONS[command.item];spendGold(game,owner,def.cost);const at=walkableGoal(game.map,dock.x,dock.y+dock.radius+36,"land");
    const item:WorldItem={id:`ship-item-${game.nextId++}`,kind:command.item,x:at.x,y:at.y,durability:def.hp,cooldownRemaining:0};game.items.push(item);
    if(delivery && "placement" in delivery)deliverPurchase(game,item,delivery.placement);else addEffect(game,"summon",at.x,at.y,seconds(.8));return;
  }
  if (command.type === "transferItem") {
    const refusal=transferRefusal(game,owner,command.itemId,command.destination);if(refusal)throw new Error(refusal);
    const item=game.items.find(item=>item.id===command.itemId)!;const originalShip=item.shipId;const source=game.units.find(unit=>unit.id===item.carrierId);if(source)removeFromHands(source,item.id);
    delete item.carrierId;delete item.slot;delete item.shipId;delete item.holdSlot;delete item.mountId;delete item.aim;
    if("unitId" in command.destination){item.carrierId=command.destination.unitId;item.slot=command.destination.slot;}else{item.shipId=command.destination.shipId;if("mountId" in command.destination){item.mountId=command.destination.mountId;item.durability??=SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].hp;}else item.holdSlot=command.destination.slot;}
    invalidateItemIndex(game.items);
    for(const unit of game.units){if(shipProfile(unit) && (unit.id===originalShip || unit.id===item.shipId))rebuildShipFittings(game,unit);if(unit.id===source?.id || unit.id===item.carrierId || unit.id===originalShip || unit.id===item.shipId)applyDerivedUnitStats(game,unit);}refreshEquipmentMass(game);return;
  }
  if(command.type === "wieldItem"){
    const refusal=wieldRefusal(game,owner,command.unitId,command.itemId,command.hand);if(refusal)throw new Error(refusal);
    const unit=game.units.find(unit=>unit.id===command.unitId)!;unit.hands??={};
    if(command.itemId){removeFromHands(unit,command.itemId);unit.hands[command.hand]=command.itemId;const item=game.items.find(item=>item.id===command.itemId)!;if(itemHands(item)===2)delete unit.hands.left;}else delete unit.hands[command.hand];
    unit.aim=undefined;unit.cooldown=Math.max(unit.cooldown,seconds(.35));applyDerivedUnitStats(game,unit);return;
  }
  if (command.type === "pickupItem") {
    pickupItem(game, owner, command.unitId, command.itemId, command.queued);
    return;
  }

  if (command.type === "dropItem") {
    dropItem(game, owner, command.unitId, command.itemId, command.x, command.y);
    return;
  }

  if (command.type === "useItem") {
    useItem(game, owner, command.unitId, command.itemId, command.targetId, command.x, command.y);
    return;
  }

  const building = game.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
  if (!building) throw new Error(`Unknown ${owner} building ${command.buildingId}`);
  queueTraining(game, building, command.unitKind);
}

export function stepGame(game: Game) {
  if (game.match.winner) return;
  bindGangwayCrewRules(game.units,game);
  if(game.units.some(unit=>unit.cargo))restoreCargoDecks(game.units);
  syncDecks(game.units);
  updateCabinPassengers(game);
  game.tick += 1;
  updateWindField(game.map, game.tick);
  // Auras and their spatial query start from this tick's actual positions, including after restore.
  game.unitSpatial = createSpatialIndex(game.units, 320);
  refreshVeteranFrame(game);
  syncBuildingBodies(game);
  updateWorldEffects(game);
  updateProjectiles(game);
  updateUnitStatusEffects(game);
  updateConstruction(game);
  updateTraining(game);
  updateResearch(game);
  updateResources(game);
  game.miningFrame = prepareMiningFrame(game);
  updateMercenaryCamps(game);
  if (game.shops) restockShops(game.shops);
  game.unitSpatial = createSpatialIndex(game.units, 320);
  game.unitSpatialByTeam = createTeamSpatialIndexes(game, game.units, 230);
  game.shipReachPadding = shipReachPadding(game.units);
  if (!game.buildingSpatial || game.buildingSpatialCount !== game.buildings.length) {
    game.buildingSpatial = createSpatialIndex(game.buildings, 420);
    game.buildingSpatialByTeam = createTeamSpatialIndexes(game, game.buildings, 260);
    game.buildingSpatialCount = game.buildings.length;
  }
  game.entityById = createEntityIndex(game);
  updateItems(game);
  updateMoonWellHealing(game);
  updateRegeneration(game);
  updateDockRepairs(game);
  updateTowerAttacks(game);
  const starts = new Map(shipsIn(game.units).map(ship => [ship.id, { x: ship.x, y: ship.y, heading: ship.sailing!.heading }]));
  beginShipMotionFrame(game.units,game.map,game.buildingBodiesSeen ?? game.buildings);
  beginShipPlanningFrame(game.units,game.tick);
  updateShipGangways(game.map,game.units,game.tick,game);
  prepareCrewRendezvous(game.map,game.units);
  game.boardingHolds=boardingHoldShips(game.units);
  const defenses=prepareShipDefenseFrame(game,(ship,range,visit)=>forEachNearbyEnemyUnit(game,ship.owner,ship,range,visit),game.boardingHolds);
  const shoreBoarders = new Map<string, Unit[]>();
  for (const unit of game.units) if (unit.hp > 0 && !unit.deck && unit.order.type === 'board') {
    const waiting = shoreBoarders.get(unit.order.transportId);
    if (waiting) waiting.push(unit); else shoreBoarders.set(unit.order.transportId, [unit]);
  }
  for (const ship of shipsIn(game.units)) {
    // Shore boarding gives an idle boat a ferry voyage without replacing its
    // order. Its sails must stay available while it approaches the passenger.
    const collecting = ship.order.type === 'idle' && shoreBoarders.get(ship.id)?.some(unit => unit.owner === ship.owner && !alongside(unit, ship));
    const idle = game.boardingHolds.has(ship.id) || ship.order.type === 'hold' || ship.order.type === 'idle' && !collecting && !defenses.has(ship.id)
      || !!ship.sailing?.gangway && ship.sailing.gangway.phase!=='approach';
    updateAutoTrim(ship, game.map, idle ? 'idle' : ship.sailing?.sail?.mode === 'idle' ? 'sail' : undefined);
  }
  const ferry = updateUnits(game,defenses);
  updateMountedWeapons(game,starts,defenses);
  if (ferry) ferryUnits(game, ferry, starts);
  for (const ship of shipsIn(game.units)) { const start = starts.get(ship.id); if (start && ship.sailing && start.x === ship.x && start.y === ship.y) ship.sailing.speed = 0; }
  updateShipGangways(game.map,game.units,game.tick,game);
  settleGangwayCrossings(game.units);
  syncDecks(game.units);
  settleDeckSupport(game.units,game.map);
  updateCabinPassengers(game);
  slideUnits(game);
  separateUnits(game);
  syncDecks(game.units);
  if (game.map.terrain) keepUnitsOutOfBuildings(game);
  for(const impact of drainShipCollisionImpacts(game.units)) {
    const other=impact.other;
    const source=other && !isObstacle(other) ? other : impact.ship;
    if(impact.ship.hp>0 && impact.shipDamage>0){
      const taken=applyDamage(game,source,impact.ship,impact.shipDamage,0,impact.point,0,DAMAGE_PROFILES.EXPLOSION);
      if(taken!==undefined && taken>0)addHitEffect(game,impact.ship,taken);
    }
    if(other && other.hp>0 && impact.otherDamage>0){
      const taken=applyDamage(game,impact.ship,other,impact.otherDamage,0,impact.point,0,DAMAGE_PROFILES.EXPLOSION);
      if(taken!==undefined && taken>0)addHitEffect(game,other,taken);
    }
  }
  for (const ship of shipsIn(game.units)) {
    const start = starts.get(ship.id);
    if (!ship.sailing) continue;
    ship.sailing.velocityX = start ? (ship.x - start.x) * SIM_TICKS_PER_SECOND : 0;
    ship.sailing.velocityY = start ? (ship.y - start.y) * SIM_TICKS_PER_SECOND : 0;
  }
  for (const unit of game.units) if(unit.aim)invalidateMovedAim(unit, weaponRules(game, unit));
  removeExpiredUnits(game);
  removeDead(game);
  if(settleGroundItems(game.items,game.units,game.map))refreshEquipmentMass(game);
  updateShipOwnership(game);
  syncBuildingBodies(game);
  // Snapshots and restored games observe the same aura boundary after movement, deaths and captures.
  game.unitSpatial = createSpatialIndex(game.units, 320);
  refreshVeteranFrame(game);
  updateVictory(game);
}

// Hands the map's routing the buildings standing now, and the rocks and gates (see @@@obstacle), whenever one was laid
// down or fell (see @@@building-pathing): at the step's start, for the sites laid by the commands before it, and after the
// dead are gone, so what a planner reads between steps is current.
function syncBuildingBodies(game: Game) {
  const seen = game.buildingBodiesSeen;
  const obstacles = game.obstacles ?? [];
  const count = game.buildings.length;
  if (seen && seen.length === count + obstacles.length && game.buildings.every((building, index) => building === seen[index]) && obstacles.every((obstacle, index) => obstacle === seen[count + index])) return;
  game.buildingBodiesSeen = [...game.buildings, ...obstacles];
  setBuildingBodies(game.map, game.buildingBodiesSeen);
}

function copyUnitOrder(order:UnitOrder):UnitOrder {
  const copy={...order};
  if((copy.type==='move'||copy.type==='attackMove') && copy.deckPoint)copy.deckPoint={...copy.deckPoint};
  if(copy.type==='board'){
    if(copy.deckPoint)copy.deckPoint={...copy.deckPoint};
    if(copy.rendezvous)copy.rendezvous={...copy.rendezvous};
    if(copy.berth)copy.berth={...copy.berth};
  }
  return copy;
}
export function snapshotGame(game: Game): GameSnapshot {
  const snapshot:GameSnapshot = {
    equipmentVersion: 1,
    rateUnits: "perSecond",
    tick: game.tick,
    match: {
      winner: game.match.winner,
      endedAtTick: game.match.endedAtTick,
      stats: {
        unitsKilled: { ...game.match.stats.unitsKilled },
        unitsLost: { ...game.match.stats.unitsLost },
        buildingsDestroyed: { ...game.match.stats.buildingsDestroyed },
        nonBaseBuildingsDestroyed: { ...game.match.stats.nonBaseBuildingsDestroyed },
        goldSpent: { ...game.match.stats.goldSpent },
        mercenaryKills: { ...game.match.stats.mercenaryKills },
        neutralUnitsKilled: { ...game.match.stats.neutralUnitsKilled },
        unitsKilledByNeutral: { ...game.match.stats.unitsKilledByNeutral },
      },
    },
    map: { ...game.map, ...(game.map.wind ? { wind: { ...game.map.wind } } : {}) },
    teams: { ...game.teams },
    players: Object.fromEntries(Object.entries(game.players).map(([owner, player]) => [owner, { ...player, upgrades: { ...player.upgrades } }])) as PlayerStateMap,
    units: game.units.map((unit) => {
      // Most units have no deck or gun state. Copy only the nested state present,
      // rather than allocating empty intermediate objects for every optional field.
      const copy = { ...unit, order: copyUnitOrder(unit.order), orderQueue: unit.orderQueue?.map(copyUnitOrder) ?? [] };
      if (unit.aim) copy.aim = { ...unit.aim };
      if (unit.deck) copy.deck = { ...unit.deck };
      if (unit.cabin) copy.cabin = { ...unit.cabin };
      if (unit.hands) copy.hands = { ...unit.hands };
      if (unit.shipParts) copy.shipParts = { ...unit.shipParts };
      if (unit.fittings) copy.fittings = unit.fittings.map(fitting => ({ ...fitting, accepts: [...fitting.accepts] }));
      if (unit.sailing) {
        copy.sailing = { ...unit.sailing };
        if (unit.sailing.sail) copy.sailing.sail = { ...unit.sailing.sail };
        if (unit.sailing.pursuit) copy.sailing.pursuit = { ...unit.sailing.pursuit };
        if (unit.sailing.defense) copy.sailing.defense = { ...unit.sailing.defense };
        if(unit.sailing.gangway)copy.sailing.gangway={...unit.sailing.gangway,sourceAnchor:{...unit.sailing.gangway.sourceAnchor},targetAnchor:{...unit.sailing.gangway.targetAnchor}};
        if (unit.sailing.route) copy.sailing.route = { ...unit.sailing.route, end: { ...unit.sailing.route.end }, points: unit.sailing.route.points.map(point => ({ ...point,...(point.pivot?{pivot:{...point.pivot}}:{}) })) };
      }
      if(unit.gangway)copy.gangway={...unit.gangway};
      if (unit.abilityCooldowns) copy.abilityCooldowns = { ...unit.abilityCooldowns };
      if (unit.autocast) copy.autocast = { ...unit.autocast };
      if (unit.veteranSkillChoices) copy.veteranSkillChoices = [...unit.veteranSkillChoices];
      copy.effects = unit.effects.map(effect => ({ ...effect, ...(effect.damageFilter ? {
        damageFilter: Object.fromEntries(Object.entries(effect.damageFilter).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])),
      } : {}) }));
      return copy;
    }),
    buildings: game.buildings.map((building) => {
      const { rallyTarget, ...rest } = building;
      return {
        ...rest,
        ...(rallyTarget ? { rallyTarget: { ...rallyTarget } } : {}),
        queue: building.queue.map((job) => ({ ...job })),
        researchQueue: building.researchQueue.map((job) => ({ ...job })),
      };
    }),
    resources: game.resources.map((resource) => ({ ...resource })),
    mercenaryCamps: game.mercenaryCamps.map((camp) => ({ ...camp })),
    ...(game.shops ? { shops: game.shops.map((shop) => ({ ...shop, goods: shop.goods.map((good) => ({ ...good })) })) } : {}),
    items: game.items.map(item => ({...item,...(item.aim?{aim:{...item.aim}}:{}),...(item.deck?{deck:{...item.deck}}:{})})),
    projectiles: game.projectiles.map(projectile => ({ ...projectile,
      ...(projectile.damageProfile ? { damageProfile: { ...projectile.damageProfile } } : {}),
      ...(projectile.weapon ? { weapon: { ...projectile.weapon, ...(projectile.weapon.damageProfile ? { damageProfile: { ...projectile.weapon.damageProfile } } : {}) } } : {}),
    })),
    effects: game.effects.map(effect => ({ ...effect, ...(effect.damageProfile ? { damageProfile: { ...effect.damageProfile } } : {}) })),
    ...(game.corpses ? { corpses: game.corpses.map(corpse => ({ ...corpse })) } : {}),
    // A variant's rules are replaced whole when they change, never edited, so the snapshot may share them.
    ...(game.variants ? { variants: { ...game.variants } } : {}),
    ...(game.obstacles ? { obstacles: game.obstacles.map((obstacle) => ({ ...obstacle, along: { ...obstacle.along } })) } : {}),
  };
  bindGangwayCrewRules(snapshot.units,snapshot);
  shareBuildingBodies(game.map, snapshot.map);
  return snapshot;
}

export function restoreSnapshotIntoGame(game: Game, snapshot: GameSnapshot, nextId: number): void {
  game.equipmentVersion = 1;
  game.rateUnits = "perSecond";
  game.tick = snapshot.tick;
  game.match = cloneSnapshotValue(snapshot.match);
  game.map = cloneSnapshotValue(snapshot.map);
  game.teams = snapshot.teams ? definedTeams(snapshot.teams) : { ...game.teams };
  game.players = cloneSnapshotValue(snapshot.players);
  const colors=assignPlayerColors(Object.keys(game.players),Object.fromEntries(Object.entries(game.players).map(([owner,player])=>[owner,player.color])));
  for(const [owner,player] of Object.entries(game.players))player.color=colors[owner]!;
  if (snapshot.teams) game.activePlayers = Object.keys(snapshot.teams).filter(owner => snapshot.players[owner] !== undefined);
  game.units = cloneSnapshotValue(snapshot.units).map(withUnitShape);
  game.buildings = cloneSnapshotValue(snapshot.buildings);
  game.resources = cloneSnapshotValue(snapshot.resources);
  game.mercenaryCamps = cloneSnapshotValue(snapshot.mercenaryCamps);
  if (snapshot.shops) game.shops = cloneSnapshotValue(snapshot.shops);
  else delete game.shops;
  game.items = cloneSnapshotValue(snapshot.items);
  game.projectiles = cloneSnapshotValue(snapshot.projectiles);
  game.effects = cloneSnapshotValue(snapshot.effects);
  if (snapshot.corpses) game.corpses = cloneSnapshotValue(snapshot.corpses);
  else delete game.corpses;
  if (snapshot.variants) game.variants = cloneSnapshotValue(snapshot.variants);
  else delete game.variants;
  if (snapshot.obstacles) game.obstacles = cloneSnapshotValue(snapshot.obstacles);
  else delete game.obstacles;
  if (!snapshot.rateUnits) migrateSnapshotRates(game);
  for(const building of game.buildings)for(const job of building.queue)if(job.paidGold===undefined)job.paidGold=isShipKind(job.unitKind) ? PREVIOUS_SHIP_TRAIN_COST[job.unitKind as keyof typeof PREVIOUS_SHIP_TRAIN_COST] : UNIT_DEFS[job.unitKind].cost;
  migrateShipSizes(game.units);
  restoreCargoDecks(game.units);
  for (const ship of shipsIn(game.units)) if (ship.shipParts) ship.shipParts.cabin ??= shipPartMax(ship).cabin;
  // Early naval previews had a separate leg piece. Fold those saved items into
  // body armor and reassign their positions without discarding equipment.
  const removedArmor = game.items.some(item => (item.kind as string) === 'legGuards' || (item.slot as string) === 'legs');
  if (removedArmor) {
    for (const item of game.items) {
      if ((item.kind as string) === 'legGuards') { item.kind = 'leatherArmor'; delete item.slot; }
      else if ((item.slot as string) === 'legs') delete item.slot;
    }
    normalizeEquipment(game);
    refreshEquipmentMass(game);
  }
  if (game.shops) for (const shop of game.shops) shop.goods = shop.goods.filter(good => (good.kind as string) !== 'legGuards');
  if (snapshot.equipmentVersion !== 1) {
    initializeShipEquipment(game);
    normalizeEquipment(game,true);
    refreshEquipmentMass(game);
  }
  game.nextId = nextId;
  normalizeEquipment(game);
  keepShipsOnWater(game.map,game.units);
  syncDecks(game.units);
  invalidateGameRuntimeCaches(game);
  refreshVeteranFrame(game);
  bindGangwayCrewRules(game.units,game);
}

/** Old saves used 20 Hz rates, including passengers and campaign rule overrides. */
function migrateSnapshotRates(game: Game): void {
  const migrate = (unit: Unit) => {
    unit.speed *= 20;
    if (unit.pushX !== undefined) unit.pushX *= 20;
    if (unit.pushY !== undefined) unit.pushY *= 20;
    unit.cargo?.forEach(migrate);
  };
  game.units.forEach(migrate);
  for (const rules of Object.values(game.variants ?? {})) {
    rules.speed *= 20;
    if (rules.aimSpeed !== undefined) rules.aimSpeed *= 20;
  }
}

function invalidateGameRuntimeCaches(game: Game): void {
  delete game.veteranFrame;
  delete game.veteranAutocastFrame;
  delete game.boardingHolds;
  delete game.unitSpatial;
  delete game.unitSpatialByTeam;
  delete game.shipReachPadding;
  delete game.buildingSpatial;
  delete game.buildingSpatialByTeam;
  delete game.buildingSpatialCount;
  delete game.buildingBodiesSeen;
  delete game.entityById;
}

function cloneSnapshotValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function definedTeams(teams: Partial<Record<PlayerId, string>>): Record<PlayerId, string> {
  return Object.fromEntries(Object.entries(teams).filter((entry): entry is [PlayerId, string] => typeof entry[1] === "string"));
}

function updateConstruction(game: Game) {
  for (const building of game.buildings) {
    if (building.complete) continue;
    // A site goes up with the work of the workers sent to it, at it (see @@@building-work): the builder's order is to repair
    // it, and a worker sent to help repairs it too, as a peasant does in Warcraft III. Counted by who stood near it, one
    // worker among three sites raised all three at once, and a miner passing a site was set idle when it was done (the
    // owner, 10-02).
    const builders = constructionWorkers(game, building);
    if (builders.length === 0) continue;
    for (const builder of builders) emitWorkerWork(game, builder, building);
    // The site gains health with the work done (see construction-hp): each builder's share of the build time brings the
    // same share of the health it started without.
    const before = building.buildProgress;
    building.buildProgress = Math.min(building.buildTime, building.buildProgress + builders.length);
    const gained = ((building.buildProgress - before) / Math.max(1, building.buildTime)) * (building.maxHp - constructionStartHp(building.maxHp));
    building.hp = Math.min(building.maxHp, building.hp + gained);
    if (building.buildProgress >= building.buildTime) {
      applyDerivedBuildingStats(game, building);
      building.complete = true;
      for (const builder of builders) builder.order = { type: "idle" };
      updateSupplyState(game);
    }
  }
}

function updateTraining(game: Game) {
  for (const building of game.buildings) {
    if (!building.complete || building.queue.length === 0) continue;
    const job = building.queue[0];
    if (!job) continue;
    job.remaining = Math.max(0,job.remaining-1);
    if (job.remaining > 0) continue;
    const sea=unitMover(job.unitKind)==="sea";
    const launch=sea ? shipLaunchPose(game,building,shipLaunchPrototype(building,job.unitKind)) : undefined;
    const from=sea ? launch : landSpawnPoint(game,building,landSpawnPrototype(building,job.unitKind));
    // A paid job waits for a legal local exit. Rally direction chooses among
    // those exits rather than placing the new unit inside a body or beyond it.
    if(!from)continue;
    const unit = game.spawnUnit(building.owner, job.unitKind, from.x, from.y,launch);
    building.queue.shift();
    unit.order = rallyOrderForUnit(game, building, unit);
  }
}

function updateResearch(game: Game) {
  for (const building of game.buildings) {
    if (!building.complete || building.researchQueue.length === 0) continue;
    const job = building.researchQueue[0];
    if (!job) continue;
    job.remaining -= 1;
    if (job.remaining > 0) continue;
    building.researchQueue.shift();
    completeResearch(game, building.owner, job.upgradeKind, job.targetLevel);
  }
}

function updateTowerAttacks(game: Game) {
  for (const building of game.buildings) {
    if (!building.complete || building.attackDamage <= 0) continue;
    building.cooldown = Math.max(0, building.cooldown - 1);
    if (building.cooldown > 0) continue;
    const target = nearestEnemyTargetFromPoint(game, building.owner, building, building.attackRange);
    if (!target) continue;
    applyWeaponAttack(game, building, target, building.attackDamage, building.attackRange);
    building.cooldown = building.attackCooldown;
  }
}

function updateMoonWellHealing(game: Game) {
  for (const building of game.buildings) {
    if (!building.complete || !isHealingBuildingKind(building.kind)) continue;
    building.cooldown = Math.max(0, building.cooldown - 1);
    if (building.cooldown > 0) continue;
    const target = mostWoundedSoldierNear(game, building);
    if (!target) continue;
    target.hp = Math.min(target.maxHp, target.hp + SUPPORT_BUILDING_HEAL);
    building.cooldown = building.attackCooldown;
    addEffect(game, "heal", target.x, target.y, MOON_WELL_HEAL_EFFECT_DURATION, { fromX: building.x, fromY: building.y, toX: target.x, toY: target.y });
  }
}

function mostWoundedSoldierNear(game: Game, building: Building) {
  let target: Unit | undefined;
  let targetScore = 0;
  forEachNearbyUnit(game, building, building.attackRange, (unit) => {
    if (!canReceiveHealing(unit, game) || unit.owner !== building.owner || unit.kind === "worker" || unit.hp >= unit.maxHp || distance(unit, building) > building.attackRange) return;
    const score = (unit.maxHp - unit.hp) * 2 + (1 - unit.hp / Math.max(1, unit.maxHp)) * 80;
    if (score <= targetScore) return;
    target = unit;
    targetScore = score;
  });
  return target;
}

function updateDockRepairs(game: Game) {
  if (game.tick % seconds(1)) return;
  for (const ship of game.units) {
    if (!shipProfile(ship) || !unitNeedsRepair(game,ship) || !isPlayerId(ship.owner) || ship.order.type==="attack" || ship.order.type==="attackMove") continue;
    const dock=game.buildings.find(building=>building.owner===ship.owner && building.kind==="shipyard" && building.complete && distance(ship,building)<DOCK_REPAIR.range);
    if (!dock || playerState(game,ship.owner).gold<DOCK_REPAIR.goldPerSecond)continue;
    spendGold(game,ship.owner,DOCK_REPAIR.goldPerSecond);repairShipParts(game,ship,DOCK_REPAIR.hpPerSecond);
  }
}

function updateRegeneration(game: Game) {
  for (const unit of game.units) {
    if (unit.hp <= 0) continue;
    const regenPerSecond = unitRegenPerSecond(game, unit);
    if (regenPerSecond <= 0 || unit.hp >= unit.maxHp) continue;
    unit.hp = Math.min(unit.maxHp, unit.hp + regenPerSecond / 20);
  }
}

// A unit's own regeneration (the cinder revenant's) plus what leadership gives its veterans.
export function unitRegenPerSecond(game: GameSnapshot, unit: Unit) {
  const veterans = "nextId" in game ? (game as Game).veteranFrame : buildVeteranFrame(game);
  return canReceiveHealing(unit, game) ? (unitRules(game, unit).regenPerSecond ?? 0) + leadershipRegenPerSecond(game, unit) + (veterans?.get(unit.id)?.regenPerSecond ?? 0) : 0;
}

function veteranNearby(game: Game) {
  return (x: number, y: number, radius: number) => {
    const units: Unit[] = [];
    forEachNearbyUnit(game, { x, y }, radius, unit => units.push(unit));
    return units;
  };
}
function refreshVeteranFrameAfterCommandSpawn(game: Game) {
  // SDK commands may be saved before the next tick. Include new units at their final spawn positions.
  game.unitSpatial = createSpatialIndex(game.units, 320);
  refreshVeteranFrame(game);
}
function refreshVeteranFrame(game: Game) {
  const previous = game.veteranFrame;
  game.veteranFrame = buildVeteranFrame(game, veteranNearby(game));
  for (const unit of game.units) {
    if (unit.hp > 0 && (previous?.has(unit.id) || game.veteranFrame.has(unit.id))) {
      const hp = unit.hp;
      applyDerivedUnitStats(game, unit);
      // Aura projection changes derived combat stats, never health (including fractions below one).
      unit.hp = Math.min(hp, unit.maxHp);
    }
  }
}
function veteranAimSpeed(game: Game, unit: Unit) {
  return game.veteranFrame?.get(unit.id)?.aimSpeedMultiplier ?? 1;
}
function applyVeteranAbility(game: Game, caster: Unit, ability: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "veteran" }>, automatic: boolean) {
  return castVeteranAbility(game, caster, ability.skill, automatic,
    (type, x, y, duration, options) => addEffect(game, type, x, y, duration, options), veteranNearby(game), game.veteranAutocastFrame);
}

export { unitRules };

export function leadershipRegenPerSecond(game: GameSnapshot, unit: Unit) {
  if (!canReceiveHealing(unit, game) || !isPlayerId(unit.owner) || unit.level <= 0) return 0;
  const upgrade = UPGRADE_DEFS.leadership;
  const ownerState = game.players[unit.owner];
  if (!ownerState) throw new Error(`Missing player state for ${unit.owner}`);
  const level = ownerState.upgrades.leadership ?? 0;
  const levelDef = upgrade.levels[level - 1];
  return levelDef?.veteranRegenByStars?.[Math.min(MAX_UPGRADE_LEVEL, unit.level) - 1] ?? 0;
}

function updateMercenaryCamps(game: Game) {
  for (const camp of game.mercenaryCamps) {
    camp.cooldownRemaining = Math.max(0, camp.cooldownRemaining - 1);
  }
}

/** Both ordinary shots and weapon skills use the fitting's own reticle. */
function aimMountedWeapon(game:Game,ship:Unit,item:WorldItem,point:{x:number;y:number},pose=mountedWeaponPose(ship,item)!) {
  const def=SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
  const mount=shipMounts(ship).find(mount=>mount.id===item.mountId)!;
  // A fixed fitting travels with its deck. World displacement must not reset
  // its reticle every few ticks while the carrying hull is making way.
  const proxy={...ship,x:pose.pivot.x,y:pose.pivot.y,deck:{shipId:ship.id,x:mount.x,y:mount.y},aim:item.aim};
  const {naval:_hull,...weaponBase}=unitRules(game,ship);
  const ready=aimAt(proxy,{...weaponBase,attackDamage:def.damage,attackRange:def.range,aimSpeed:def.aimSpeed,weapon:def.weapon},point,game.tick,veteranAimSpeed(game,ship));
  if(proxy.aim)item.aim=proxy.aim;else delete item.aim;
  if(proxy.facing!==undefined)item.facing=proxy.facing;
  return ready?proxy:undefined;
}
function friendlyFireBlockers(game:Game,ship:Unit){
  return shipsIn(game.units).filter(other=>other.id!==ship.id && other.hp>0 && !areEnemyOwners(game,ship.owner,other.owner));
}
function mountedShotClear(ship:Unit,blockers:readonly Unit[]):MountedShotClear|undefined{
  if(!blockers.length)return undefined;
  const poses=new Map<number,Unit>();
  return(item,point,heading)=>{
    let aimed=poses.get(heading);
    if(!aimed){aimed={...ship,sailing:{...ship.sailing!,heading}};shareShipProfile(ship,aimed);poses.set(heading,aimed);}
    return mountedFireLaneClear(aimed,item,point,blockers);
  };
}
function updateMountedWeapons(game:Game,starts:Map<string,{x:number;y:number;heading:number}>,defenses:ShipDefenseFrame){
  const crossing=game.boardingHolds!;
  for(const ship of shipsIn(game.units)){
    if(ship.hp<=0 || isStaggered(ship) || isStunned(ship) || !shipProfile(ship) || "avoidCombat" in ship.order && ship.order.avoidCombat)continue;
    const order=ship.order;
    const blockers=friendlyFireBlockers(game,ship);
    const weapons=installedWeapons(game,ship),mounts=shipMounts(ship);
    const acquisitionRange=weapons.reduce((reach,item)=>{
      if((item.durability ?? 1)<=0)return reach;
      const mount=mounts.find(mount=>mount.id===item.mountId);
      const def=SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
      return mount ? Math.max(reach,veteranWeaponRange(ship,def.range)+Math.hypot(mount.x,mount.y)) : reach;
    },ship.attackRange);
    const intrinsic=unitRules(game,ship).intrinsicAttack;
    const ordered=(order.type==="attack" || order.type==="attackMove") && order.targetId ? findStrikeTarget(game,order.targetId) : undefined;
    const explicit=order.type==='attack' && order.leashX===undefined;
    const requested=defenses.get(ship.id)?.target ?? (ordered && (explicit || isObstacle(ordered) || automaticTargetAllowed(game.units,ship.owner,ordered)) ? ordered : undefined);
    // Acquire far enough to include the offset battery, not just the hull
    // center. Actual heading and firing still use each pivot's own range.
    let facingPoint=order.type==="aim" ? order : requested ?? (["attackMove","idle","hold"].includes(order.type) ? nearestEnemyTarget(game,ship,acquisitionRange) : undefined);
    if(facingPoint && "owner" in facingPoint && !isObstacle(facingPoint))facingPoint=navalCombatTarget(game,ship,facingPoint);
    const orientHull = ['idle', 'hold', 'aim'].includes(order.type)
      || (order.type === 'attack' || order.type === 'attackMove') && shipCanTurnForAttack(ship);
    if(!crossing.has(ship.id) && facingPoint && (shipCanTurnForAttack(ship) || strikeGap(ship,facingPoint)<=acquisitionRange) && orientHull) {
      turnShipToward(ship,bestFiringHeading(game,ship,facingPoint,0,mountedShotClear(ship,blockers)),game.map,game.units,Math.abs(headingDifference(starts.get(ship.id)!.heading,ship.sailing!.heading)));
    }
    for(const item of weapons){
      if((item.durability ?? 1)<=0 || item.cooldownRemaining>0 || item.mountId==="bow" && !intrinsic && ship.cooldown>0)continue;
      const def=SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS],pose=mountedWeaponPose(ship,item)!;
      const range=veteranWeaponRange(ship,def.range);
      const canShoot=(candidate:Unit|Building|Obstacle)=>{
        const point=mountedTargetPoint(game,ship,item,candidate,pose),gap=distance(pose.pivot,point);
        return shipGunCanAim(ship,item,point) && gap<=range && gap>=(def.weapon.minRange??0)
          && (!blockers.length || mountedFireLaneClear(ship,item,point,blockers));
      };
      const preferred=requested && !isObstacle(requested) ? navalCombatTarget(game,ship,requested) : requested;
      // The ordered enemy remains the navigator's objective. A gun which
      // cannot bear on it may still defend against another reachable enemy.
      const target=preferred && areEnemyOwners(game,ship.owner,preferred.owner) && canShoot(preferred) ? preferred
        : nearestEnemyTargetFromPoint(game,ship.owner,pose.pivot,range,ship,candidate=>canShoot(candidate) && (!["move","unload","follow"].includes(order.type) || candidate.attackDamage>0));
      const aimTarget=order.type==="aim" && !target ? order : target;
      const point=target ? mountedTargetPoint(game,ship,item,target,pose) : aimTarget && strikePoint(pose.pivot,aimTarget);
      if(!point || !shipGunCanAim(ship,item,point) || distance(pose.pivot,point)>range || def.weapon.minRange && distance(pose.pivot,point)<def.weapon.minRange)continue;
      const proxy=aimMountedWeapon(game,ship,item,point,pose);
      if(!proxy || !target)continue;
      const launchPose=mountedWeaponPose(ship,item)!;
      if(blockers.length && !shipFireLaneClear(launchPose.muzzle,point,def.weapon,blockers))continue;
      fireWeapon(game,ship,target,Math.round(def.damage*(nonStarUnitStats(game,ship).attackDamage/Math.max(1,weaponRules(game,ship).attackDamage))*outgoingDamageMultiplier(game,ship)),def.weapon,range,{},target.id,{item,pose:launchPose,aimPoint:point});
      markAimShot(proxy);item.cooldownRemaining=attackCooldownOf(game,ship,def.cooldown);if(item.mountId==="bow" && !intrinsic)ship.cooldown=item.cooldownRemaining;
    }
  }
}

function refreshEquipmentMass(game:Game,units:readonly Unit[]=game.units){for(const unit of units){unit.gearMass=unitItemMass(game,unit);if(shipProfile(unit))unit.holdMass=shipItemMass(game,unit);}}

function updateItems(game: Game) {
  // The carriers a ring has healed this tick: a second ring heals no more (see @@@shop-goods).
  let ringed: Set<string> | undefined;
  const unitsById = game.entityById!;
  for (const item of game.items) {
    if(item.cooldownRemaining>0)item.cooldownRemaining = Math.max(0, item.cooldownRemaining - 1);
    const entity = item.carrierId ? unitsById.get(item.carrierId) : undefined;
    const carrier=entity && isUnit(entity) ? entity : undefined;
    if(item.shipId){const ship=unitsById.get(item.shipId);if(ship){item.x=ship.x;item.y=ship.y;}continue;}
    if (!carrier) continue;
    item.x = carrier.x;
    item.y = carrier.y;
    if (!isInCabin(carrier) && item.kind === "flameCloak" && itemEquipped(game,carrier,item)) applyFlameCloak(game, carrier, item);
    if (canReceiveHealing(carrier, game) && item.kind === "regenRing" && itemEquipped(game,carrier,item) && carrier.hp < carrier.maxHp && !ringed?.has(carrier.id)) {
      carrier.hp = Math.min(carrier.maxHp, carrier.hp + perTick(RING_REGEN_PER_SECOND));
      (ringed ??= new Set()).add(carrier.id);
    }
    if (!isInCabin(carrier) && carrier.owner === "neutral" && itemEquipped(game,carrier,item)) activateNeutralItem(game, carrier, item);
  }
}

function updateResources(game: Game) {
  for (const resource of game.resources) {
    resource.harvestCooldownRemaining = Math.max(0, (resource.harvestCooldownRemaining ?? 0) - 1);
  }
}

// The units under way to board a transport, and the transports under way to unload, as updateUnits found them: what
// ferryUnits has to look at (see @@@transport), so that no other pass looks over every unit for them.
type Ferry = { boarding: Unit[]; unloading: Unit[] };

function updateUnits(game: Game, defenses: ShipDefenseFrame): Ferry | undefined {
  game.veteranAutocastFrame = {};
  let ferry: Ferry | undefined;
  const vessels=shipsIn(game.units);
  const ordered=vessels.length ? [...vessels,...game.units.filter(unit=>!isShipKind(unit.kind))] : game.units.slice();
  for (const unit of ordered) {
    if (unit.sailing?.pursuit && !['attack', 'attackMove', 'follow'].includes(unit.order.type) && !defenses.has(unit.id)) delete unit.sailing.pursuit;
    if(unit.aim)invalidateMovedAim(unit, weaponRules(game, unit));
    unit.cooldown = Math.max(0, unit.cooldown - 1);
    if (unit.abilityCooldowns) {
      const left = tickedAbilityCooldowns(unit.abilityCooldowns);
      if (left) unit.abilityCooldowns = left;
      else unit.abilityCooldowns = undefined;
    }
    if (isInCabin(unit) || cabinCrewMovedThisTick(game,unit)) continue;
    if (unit.order.type === 'enterCabin') {
      if (!isStaggered(unit) && !isStunned(unit)) enterCabinStep(game,unit,statusPace(unit),other=>isStaggered(other)||isStunned(other)?0:statusPace(other));
      continue;
    }
    // A charging rider rides its own slide (see @@@charge); any other unit off its feet (see @@@push) neither walks,
    // strikes nor casts, and its order waits for it.
    if (unit.order.type !== "charge") {
      if (isStaggered(unit) || isStunned(unit)) continue;
      activateQueuedOrder(game,unit);
      if (updateNeutralLeash(game, unit)) continue;
      if (autoRepairDeckShip(game, unit)) continue;
      autocastStep(game, unit);
    }
    if (unit.order.type === "charge") {
      updateChargeOrder(game, unit);
      continue;
    }
    if (unit.order.type === "move") {
      if (followQueuedShipCourse(unit, game.map, game.units, statusPace(unit))) continue;
      moveToward(unit, unit.order.x, unit.order.y, game.map, game.units);
      if (walkEnded(game, unit, unit.order, 5)) arrive(unit, unit.order);
      continue;
    }
    if (unit.order.type === "attackMove") {
      updateAttackMoveOrder(game, unit);
      continue;
    }
    if (unit.order.type === "hold") {
      updateHoldOrder(game, unit);
      continue;
    }
    if (unit.order.type === "aim") {
      updateAimOrder(game, unit);
      continue;
    }
    if (unit.order.type === "follow") {
      updateFollowOrder(game, unit);
      continue;
    }
    if (unit.order.type === "cast") {
      updateCastOrder(game, unit);
      continue;
    }
    if (unit.order.type === "attack") {
      updateAttackOrder(game, unit);
      continue;
    }
    if (unit.order.type === "mine") {
      updateMineOrder(game, unit);
      continue;
    }
    if (unit.order.type === "build") {
      updateBuildOrder(game, unit);
      continue;
    }
    if (unit.order.type === "repair") {
      updateRepairOrder(game, unit);
      continue;
    }
    if (unit.order.type === "repairUnit" || unit.order.type === "repairShip") {
      updateUnitRepairOrder(game, unit);
      continue;
    }
    if (unit.order.type === "pickupItem") {
      updatePickupItemOrder(game, unit);
      continue;
    }
    if (unit.order.type === "board") {
      updateBoardOrder(game, unit);
      (ferry ??= { boarding: [], unloading: [] }).boarding.push(unit);
      continue;
    }
    if(unit.order.type==='boardShip') {
      updateBoardShipOrder(game,unit);
      continue;
    }
    if (unit.order.type === "unload") {
      moveToward(unit, unit.order.x, unit.order.y, game.map, game.units);
      (ferry ??= { boarding: [], unloading: [] }).unloading.push(unit);
      continue;
    }
    if (unit.kind === "worker" && !unit.deck && updateAutoRepair(game, unit)) continue;
    if(combatHull(unit) && unit.owner!=='neutral') {
      const defense=defenses.get(unit.id);
      if(defense?.target){
        const target=navalCombatTarget(game,unit,defense.target);
        navigateShipAttack(game,unit,target);
        if(unitRules(game,unit).intrinsicAttack && unit.cooldown===0 && targetGap(unit,target)<=unit.attackRange
          && aimAt(unit,weaponRules(game,unit),strikePoint(unit,target),game.tick,veteranAimSpeed(game,unit))){
          applyWeaponAttack(game,unit,target,Math.max(1,Math.round(unit.attackDamage*outgoingDamageMultiplier(game,unit))),unit.attackRange);
          markAimShot(unit);unit.cooldown=attackCooldownOf(game,unit);
        }
      }
      else if(defense?.returnTo)moveToward(unit,defense.returnTo.x,defense.returnTo.y,game.map,game.units);
      else updateHoldOrder(game,unit);
      continue;
    }
    if(shipProfile(unit))continue;
    if (unit.kind !== "worker") {
      const target = nearestEnemyTarget(game, unit, unit.owner === "neutral" ? 150 : AUTO_ACQUIRE_RANGE);
      if (target) unit.order = { type: "attack", targetId: target.id, leashX: unit.x, leashY: unit.y };
    }

  }
  return ferry;
}

function deckPointOrder(game: Game, unit: Unit, order: Extract<UnitOrder, { type: "move" | "attackMove" }>): UnitOrder {
  // A water destination under another hull is still water for a ship. Only
  // walking bodies can enter a deck or follow its moving local coordinates.
  if (unitMover(unit.kind) !== "land") return order;
  const ship=game.units.find(ship=>shipProfile(ship) && circleInPolygon(worldToLocal(ship,order),0,shipProfile(ship)!.hull))
;
  return ship ? {...order,deckPoint:worldToLocal(ship,order),deckShipId:ship.id} : order;
}

/** A destination on any deck follows that hull; a shore destination stays in world space. */
function deckGoal(unit: Unit, ship: Unit | undefined, goal: { x: number; y: number }, units: readonly Unit[]) {
  const order=unit.order;
  if((order.type!=="move" && order.type!=="attackMove") || !order.deckPoint || order.x!==goal.x || order.y!==goal.y)return goal;
  const parent=units.find(unit=>unit.id===(order.deckShipId ?? ship?.id));
  return parent ? localToWorld(parent,order.deckPoint) : goal;
}

function updateShipOwnership(game:Game) {
  let changed=false;
  for(const ship of shipsIn(game.units)){
    const crew=shipPassengers(game.units,ship).filter(unit=>unit.hp>0);
    if(!crew.length || crew.some(unit=>!areEnemyOwners(game,ship.owner,unit.owner)))continue;
    const occupants=crew.filter(unit=>isPlayerId(unit.owner)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const owner=occupants[0]?.owner;
    if(!owner || occupants.some(unit=>areEnemyOwners(game,owner,unit.owner)))continue;
    ship.owner=owner;ship.order={type:"idle"};ship.orderQueue=[];ship.aim=undefined;
    if(ship.sailing){ship.sailing.speed=0;ship.sailing.route=undefined;delete ship.sailing.pursuit;cancelShipPlanningJob(ship);}
    refreshUnitStats(game,ship);changed=true;
  }
  if(changed)updateSupplyState(game);
}

function assignUnitOrder(unit: Unit, order: UnitOrder, queued = false) {
  // @@@command-queue - Queued orders live in simulation state so local, lockstep, replay, and SDK paths share one behavior.
  if (queued) {
    unit.orderQueue = [...(unit.orderQueue ?? []), order];
    return;
  }
  // A charge runs its course (half a second or so): an order given during the dash waits for it (see charge).
  if (unit.order.type === "charge") {
    unit.orderQueue = [order];
    return;
  }
  unit.order = order;
  unit.orderQueue = [];
  if(unit.sailing?.gangway)cancelShipBoarding(unit);
  if (unit.sailing) { unit.sailing.route = undefined; delete unit.sailing.pursuit;
    cancelShipPlanningJob(unit);
    delete unit.sailing.planningRequestedAtTick; delete unit.sailing.planningLastRequestedAtTick; }
}

function activateQueuedOrder(game:Game,unit: Unit) {
  if (unit.order.type !== "idle") return;
  const next = unit.orderQueue?.shift();
  if (!next) return;
  // A queued helm command has the same priority as an immediate one. Leaving
  // pending crew orders behind would send an idle ship back to its old berth.
  if(shipProfile(unit))cancelCrewRendezvous(game.units,new Set([unit.id]));
  unit.order = next;
  if(unit.sailing?.gangway)cancelShipBoarding(unit);
  if (unit.sailing) { unit.sailing.route = undefined; delete unit.sailing.pursuit;
    cancelShipPlanningJob(unit);
    delete unit.sailing.planningRequestedAtTick; delete unit.sailing.planningLastRequestedAtTick; }
}

function updateFollowOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "follow") return;
  const order = unit.order;
  const target = game.units.find((candidate) => candidate.id === order.targetId && !areEnemyOwners(game, candidate.owner, unit.owner));
  if (!target) {
    unit.order = { type: "idle" };
    return;
  }
  if (shipProfile(unit)) {
    const goal = shipPursuitGoal(unit, target, game.units, Math.max(72, shipProfile(unit)!.length * .6 + 20), 0, true);
    const pace = statusPace(unit);
    if (goal && pace > 0) sailToward(unit, goal, game.map, game.units, pace);
    return;
  }
  if (distance(unit, target) > Math.max(72, target.radius + unit.radius + 26)) {
    moveToward(unit, target.x, target.y, game.map, game.units);
  }
}

function updateNeutralLeash(game: Game, unit: Unit) {
  if (unit.owner !== "neutral" || unit.homeX === undefined || unit.homeY === undefined) return false;
  const home = { x: unit.homeX, y: unit.homeY };
  const responseOrigin = neutralResponseOrigin(unit) ?? home;
  const homeDistance = distance(unit, home);
  if (homeDistance <= NEUTRAL_RETURN_STOP_RANGE && unit.order.type === "move" && distance(unit.order, home) <= NEUTRAL_RETURN_STOP_RANGE) {
    unit.order = { type: "idle" };
    return false;
  }
  const target = unit.order.type === "attack" ? findTarget(game, unit.order.targetId) : undefined;
  const returning = unit.order.type === "move" && distance(unit.order, home) <= NEUTRAL_RETURN_STOP_RANGE;
  const lostQuarry = !target && (unit.order.type === "idle" || unit.order.type === "attack");
  if (homeDistance <= NEUTRAL_LEASH_RANGE && !returning && (!lostQuarry || homeDistance <= NEUTRAL_RETURN_STOP_RANGE)
    && (!target || distance(target, responseOrigin) <= NEUTRAL_DAMAGE_RESPONSE_RANGE)) return false;

  // @@@neutral-leash - Creeps reset to their authored camp instead of dragging fights into worker lines forever.
  unit.order = { type: "move", x: home.x, y: home.y };
  moveToward(unit, home.x, home.y, game.map, game.units);
  if (distance(unit, home) <= NEUTRAL_RETURN_STOP_RANGE) unit.order = { type: "idle" };
  return true;
}

function updateHoldOrder(game: Game, unit: Unit) {
  if(shipProfile(unit) && !unitRules(game,unit).intrinsicAttack)return;
  if (unit.cooldown > 0 || unit.attackDamage <= 0) return;
  const target = nearestEnemyTarget(game, unit, unit.attackRange);
  if (!target) return;
  if (!aimAt(unit, weaponRules(game, unit), strikePoint(unit,target), game.tick, veteranAimSpeed(game, unit))) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit))), unit.attackRange);
  markAimShot(unit);
  unit.cooldown = attackCooldownOf(game, unit);
}

function updateAimOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "aim") return;
  const point = unit.order;
  if (distance(unit, point) > unit.attackRange) {
    unit.aim = undefined;
    moveToward(unit, point.x, point.y, game.map, game.units);
    if (distance(unit, point) > unit.attackRange && walkEnded(game, unit, point, 5)) unit.order = { type: "idle" };
    return;
  }
  if (backOutOfDeadZone(game, unit, point)) { unit.aim = undefined; return; }
  if (nearestEnemyTarget(game, unit, unit.attackRange)) updateHoldOrder(game, unit);
  else aimAt(unit, weaponRules(game, unit), point, game.tick, veteranAimSpeed(game, unit));
}

function updateAttackMoveOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "attackMove") return;
  const order = unit.order;
  if (order.targetId) {
    const target = findTarget(game, order.targetId);
    if (target && target.hp > 0 && automaticTargetAllowed(game.units,unit.owner,target) && projectedHpAfterPendingProjectiles(game, unit.owner, target) > 0 && areEnemyOwners(game, unit.owner, target.owner) && canReach(game.map, unit, target, game.units)) {
      const chosen = automaticCombatTarget(game, unit, target);
      unit.order = { ...order, targetId: chosen.id };
      attackMoveTowardTarget(game, unit, chosen);
      return;
    }
    const { targetId: _lost, ...destination } = order;
    unit.order = destination;
  }

  const profile=shipProfile(unit);
  const acquisition=profile ? Math.max(unit.attackRange,Math.min(700,Math.max(AUTO_ACQUIRE_RANGE,unit.attackRange+profile.length*.4+100)))
    : unitRules(game,unit).weapon ? Math.max(AUTO_ACQUIRE_RANGE,unit.attackRange) : AUTO_ACQUIRE_RANGE;
  const target = nearestEnemyTarget(game, unit, acquisition);
  if (target) {
    unit.order = { ...order, targetId: target.id };
    attackMoveTowardTarget(game, unit, target);
    return;
  }
  if (unit.sailing) delete unit.sailing.pursuit;
  moveToward(unit, order.x, order.y, game.map, game.units);
  if (walkEnded(game, unit, order, 8)) arrive(unit, order);
}

function attackMoveTowardTarget(game: Game, unit: Unit, target: Unit | Building) {
  target = navalCombatTarget(game, unit, target);
  const gap = targetGap(unit, target);
  const ship = Boolean(shipProfile(unit));
  if (ship) navigateShipAttack(game, unit, target);
  else if (backOutOfDeadZone(game, unit, target)) return;
  if (gap > unit.attackRange) {
    if (!ship) moveToward(unit, target.x, target.y, game.map, game.units);
    return;
  }
  if(shipProfile(unit) && !unitRules(game,unit).intrinsicAttack)return;
  if (unit.cooldown > 0) return;
  if (!aimAt(unit, weaponRules(game, unit), strikePoint(unit,target), game.tick, veteranAimSpeed(game, unit))) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit))), unit.attackRange);
  markAimShot(unit);
  unit.cooldown = attackCooldownOf(game, unit);
}

function updateAttackOrder(game: Game, unit: Unit) {
  const order = unit.order;
  if (order.type !== "attack") return;
  let target = findStrikeTarget(game, order.targetId);
  if (!target) {
    unit.order = { type: "idle" };
    return;
  }
  if (!isObstacle(target)) target = navalCombatTarget(game, unit, target);
  // A target that is as good as dead, or out of reach from the attacker's ground (see @@@reach), gives way to the next.
  if (projectedHpAfterPendingProjectiles(game, unit.owner, target) <= 0 || !canReach(game.map, unit, target, game.units)) {
    const replacement = nearestEnemyTarget(game, unit, Math.max(AUTO_ACQUIRE_RANGE, unit.attackRange));
    if (!replacement) {
      unit.order = { type: "idle" };
      return;
    }
    unit.order = { ...order, targetId: replacement.id };
    updateAttackOrder(game, unit);
    return;
  }
  // Only automatic orders reconsider living targets here. Explicit player attacks keep their target.
  if (!isObstacle(target) && (unit.owner === "neutral" || order.leashX !== undefined)) {
    if(!automaticTargetAllowed(game.units,unit.owner,target)){unit.order={type:'idle'};return;}
    target = automaticCombatTarget(game, unit, target);
    unit.order = { ...order, targetId: target.id };
  }
  const gap = targetGap(unit, target);
  const ship = Boolean(shipProfile(unit));
  if (!ship && backOutOfDeadZone(game, unit, target)) return;
  if (gap > unit.attackRange) {
    if (isPlayerId(unit.owner) && order.leashX !== undefined && order.leashY !== undefined && distance(unit, { x: order.leashX, y: order.leashY }) > GUARD_LEASH_RANGE) {
      unit.order = { type: "move", x: order.leashX, y: order.leashY };
      return;
    }
    if (ship) navigateShipAttack(game, unit, target);
    else moveToward(unit, target.x, target.y, game.map, game.units);
    return;
  }
  if (ship) navigateShipAttack(game, unit, target);
  if(shipProfile(unit) && !unitRules(game,unit).intrinsicAttack)return;
  if (unit.cooldown > 0) return;
  if (!aimAt(unit, weaponRules(game, unit), strikePoint(unit,target), game.tick, veteranAimSpeed(game, unit))) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit))), unit.attackRange);
  markAimShot(unit);
  unit.cooldown = attackCooldownOf(game, unit);
}

function navigateShipAttack(game: Game, ship: Unit, target: Unit | Building | Obstacle) {
  if(game.boardingHolds?.has(ship.id))return;
  const weapons = installedWeapons(game, ship).filter(item => (item.durability ?? 1) > 0);
  const minimum = weapons.length ? Math.min(...weapons.map(item => SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].weapon.minRange ?? 0))
    : weaponRules(game, ship).weapon?.minRange ?? 0;
  const blockers=friendlyFireBlockers(game,ship);
  let firingHeading: number | undefined;
  const canFireFrom = (station:Unit,checkTurn:boolean) => {
    if (!weapons.length) return targetGap(station, target) <= station.attackRange && targetGap(station, target) >= minimum;
    shareShipProfile(ship,station);
    const start = { x: station.x, y: station.y, heading: station.sailing!.heading };
    const shotClear=mountedShotClear(station,blockers);
    for (const margin of [Math.PI / 36, 0]) {
      const heading = bestFiringHeading(game, station, target, margin,shotClear), aimed = { ...station, sailing: { ...station.sailing!, heading } }, end = { ...start, heading };
      shareShipProfile(ship,aimed);
      if (checkTurn && (!hullPassageClear(game.map, station, start, end) || !shipTraffic(station, game.units)(start, end))) continue;
      if (weapons.some(item => {
        const pose = mountedWeaponPose(aimed, item), def = SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
        if (!pose) return false;
        const point = mountedTargetPoint(game,aimed,item,target,pose);
        if (!shipGunCanAim(aimed, item, point)) return false;
        const gap = distance(pose.pivot, point);
        return gap <= veteranWeaponRange(station, def.range) && gap >= (def.weapon.minRange ?? 0)
          && (!blockers.length || mountedFireLaneClear(aimed,item,point,blockers));
      })) { if(checkTurn)firingHeading = heading; return true; }
    }
    return false;
  };
  const firing = canFireFrom(ship,true);
  const bow=weapons.find(item=>item.mountId==='bow' && veteranWeaponRange(ship,SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].range)>=ship.attackRange);
  const bowPose=bow && mountedWeaponPose(ship,bow);
  const stationBowReach=bowPose ? (bowPose.pivot.x-ship.x)*detCos(ship.sailing!.heading)+(bowPose.pivot.y-ship.y)*detSin(ship.sailing!.heading) : 0;
  const goal = shipPursuitGoal(ship, target, game.units, ship.attackRange, minimum, false, () => firing, game.map, firingHeading,stationBowReach,station=>canFireFrom(station,false),()=>tryAdmitShipPlan(ship));
  const pace = statusPace(ship);
  if (goal && pace > 0) sailToward(ship, goal, game.map, game.units, pace);
  else if (!goal && ship.sailing!.planningRequestedAtTick !== undefined && !ship.sailing!.route) {
    // A new attack awaiting its first admitted station has no motion
    // authority. It may use this frame's bounded, swept yaw to face the
    // carrying hull, but cannot surge toward an untested firing station.
    ship.sailing!.speed = 0;
    if (pace > 0) {
      const quarry = shipNavigationTarget(target, game.units);
      turnShipToward(ship, Math.atan2(quarry.y - ship.y, quarry.x - ship.x), game.map, game.units);
    }
  }
}

function updateMineOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "mine") return;
  const order = unit.order;
  const resource = game.miningFrame!.resources.get(order.resourceId);
  if ((!resource || resource.amount <= 0) && order.phase !== "return") {
    unit.order = { type: "idle" };
    return;
  }

  if (order.phase === "toMine") {
    if (distance(unit, resource!) > MINE_RANGE) {
      moveToward(unit, resource!.x, resource!.y, game.map, game.units);
      return;
    }
    order.timer += 1;
    if ((resource!.harvestCooldownRemaining ?? 0) > 0) return;
    if (game.miningFrame!.nextWorker.get(order.resourceId) !== unit.id) return;
    unit.mineSlot = order.resourceId;
    resource!.harvestCooldownRemaining = GOLD_MINE_ENTRY_COOLDOWN;
    unit.order = { ...order, phase: "gather", timer: GATHER_DURATION };
    return;
  }

  if (order.phase === "gather") {
    order.timer -= 1;
    if (order.timer > 0) return;
    const mined = Math.min(GOLD_PER_TRIP, resource!.amount);
    resource!.amount -= mined;
    unit.carryingGold = mined;
    unit.order = { ...order, phase: "return", timer: 0 };
    return;
  }

  const townHall = nearestCompleteTownHall(game, unit.owner, unit.x, unit.y);
  if (!townHall) {
    unit.order = { type: "idle" };
    return;
  }
  if (distance(unit, townHall) > TOWN_HALL_DROP_RANGE) {
    moveToward(unit, townHall.x, townHall.y, game.map, game.units);
    return;
  }
  if (isPlayerId(unit.owner)) {
    const player = playerState(game, unit.owner);
    player.gold += upkeepGoldIncome(unit.carryingGold, player.supplyUsed);
  }
  unit.carryingGold = 0;
  unit.order = resource && resource.amount > 0 ? { type: "mine", resourceId: resource.id, phase: "toMine", timer: 0 } : { type: "idle" };
}

// A soldier told to board walks to its transport (see @@@transport); it goes aboard in ferryUnits. An idle transport
// sails in to the water nearest it, so the two meet at the shore wherever each stopped.
function updateBoardShipOrder(game:Game,ship:Unit) {
  if(ship.order.type!=='boardShip')return;
  const order=ship.order;
  const target=game.units.find(unit=>unit.id===order.targetId && unit.hp>0);
  if(!target || !shipProfile(ship) || !ship.sailing) {
    cancelShipBoarding(ship);ship.order={type:'idle'};return;
  }
  if(!ship.sailing.gangway && !beginShipBoarding(game.map,game.units,ship,target,game.tick,game)) {
    ship.order={type:'idle'};return;
  }
  const state=ship.sailing.gangway!;
  if(state.phase==='approach') {
    const goal=shipBoardingGoal(game.map,game.units,ship,target);
    if(goal)sailToward(ship,goal,game.map,game.units,statusPace(ship));
    return;
  }
  ship.sailing.speed=0;ship.sailing.yawRate=0;
  if(state.phase!=='ready')return;
  if(areEnemyOwners(game,ship.owner,target.owner))for(const crew of shipPassengers(game.units,ship)) {
    const crewOrder=crew.order;
    const automaticTarget=crewOrder.type==='attack' && crewOrder.leashX!==undefined
      ? game.units.find(unit=>unit.id===crewOrder.targetId) : undefined;
    const automaticAttack=crewOrder.type==='attack' && crewOrder.leashX!==undefined
      && (crewOrder.targetId===target.id || automaticTarget?.deck?.shipId===target.id);
    if(crew.owner!==ship.owner || crew.kind==='worker' || !gangwayCrewEligible(crew,game)
      || unitRules(game,crew).attackRange>RANGED_ATTACK_RANGE_THRESHOLD || crew.attackDamage<=0
      || !['idle','hold'].includes(crew.order.type) && !automaticAttack || crew.orderQueue?.length)continue;
    assignUnitOrder(crew,{type:'board',transportId:target.id});
  }
  // Deploying completes the command. The saved connection continues to hold
  // its source station until cancelled, damaged, or a new helm order departs.
  ship.order={type:'idle'};
}

function updateBoardOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "board") return;
  const transport = findTarget(game, unit.order.transportId);
  if (!transport || !isUnit(transport) || transport.hp<=0 || !unit.deck && transport.owner !== unit.owner) {
    unit.order = { type: "idle" };
    return;
  }
  if(unit.deck){
    const source=game.units.find(ship=>ship.id===unit.deck!.shipId);
    if(!source)return;
    if(source.id!==transport.id && !decksCanTransfer(source,transport,unit))return;
    // A defended entry is a fight, not an unreachable ferry destination.
    // Retain the boarding order so clearing the lane resumes the crossing.
    if(unit.kind!=='worker' && areEnemyOwners(game,unit.owner,transport.owner) && unit.attackDamage>0
      && unitRules(game,unit).attackRange<=RANGED_ATTACK_RANGE_THRESHOLD) {
      // Answer the reachable front rank before pursuing a higher-priority
      // shooter whose route is sealed by that defender's body.
      const nearby=navalCombatTarget(game,unit,transport,unit.attackRange);
      const defender=nearby!==transport ? nearby : navalCombatTarget(game,unit,transport);
      if(defender!==transport && isUnit(defender)) {
        const boardingOrder=unit.order;
        unit.order={type:'attack',targetId:defender.id};
        try { updateAttackOrder(game,unit); }
        finally { unit.order=boardingOrder; }
        return;
      }
    }
    if(source.id!==transport.id && !canBoard(transport,unit,game.units)){
      unit.order={type:"idle"};
      addEffect(game,"boardingBlocked",unit.x,unit.y,seconds(.4),{unitId:unit.id,owner:unit.owner,sourceKind:unit.kind});
      return;
    }
    // One shared entry admits large bodies first. Waiting crew clear the aft
    // passage on their own deck rather than racing ahead and sealing the exit.
    const ahead=game.units.some(other=>other!==unit && other.hp>0 && other.deck && other.order.type==="board" && other.order.transportId===transport.id
      && (other.radius>unit.radius || other.radius===unit.radius && other.id<unit.id));
    if(ahead && source.id!==transport.id){
      const profile=shipProfile(source)!,entry=worldToLocal(source,transport);
      const waiting=deckPlacement(source,unit,game.units,{x:profile.length/4,y:-Math.sign(entry.y)*profile.beam/2});
      if(waiting){const at=localToWorld(source,waiting);moveToward(unit,at.x,at.y,game.map,game.units);}
      return;
    }
    if(unit.order.deckPoint && !deckPointFits(transport,unit,unit.order.deckPoint,game.units,true))delete unit.order.deckPoint;
    if(!unit.order.deckPoint){
      const reserved=game.units.map(other=>other!==unit && other.order.type==="board" && other.order.transportId===transport.id && other.order.deckPoint
        ? {...other,deck:{shipId:transport.id,...other.order.deckPoint}} : other);
      const entry=worldToLocal(transport,source),profile=shipProfile(transport)!;
      // Walk beyond the entry seam so early arrivals leave room for larger crew.
      const reach=Math.hypot(entry.x,entry.y)||1;
      const preferred={x:profile.length/2,y:-entry.y/reach*profile.beam/2};
      const point=deckPlacement(transport,unit,reserved,preferred,true);
      if(point)unit.order.deckPoint=point;
    }
    const point=unit.order.deckPoint;if(!point)return;
    const goal=localToWorld(transport,point);
    if(source.id===transport.id){
      moveToward(unit,goal.x,goal.y,game.map,game.units);
      if(distance(unit,goal)<1e-6)unit.order={type:"idle"};
    } else if(decksCanTransfer(source,transport,unit))moveToward(unit,goal.x,goal.y,game.map,game.units);
    return;
  }
  if (alongside(unit, transport)) return;
  const goal = transport.order.type === "idle" ? unit.order.berth?.shore ?? unit.order.berth ?? transport : transport;
  moveToward(unit, goal.x, goal.y, game.map, game.units);
}

// After every unit has moved: soldiers alongside the transport they were told to board go aboard while their supply fits
// (the rest stop), and a stopped transport within reach of its requested shore sets its passengers ashore (any
// that find no land near enough stay aboard) and stops (see @@@transport).
function ferryUnits(game: Game, { boarding, unloading }: Ferry, starts: ReadonlyMap<string, {x:number;y:number;heading:number}>) {
  const approached=new Set<string>();
  for(const passenger of boarding) {
    if(passenger.order.type!=="board" || passenger.deck || approached.has(passenger.order.transportId))continue;
    const boat=findTarget(game,passenger.order.transportId);
    if(!boat || !isUnit(boat) || boat.order.type!=="idle")continue;
    approached.add(boat.id);
    const berth=passenger.order.berth ?? boardingBerth(game.map,passenger,boat);
    // The berth is a hull pose, not just a center. Discarding its heading can
    // leave the bow offshore even after the boat reaches the correct point.
    if(berth && !alongside(passenger,boat))sailToward(boat,berth,game.map,game.units);
  }
  for(const passenger of boarding) {
    if(passenger.order.type!=="board" || passenger.deck)continue;
    const ship=findTarget(game,passenger.order.transportId);
    if(!ship || !isUnit(ship) || !alongside(passenger,ship))continue;
    const boarded=boardUnit(ship,passenger,game.units);
    assignUnitOrder(passenger,{type:"idle"});
    addEffect(game,boarded ? "board" : "boardingBlocked",passenger.x,passenger.y,seconds(.4),{unitId:passenger.id,owner:passenger.owner,sourceKind:passenger.kind});
  }
  for(const ship of unloading) {
    if(ship.order.type!=="unload" || (ship.sailing?.speed??0)>.1)continue;
    const start=starts.get(ship.id);
    if(start && (distance(ship,start)>1e-6 || Math.abs(headingDifference(start.heading,ship.sailing!.heading))>1e-6))continue;
    // Another hull can occupy the chosen berth while a nearby stop still
    // reaches the same island. landingSpot checks the actual hull reach and
    // the requested shore's ground component before putting anyone ashore.
    const arrived=walkEnded(game,ship,ship.order,8);
    // A deferred route can hold the departure pose without reaching the
    // shore. Keep even an empty ship's unload order active during that wait.
    const planning=ship.sailing?.planningJob!==undefined || ship.sailing?.planningRequestedAtTick!==undefined;
    if(unloadCargo(game,ship)>0 || arrived || !planning && shipPassengers(game.units,ship).length===0)ship.order={type:"idle"};
  }
}

// A portrait click lands one crew member, without replacing the ship's order.
function unloadCargo(game: Game, ship: Unit, passengerId?: string) {
  if(ship.cargo)restoreCargoDecks(game.units);
  const crew=shipPassengers(game.units,ship);
  let landed=0;
  crew.forEach((passenger,index)=>{
    if(isInCabin(passenger) || passenger.owner!==ship.owner || passengerId!==undefined && passenger.id!==passengerId)return;
    const spot=landingSpot(game.map,ship,index,crew.length,game.units,passenger);
    if(!spot)return;
    passenger.deck=undefined;
    passenger.cabin=undefined;
    passenger.aim=undefined;
    Object.assign(passenger,spot);
    assignUnitOrder(passenger,{type:"idle"});
    addEffect(game,"unload",spot.x,spot.y,seconds(.4),{unitId:passenger.id,owner:passenger.owner,sourceKind:passenger.kind});
    landed++;
  });
  syncDecks(game.units);
  updateSupplyState(game);
  return landed;
}

function cargoSupply(game: Game, ship: Unit) {
  return (ship.cargo ?? []).reduce((sum,passenger)=>sum+unitRules(game,passenger).supplyUsed,0);
}

function upkeepGoldIncome(carriedGold: number, supplyUsed: number) {
  if (supplyUsed >= HIGH_UPKEEP_SUPPLY) return Math.floor(carriedGold * HIGH_UPKEEP_GOLD_RATE);
  if (supplyUsed >= LOW_UPKEEP_SUPPLY) return Math.floor(carriedGold * LOW_UPKEEP_GOLD_RATE);
  return carriedGold;
}

function updateBuildOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "build" || !isPlayerId(unit.owner)) return;
  const order = unit.order;
  const def = BUILDING_DEFS[order.buildingKind];
  const half = footprintHalf(def.radius, TERRAIN_CELL);
  const gap = Math.hypot(Math.max(0, Math.abs(unit.x-order.x)-half), Math.max(0, Math.abs(unit.y-order.y)-half));
  if (gap > BUILDING_WORK_REACH) {
    // Track movement rather than a fixed journey limit: long walks are valid, blocked plans must release their worker.
    if (order.progressTick === undefined || Math.hypot(unit.x - (order.progressX ?? unit.x), unit.y - (order.progressY ?? unit.y)) > 24) {
      order.progressTick = game.tick; order.progressX = unit.x; order.progressY = unit.y;
    } else if (game.tick - order.progressTick > seconds(20)) {
      unit.order = { type: "idle" }; return;
    }
    moveToward(unit, order.x, order.y, game.map, game.units); return;
  }
  // Revalidate at arrival: two builders cannot claim the same site, and money is paid only on breaking ground.
  if (buildingPlacementBlocker(game, order.buildingKind, order) || terrainBlocksPlacement(game.map, order.buildingKind, order)) {
    unit.order = { type: "idle" }; return;
  }
  if (playerState(game, unit.owner).gold < def.cost) return; // Wait for funds, retaining the visible plan.
  spendGold(game, unit.owner, def.cost);
  const building = createBuilding(`building-${unit.owner}-${order.buildingKind}-${game.nextId++}`, unit.owner, order.buildingKind, order.x, order.y, false);
  applyDerivedBuildingStats(game, building);
  building.hp = constructionStartHp(building.maxHp);
  game.buildings.push(building);
  syncBuildingBodies(game);
  unit.order = { type: "repair", buildingId: building.id };
  addEffect(game, "build", building.x, building.y, 60);
}

function updateRepairOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "repair" || !isPlayerId(unit.owner)) return;
  const order = unit.order;
  const building = game.buildings.find((candidate) => candidate.id === order.buildingId && candidate.owner === unit.owner);
  if (!building || building.hp <= 0 || (building.complete && building.hp >= building.maxHp)) {
    unit.order = { type: "idle" };
    return;
  }
  if (buildingWorkGap(unit, building) > BUILDING_WORK_REACH) {
    moveToward(unit, building.x, building.y, game.map, game.units);
    return;
  }
  // A site goes up with its builders' work (see updateConstruction); a standing building is mended.
  if (!building.complete || unit.cooldown > 0) return;
  if (!repairBuildingTick(game, unit, building)) unit.order = { type: "idle" };
}

function updateAutoRepair(game: Game, unit: Unit) {
  if (unit.order.type !== "idle" || !isPlayerId(unit.owner)) return false;
  if (unit.cooldown > 0) return false;
  const building = game.buildings.find(
    (candidate) => candidate.owner === unit.owner && candidate.complete && candidate.hp > 0 && candidate.hp < candidate.maxHp && buildingWorkGap(unit, candidate) <= BUILDING_WORK_REACH,
  );
  if (!building) return false;
  return repairBuildingTick(game, unit, building);
}

function updateUnitRepairOrder(game: Game, worker: Unit) {
  if (worker.order.type !== "repairUnit" && worker.order.type !== "repairShip") return;
  if (worker.kind !== "worker" || !isPlayerId(worker.owner)) { worker.order = { type: "idle" }; return; }
  const targetId = worker.order.targetId;
  const target = game.units.find(unit => unit.id === targetId && unit.owner === worker.owner
    && (worker.order.type !== "repairShip" || unitMover(unit.kind) === "sea"));
  if (!target || !unitNeedsRepair(game, target)) { worker.order = { type: "idle" }; return; }
  const ship = Boolean(shipProfile(target));
  const sameWorkSurface = ship ? worker.deck?.shipId === target.id : worker.deck?.shipId === target.deck?.shipId;
  const withinReach = distance(worker, target) <= worker.radius + target.radius + BUILDING_WORK_REACH;
  // Crew can work anywhere on their own hull; separate ground/deck units must
  // share a surface and stand within working reach.
  const canWorkHere = ship ? sameWorkSurface || !worker.deck && withinReach : sameWorkSurface && withinReach;
  if (!canWorkHere) {
    moveToward(worker, target.x, target.y, game.map, game.units);
    return;
  }
  repairUnitTick(game, worker, target);
  if (!unitNeedsRepair(game, target)) worker.order = { type: "idle" };
}

function autoRepairDeckShip(game: Game, worker: Unit) {
  if (worker.kind !== "worker" || !worker.deck || !isPlayerId(worker.owner) || worker.orderQueue?.length || !["idle", "hold"].includes(worker.order.type)) return false;
  const ship=game.units.find(unit=>unit.id===worker.deck!.shipId && unit.owner===worker.owner && unit.hp>0);
  if (!ship || !shipProfile(ship) || !unitNeedsRepair(game,ship) || playerState(game,worker.owner).gold<1) return false;
  repairUnitTick(game,worker,ship);
  return true;
}

function repairUnitTick(game: Game, worker: Unit, target: Unit) {
  if (worker.kind !== "worker" || !isPlayerId(worker.owner) || target.owner !== worker.owner || !unitNeedsRepair(game, target)) return;
  if (worker.cooldown > 0) return;
  const player = playerState(game, worker.owner);
  if (player.gold < 1) return;
  emitWorkerWork(game, worker, target);
  const healed = unitRepairHpPerGold(game, target);
  spendGold(game, worker.owner, 1);
  if (shipProfile(target)) repairShipParts(game,target,healed);
  else target.hp = Math.min(target.maxHp, target.hp + healed);
  worker.cooldown = seconds(healed / REPAIR_HP_PER_SECOND);
}

function emitWorkerWork(game: Game, worker: Unit, target: Unit | Building) {
  if (game.effects.some(effect => effect.type === "repair" && effect.unitId === worker.id)) return;
  // Actual work drives unit poses and sound, never a floating tool icon.
  // Presentation IDs must not advance the entity counter or change army ordering.
  game.effects.push({ id: `work-${worker.id}-${game.tick}`, type: "repair", x:worker.x, y:worker.y,
    duration:seconds(0.65), remaining:seconds(0.65), unitId:worker.id, fromX:target.x, fromY:target.y });
}

function repairBuildingTick(game: Game, unit: Unit, building: Building) {
  if (!isPlayerId(unit.owner)) return false;
  const owner = unit.owner;
  const player = playerState(game, owner);
  if (player.gold < 1 || building.hp >= building.maxHp) return false;
  const fullRepairCost = Math.max(1, Math.round(BUILDING_DEFS[building.kind].cost * REPAIR_FULL_COST_FRACTION));
  const hpPerGold = Math.max(1, building.maxHp / fullRepairCost);
  spendGold(game, owner, 1);
  building.hp = Math.min(building.maxHp, building.hp + hpPerGold);
  unit.cooldown = seconds(hpPerGold / REPAIR_HP_PER_SECOND);
  emitWorkerWork(game, unit, building);
  addRepairHammerEffect(game, building);
  return true;
}

function addRepairHammerEffect(game: Game, building: Building, queued = false) {
  const activeType = queued ? ["repair", "queuedRepair"] : ["repair"];
  if (game.effects.some((effect) => activeType.includes(effect.type) && effect.x === building.x && effect.y === building.y)) return;
  addEffect(game, queued ? "queuedRepair" : "repair", building.x, building.y, REPAIR_HAMMER_EFFECT_DURATION, { owner: building.owner });
}

function queueTraining(game: Game, building: Building, unitKind: TrainableUnitKind) {
  if (!building.complete) throw new Error(`Cannot train from incomplete ${building.kind}`);
  if (!BUILDING_DEFS[building.kind].trains.includes(unitKind)) throw new Error(`${building.kind} cannot train ${unitKind}`);
  if (!RACE_DEFS[playerState(game, building.owner).race].trainableUnits.includes(unitKind)) throw new Error(`${playerState(game, building.owner).race} race cannot train ${unitKind}`);
  const cap = requiredSupplyCap(unitKind);
  if (playerState(game, building.owner).supplyCap < cap) throw new Error(`Need a supply cap of ${cap} to train ${unitKind}`);
  if (projectedSupplyUsed(game, building.owner) + UNIT_DEFS[unitKind].supplyUsed > playerState(game, building.owner).supplyCap) {
    throw new Error(`Need more supply to train ${unitKind}`);
  }
  spendGold(game, building.owner, UNIT_DEFS[unitKind].cost);
  building.queue.push({ id: `training-${game.nextId++}`, unitKind, remaining: trainTimeFor(unitKind), paidGold:UNIT_DEFS[unitKind].cost });
  updateSupplyState(game);
}

function setRally(game: Game, owner: PlayerId, buildingIds: string[], x: number, y: number, target: RallyTarget | undefined) {
  const buildings = buildingsByIds(game, buildingIds, owner);
  const normalized = normalizeRallyTarget(game, owner, x, y, target);
  for (const building of buildings) {
    if (BUILDING_DEFS[building.kind].trains.length === 0) throw new Error(`${building.kind} has no training rally point`);
    building.rallyX = normalized.x;
    building.rallyY = normalized.y;
    building.rallyTarget = normalized.target;
  }
  addEffect(game, "move", normalized.x, normalized.y, 24, { owner });
}

function normalizeRallyTarget(game: Game, owner: PlayerId, x: number, y: number, target: RallyTarget | undefined) {
  if (!target || target.type === "point") {
    return { x: clamp(x, 0, game.map.width), y: clamp(y, 0, game.map.height), target: { type: "point" } as RallyTarget };
  }
  if (target.type === "resource") {
    const resource = game.resources.find((candidate) => candidate.id === target.resourceId);
    if (!resource) throw new Error(`Unknown rally resource ${target.resourceId}`);
    return { x: resource.x, y: resource.y, target };
  }
  const unit = game.units.find((candidate) => candidate.id === target.unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} rally unit ${target.unitId}`);
  return { x: unit.x, y: unit.y, target };
}

function rallyOrderForUnit(game: Game, building: Building, unit: Unit): Unit["order"] {
  const target = building.rallyTarget;
  if (target?.type === "resource" && unit.kind === "worker" && game.resources.some((resource) => resource.id === target.resourceId && resource.amount > 0)) {
    return { type: "mine", resourceId: target.resourceId, phase: "toMine", timer: 0 };
  }
  if (target?.type === "unit" && game.units.some((candidate) => candidate.id === target.unitId && candidate.owner === unit.owner && candidate.hp > 0)) {
    return { type: "follow", targetId: target.unitId };
  }
  return { type: "move", x: building.rallyX, y: building.rallyY };
}

function queueResearch(game: Game, building: Building, upgradeKind: UpgradeKind) {
  if (!building.complete) throw new Error(`Cannot research from incomplete ${building.kind}`);
  const upgrade = UPGRADE_DEFS[upgradeKind];
  if (!upgrade) throw new Error(`Unknown upgrade ${upgradeKind}`);
  if (!RACE_DEFS[playerState(game, building.owner).race].upgrades.includes(upgradeKind)) throw new Error(`${playerState(game, building.owner).race} race cannot research ${upgradeKind}`);
  if (!upgrade.researchBuildingKinds.includes(building.kind) || !BUILDING_DEFS[building.kind].researches.includes(upgradeKind)) {
    throw new Error(`${building.kind} cannot research ${upgradeKind}`);
  }
  const player = playerState(game, building.owner);
  const currentLevel = player.upgrades[upgradeKind] ?? 0;
  if (currentLevel >= maxUpgradeLevel(upgradeKind)) throw new Error(`${upgradeKind} already at max level`);
  if (building.researchQueue.some((job) => job.upgradeKind === upgradeKind)) throw new Error(`${upgradeKind} is already queued`);
  const targetLevel = currentLevel + 1;
  const level = upgrade.levels[targetLevel - 1];
  if (!level) throw new Error(`${upgradeKind} missing level ${targetLevel}`);
  spendGold(game, building.owner, level.cost);
  building.researchQueue.push({ upgradeKind, targetLevel, remaining: level.researchTime });
}

function completeResearch(game: Game, owner: PlayerId, upgradeKind: UpgradeKind, targetLevel: number) {
  const player = playerState(game, owner);
  const currentLevel = player.upgrades[upgradeKind] ?? 0;
  if (targetLevel <= currentLevel) return;
  if (targetLevel !== currentLevel + 1) throw new Error(`${upgradeKind} research completed out of order`);
  player.upgrades[upgradeKind] = targetLevel;
  for (const unit of game.units.filter((candidate) => candidate.owner === owner)) {
    applyUpgradeLevelToUnit(game, unit, upgradeKind, targetLevel);
  }
  for (const building of game.buildings.filter((candidate) => candidate.owner === owner)) {
    applyUpgradeLevelToBuilding(game, building, upgradeKind, targetLevel);
  }
}

function applyUnitUpgrades(game: Game, unit: Unit) {
  if (!isPlayerId(unit.owner)) return;
  applyDerivedUnitStats(game, unit);
}

function applyUpgradeLevelToUnit(game: Game, unit: Unit, upgradeKind: UpgradeKind, level: number) {
  const upgrade = UPGRADE_DEFS[upgradeKind];
  const levelDef = upgrade.levels[level - 1];
  if (!levelDef) throw new Error(`${upgradeKind} missing level ${level}`);
  if (!upgrade.affectedUnitKinds.includes(unit.kind as TrainableUnitKind)) return;
  applyDerivedUnitStats(game, unit);
}

function applyUpgradeLevelToBuilding(game: Game, building: Building, upgradeKind: UpgradeKind, level: number) {
  const upgrade = UPGRADE_DEFS[upgradeKind];
  const levelDef = upgrade.levels[level - 1];
  if (!levelDef) throw new Error(`${upgradeKind} missing level ${level}`);
  if (!levelDef.buildingMaxHpMultiplier) return;
  applyDerivedBuildingStats(game, building);
}

function applyDerivedBuildingStats(game: Game, building: Building) {
  const previousMaxHp = building.maxHp;
  const def = BUILDING_DEFS[building.kind];
  let maxHp = def.hp;
  for (const upgradeKind of UPGRADE_KINDS) {
    const upgradeLevel = playerState(game, building.owner).upgrades[upgradeKind] ?? 0;
    for (let level = 0; level < upgradeLevel; level += 1) {
      const levelDef = UPGRADE_DEFS[upgradeKind].levels[level];
      if (!levelDef?.buildingMaxHpMultiplier) continue;
      maxHp = Math.round(maxHp * levelDef.buildingMaxHpMultiplier);
    }
  }
  building.maxHp = maxHp;
  building.hp = Math.min(building.maxHp, Math.max(1, building.hp + building.maxHp - previousMaxHp));
  building.attackDamage = def.attackDamage;
  building.attackRange = def.attackRange;
  building.attackCooldown = def.attackCooldown;
}

function hireMercenary(game: Game, owner: PlayerId, campId: string) {
  const camp = game.mercenaryCamps.find((candidate) => candidate.id === campId);
  if (!camp) throw new Error(`Unknown mercenary camp ${campId}`);
  if (camp.stock <= 0) throw new Error(`${camp.id} has no mercenary stock`);
  if (camp.cooldownRemaining > 0) throw new Error(`${camp.id} is restocking`);
  if (!hasFriendlyUnitAtMercenaryCamp(game, owner, camp)) throw new Error(`${camp.id} needs a friendly unit nearby before hiring`);
  if (!canSupply(game, owner, camp.hireKind)) throw new Error(`Need more supply to hire ${camp.hireKind}`);
  spendGold(game, owner, camp.cost);
  camp.stock -= 1;
  camp.cooldownRemaining = camp.cooldown;
  const offset = owner === "player" ? -camp.radius : camp.radius;
  const mercenary = game.spawnUnit(owner, camp.hireKind, camp.x + offset, camp.y);
  addEffect(game, "summon", camp.x, camp.y, 34);
  updateSupplyState(game);
  return mercenary;
}

// The good comes from the shop's stock to the owner's unit standing by it nearest it with room (see @@@carried-items), or
// to the ground at the shop's door when none has room.
function buyGood(game: Game, owner: PlayerId, shopId: string, kind: WorldItem["kind"], recipientId?:string) {
  const refusal = buyRefusal(game, owner, shopId, kind, recipientId);
  if (refusal) throw new Error(refusal.message);
  const shop = game.shops!.find((candidate) => candidate.id === shopId)!;
  const good = shop.goods.find((candidate) => candidate.kind === kind)!;
  const delivery=recipientId!==undefined ? purchasePlacement(game,owner,shop,kind,recipientId) : undefined;
  if(delivery && "refusal" in delivery)throw new Error(delivery.refusal);
  spendGold(game, owner, good.cost);
  good.stock -= 1;
  if (good.restockRemaining <= 0) good.restockRemaining = good.restock;
  const item: WorldItem = { id: `item-${owner}-${kind}-${game.nextId}`, kind, x: shop.x, y: shop.y + shop.radius + 16, cooldownRemaining: 0 };
  game.nextId += 1;
  game.items.push(item);
  if(delivery && "placement" in delivery)deliverPurchase(game,item,delivery.placement);
  else {
    // Replay compatibility for commands recorded before explicit recipients.
    const buyer = shopBuyer(game, owner, shop,kind);
    if (buyer) attachItemToUnit(game, item, buyer);
    addEffect(game, "summon", shop.x, shop.y, 24);
  }
  return item;
}

function deliverPurchase(game:Game,item:WorldItem,placement:PurchasePlacement){
  const recipient=game.units.find(unit=>unit.id===("unitId" in placement ? placement.unitId : placement.shipId))!;
  if("unitId" in placement){item.carrierId=recipient.id;item.slot=placement.slot;}
  else {item.shipId=recipient.id;item.holdSlot=placement.slot;}
  item.x=recipient.x;item.y=recipient.y;
  invalidateItemIndex(game.items);
  applyDerivedUnitStats(game,recipient);refreshEquipmentMass(game);
  addEffect(game,"itemReceived",recipient.x,recipient.y,seconds(.8),{owner:recipient.owner});
}

function hasFriendlyUnitAtMercenaryCamp(game: Game, owner: PlayerId, camp: { x: number; y: number; radius: number }) {
  return game.units.some((unit) => unit.owner === owner && distance(unit, camp) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE);
}

function updatePickupItemOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "pickupItem") return;
  const itemId = unit.order.itemId;
  const item = game.items.find((candidate) => candidate.id === itemId);
  if (!item || item.carrierId || item.shipId) {
    unit.order = { type: "idle" };
    return;
  }
  if (distance(unit, item) > ITEM_PICKUP_RANGE) {
    moveToward(unit, item.x, item.y, game.map, game.units);
    return;
  }
  if (freeItemSlot(game,unit,item.kind)) attachItemToUnit(game, item, unit);
  unit.order = { type: "idle" };
}

function pickupItem(game: Game, owner: PlayerId, unitId: string, itemId: string, queued = false) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item carrier ${unitId}`);
  const item = game.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  if (item.carrierId || item.shipId) throw new Error(`${item.id} is already carried`);
  if (unitMover(unit.kind) === "sea") throw new Error("A ship carries no items");
  if (!canEquip(unit) || !freeItemSlot(game,unit,item.kind)) throw new Error(`${unit.id} has no free equipment position`);
  if (distance(unit, item) > ITEM_PICKUP_RANGE) {
    assignUnitOrder(unit, { type: "pickupItem", itemId }, queued);
    return;
  }
  attachItemToUnit(game, item, unit);
}

function attachItemToUnit(game: Game, item: WorldItem, unit: Unit) {
  const slot=freeItemSlot(game,unit,item.kind);if(!slot)return;
  item.slot=slot;
  item.carrierId = unit.id;
  delete item.deck;
  invalidateItemIndex(game.items);
  item.x = unit.x;
  item.y = unit.y;
  // Boots change their carrier's pace (see @@@shop-goods).
  if (isPlayerId(unit.owner)) applyDerivedUnitStats(game, unit);
  refreshEquipmentMass(game);
}

function dropItem(game: Game, owner: PlayerId, unitId: string, itemId: string, x: number, y: number) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item carrier ${unitId}`);
  const refusal = dropRefusal(game, owner, unitId, itemId);
  if (refusal) throw new Error(refusal);
  const item = game.items.find(item => item.id === itemId)!;
  const ship = game.units.find(ship => ship.id === item.shipId);
  delete item.carrierId;delete item.slot;delete item.shipId;delete item.holdSlot;delete item.mountId;removeFromHands(unit,item.id);
  if (ship) rebuildShipFittings(game, ship);
  invalidateItemIndex(game.items);
  item.x = clamp(x, 0, game.map.width);
  item.y = clamp(y, 0, game.map.height);
  settleGroundItems(game.items,game.units,game.map);
  if (isPlayerId(unit.owner)) applyDerivedUnitStats(game, unit);
  refreshEquipmentMass(game);
}

function useItem(
  game: Game,
  owner: PlayerId,
  unitId: string,
  itemId: string,
  targetId: string | undefined,
  x: number | undefined,
  y: number | undefined,
) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item user ${unitId}`);
  const item = carriedItem(game, unit, itemId);
  const previousHands=unit.hands ? {...unit.hands} : undefined;
  if(!ITEM_DEFS[item.kind].passive && !itemEquipped(game,unit,item)){unit.hands??={};removeFromHands(unit,item.id);unit.hands.right=item.id;if(itemHands(item)===2)delete unit.hands.left;unit.aim=undefined;applyDerivedUnitStats(game,unit);}
  activateItem(game, unit, item, targetId, x, y);
  if(previousHands && !game.items.some(candidate=>candidate.id===item.id)){unit.hands=previousHands;applyDerivedUnitStats(game,unit);}
}

function castAbility(
  game: Game,
  owner: PlayerId,
  unitId: string,
  ability: AbilityKind,
  targetId: string | undefined,
  x: number | undefined,
  y: number | undefined,
  queued = false,
) {
  const caster = game.units.find((unit) => unit.id === unitId && unit.owner === owner);
  if (!caster || caster.hp <= 0) throw new Error(`Unknown ${owner} caster ${unitId}`);
  if (isStunned(caster)) throw new Error(`${caster.kind} is stunned`);
  if (!unitAbilities(caster).includes(ability)) throw new Error(`${caster.kind} cannot cast ${ability}`);
  if (abilityCooldown(caster, ability) > 0) throw new Error(`${caster.kind} is on cooldown`);
  const def = ABILITY_DEFS[ability];
  if (def.behavior === "veteran") {
    if (queued) assignUnitOrder(caster, { type: "cast", ability }, true);
    else applyVeteranAbility(game, caster, def, false);
    return;
  }
  const typedTarget = targetId ? findStrikeTarget(game, targetId) : undefined;
  if (typedTarget && isUnit(typedTarget) && !matchesUnitTarget(typedTarget, def.targets, game)) {
    throw new Error(def.behavior === "heal" ? "Healing cannot restore mechanical units" : "Ability cannot target this unit class");
  }
  // Out of reach, or after the orders before it (shift), the caster walks to cast (see @@@cast-order).
  const later = (order: Extract<UnitOrder, { type: "cast" }>, at: { x: number; y: number }) => {
    assignUnitOrder(caster, order, queued);
    addEffect(game, queued ? "queuedMove" : "move", at.x, at.y, queued ? 38 : 24, { owner });
  };

  if (def.behavior === "weapon") {
    const target = targetId ? findStrikeTarget(game, targetId) : undefined;
    if (def.target === "enemy" && (!target || !areEnemyOwners(game, owner, target.owner))) throw new Error("Weapon skill requires an enemy target");
    const point = target ?? (isNumber(x) && isNumber(y) ? { x, y } : undefined);
    if (!point) throw new Error("Weapon skill requires a target point");
    if (def.weapon.minRange && distance(caster, point) < def.weapon.minRange) throw new Error("Target inside weapon minimum range");
    if (queued || isShipKind(caster.kind) || aimingProfile(unitRules(game, caster)) || distance(caster, point) > def.range + (target && !isUnit(target) ? target.radius : 0)) later({type:"cast",ability,...(target ? {targetId:target.id} : {x:point.x,y:point.y})},point);
    else applyWeaponAbility(game,caster,ability,point,def,target?.id);
    return;
  }
  if (def.behavior === "heal") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && !areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Heal requires an allied unit target");
    if (!canReceiveHealing(target, game)) throw new Error("Healing cannot restore mechanical units");
    if (queued || distance(caster, target) > def.range) later({ type: "cast", ability, targetId: target.id }, target);
    else applyHeal(game, caster, ability, target, def);
    return;
  }
  if (def.behavior === "curse") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Curse requires an enemy unit target");
    if (queued || distance(caster, target) > def.range) later({ type: "cast", ability, targetId: target.id }, target);
    else applyCurse(game, caster, ability, target, def);
    return;
  }
  if (def.behavior === "charge") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Charge requires an enemy unit target");
    if (distance(caster, target) < def.minRange) throw new Error(`Charge target must be at least ${def.minRange} away`);
    if (!canReach(game.map, caster, target, game.units)) throw new Error("Charge target is out of reach");
    if (queued || distance(caster, target) > def.range) later({ type: "cast", ability, targetId: target.id }, target);
    else startCharge(game, caster, ability, target, def, true);
    return;
  }
  if (def.behavior !== "summon") throw new Error(`${ability} is cast by its creep alone`);
  if (!isNumber(x) || !isNumber(y)) throw new Error("Summon requires a target point");
  if (queued || distance(caster, { x, y }) > def.range) later({ type: "cast", ability, x, y }, { x, y });
  else applySummon(game, caster, ability, x, y, def);
}

// @@@cast-order - A spell cast out of reach is walked to, as Warcraft III's are: the caster heads for the spell's point or
// follows its unit, and casts once within the spell's range (a charge: within its window, from which it charges) with
// the spell ready. A target gone, dead or turned, one it can come no nearer to, a charge's target come too close or out
// of reach, or the spell not ready on arrival, and the order ends: the caster takes up its next queued order, else idles.
function updateCastOrder(game: Game, unit: Unit) {
  const order = unit.order;
  if (order.type !== "cast") return;
  const def = ABILITY_DEFS[order.ability];
  const target = order.targetId === undefined ? undefined : findStrikeTarget(game, order.targetId);
  const end = () => {
    unit.order = { type: "idle" };
  };
  // Saves can contain a cast for an ability removed from the catalog.
  if (!def) return end();
  if (def.behavior === "veteran") {
    if (unitAbilities(unit).includes(order.ability) && abilityCooldown(unit, order.ability) <= 0) applyVeteranAbility(game, unit, def, false);
    return end();
  }
  if (order.targetId !== undefined && (!target || target.hp <= 0 || areEnemyOwners(game, target.owner, unit.owner) !== (def.behavior !== "heal"))) return end();
  if (target && isUnit(target) && !matchesUnitTarget(target, def.targets, game)) return end();
  if (def.behavior === "heal" && target && (!isUnit(target) || !canReceiveHealing(target, game))) return end();
  const at = target ?? (isNumber(order.x) && isNumber(order.y) ? { x: order.x, y: order.y } : undefined);
  if (!at) return end();
  if (def.behavior === "weapon" && def.weapon.minRange && distance(unit, at)<def.weapon.minRange) return end();
  if (distance(unit, at) > def.range + (def.behavior === "weapon" && target && !isUnit(target) ? target.radius : 0)) {
    moveToward(unit, at.x, at.y, game.map, game.units);
    // As near as it can come (its point or unit beyond its ground, see @@@reach) and still out of range: no cast.
    if (walkEnded(game, unit, at, 5)) end();
    return;
  }
  if (abilityCooldown(unit, order.ability) > 0) return end();
  if (def.behavior === "weapon") {
    if(order.ability==='incendiaryFlume' && unit.fittings){
      const item=installedWeapons(game,unit).find(item=>item.kind==='flameProjector' && (item.durability ?? 1)>0);
      if(!item)return end();
      if(!shipGunCanAim(unit,item,at)){const mount=shipMounts(unit).find(mount=>mount.id===item.mountId)!;turnShipToward(unit,Math.atan2(at.y-unit.y,at.x-unit.x)-mount.bearing,game.map,game.units);return;}
      item.facing=Math.atan2(at.y-mountedWeaponPose(unit,item)!.pivot.y,at.x-mountedWeaponPose(unit,item)!.pivot.x);
      const proxy=aimMountedWeapon(game,unit,item,at);if(!proxy)return;
      applyWeaponAbility(game,unit,order.ability,at,def,target?.id);markAimShot(proxy);end();return;
    }
    if (!aimAt(unit, weaponRules(game, unit), at, game.tick, veteranAimSpeed(game, unit))) return;
    applyWeaponAbility(game,unit,order.ability,at,def,target?.id);
    markAimShot(unit);
  }
  else if (def.behavior === "heal" && target && isUnit(target)) applyHeal(game, unit, order.ability, target, def);
  else if (def.behavior === "curse" && target && isUnit(target)) applyCurse(game, unit, order.ability, target, def);
  else if (def.behavior === "summon") applySummon(game, unit, order.ability, at.x, at.y, def);
  else if (def.behavior === "charge" && target && isUnit(target) && distance(unit, target) >= def.minRange && canReach(game.map, unit, target, game.units)) {
    // The charge's own rule sees to what follows it (see endCharge): the next queued order, else attacking its unit.
    startCharge(game, unit, order.ability, target, def, false);
    return;
  }
  end();
}

function applyHeal(game: Game, caster: Unit, ability: AbilityKind, target: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "heal" }>) {
  if (!matchesUnitTarget(target, def.targets, game) || !canReceiveHealing(target, game) || distance(caster, target) > def.range) return;
  target.hp = Math.min(target.maxHp, target.hp + def.healAmount);
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, target.x, target.y, 36, { sourceKind: caster.kind, unitId: caster.id, owner: caster.owner });
}

function syncSummonLoad(game: Game, ship: Unit, probe: Unit) {
  return shipPassengers(game.units, ship).reduce((mass, unit) => mass + bodyMass(unit), bodyMass(probe)) > shipProfile(ship)!.loadCapacity;
}

function applySummon(game: Game, caster: Unit, ability: AbilityKind, x: number, y: number, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "summon" }>) {
  if (distance(caster, { x, y }) > def.range) return false;
  const ship = game.units.find(ship => {
    const profile = shipProfile(ship);
    return profile && ship.owner === caster.owner && circleInPolygon(worldToLocal(ship, { x, y }), 0, profile.deck);
  });
  if (!ship && !isWalkable(game.map, x, y)) return false;
  const probe = ship && createUnit("summon-probe", caster.owner, def.summonKind, x, y);
  const point = ship && probe && deckPlacement(ship, probe, game.units, worldToLocal(ship, { x, y }));
  if (ship && (!point || syncSummonLoad(game, ship, probe!))) return false;
  const spirit = game.spawnUnit(caster.owner, def.summonKind, x, y);
  if (ship && point) { spirit.deck = { shipId: ship.id, ...point }; Object.assign(spirit, localToWorld(ship, point)); }
  spirit.expiresTick = game.tick + def.summonDuration;
  spirit.order = { type: "idle" };
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, spirit.x, spirit.y, 50, { sourceKind: caster.kind, unitId: caster.id, owner: caster.owner });
  return true;
}

function applyCurse(game: Game, caster: Unit, ability: AbilityKind, target: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "curse" }>) {
  if (!matchesUnitTarget(target, def.targets, game) || distance(caster, target) > def.range) return;
  const damageMultiplier = target.effects.some((effect) => effect.type === "scorch")
    ? (def.scorchedDamageMultiplier ?? def.damageMultiplier)
    : def.damageMultiplier;
  target.effects = target.effects.filter((effect) => effect.type !== def.statusType);
  target.effects.push({ type: def.statusType, remaining: def.effectDuration, ...(damageMultiplier !== 0.4 ? { damageMultiplier } : {}) });
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, target.x, target.y, 46, { sourceKind: caster.kind, unitId: caster.id, owner: caster.owner });
  if (def.summonedDamage && target.expiresTick !== undefined) applyDamage(game, caster, target, def.summonedDamage, undefined, undefined, 0, DAMAGE_PROFILES.ARCANE);
}

type ChargeDef = Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "charge" }>;

// @@@charge - The cavalry's charge rides the push physics (see @@@push): at an enemy unit between minRange and range away
// the rider shoves itself at where the unit stands, hard enough to slide on `drive` past the point of meeting it, so it
// arrives at a gallop (24 a tick at the most, about six times its walk). Once the unit is within its reach it strikes once
// for damageMultiplier times its weapon's blow, as any melee blow lands (curse, armor and its stance count as ever), and
// what is left of its slide carries it into the unit: the two meet as any two bodies do, so a knight throws a footman
// back and hardly moves a golem. A unit that walks out of the line may be missed: a slide that runs out with the unit
// out of reach strikes nothing. The charge runs its course: an order given meanwhile waits for it (see
// assignUnitOrder). The rider then takes up `resume`: what it was doing, now aimed at the unit it charged. It used to
// dash at 30 a tick, steering after the unit, and stop dead at striking distance.
function inChargeWindow(caster: Unit, target: Unit, def: ChargeDef) {
  const gap = distance(caster, target);
  return gap >= def.minRange && gap <= def.range;
}

function startCharge(game: Game, caster: Unit, ability: AbilityKind, target: Unit, def: ChargeDef, commanded: boolean) {
  if (!matchesUnitTarget(target, def.targets, game)) return;
  const current = caster.order.type === "charge" ? caster.order.resume : caster.order;
  // Charged from a standstill on its own, the rider keeps an idle unit's leash back to where it stood.
  const resume: SettledUnitOrder =
    current.type === "attackMove"
      ? { type: "attackMove", x: current.x, y: current.y, targetId: target.id }
      : current.type === "attack" && current.leashX !== undefined && current.leashY !== undefined
        ? { type: "attack", targetId: target.id, leashX: current.leashX, leashY: current.leashY }
        : current.type === "idle" && !commanded
          ? { type: "attack", targetId: target.id, leashX: caster.x, leashY: caster.y }
          : { type: "attack", targetId: target.id };
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  caster.order = { type: "charge", targetId: target.id, resume };
  if (commanded) caster.orderQueue = [];
  const meeting = Math.max(0, distance(caster, target) - caster.radius - target.radius);
  shove(caster, target.x - caster.x, target.y - caster.y, meeting + def.drive);
  const expected = Math.max(1, Math.ceil((distance(caster, target) - caster.attackRange) / MAX_SLIDE_STEP));
  addEffect(game, def.effectType, caster.x, caster.y, expected, { fromX: caster.x, fromY: caster.y, toX: target.x, toY: target.y, owner: caster.owner, sourceKind: caster.kind, unitId: caster.id });
}

function updateChargeOrder(game: Game, unit: Unit) {
  const order = unit.order;
  if (order.type !== "charge") return;
  const ability = UNIT_DEFS[unit.kind].abilities.find((candidate) => ABILITY_DEFS[candidate].behavior === "charge");
  const def = ability ? ABILITY_DEFS[ability] : undefined;
  const target = findTarget(game, order.targetId);
  if (!def || def.behavior !== "charge" || !target || !isUnit(target) || target.hp <= 0) {
    endCharge(unit, order.resume);
    return;
  }
  if (distance(unit, target) <= unit.attackRange) {
    const damage = Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit) * def.damageMultiplier));
    applyAttackDamage(game, unit, target, damage, unit.attackRange);
    addEffect(game, "chargeImpact", target.x, target.y, CHARGE_IMPACT_TICKS, { fromX: unit.x, fromY: unit.y, toX: target.x, toY: target.y, owner: unit.owner, sourceKind: unit.kind, unitId: unit.id });
    unit.cooldown = unit.attackCooldown;
    endCharge(unit, order.resume);
    return;
  }
  if (unit.pushX === undefined) endCharge(unit, order.resume);
}

function endCharge(unit: Unit, resume: SettledUnitOrder) {
  const next = unit.orderQueue?.shift();
  unit.order = next ?? resume;
}

// @@@autocast-step - Each ready ability a unit has switched on (see autocast) looks for its moment, as Warcraft III units
// do: only while the unit is idle, attacking or attack-moving, never under a move the player gave. A creep minding its
// camp is nobody's target until it fights: a rider passing a camp does not charge it, a witch does not curse it.
// - heal: the ally in reach missing the most health, if it misses at least half a heal;
// - curse: an enemy in reach that is fighting (or any, while the caster fights), not already cursed; a summoned unit first
//   when the curse kills those, then the caster's own target, then the nearest;
// - summon: when an enemy that is fighting, or any enemy player's unit, comes near and none of the caster's summons stands
//   beside it;
// - charge: the rider's own target when it is a unit inside the window, or, idle or attack-moving, the nearest enemy unit
//   inside it that no rider of its side is already charging (the nearest of all only when every one is taken): picking
//   the nearest alone, a line of twelve riders all charged the same ravager, the last four landed on a corpse, and the
//   wing, bunched on one spot, was cut down.
const AUTOCAST_EVERY_TICKS = 2;
const AUTOCAST_ORDERS = new Set<UnitOrder["type"]>(["idle", "attack", "attackMove", "hold", "aim"]);
const SUMMON_ALERT_MARGIN = 100;
const SUMMON_COMPANY_RANGE = 320;
const SUMMON_STEP = 60;
const CHARGE_IMPACT_TICKS = 12;

function autocastStep(game: Game, unit: Unit) {
  if (game.tick % AUTOCAST_EVERY_TICKS !== 0 || !AUTOCAST_ORDERS.has(unit.order.type)) return;
  for (const ability of unitAbilities(unit)) {
    if (abilityCooldown(unit, ability) > 0 || !autocastEnabled(unit, ability)) continue;
    const def = ABILITY_DEFS[ability];
    if (def.behavior === "veteran") {
      if (applyVeteranAbility(game, unit, def, true)) return;
    } else if (def.behavior === "heal") {
      const target = autocastHealTarget(game, unit, def);
      if (target) return applyHeal(game, unit, ability, target, def);
    } else if (def.behavior === "curse") {
      const target = autocastCurseTarget(game, unit, def);
      if (target) return applyCurse(game, unit, ability, target, def);
    } else if (def.behavior === "summon") {
      const point = autocastSummonPoint(game, unit, def);
      if (point && applySummon(game, unit, ability, point.x, point.y, def)) return;
    } else if (def.behavior === "stomp") {
      if (applyStomp(game, unit, ability, def)) return;
    } else if (def.behavior === "bloodlust") {
      if (applyBloodlust(game, unit, ability, def)) return;
    } else if (def.behavior === "web") {
      if (applyWeb(game, unit, ability, def)) return;
    } else if (def.behavior === "charge" && unit.order.type !== "hold") {
      const target = autocastChargeTarget(game, unit, def);
      if (target) return startCharge(game, unit, ability, target, def, false);
    }
  }
}

// @@@creep-abilities in play: each only when a foe is about (see isAutocastFoe), so an idle camp keeps its powers.
function applyStomp(game: Game, caster: Unit, ability: AbilityKind, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "stomp" }>) {
  const struck: Unit[] = [];
  forEachNearbyUnit(game, caster, def.range, (candidate) => {
    if (matchesUnitTarget(candidate, def.targets, game) && distance(caster, candidate) <= def.range && isAutocastFoe(game, caster, candidate)) struck.push(candidate);
  });
  if (struck.length === 0) return false;
  for (const unit of struck) setStatus(unit, { type: "stun", remaining: def.effectDuration });
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, "stomp", caster.x, caster.y, 24, { radius: def.range, owner: caster.owner, sourceKind: caster.kind, unitId: caster.id });
  return true;
}

function applyBloodlust(game: Game, caster: Unit, ability: AbilityKind, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "bloodlust" }>) {
  let best: Unit | undefined;
  forEachNearbyUnit(game, caster, def.range, (candidate) => {
    if (!matchesUnitTarget(candidate, def.targets, game) || distance(caster, candidate) > def.range || candidate.hp <= 0 || candidate.owner !== caster.owner || !isEngaged(candidate)) return;
    if (candidate.effects.some((effect) => effect.type === "bloodlust")) return;
    if (!best || candidate.attackDamage > best.attackDamage) best = candidate;
  });
  if (!best) return false;
  setStatus(best, { type: "bloodlust", remaining: def.effectDuration });
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, "bloodlust", best.x, best.y, 30, { owner: caster.owner, sourceKind: caster.kind, unitId: caster.id });
  return true;
}

function applyWeb(game: Game, caster: Unit, ability: AbilityKind, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "web" }>) {
  let best: Unit | undefined;
  forEachNearbyUnit(game, caster, def.range, (candidate) => {
    if (!matchesUnitTarget(candidate, def.targets, game) || distance(caster, candidate) > def.range || !isAutocastFoe(game, caster, candidate) || candidate.effects.some((effect) => effect.type === "root")) return;
    if (!best || distance(caster, candidate) < distance(caster, best)) best = candidate;
  });
  if (!best) return false;
  setStatus(best, { type: "root", remaining: def.effectDuration });
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, "web", best.x, best.y, def.effectDuration, { owner: caster.owner, sourceKind: caster.kind, unitId: caster.id });
  return true;
}

// A status put on anew: one of its kind at a time, the later replacing the earlier.
function setStatus(unit: Unit, status: UnitStatusEffect) {
  unit.effects = unit.effects.filter((effect) => effect.type !== status.type);
  unit.effects.push(status);
}

// The share of its pace a unit keeps under its statuses: none rooted or stunned, a net's share slowed.
function statusPace(unit: Unit) {
  if (unit.effects.length === 0) return 1;
  let pace = 1;
  for (const effect of unit.effects) {
    if (effect.type === "root" || effect.type === "stun") return 0;
    if (effect.type === "slow") pace = SLOW_PACE;
  }
  return pace;
}

// The ticks between a unit's blows: bloodlust's quicker.
function attackCooldownOf(game: Game, unit: Unit, baseCooldown = unit.attackCooldown) {
  const speed = (game.veteranFrame?.get(unit.id)?.attackSpeedMultiplier ?? 1) * temporaryAttackSpeedMultiplier(unit);
  return speed === 1 ? baseCooldown : Math.max(1, Math.round(baseCooldown / speed));
}

// Fighting: attacking, charging, or attack-moving onto a target.
function isEngaged(unit: Unit) {
  return unit.order.type === "attack" || unit.order.type === "charge" || (unit.order.type === "attackMove" && unit.order.targetId !== undefined);
}

// An enemy the unit's own spells and charges may pick: a player's unit, or a creep that is already fighting.
function isAutocastFoe(game: Game, caster: Unit, candidate: Unit) {
  return candidate.hp > 0 && areEnemyOwners(game, caster.owner, candidate.owner) && (candidate.owner !== "neutral" || isEngaged(candidate));
}

function autocastHealTarget(game: Game, caster: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "heal" }>) {
  let best: Unit | undefined;
  let bestMissing = def.healAmount / 2;
  forEachNearbyUnit(game, caster, def.range, (candidate) => {
    if (!matchesUnitTarget(candidate, def.targets, game) || !canReceiveHealing(candidate, game) || candidate.hp <= 0 || areEnemyOwners(game, caster.owner, candidate.owner) || distance(caster, candidate) > def.range) return;
    const missing = candidate.maxHp - candidate.hp;
    if (missing < bestMissing || (missing === bestMissing && best)) return;
    best = candidate;
    bestMissing = missing;
  });
  return best;
}

function autocastCurseTarget(game: Game, caster: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "curse" }>) {
  const casterFights = isEngaged(caster);
  const own = caster.order.type === "attack" || caster.order.type === "attackMove" ? caster.order.targetId : undefined;
  let best: Unit | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  forEachNearbyUnit(game, caster, def.range, (candidate) => {
    if (!matchesUnitTarget(candidate, def.targets, game) || !isAutocastFoe(game, caster, candidate) || distance(caster, candidate) > def.range) return;
    if (!casterFights && !isEngaged(candidate)) return;
    if (candidate.effects.some((effect) => effect.type === def.statusType)) return;
    const score = (def.summonedDamage && candidate.expiresTick !== undefined ? 2_000 : 0) + (candidate.id === own ? 1_000 : 0) - distance(caster, candidate);
    if (score <= bestScore) return;
    best = candidate;
    bestScore = score;
  });
  return best;
}

function autocastSummonPoint(game: Game, caster: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "summon" }>) {
  let foe: Unit | undefined;
  forEachNearbyUnit(game, caster, def.range + SUMMON_ALERT_MARGIN, (candidate) => {
    if (!isAutocastFoe(game, caster, candidate) || distance(caster, candidate) > def.range + SUMMON_ALERT_MARGIN) return;
    if (!foe || distance(caster, candidate) < distance(caster, foe)) foe = candidate;
  });
  if (!foe) return undefined;
  let company = false;
  forEachNearbyUnit(game, caster, SUMMON_COMPANY_RANGE, (candidate) => {
    if (candidate.owner === caster.owner && candidate.kind === def.summonKind && distance(caster, candidate) <= SUMMON_COMPANY_RANGE) company = true;
  });
  if (company) return undefined;
  const gap = distance(caster, foe);
  const step = Math.min(SUMMON_STEP, gap);
  return gap > 0 ? { x: caster.x + ((foe.x - caster.x) / gap) * step, y: caster.y + ((foe.y - caster.y) / gap) * step } : { x: caster.x, y: caster.y };
}

function autocastChargeTarget(game: Game, rider: Unit, def: ChargeDef) {
  const order = rider.order;
  const own = order.type === "attack" || order.type === "attackMove" ? order.targetId : undefined;
  if (own) {
    const target = findTarget(game, own);
    return target && isUnit(target) && matchesUnitTarget(target, def.targets, game) && isAutocastFoe(game, rider, target) && inChargeWindow(rider, target, def) && canReach(game.map, rider, target, game.units) ? target : undefined;
  }
  if (order.type !== "idle" && order.type !== "attackMove") return undefined;
  let charged: Set<string> | undefined;
  let free: Unit | undefined;
  let any: Unit | undefined;
  forEachNearbyUnit(game, rider, def.range, (candidate) => {
    if (!matchesUnitTarget(candidate, def.targets, game) || !isAutocastFoe(game, rider, candidate) || !inChargeWindow(rider, candidate, def) || !canReach(game.map, rider, candidate, game.units)) return;
    // Most riders are out of charge range: only scan existing charges when a candidate exists.
    charged ??= new Set(game.units.flatMap((unit) => (unit.owner === rider.owner && unit.order.type === "charge" ? [unit.order.targetId] : [])));
    if (!any || distance(rider, candidate) < distance(rider, any)) any = candidate;
    if (!charged.has(candidate.id) && (!free || distance(rider, candidate) < distance(rider, free))) free = candidate;
  });
  return free ?? any;
}

function outgoingDamageMultiplier(game: Game, unit: Unit) {
  const cursed = unit.effects.reduce((multiplier, effect) => Math.min(multiplier, effect.damageMultiplier ?? (effect.type === "curse" ? 0.4 : 1)), 1);
  return (unit.stance === "brace" ? cursed * BRACE_DAMAGE_SHARE : cursed) * passengerDamageMultiplier(game, unit);
}

function carriedItem(game: Game, unit: Unit, itemId: string) {
  const item = game.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  if (item.carrierId !== unit.id) throw new Error(`${unit.id} is not carrying ${item.id}`);
  return item;
}

function carrierFor(game: Game, item: WorldItem) {
  return item.carrierId ? game.units.find((unit) => unit.id === item.carrierId) : undefined;
}

function activateNeutralItem(game: Game, carrier: Unit, item: WorldItem) {
  // @@@neutral-treasure-rule - Camps can weaponize carried treasure, except scrolls that are explicitly inert on monsters
  // and what a shop sells (which no camp carries).
  if (item.kind === "guardianScroll" || item.kind === "experienceBook" || item.kind === "breachCharge" || isShopOnlyItem(item.kind) || item.cooldownRemaining > 0) return;
  const target = nearestEnemyInRange(game, carrier, item.kind === "stormStaff" ? NEUTRAL_STORM_TARGET_RANGE : NEUTRAL_ITEM_TARGET_RANGE);
  if (!target) return;
  activateItem(game, carrier, item, target.id, target.x, target.y);
}

function activateItem(
  game: Game,
  carrier: Unit,
  item: WorldItem,
  targetId: string | undefined,
  x: number | undefined,
  y: number | undefined,
) {
  if (item.cooldownRemaining > 0) return;
  if (item.kind === "lightningRod") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && areEnemyOwners(game, carrier.owner, unit.owner)) : undefined;
    if (!target || distance(carrier, target) > LIGHTNING_ROD.range) return;
    applyChainLightning(game, carrier, item, target);
    return;
  }
  if (item.kind === "stormStaff") {
    const point = targetId ? game.units.find((unit) => unit.id === targetId) : isNumber(x) && isNumber(y) ? { x, y } : undefined;
    if (!point || distance(carrier, point) > STORM_STAFF.range) return;
    applyStormStaff(game, carrier, item, point.x, point.y);
    return;
  }
  if (item.kind === "guardianScroll") {
    if (carrier.owner === "neutral") return;
    forEachNearbyUnit(game, carrier, GUARDIAN_SCROLL.radius, (unit) => {
      if (distance(unit, carrier) > GUARDIAN_SCROLL.radius || areEnemyOwners(game, carrier.owner, unit.owner)) return;
      unit.effects = unit.effects.filter((effect) => effect.type !== "guardian");
      unit.effects.push({ type: "guardian", remaining: GUARDIAN_SCROLL.duration });
    });
    addEffect(game, "guardianField", carrier.x, carrier.y, GUARDIAN_SCROLL.duration, { radius: GUARDIAN_SCROLL.radius });
    consumeItem(game, item);
    return;
  }
  if (item.kind === "breachCharge") {
    if (carrier.owner === "neutral") return;
    const target = targetId ? game.buildings.find((building) => building.id === targetId && areEnemyOwners(game, carrier.owner, building.owner)) : undefined;
    if (!target || distance(carrier, target) > BREACH_CHARGE.range) return;
    applyAttackDamage(game, carrier, target, BREACH_CHARGE.damage, BREACH_CHARGE.range, ITEM_DAMAGE_PROFILES.breachCharge);
    consumeItem(game, item);
    return;
  }
  if (item.kind === "experienceBook") {
    if (carrier.owner === "neutral") return;
    carrier.xp += EXPERIENCE_BOOK_XP;
    applyXpLevel(game, carrier);
    addEffect(game, "experienceBurst", carrier.x, carrier.y, 48);
    consumeItem(game, item);
    return;
  }
  if (item.kind === "healingScroll") {
    if (carrier.owner === "neutral") return;
    forEachNearbyUnit(game, carrier, HEALING_SCROLL_RADIUS, (unit) => {
      if (!canReceiveHealing(unit, game) || distance(unit, carrier) > HEALING_SCROLL_RADIUS || areEnemyOwners(game, carrier.owner, unit.owner)) return;
      unit.hp = Math.min(unit.maxHp, unit.hp + HEALING_SCROLL_HEAL);
    });
    addEffect(game, "heal", carrier.x, carrier.y, 30, { radius: HEALING_SCROLL_RADIUS });
    consumeItem(game, item);
    return;
  }
  if (item.kind === "ivoryTower") {
    if (!isPlayerId(carrier.owner) || !isNumber(x) || !isNumber(y)) return;
    if (Math.hypot(x - carrier.x, y - carrier.y) > IVORY_TOWER_REACH) return;
    if (terrainBlocksPlacement(game.map, "defenseTower", { x, y }) || buildingPlacementBlocker(game, "defenseTower", { x, y })) return;
    const at = snapToFootprint(game.map, BUILDING_DEFS.defenseTower.radius, { x, y });
    const tower = createBuilding(`building-${carrier.owner}-defenseTower-${game.nextId}`, carrier.owner, "defenseTower", at.x, at.y, true);
    game.nextId += 1;
    tower.hp = Math.round(tower.maxHp * IVORY_TOWER_HP_SHARE);
    game.buildings.push(tower);
    addEffect(game, "summon", at.x, at.y, 34);
    consumeItem(game, item);
  }
}

function isShopOnlyItem(kind: WorldItem["kind"]) {
  return kind === "speedBoots" || kind === "regenRing" || kind === "healingScroll" || kind === "ivoryTower";
}

function consumeItem(game: Game, item: WorldItem) {
  const unit=carrierFor(game,item);if(unit)removeFromHands(unit,item.id);
  game.items = game.items.filter((candidate) => candidate.id !== item.id);
  if(unit)applyDerivedUnitStats(game,unit);refreshEquipmentMass(game);
}

function applyChainLightning(game: Game, carrier: Unit, item: WorldItem, firstTarget: Unit) {
  const struck = new Set<string>();
  let current = firstTarget;
  let damage = LIGHTNING_ROD.damage;
  for (let bounce = 0; bounce < LIGHTNING_ROD.hits; bounce += 1) {
    struck.add(current.id);
    applyAttackDamage(game, carrier, current, damage*outgoingDamageMultiplier(game,carrier), 240, ITEM_DAMAGE_PROFILES.lightningRod);
    addEffect(game, "chainLightning", current.x, current.y, 28, { fromX: carrier.x, fromY: carrier.y, toX: current.x, toY: current.y });
    const next = nearestChainTarget(game, carrier, current, struck, LIGHTNING_ROD.bounceRange);
    if (!next) break;
    current = next;
    damage = Math.max(LIGHTNING_ROD.minimumDamage, Math.round(damage * LIGHTNING_ROD.decay));
  }
  item.cooldownRemaining = LIGHTNING_ROD.cooldown;
}

function nearestChainTarget(game: Game, carrier: Unit, from: Unit, struck: Set<string>, range: number) {
  const limit = range * range;
  let best: Unit | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  forEachNearbyUnit(game, from, range, (candidate) => {
    if (struck.has(candidate.id) || !areEnemyOwners(game, carrier.owner, candidate.owner)) return;
    const candidateDistance = distanceSquared(from, candidate);
    if (candidateDistance > limit || candidateDistance >= bestDistance) return;
    best = candidate;
    bestDistance = candidateDistance;
  });
  return best;
}

function applyStormStaff(game: Game, carrier: Unit, item: WorldItem, x: number, y: number) {
  forEachNearbyUnit(game, { x, y }, STORM_STAFF.radius, (target) => {
    if (distance(target, { x, y }) > STORM_STAFF.radius || !areEnemyOwners(game, carrier.owner, target.owner)) return;
    applyAttackDamage(game, carrier, target, STORM_STAFF.impactDamage*outgoingDamageMultiplier(game,carrier), STORM_STAFF.range, ITEM_DAMAGE_PROFILES.stormStaff);
  });
  addEffect(game, "storm", x, y, STORM_STAFF.duration, { owner: carrier.owner, unitId: carrier.id, damage: STORM_STAFF.pulseDamage*outgoingDamageMultiplier(game,carrier), damageProfile: { ...ITEM_DAMAGE_PROFILES.stormStaff }, radius: STORM_STAFF.radius, tickEvery: STORM_STAFF.pulseEvery });
  item.cooldownRemaining = STORM_STAFF.cooldown;
}

function applyFlameCloak(game: Game, carrier: Unit, item: WorldItem) {
  if (item.cooldownRemaining > 0) return;
  let burned = false;
  forEachNearbyUnit(game, carrier, FLAME_CLOAK.radius, (target) => {
    if (distance(target, carrier) > FLAME_CLOAK.radius || !areEnemyOwners(game, carrier.owner, target.owner)) return;
    applyAttackDamage(game, carrier, target, FLAME_CLOAK.damage*outgoingDamageMultiplier(game,carrier), 70, ITEM_DAMAGE_PROFILES.flameCloak);
    addEffect(game, "flameBurn", target.x, target.y, FLAME_CLOAK_VISUAL_DURATION);
    burned = true;
  });
  if (!burned) return;
  item.cooldownRemaining = FLAME_CLOAK.interval;
}

function updateWorldEffects(game: Game) {
  if (game.effects.length === 0) return;
  let expired = false;
  for (const effect of game.effects) {
    applyWorldEffectTick(game, effect);
    effect.remaining -= 1;
    expired ||= !(effect.remaining > 0);
  }
  if (expired) game.effects = game.effects.filter((effect) => effect.remaining > 0);
}

function applyWorldEffectTick(game: Game, effect: WorldEffect) {
  if (effect.type === "burningGround" && effect.owner && effect.damage && effect.radius && effect.tickEvery) {
    if (effect.remaining % effect.tickEvery !== 0) return;
    const source = effect.unitId ? findTarget(game,effect.unitId) : undefined;
    const attacker = source ?? scriptSource({id:effect.unitId ?? effect.id,owner:effect.owner,x:effect.x,y:effect.y});
    for (const target of [...game.units,...game.buildings]) if (target.hp>0 && areEnemyOwners(game,effect.owner,target.owner) && distance(effect,target)<=effect.radius+target.radius) {
      if (effect.sourceKind === 'sparkArcher' && isUnit(target) && (target.deck || unitMover(target.kind) !== 'land')) continue;
      const taken=applyDamage(game,attacker,target,effect.damage,undefined,undefined,0,effect.damageProfile ?? DAMAGE_PROFILES.BURNING);if(taken!==undefined)addHitEffect(game,target,taken,source);
      if (taken !== undefined && effect.sourceKind === 'sparkArcher' && isUnit(target)) setStatus(target, { type: 'scorch', remaining: SCORCH_DURATION });
    }
    return;
  }
  if (effect.type !== "storm" || !effect.owner || !effect.damage || !effect.radius || !effect.tickEvery) return;
  if (effect.remaining !== effect.duration && effect.remaining % effect.tickEvery !== 0) return;
  forEachNearbyUnit(game, effect, effect.radius, (target) => {
    if (distance(target, effect) > effect.radius! || !areEnemyOwners(game, effect.owner!, target.owner)) return;
    applyAttackDamage(game, scriptSource({ id: effect.unitId ?? effect.id, owner: effect.owner!, x: effect.x, y: effect.y }), target, effect.damage!, 260, effect.damageProfile ?? DAMAGE_PROFILES.STORM);
  });
}

function updateProjectiles(game: Game) {
  if (game.projectiles.length === 0) return;
  const pending: Projectile[] = [];
  for (const projectile of game.projectiles) {
    projectile.remaining -= 1;
    if (projectile.remaining > 0) {
      pending.push(projectile);
      continue;
    }
    applyProjectileImpact(game, projectile);
  }
  game.projectiles = pending;
}

function applyProjectileImpact(game: Game, projectile: Projectile) {
  withDeckDamageBatch(game, () => {
  if (projectile.weapon) { impactWeapon(game, projectile); return; }
  const target = findStrikeTarget(game, projectile.targetId);
  if (!target || target.hp <= 0 || !areEnemyOwners(game, projectile.owner, target.owner)) return;
  const liveShooter = findTarget(game, projectile.attackerId);
  const shooter = liveShooter?.owner===projectile.owner ? liveShooter : undefined;
  const attacker = shooter ?? projectileAttacker(projectile);
  const taken = applyDamage(game, attacker, target, attackDamageAgainstTarget(game, attacker, target, projectile.damage), projectile.hullDamageShare, undefined, 0, projectile.damageProfile ?? attackDamageProfile(projectile.sourceKind ?? "defenseTower"), projectile.armorAlreadyApplied);
  if (taken === undefined) return;
  applyAttackStatusEffects(game, attacker, target, projectile.sourceKind);
  addHitEffect(game, target, taken, shooter, projectile.attackKind);
  });
}

function projectileAttacker(projectile: Projectile): Building {
  return {
    id: projectile.attackerId,
    owner: projectile.owner as Exclude<Owner, "neutral">,
    kind: "defenseTower",
    x: projectile.fromX,
    y: projectile.fromY,
    hp: 1,
    maxHp: 1,
    radius: 0,
    complete: true,
    buildProgress: 0,
    buildTime: 0,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 0,
    cooldown: 0,
    rallyX: projectile.fromX,
    rallyY: projectile.fromY,
    queue: [],
    researchQueue: [],
  };
}

function updateUnitStatusEffects(game: Game) {
  for (const unit of game.units) {
    if (unit.effects.length === 0) continue;
    // Every status observes the same instant. A poison tick must not see a
    // one-tick ward differently just because that ward was inserted later.
    let expired = false;
    for (const effect of unit.effects) {
      effect.remaining -= 1;
      expired ||= !(effect.remaining > 0);
    }
    for (const effect of unit.effects) {
      // Poison bites once a second (see @@@creep-trait-numbers), for its biter while it lives.
      if (effect.type === "poison" && effect.remaining % 20 === 0 && unit.hp > 0) {
        const source = effect.sourceId ? findTarget(game, effect.sourceId) : undefined;
        const attacker = source && source.hp > 0 ? source : scriptSource({ id: effect.sourceId ?? "poison", owner: effect.sourceOwner ?? "neutral", x: unit.x, y: unit.y });
        applyDamage(game, attacker, unit, POISON_DAMAGE, undefined, undefined, 0, DAMAGE_PROFILES.POISON, false, true);
      }
    }
    if (expired) unit.effects = unit.effects.filter((effect) => effect.remaining > 0);
  }
}

type WeaponAbility = Extract<(typeof ABILITY_DEFS)[AbilityKind],{behavior:"weapon"}>;
function applyWeaponAbility(game:Game,caster:Unit,ability:AbilityKind,at:{x:number;y:number},def:WeaponAbility,targetId?:string){
  caster.abilityCooldowns=withAbilityCooldown(caster,ability,def.cooldown);
  const mounted=ability==='incendiaryFlume' ? installedWeapons(game,caster).find(item=>item.kind==='flameProjector' && (item.durability ?? 1)>0 && shipGunCanAim(caster,item,at)) : undefined;
  fireWeapon(game,caster,at,def.damage*outgoingDamageMultiplier(game, caster),def.weapon,def.range,{...(def.rootTicks ? {rootTicks:def.rootTicks}:{}),...(def.burnTicks ? {burnTicks:def.burnTicks}:{})},targetId,mounted?{item:mounted,pose:mountedWeaponPose(caster,mounted)!}:undefined);
}
function backOutOfDeadZone(game:Game,unit:Unit,target:{x:number;y:number}){
  let minimum=weaponRules(game,unit).weapon?.minRange;
  if(isShipKind(unit.kind)){
    const weapons=installedWeapons(game,unit).filter(item=>(item.durability ?? 1)>0);
    if(weapons.length)minimum=Math.min(...weapons.map(item=>SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].weapon.minRange ?? 0));
  }
  if(!minimum||distance(unit,target)>=minimum)return false;
  const dx=unit.x-target.x,dy=unit.y-target.y,length=Math.hypot(dx,dy)||1;
  moveToward(unit,unit.x+(dx||1)/length*(minimum+32),unit.y+dy/length*(minimum+32),game.map,game.units);return true;
}
function weaponOrigin(attacker: Unit | Building) {
  const pose = isUnit(attacker) && shipWeaponPose(attacker);
  return pose ? pose.muzzle : { x: attacker.x, y: attacker.y };
}
function combatVisualHeight(game: Game, entity: {id?:string}) {
  const unit=entity.id && game.units.find(unit=>unit.id===entity.id);
  if (!unit) return 0;
  const hull=unit.deck && game.units.find(ship=>ship.id===unit.deck!.shipId);
  return hull ? (shipProfile(hull)?.deckHeight ?? 0)+18 : shipProfile(unit)?.deckHeight ?? 0;
}

function fireWeapon(game:Game,attacker:Unit|Building,at:{x:number;y:number;id?:string},damage:number,weapon:WeaponDef,range:number,skill:{rootTicks?:number;burnTicks?:number}={},targetId=at.id, mounted?:{item:WorldItem;pose:NonNullable<ReturnType<typeof mountedWeaponPose>>;aimPoint?:{x:number;y:number}}){
  const origin = mounted?.pose.muzzle ?? weaponOrigin(attacker);
  const damageProfile = weaponDamageProfile(weapon);
  const target = targetId ? findStrikeTarget(game,targetId) : undefined;
  const point = mounted?.aimPoint ?? (target ? strikePoint(origin,target) : at);
  const fromHeight=mounted?.pose.height || (isUnit(attacker) && shipWeaponPose(attacker)?.height) || combatVisualHeight(game,attacker);
  const attackKind=weapon.presentation ?? (weapon.delivery==="cone" ? "grapeshot" : weapon.delivery==="shell" ? "stone" : "bolt");
  const visuals={attackKind,fromX:origin.x,fromY:origin.y,fromHeight,toX:point.x,toY:point.y,toHeight:combatVisualHeight(game,at),owner:attacker.owner,sourceKind:attacker.kind,unitId:attacker.id,...(mounted?{itemId:mounted.item.id}:{})};
  if((attackKind==="cannon" || attackKind==="mortar" || attackKind==="grapeshot") && (mounted || isUnit(attacker)))addEffect(game,"muzzleFlash",origin.x,origin.y,seconds(.65),visuals);
  if(weapon.delivery==="ram"){
    const target=targetId?findStrikeTarget(game,targetId):undefined;
    if(target&&areEnemyOwners(game,attacker.owner,target.owner))hitWeapon(game,attacker,target,damage,weapon);
    addEffect(game,"siegeImpact",at.x,at.y,18,{fromX:origin.x,fromY:origin.y,toX:point.x,toY:point.y,owner:attacker.owner,sourceKind:attacker.kind});return;
  }
  if(weapon.delivery==="cone"){
    const hits=[...game.units,...game.buildings].filter(target=>target.hp>0&&(!isUnit(target)||!isInCabin(target))&&areEnemyOwners(game,attacker.owner,target.owner)&&inWeaponCone(origin,point,target,range,weapon.coneAngle??.6));
    withDeckDamageBatch(game,()=>{for(const target of crewBeforeHulls(hits))hitWeapon(game,attacker,target,damage*(weapon.burst??1),weapon);});
    addEffect(game,"grapeshot",point.x,point.y,seconds(.7),{...visuals,radius:range});return;
  }
  const flight=Math.max(seconds(0.2),Math.ceil(distance(origin,point)/perTick(weapon.delivery==="shell"?240:560)));
  const projectile:Projectile={id:`projectile-${game.nextId++}`,owner:attacker.owner,attackerId:attacker.id,targetId:targetId??"",fromX:origin.x,fromY:origin.y,toX:point.x,toY:point.y,damage,damageProfile:{...damageProfile},remaining:flight,duration:flight,attackKind,weapon:{...weapon},...(isUnit(attacker)?{sourceKind:attacker.kind}:{}),...skill};
  game.projectiles.push(projectile);
  addEffect(game,weapon.delivery==="shell"?"shellFlight":"siegeBolt",point.x,point.y,flight,{...visuals,radius:weapon.radius??0});
}
function hitWeapon(game:Game,attacker:Unit|Building,target:Unit|Building|Obstacle,damage:number,weapon:WeaponDef,share=1,rootTicks?:number,impact=strikePoint(attacker,target),profile:DamageProfile=weaponDamageProfile(weapon)){
  const dealt=weaponDamage(weapon,damage,!isUnit(target),isUnit(target)&&unitMover(target.kind)==="sea",share);
  const taken=applyDamage(game,attacker,target,dealt,deckHullDamageShare(game,attacker,weapon),impact,weapon.blastRadius ?? weapon.radius ?? 0,profile);if(taken===undefined)return;
  addHitEffect(game,target,taken,attacker,weapon.presentation);
  if(rootTicks&&isUnit(target)&&target.hp>0)setStatus(target,{type:"root",remaining:rootTicks});
}
function impactWeapon(game:Game,projectile:Projectile){
  const weapon=projectile.weapon!;
  // Remember the shooter's kind if it died during flight: armor and attribution remain consistent.
  const liveSource=findTarget(game,projectile.attackerId);
  const source=liveSource?.owner===projectile.owner ? liveSource : undefined;
  const fallback=projectileAttacker(projectile);
  const attacker=source??(projectile.sourceKind?{...fallback,kind:projectile.sourceKind,order:{type:"idle"},effects:[],xp:0,level:0,kills:0,abilityCooldown:0,speed:0} as unknown as Unit:fallback);
  const from={x:projectile.fromX,y:projectile.fromY},to={x:projectile.toX,y:projectile.toY};
  const flightLength=distance(from,to),impactAt=(along:number)=>{const share=flightLength?Math.max(0,Math.min(1,along/flightLength)):0;return{x:from.x+(to.x-from.x)*share,y:from.y+(to.y-from.y)*share};};
  const foes=[...game.units,...game.buildings,...(game.obstacles??[])].filter(t=>t.hp>0&&(!isUnit(t)||!isInCabin(t))&&areEnemyOwners(game,projectile.owner,t.owner));
  if(weapon.delivery==="bolt"){
    const intersections=foes.map(target=>({target,along:boltIntersection(from,to,target,weapon.radius??12)})).filter(h=>h.along!==undefined).sort((a,b)=>a.along!-b.along!);
    const eligible=new Set(crewBeforeHulls(intersections.map(hit=>hit.target)));
    const hits=intersections.filter(hit=>eligible.has(hit.target)).slice(0,weapon.maxHits??1);
    if(weapon.blastRadius && hits[0]){
      const impact=impactAt(hits[0].along!);
      for(const target of crewBeforeHulls(foes.filter(target=>bodyGap(impact,target)<=weapon.blastRadius!))) {
        const share=Math.max(.4,1-bodyGap(impact,target)/weapon.blastRadius*.6);
        hitWeapon(game,attacker,target,projectile.damage,weapon,share,projectile.rootTicks,impact,projectile.damageProfile);
      }
      addEffect(game,"siegeImpact",impact.x,impact.y,seconds(.65),{radius:weapon.blastRadius,owner:projectile.owner,...(projectile.sourceKind?{sourceKind:projectile.sourceKind}:{})});
      return;
    }
    hits.forEach(({target,along},i)=>hitWeapon(game,attacker,target,projectile.damage,weapon,(weapon.pierceShare??1)**i,projectile.rootTicks,impactAt(along!),projectile.damageProfile));
  }else{
    for(const target of crewBeforeHulls(foes.filter(target=>bodyGap(to,target)<=(weapon.radius??0)))){const gap=bodyGap(to,target);
      const falloff=Math.max(.35,1-gap/Math.max(1,weapon.radius??1)*.65);hitWeapon(game,attacker,target,projectile.damage,weapon,falloff,projectile.rootTicks,to,projectile.damageProfile);
    }
    addEffect(game,"siegeImpact",to.x,to.y,24,{radius:weapon.radius??0,owner:projectile.owner,...(projectile.sourceKind?{sourceKind:projectile.sourceKind}:{})});
    if(projectile.burnTicks)addEffect(game,"burningGround",to.x,to.y,projectile.burnTicks,{owner:projectile.owner,unitId:projectile.attackerId,damage:3,damageProfile:{...DAMAGE_PROFILES.BURNING},radius:weapon.radius??0,tickEvery:10,...(projectile.sourceKind?{sourceKind:projectile.sourceKind}:{})});
  }
}

function applyWeaponAttack(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, attackRange: number) {
  if (!isObstacle(target)) target=navalCombatTarget(game,attacker,target);
  if(isUnit(attacker) && shipProfile(attacker) && !unitRules(game,attacker).intrinsicAttack)return;
  const weapon = isUnit(attacker) ? weaponRules(game, attacker).weapon : undefined;
  if (weapon) {
    if (weapon.minRange && distance(attacker, target) < weapon.minRange) return;
    fireWeapon(game, attacker, target, damage, weapon, attackRange);
    return;
  }
  const baseRange = isUnit(attacker) ? weaponRules(game, attacker).attackRange : attackRange;
  if (baseRange > RANGED_ATTACK_RANGE_THRESHOLD) {
    launchProjectile(game, attacker, target, buildingTargetDamage(attacker, target, damage));
    return;
  }
  // Range upgrades extend a melee weapon; they do not turn it into a projectile or change its armor interaction.
  applyAttackDamage(game, attacker, target, damage, baseRange);
}

function launchProjectile(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number) {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const flight = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / perTick(PROJECTILE_SPEED)));
  const projectile = {
    attackKind: innateMissile(attacker.kind),
    damageProfile: { ...(isUnit(attacker) ? unitAttackDamageProfile(game, attacker) : attackDamageProfile(attacker.kind)) },
    id: `projectile-${game.nextId}`,
    owner: attacker.owner,
    attackerId: attacker.id,
    targetId: target.id,
    fromX: attacker.x,
    fromY: attacker.y,
    toX: target.x,
    toY: target.y,
    damage,
    remaining: flight,
    duration: flight,
    ...(isUnit(attacker) ? { sourceKind: attacker.kind } : {}),
    hullDamageShare: deckHullDamageShare(game,attacker),
  } satisfies Projectile;
  game.nextId += 1;
  game.projectiles.push(projectile);
  addEffect(game, "projectile", target.x, target.y, flight, {
    fromX: projectile.fromX,
    fromY: projectile.fromY,
    toX: projectile.toX,
    toY: projectile.toY,
    sourceKind: attacker.kind,
    attackKind: projectile.attackKind,
    fromHeight: combatVisualHeight(game,attacker),
    toHeight: combatVisualHeight(game,target),
  });
}

function applyAttackDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, attackRange: number, profile?: DamageProfile) {
  profile ??= isUnit(attacker) ? unitAttackDamageProfile(game, attacker) : attackDamageProfile(attacker.kind);
  const dealt = profile.origin === "spell" ? damage : attackDamageAgainstTarget(game, attacker, target, buildingTargetDamage(attacker, target, damage));
  const taken = applyDamage(game, attacker, target, dealt, undefined, undefined, 0, profile);
  if (taken === undefined) return;
  if (profile.origin !== "spell") applyAttackStatusEffects(game, attacker, target, attacker.kind);
  if (profile.delivery === "melee" && profile.origin !== "spell" && isUnit(attacker) && isUnit(target)) stanceBlow(attacker, target, dealt);
  const from = { x: attacker.x, y: attacker.y };
  const to = { x: target.x, y: target.y };
  const kind: WorldEffect["type"] = attackRange > RANGED_ATTACK_RANGE_THRESHOLD ? "projectile" : "melee";
  addEffect(game, kind, to.x, to.y, kind === "projectile" ? 22 : 16, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
  addHitEffect(game, target, taken, attacker);
}

// The flinch of whatever was struck, carrying who it was and what it took, so the client shakes it by the share of its
// full health the blow took, and the kind of who struck it (a weapon's blow; a spell's or a gone shooter's has none) so
// the client can sound the blow.
function addHitEffect(game: Game, target: Unit | Building | Obstacle, taken: number, striker?: Unit | Building, attackKind?: AttackKind) {
  attackKind ??= striker ? isUnit(striker) && weaponRules(game,striker).attackRange<=RANGED_ATTACK_RANGE_THRESHOLD ? "melee" : innateMissile(striker.kind) : undefined;
  addEffect(game, "hit", target.x, target.y, 14, { unitId: target.id, damage: taken, ...(attackKind ? {attackKind} : {}), ...(striker ? { sourceKind: striker.kind } : {}) });
}

function buildingTargetDamage(attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number) {
  if (isUnit(attacker) || !isUnit(target) || target.owner !== "neutral") return damage;
  return damage * (BUILDING_DEFS[attacker.kind]?.neutralDamageMultiplier ?? 1);
}

function attackDamageAgainstTarget(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number) {
  if (!isUnit(attacker) || !isUnit(target)) return damage;
  const slayer = unitRules(game, attacker).casterSlayer;
  const dealt = slayer && isCasterOrSummoned(target) ? Math.round(damage * slayer) : damage;
  if (!target.effects.some((effect) => effect.type === "scorch")) return dealt;
  if (attacker.kind === "emberRavager") return dealt + 7;
  if (attacker.kind === "cinderRunner") return dealt + 5;
  return dealt;
}

// A melee blow in brace or shock shoves its target, and in shock the striker after it (see @@@melee-stances).
function stanceBlow(attacker: Unit, target: Unit, dealt: number) {
  if (!attacker.stance || target.hp <= 0) return;
  const strength = blowStrength(dealt, target);
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  shove(target, dx, dy, strength);
  if (attacker.stance === "shock") shove(attacker, dx, dy, lungeStrength(attacker, strength));
}

// What the ash chieftain hunts: anything summoned, and any unit with a spell.
function isCasterOrSummoned(unit: Unit) {
  return unit.expiresTick !== undefined || hasSpell(unit.kind);
}

function applyAttackStatusEffects(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, sourceKind: (Unit | Building)['kind'] | undefined) {
  if (sourceKind === 'sparkArcher' && isUnit(target) && !target.deck && unitMover(target.kind) === 'land'
    && sparkIgnites(attacker.id, target.id, game.tick)) {
    addEffect(game, 'burningGround', target.x, target.y, SPARK_FIRE.duration, {
      owner: attacker.owner, unitId: attacker.id, sourceKind, damageProfile: DAMAGE_PROFILES.BURNING,
      damage: SPARK_FIRE.damage, radius: SPARK_FIRE.radius, tickEvery: SPARK_FIRE.tickEvery,
    });
  }
  if (!isUnit(attacker)) return;
  const rules = unitRules(game, attacker);
  // A red dragon's fire (see @@@creep-traits) falls on buildings' neighbours too.
  if (rules.splash) {
    const share = Math.max(1, Math.round(attacker.attackDamage * SPLASH_SHARE));
    const burned: Unit[] = [];
    forEachNearbyUnit(game, target, SPLASH_RADIUS, (unit) => {
      if (unit !== target && unit.hp > 0 && distance(unit, target) <= SPLASH_RADIUS && areEnemyOwners(game, attacker.owner, unit.owner)) burned.push(unit);
    });
    for (const unit of burned) applyDamage(game, attacker, unit, share, undefined, undefined, 0, unitAttackDamageProfile(game, attacker));
    addEffect(game, "flameBurn", target.x, target.y, 20);
  }
  if (!isUnit(target)) return;
  if (rules.slowOnHit) setStatus(target, { type: "slow", remaining: SLOW_TICKS });
  if (rules.poisonOnHit) setStatus(target, { type: "poison", remaining: POISON_TICKS, sourceId: attacker.id, sourceOwner: attacker.owner });
}

// The damage the target took, or undefined when a guardian field turned the blow aside.
function applyDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, hullShare?: number,impact?:{x:number;y:number},blastRadius=0, profile: DamageProfile = isUnit(attacker) ? unitAttackDamageProfile(game, attacker) : attackDamageProfile(attacker.kind), armorAlreadyApplied = false, existingStatus = false): number | undefined {
  if (isUnit(attacker) && isInCabin(attacker)) return undefined;
  // Existing poison persists indoors; shelter blocks incoming attacks rather than cleansing statuses.
  if (isUnit(target) && isCabinProtected(game,target) && !existingStatus) return undefined;
  if ('invulnerable' in target && target.invulnerable) return undefined;
  if (isObstacle(target)) {
    // A rock pile or gate wakes nobody and pays nothing when it falls (see @@@obstacle).
    const hpBefore = target.hp;
    target.hp -= damage;
    game.observer?.hit(attacker, target, damage, hpBefore);
    return damage;
  }
  const impactDamage = damage;
  const resolved = isUnit(target) ? resolveUnitDamage(game, target, damage, profile, game.veteranFrame?.get(target.id)?.reductions, { armorAlreadyApplied }) : undefined;
  if (resolved?.blocked) return undefined;
  const taken = resolved?.damage ?? damage;
  const hpBefore = target.hp;
  target.hp -= taken;
  if(isUnit(target) && shipProfile(target)){
    damageShipGangway(target,taken);
    damageShipParts(game,target,impact ?? strikePoint(attacker,target),taken,blastRadius);
    if(target.hp>0) {
      applyDerivedUnitStats(game,target);
      updateCabinPassengers(game);
      // Trapped occupants of a broken compartment remain selectable in the crew list, not as invisible targets.
      // Incoming hull hits reach them until a real, clear deck exit opens.
      for (const passenger of shipPassengers(game.units,target)) if (passenger.hp>0 && isInCabin(passenger) && !isCabinProtected(game,passenger)) applyDamage(game,attacker,passenger,taken*.35,0,impact,0,profile);
    }
  }
  if (hpBefore > 0 && isUnit(target)) {
    if (shipProfile(target) && game.deckDamageBatch) {
      const entry = game.deckDamageBatch.get(target.id) ?? { ship: target, direct: 0, collateral: 0 };
      entry.direct += impactDamage;
      game.deckDamageBatch.set(target.id, entry);
    }
    const hull = target.deck && game.units.find(ship => ship.id === target.deck!.shipId && ship.hp > 0);
    if (hull && areEnemyOwners(game, attacker.owner, hull.owner)) {
      const collateral = impactDamage * (hullShare ?? deckHullDamageShare(game,attacker));
      if (game.deckDamageBatch) {
        const entry = game.deckDamageBatch.get(hull.id) ?? { ship: hull, direct: 0, collateral: 0, source: attacker };
        if (collateral > entry.collateral) { entry.collateral = collateral; entry.source = attacker; entry.profile = profile; }
        game.deckDamageBatch.set(hull.id,{...entry,impact:{x:target.x,y:target.y},blastRadius});
      } else if (collateral > 0) applyDamage(game, attacker, hull, collateral, 0,target,0,profile);
    }
  }
  game.observer?.hit(attacker, target, taken, hpBefore);
  if (hpBefore > 0 && isUnit(target) && target.owner === "neutral") triggerNeutralAssist(game, target, attacker);
  if (hpBefore > 0 && isPlayerId(target.owner)) triggerPlayerAggro(game, target, attacker);
  if (hpBefore > 0 && target.hp <= 0) {
    recordKill(game, attacker, target);
  }
  return taken;
}

function crewBeforeHulls<T extends Unit | Building | Obstacle>(targets: T[]): T[] {
  const occupied = new Set(targets.flatMap(target => isUnit(target) && target.deck ? [target.deck.shipId] : []));
  return targets.filter(target => !isUnit(target) || !shipProfile(target) || !occupied.has(target.id));
}
function withDeckDamageBatch(game: Game, body: () => void) {
  if (game.deckDamageBatch) { body(); return; }
  const batch: NonNullable<Game["deckDamageBatch"]> = new Map();
  game.deckDamageBatch = batch;
  try { body(); } finally { delete game.deckDamageBatch; }
  for (const { ship, direct, collateral, source,impact,blastRadius,profile } of batch.values()) {
    if (source && ship.hp > 0 && collateral > direct) applyDamage(game, source, ship, collateral - direct, 0,impact,blastRadius,profile);
  }
}

/** Ship orders address the fighting deck and remain on the hull after its last passenger dies. */
function navalCombatTarget(game: Game, attacker: Unit | Building, target: Unit | Building, crewRange=Infinity): Unit | Building {
  if (!isUnit(target) || !shipProfile(target)) return target;
  const home=isUnit(attacker) && attacker.deck && unitRules(game,attacker).attackRange<=RANGED_ATTACK_RANGE_THRESHOLD
    ? game.units.find(ship=>ship.id===attacker.deck!.shipId) : undefined;
  // Boarders remain combatants when they cross the seam onto our own deck.
  // A hull-targeted melee order must answer them before striking an empty hull.
  const passengers=home && home.id!==target.id && decksCanTransfer(home,target,attacker as Unit)
    ? [...shipPassengers(game.units,target),...shipPassengers(game.units,home)] : shipPassengers(game.units,target);
  const crew = passengers.filter(unit => unit.hp > 0 && !isInCabin(unit) && areEnemyOwners(game, attacker.owner, unit.owner) && (crewRange===Infinity || distanceSquared(attacker,unit)<=crewRange*crewRange)
    && (isUnit(attacker) ? canReach(game.map, attacker, unit, game.units) : distance(attacker,unit)<=attacker.attackRange));
  let best: Unit | undefined, bestScore = -Infinity;
  for (const unit of crew) {
    const score = targetPriorityScore(game, attacker.owner, unit, distanceSquared(attacker, unit), isUnit(attacker) ? attacker : undefined);
    if (score > bestScore) { best = unit; bestScore = score; }
  }
  return best ?? crew[0] ?? target;
}

function triggerNeutralAssist(game: Game, damagedNeutral: Unit, attacker: Unit | Building) {
  if (!areEnemyOwners(game, damagedNeutral.owner, attacker.owner)) return;
  const origin = neutralHomeOrCurrentPoint(damagedNeutral);
  // @@@neutral-assist - Damage wakes the camp; an ongoing fight changes target only for a substantially greater threat.
  for (const unit of game.units) {
    if (unit.owner !== "neutral" || unit.hp <= 0) continue;
    if (distance(unit, damagedNeutral) > NEUTRAL_ASSIST_RANGE) continue;
    if (!canReach(game.map, unit, attacker, game.units)) continue;
    const responseOrigin = neutralResponseOrigin(unit) ?? origin;
    if (distance(attacker, responseOrigin) > NEUTRAL_DAMAGE_RESPONSE_RANGE) continue;
    if (neutralHasValidAttackTarget(game, unit) && unit.order.type === "attack") {
      if (incomingThreatOutranks(game, unit, unit.order.targetId, attacker, damagedNeutral)) unit.order = { ...unit.order, targetId: attacker.id };
    } else unit.order = { type: "attack", targetId: attacker.id, leashX: origin.x, leashY: origin.y };
  }
}

// A hit wakes the victim and every soldier of its owner within call range, even when the victim is a worker or a
// building or did not survive the hit. Attackers that are already gone (a tower's arrow still flying, a storm) are nobody
// to turn on.
function triggerPlayerAggro(game: Game, victim: Unit | Building, attacker: Unit | Building) {
  if (!areEnemyOwners(game, victim.owner, attacker.owner) || attacker.hp <= 0 || findTarget(game, attacker.id) !== attacker) return;
  if (isUnit(victim)) takeUpAttacker(game, victim, attacker, victim);
  const reach = HELP_CALL_RANGE + (isUnit(victim) ? 0 : victim.radius);
  forEachNearbyUnit(game, victim, reach, (ally) => {
    if (ally === victim || ally.owner !== victim.owner || distance(ally, victim) > reach) return;
    takeUpAttacker(game, ally, attacker, victim);
  });
}

function takeUpAttacker(game: Game, unit: Unit, attacker: Unit | Building, victim: Unit | Building) {
  if (unit.hp <= 0 || unit.kind === "worker" || unit.attackDamage <= 0 || !canReach(game.map, unit, attacker, game.units)) return;
  const order = unit.order;
  if(shipProfile(unit) && order.type==='idle')return;
  if (order.type === "idle") {
    if (!unit.orderQueue?.length) unit.order = { type: "attack", targetId: attacker.id, leashX: unit.x, leashY: unit.y };
    return;
  }
  if (order.type === "attackMove") {
    if (!order.targetId || incomingThreatOutranks(game, unit, order.targetId, attacker, victim)) unit.order = { ...order, targetId: attacker.id };
    return;
  }
  const selfDirected = order.type === "attack" && order.leashX !== undefined;
  if (selfDirected && incomingThreatOutranks(game, unit, order.targetId, attacker, victim)) unit.order = { ...order, targetId: attacker.id };
}

// The same score and hysteresis apply to damage responses and ordinary acquisition, even during a strike.
function incomingThreatOutranks(game: Game, unit: Unit, targetId: string, attacker: Unit | Building, victim: Unit | Building) {
  if (targetId === attacker.id) return false;
  const current = findTarget(game, targetId);
  if (!current || current.hp <= 0 || !canReach(game.map, unit, current, game.units)) return true;
  const incoming = combatTargetScore(attacker, targetGap(unit, attacker), victim.id === unit.id ? "self" : "ally", projectedHpAfterPendingProjectiles(game, unit.owner, attacker));
  return shouldSwitchCombatTarget(targetPriorityScore(game, unit.owner, current, targetGap(unit, current) ** 2, unit), incoming);
}

function automaticCombatTarget(game: Game, unit: Unit, current: Unit | Building): Unit | Building {
  // Incoming damage reacts immediately; ordinary reconsideration happens as the next shot becomes available.
  if (unit.cooldown > 0) return current;
  const next = nearestEnemyTarget(game, unit, Math.max(AUTO_ACQUIRE_RANGE, unit.attackRange));
  if (!next || next.id === current.id) return current;
  return shouldSwitchCombatTarget(targetPriorityScore(game, unit.owner, current, targetGap(unit, current) ** 2, unit),
    targetPriorityScore(game, unit.owner, next, targetGap(unit, next) ** 2, unit)) ? next : current;
}

function neutralHasValidAttackTarget(game: Game, unit: Unit) {
  if (unit.order.type !== "attack") return false;
  const target = findTarget(game, unit.order.targetId);
  if (!target || target.hp <= 0 || !areEnemyOwners(game, unit.owner, target.owner)) return false;
  const responseOrigin = neutralResponseOrigin(unit);
  if (responseOrigin && distance(target, responseOrigin) > NEUTRAL_DAMAGE_RESPONSE_RANGE) return false;
  return true;
}

function neutralResponseOrigin(unit: Unit) {
  if (unit.order.type === "attack" && unit.order.leashX !== undefined && unit.order.leashY !== undefined) return { x: unit.order.leashX, y: unit.order.leashY };
  if (unit.homeX !== undefined && unit.homeY !== undefined) return { x: unit.homeX, y: unit.homeY };
  return undefined;
}

function neutralHomeOrCurrentPoint(unit: Unit) {
  return unit.homeX !== undefined && unit.homeY !== undefined ? { x: unit.homeX, y: unit.homeY } : { x: unit.x, y: unit.y };
}

function recordKill(game: Game, attacker: Unit | Building, target: Unit | Building) {
  // Those aboard a sunk transport drown with it, at the hand that sank it (see @@@transport).
  if(isUnit(target) && shipProfile(target))for(const passenger of shipPassengers(game.units,target)){if(passenger.hp>0){passenger.hp=0;recordKill(game,attacker,passenger);}}
  // A wreck or friendly impact causes losses, but never grants its own crew
  // kills, experience or a bounty for crashing.
  if(!areEnemyOwners(game,attacker.owner,target.owner))return;
  const attackerOwner = attacker.owner;
  if (isPlayerId(attackerOwner) || attackerOwner === "neutral") {
    incrementStat(game.match.stats.unitsKilled, attackerOwner, isUnit(target) ? 1 : 0);
  }
  if (isUnit(attacker) && isUnit(target)) {
    attacker.kills += 1;
    awardKillXp(game, attacker, target);
    if (attacker.owner === "neutral" && isPlayerId(target.owner)) {
      incrementStat(game.match.stats.unitsKilledByNeutral, target.owner, 1);
    }
    if (isPlayerId(attacker.owner) && isMercenaryUnitKind(attacker.kind) && areEnemyOwners(game, attacker.owner, target.owner)) {
      incrementStat(game.match.stats.mercenaryKills, attacker.owner, 1);
    }
  }
  if (isUnit(target) && target.owner === "neutral" && isPlayerId(attackerOwner)) {
    incrementStat(game.match.stats.neutralUnitsKilled, attackerOwner, 1);
    awardNeutralGoldBounty(game, attackerOwner, target);
  }
  if (!isUnit(target) && isPlayerId(attackerOwner)) {
    incrementStat(game.match.stats.buildingsDestroyed, attackerOwner, 1);
    if (target.kind !== "townHall") incrementStat(game.match.stats.nonBaseBuildingsDestroyed, attackerOwner, 1);
  }
}

function addEffect(
  game: Game,
  type: WorldEffect["type"],
  x: number,
  y: number,
  remaining: number,
  vectors?: Partial<Pick<WorldEffect, "fromX" | "fromY" | "fromHeight" | "toX" | "toY" | "toHeight" | "owner" | "damage" | "damageProfile" | "radius" | "tickEvery" | "sourceKind" | "unitId" | "itemId" | "amount" | "attackKind">>,
) {
  game.effects.push({ id: `effect-${game.nextId}`, type, x, y, remaining, duration: remaining, ...vectors });
  game.nextId += 1;
}

function isUnit(entity: Unit | Building | Obstacle): entity is Unit {
  return "order" in entity;
}

function isObstacle(entity: Unit | Building | Obstacle): entity is Obstacle {
  return "along" in entity;
}

function awardKillXp(game: Game, attacker: Unit, target: Unit) {
  if (attacker.owner === "neutral" || !areEnemyOwners(game, attacker.owner, target.owner)) return;
  attacker.xp += killXpReward(unitRules(game, target), target.level);
  applyXpLevel(game, attacker);
}

function awardNeutralGoldBounty(game: Game, owner: PlayerId, target: Unit) {
  const bounty = unitRules(game, target).goldBounty ?? 0;
  if (bounty <= 0) return;
  playerState(game, owner).gold += bounty;
  addEffect(game, "goldBounty", target.x, target.y, seconds(1.2), { owner, amount: bounty });
}

function applyXpLevel(game: Game, unit: Unit) {
  if (unit.variant !== undefined && game.variants?.[unit.variant]?.heroic) return;
  const nextLevel = xpStarThresholds(unitRules(game, unit)).filter(threshold => unit.xp >= threshold).length;
  if (nextLevel <= unit.level) return;
  unit.level = Math.min(MAX_UPGRADE_LEVEL, nextLevel);
  if (unit.level === 3 && unit.owner !== "neutral" && unit.expiresTick === undefined && !unit.veteranSkillChoices) {
    unit.veteranSkillChoices = rollVeteranSkillChoices(unit.kind, unit.id, `${game.map.terrain?.ecology?.seed ?? game.map.id}:${game.tick}`, unitClassOf(unit, game));
  }
  applyDerivedUnitStats(game, unit);
}

function applyDerivedUnitStats(game: Game, unit: Unit) {
  const previousMaxHp = unit.maxHp;
  const base = nonStarUnitStats(game, unit);
  const multiplier = 1 + Math.min(MAX_UPGRADE_LEVEL, Math.max(0, unit.level)) * VETERANCY_GAIN_PER_STAR;
  const heavy=itemsFor(game,unit).some(item=>ITEM_DEFS[item.kind].span===4);
  unit.bodyRadius=unitRules(game,unit).radius*(isShipKind(unit.kind)?SHIP_SIZE_MULTIPLIER:1);unit.radius=unit.bodyRadius;
  const veterans = game.veteranFrame?.get(unit.id);
  unit.attackDamage = Math.round(base.attackDamage);
  unit.maxHp = Math.round(base.maxHp * multiplier);
  unit.speed = base.speed * (heavy ? .45 : 1) * (veterans?.moveSpeedMultiplier ?? 1);
  unit.attackRange = base.attackRange * (veterans?.attackRangeMultiplier ?? 1);
  unit.hp = Math.min(unit.maxHp, Math.max(1, unit.hp + unit.maxHp - previousMaxHp));
}

function nonStarUnitStats(game: Game, unit: Unit) {
  const stats = weaponRules(game, unit);
  unit.attackCooldown=stats.attackCooldown;
  let attackDamage = stats.attackDamage;
  let maxHp = stats.hp;
  let speed = stats.speed;
  let attackRange = stats.attackRange;
  if (!isPlayerId(unit.owner)) return { attackDamage, maxHp, speed, attackRange };
  const upgrades = playerState(game, unit.owner).upgrades;
  for (const upgradeKind of UPGRADE_KINDS) {
    const upgrade = UPGRADE_DEFS[upgradeKind];
    if (!upgrade.affectedUnitKinds.includes(unit.kind as TrainableUnitKind)) continue;
    for (let level = 0; level < (upgrades[upgradeKind] ?? 0); level += 1) {
      const levelDef = upgrade.levels[level];
      if (!levelDef) throw new Error(`${upgradeKind} missing level ${level + 1}`);
      if (levelDef.attackMultiplier) attackDamage = stats.attackDamage * levelDef.attackMultiplier;
      if (levelDef.maxHpMultiplier) maxHp = stats.hp * levelDef.maxHpMultiplier;
      if (levelDef.speedMultiplier) speed = roundUnitScalar(stats.speed * levelDef.speedMultiplier);
      if (levelDef.attackRangeMultiplier) attackRange = Math.round(stats.attackRange * levelDef.attackRangeMultiplier);
    }
  }
  if (itemsFor(game,unit).some((item) => item.kind === "speedBoots" && itemEquipped(game,unit,item))) speed = roundUnitScalar(speed * BOOTS_SPEED);
  return { attackDamage, maxHp, speed, attackRange };
}

function roundUnitScalar(value: number) {
  return Math.round(value * 100) / 100;
}

function updateSupplyState(game: Game) {
  for (const owner of game.activePlayers) {
    const player = playerState(game, owner);
    player.supplyCap = game.buildings
      .filter((building) => building.owner === owner && building.complete)
      .reduce((total, building) => total + BUILDING_DEFS[building.kind].supplyProvided, 0);
    player.supplyUsed = projectedSupplyUsed(game, owner);
  }
}

function projectedSupplyUsed(game: Game, owner: PlayerId) {
  const unitSupply = game.units
    .filter((unit) => unit.owner === owner)
    .reduce((total, unit) => total + unitRules(game, unit).supplyUsed + (unit.cargo ? cargoSupply(game, unit) : 0), 0);
  const queuedSupply = game.buildings
    .filter((building) => building.owner === owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  return unitSupply + queuedSupply;
}

function unitsByIds(game: Game, unitIds: string[], owner: PlayerId) {
  const unit = ownUnitLookup(game.units, owner, unitIds.length);
  const units = unitIds.map((id) => unit(id));
  const missing = units.findIndex((unit) => !unit);
  if (missing >= 0) throw new Error(`Unknown ${owner} unit ${unitIds[missing]}`);
  return units as Unit[];
}

function buildingsByIds(game: Game, buildingIds: string[], owner: PlayerId) {
  const buildings = buildingIds.map((id) => game.buildings.find((building) => building.id === id && building.owner === owner));
  const missing = buildings.findIndex((building) => !building);
  if (missing >= 0) throw new Error(`Unknown ${owner} building ${buildingIds[missing]}`);
  return buildings as Building[];
}

function spendGold(game: Game, owner: PlayerId, amount: number) {
  spend(playerState(game, owner), amount);
  incrementStat(game.match.stats.goldSpent, owner, amount);
}

function spend(player: PlayerState, amount: number) {
  if (player.gold < amount) throw new Error(`Need ${amount} gold`);
  player.gold -= amount;
}

function playerState(game: Game, owner: PlayerId) {
  const player = game.players[owner];
  if (!player) throw new Error(`Unknown player ${owner}`);
  return player;
}

function incrementStat(record: Record<string, number>, owner: Owner, amount: number) {
  record[owner] = (record[owner] ?? 0) + amount;
}

function canSupply(game: Game, owner: PlayerId, unitKind: UnitKind) {
  return projectedSupplyUsed(game, owner) + UNIT_DEFS[unitKind].supplyUsed <= playerState(game, owner).supplyCap;
}

function isMercenaryUnitKind(kind: Unit["kind"]) {
  return (MERCENARY_UNIT_KINDS as readonly string[]).includes(kind);
}

function combatUnits(game: Game, owner: PlayerId) {
  return game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker");
}

function completeBuildings(game: Game, owner: PlayerId, kind: Building["kind"]) {
  return game.buildings.filter((building) => building.owner === owner && building.kind === kind && building.complete);
}

function nearestCompleteTownHall(game: Game, owner: Unit["owner"], x: number, y: number) {
  if (!isPlayerId(owner)) return undefined;
  return (game.miningFrame?.townHalls.get(owner) ?? completeBuildings(game, owner, "townHall")).filter(building => sameGround(game.map, { x, y }, building)).reduce<Building | undefined>((best, building) => {
    if (!best) return building;
    return distance({ x, y }, building) < distance({ x, y }, best) ? building : best;
  }, undefined);
}

// The first enemy in range in the spatial index's order (not the nearest, despite the name).
function nearestEnemyInRange(game: Game, unit: Unit, range: number) {
  const limit = range * range;
  return firstNearbyUnit(game, unit, range, (candidate) => areEnemyOwners(game, unit.owner, candidate.owner) && distanceSquared(unit, candidate) <= limit);
}

function nearestEnemyUnit(game: Game, owner: PlayerId, x: number, y: number, range: number) {
  const point = { x, y };
  const limit = range * range;
  let best: Unit | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  forEachNearbyEnemyUnit(game, owner, point, range, (unit) => {
    if (isInCabin(unit)) return;
    const candidateDistance = distanceSquared(unit, point);
    if (candidateDistance > limit) return;
    const score = targetPriorityScore(game, owner, unit, candidateDistance);
    if (score <= bestScore) return;
    best = unit;
    bestScore = score;
  });
  return best;
}

// The best enemy for a unit to strike within the range: none for a unit without a weapon, and only what it can reach
// (see @@@reach).
function nearestEnemyTarget(game: Game, unit: Unit, range: number): Unit | Building | undefined {
  if (unit.attackDamage <= 0) return undefined;
  return nearestEnemyTargetFromPoint(game, unit.owner, unit, range, unit);
}

// @@@building-reach - Buildings and ships are reached at their edges, other units at their centers: a footman's 48 reaches a
// town hall's wall, 48 from a center 66 away. While units could walk into a building they struck it from inside.
function targetGap(from: { x: number; y: number }, target: Unit | Building | Obstacle) {
  return strikeGap(from,target);
}

function nearestEnemyTargetFromPoint(game: Game, owner: Owner, point: { x: number; y: number }, range: number, attacker?: Unit, accepts?: (target:Unit|Building)=>boolean): Unit | Building | undefined {
  const limit = range * range;
  let best: Unit | Building | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  forEachNearbyEnemyUnit(game, owner, point, range + (game.shipReachPadding ?? shipReachPadding(game.units)), (candidate) => {
    if (isInCabin(candidate)) return;
    if(!automaticTargetAllowed(game.units,owner,candidate))return;
    if (shipProfile(candidate) && shipPassengers(game.units, candidate).some(unit => unit.hp > 0 && !isInCabin(unit) && (!attacker || canReach(game.map, attacker, unit, game.units)))) return;
    if(accepts && !accepts(candidate))return;
    const candidateDistance = isShipKind(candidate.kind) ? distanceToHull(candidate, point) ** 2 : distanceSquared(point, candidate);
    if (candidateDistance > limit) return;
    if (attacker && !automaticCandidateReachable(game, attacker, candidate)) return;
    const score = targetPriorityScore(game, owner, candidate, candidateDistance, attacker);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  forEachNearbyEnemyBuilding(game, owner, point, range + MAX_BUILDING_RADIUS, (building) => {
    if(accepts && !accepts(building))return;
    const gap = targetGap(point, building);
    if (gap > range) return;
    if (attacker && !automaticCandidateReachable(game, attacker, building)) return;
    const score = targetPriorityScore(game, owner, building, gap * gap, attacker);
    if (score > bestScore) {
      best = building;
      bestScore = score;
    }
  });
  return best;
}

function shipReachPadding(units: readonly Unit[]) {
  let padding = 0;
  for (const unit of shipsIn(units)) {
    const profile = shipProfile(unit);
    if (profile) padding = Math.max(padding, ...profile.hull.map(p => Math.hypot(p.x, p.y)));
  }
  return padding;
}

function automaticCandidateReachable(game: Game, unit: Unit, candidate: Unit | Building): boolean {
  if (!canReach(game.map, unit, candidate, game.units)) return false;
  if (unit.owner !== "neutral") return true;
  const origin = neutralResponseOrigin(unit);
  return !origin || distance(candidate, origin) <= NEUTRAL_DAMAGE_RESPONSE_RANGE;
}

function targetPriorityScore(game: Game, owner: Owner, target: Unit | Building, distanceSq: number, attacker?: Unit) {
  const victimId = combatVictimId(target);
  const victim = victimId ? findTarget(game, victimId) : undefined;
  const threat: TargetThreat = victim && !areEnemyOwners(game, owner, victim.owner) ? victim === attacker ? "self" : "ally" : "none";
  return combatTargetScore(target, Math.sqrt(distanceSq), threat, projectedHpAfterPendingProjectiles(game, owner, target));
}

function projectedHpAfterPendingProjectiles(game: Game, attackerOwner: Owner, target: Unit | Building | Obstacle) {
  let pendingDamage = 0;
  // Physical bolts and shells can miss or hit intervening crew. Only tracking shots guarantee their target's damage.
  for (const projectile of projectilesAt(game, target.id)) if (projectile.owner === attackerOwner && !projectile.weapon) pendingDamage += projectile.damage;
  return target.hp - pendingDamage;
}

// @@@projectiles-by-target - The shots in flight at a target, in the order game.projectiles holds them. Target choice asks
// for every candidate of every unit, and filtering all projectiles each time made a big fight's step grow with units x
// shots in the air. The engine only ever replaces the array (the shots that landed, a restore) or pushes a new shot onto
// it, so an index kept for one array stays right by taking in the shots pushed since; a replaced array gets its own. The
// sums above add the same shots in the same order as a filter would.
const projectilesByTarget = new WeakMap<Projectile[], { indexed: number; byTarget: Map<string, Projectile[]> }>();
const NO_PROJECTILES: Projectile[] = [];

function projectilesAt(game: Game, targetId: string): Projectile[] {
  const projectiles = game.projectiles;
  let index = projectilesByTarget.get(projectiles);
  if (!index || index.indexed > projectiles.length) projectilesByTarget.set(projectiles, (index = { indexed: 0, byTarget: new Map() }));
  for (; index.indexed < projectiles.length; index.indexed += 1) {
    const projectile = projectiles[index.indexed]!;
    const atTarget = index.byTarget.get(projectile.targetId);
    if (atTarget) atTarget.push(projectile);
    else index.byTarget.set(projectile.targetId, [projectile]);
  }
  return index.byTarget.get(targetId) ?? NO_PROJECTILES;
}


function findTarget(game: Game, targetId: string): Unit | Building | undefined {
  const target = game.entityById?.get(targetId) ?? game.units.find((unit) => unit.id === targetId) ?? game.buildings.find((building) => building.id === targetId);
  return target && isUnit(target) && isInCabin(target) ? undefined : target;
}

// What an attack order or a shot may strike: a unit, a building, or rocks or a gate (see @@@obstacle), which nothing else
// looks for.
function findStrikeTarget(game: Game, targetId: string): Unit | Building | Obstacle | undefined {
  return findTarget(game, targetId) ?? game.obstacles?.find((obstacle) => obstacle.id === targetId);
}

function removeExpiredUnits(game: Game) {
  if (!game.units.some(unit => unit.expiresTick !== undefined && unit.expiresTick <= game.tick)) return;
  const expiredUnits = game.units.filter((unit) => unit.expiresTick !== undefined && unit.expiresTick <= game.tick);
  dropItemsFromDeadUnits(game, expiredUnits);
  const expiredIds = new Set(expiredUnits.map((unit) => unit.id));
  game.units = game.units.filter((unit) => !expiredIds.has(unit.id));
  updateSupplyState(game);
}

function removeDead(game: Game) {
  // Empty cleanup frames still check every body. Avoid constructing death
  // lists and wreck sets until a unit or building actually needs removal.
  if (!game.units.some(unit => unit.hp <= 0) && !game.buildings.some(building => building.hp <= 0)) {
    if (game.obstacles?.some(obstacle => obstacle.hp <= 0)) game.obstacles = game.obstacles.filter(obstacle => obstacle.hp > 0);
    return;
  }
  const deadUnits = game.units.filter((unit) => unit.hp <= 0);
  const wrecks=new Set(deadUnits.filter(unit=>shipProfile(unit)).map(unit=>unit.id));
  if(wrecks.size)for(const passenger of game.units)if(passenger.deck && wrecks.has(passenger.deck.shipId) && passenger.hp>0){passenger.hp=0;deadUnits.push(passenger);}
  const deadBuildings = game.buildings.filter((building) => building.hp <= 0);
  for (const unit of deadUnits) incrementStat(game.match.stats.unitsLost, unit.owner, 1);
  dropItemsFromDeadUnits(game, deadUnits);
  // Only actual field deaths create remains. Boarding, scripted exits and
  // summon expiry do not; passengers stay aboard the wreck. IDs do not consume
  // the live-entity counter, and remains never join targeting or pathing indexes.
  for (const unit of deadUnits) if (!(unit.deck && wrecks.has(unit.deck.shipId))) {
    (game.corpses ??= []).push({ id: `corpse-${unit.id}-${game.tick}`, unitId: unit.id,
      kind: unit.kind, owner: unit.owner, x: unit.x, y: unit.y, radius: unit.radius,
      diedAtTick: game.tick, ...(unit.variant ? { variant: unit.variant } : {}) });
  }
  if(deadUnits.length)game.units = game.units.filter((unit) => unit.hp > 0);
  if(deadBuildings.length)game.buildings = game.buildings.filter((building) => building.hp > 0);
  // A rock pile or gate broken is gone, and its way open (see @@@obstacle).
  if (game.obstacles?.some((obstacle) => obstacle.hp <= 0)) game.obstacles = game.obstacles.filter((obstacle) => obstacle.hp > 0);
  if (deadUnits.length > 0 || deadBuildings.length > 0) updateSupplyState(game);
}

function dropItemsFromDeadUnits(game: Game, deadUnits: Unit[]) {
  if (deadUnits.length === 0) return;
  invalidateItemIndex(game.items);
  const deadById = new Map(deadUnits.map((unit) => [unit.id, unit]));
  for (const item of game.items) {
    if (!item.carrierId && !item.shipId) continue;
    const dead = deadById.get(item.carrierId ?? item.shipId!);
    if (!dead) continue;
    delete item.carrierId;delete item.slot;delete item.shipId;delete item.holdSlot;delete item.mountId;delete item.aim;
    item.x = dead.x;
    item.y = dead.y;
  }
}

function updateVictory(game: Game) {
  if (game.match.winner || game.scriptedVictory) return;
  const buildingTeams = new Set<string>();
  const buildingOwnersByTeam = new Map<string, PlayerId>();
  for (const building of game.buildings) {
    const team = teamKey(game, building.owner);
    buildingTeams.add(team);
    if (!buildingOwnersByTeam.has(team)) buildingOwnersByTeam.set(team, building.owner);
  }
  const contendingTeams = new Set([...new Set(game.activePlayers.map((owner) => teamKey(game, owner)))].filter((team) => buildingTeams.has(team)));
  if (contendingTeams.size > 1) return;
  if (contendingTeams.size === 0) {
    game.match.endedAtTick = game.tick;
    return;
  }
  const winnerTeam = [...contendingTeams][0]!;
  game.match.winner = buildingOwnersByTeam.get(winnerTeam) ?? null;
  game.match.endedAtTick = game.tick;
}

// @@@story-hooks - What a campaign script may do to its game besides giving orders (see story/world): bring on a unit of
// its own, re-derive a unit whose variant it rewrote (a hero that levelled or took up a relic), strike with a power of its
// own, paint an effect, and take a unit off the stage. A standard match never calls them.

export function spawnVariantUnit(game: Game, owner: Owner, variant: string, x: number, y: number, id?: string): Unit {
  const rules = game.variants?.[variant];
  if (!rules) throw new Error(`Unknown unit variant ${variant}`);
  const unitId = id ?? `unit-${owner}-${variant}-${game.nextId}`;
  if (id === undefined) game.nextId += 1;
  else if (game.units.some((unit) => unit.id === id) || game.buildings.some((building) => building.id === id)) throw new Error(`Duplicate unit id ${id}`);
  const unit = createUnit(unitId, owner, rules.base, x, y);
  unit.variant = variant;
  unit.hp = rules.hp;
  takeVariantFrame(unit, rules);
  applyUnitUpgrades(game, unit);
  game.units.push(unit);
  updateSupplyState(game);
  return unit;
}

// After the unit's variant rules changed: its numbers again, keeping the share of health it had.
export function refreshUnitStats(game: Game, unit: Unit) {
  const rules = unitRules(game, unit);
  const share = unit.hp / Math.max(1, unit.maxHp);
  if (unit.variant !== undefined) takeVariantFrame(unit, rules);
  if (isPlayerId(unit.owner)) applyDerivedUnitStats(game, unit);
  unit.hp = Math.max(1, Math.min(unit.maxHp, Math.round(unit.maxHp * share)));
}

// A variant's body and weapon, which upgrades and stars do not touch; hit points, damage, speed and range are then
// derived as any unit's are.
function takeVariantFrame(unit: Unit, rules: UnitDef) {
  unit.maxHp = rules.hp;
  unit.hp = Math.min(unit.hp, rules.hp);
  unit.speed = rules.speed;
  unit.radius = rules.radius*(isShipKind(unit.kind)?SHIP_SIZE_MULTIPLIER:1);
  unit.bodyRadius = unit.radius;
  unit.attackDamage = rules.attackDamage;
  unit.attackRange = rules.attackRange;
  unit.attackCooldown = rules.attackCooldown;
}

// A blow from a script's power: `melee` and `ranged` land as a weapon's would (the swipe or the bolt is drawn), `spell`
// only as a hit. It counts as the source's blow for kills, experience, bounty and the victim's call for help, and armor
// and curses count as ever. The source may be a unit that has since died, or a point of the source's side.
export function strikeUnit(game: Game, source: Unit | Building | { id: string; owner: PlayerId; x: number; y: number }, target: Unit | Building, damage: number, style: "melee" | "ranged" | "spell") {
  const attacker = "hp" in source ? source : (findTarget(game, source.id) ?? scriptSource(source));
  const dealt = Math.max(1, Math.round(damage));
  if (style === "spell") {
    const taken = applyDamage(game, attacker, target, dealt, undefined, undefined, 0, DAMAGE_PROFILES.ARCANE);
    if (taken !== undefined) addHitEffect(game, target, taken);
    return;
  }
  const baseProfile = isUnit(attacker) ? unitAttackDamageProfile(game, attacker) : attackDamageProfile(attacker.kind);
  applyAttackDamage(game, attacker, target, dealt, style === "ranged" ? RANGED_ATTACK_RANGE_THRESHOLD + 1 : 0, { ...baseProfile, delivery: style });
}

// A source no longer on the field (a caster dead before its fire fell) strikes as its side, from where it stood: an
// unarmed building of that side, so no tower's armor rule and no call for help applies to it.
function scriptSource(source: { id: string; owner: PlayerId; x: number; y: number }): Building {
  const stand = projectileAttacker({ id: source.id, owner: source.owner, attackerId: source.id, targetId: source.id, fromX: source.x, fromY: source.y, toX: source.x, toY: source.y, damage: 0, remaining: 0, duration: 0 });
  return { ...stand, kind: "farm" };
}

export function addWorldEffect(game: Game, type: WorldEffect["type"], x: number, y: number, ticks: number, vectors?: Parameters<typeof addEffect>[5]) {
  addEffect(game, type, x, y, ticks, vectors);
}

// Takes the unit off the stage without a death (no kill, no loss): a scene's extras leaving, a hero stepping out.
export function removeUnit(game: Game, unitId: string) {
  const unit = game.units.find((candidate) => candidate.id === unitId);
  if (!unit) return;
  dropItemsFromDeadUnits(game, [unit]);
  game.units = game.units.filter((candidate) => candidate.id !== unitId);
  game.entityById?.delete(unitId);
  if (unit.veteranSkill) {
    game.unitSpatial = createSpatialIndex(game.units, 320);
    refreshVeteranFrame(game);
  }
  updateSupplyState(game);
}

function isPlayerId(owner: Unit["owner"]): owner is PlayerId {
  return owner !== "neutral";
}

function areEnemyOwners(game: Game, a: Owner, b: Owner) {
  if (a === b) return false;
  if (a === "neutral" || b === "neutral") return a !== "neutral" || b !== "neutral";
  return game.teams[a] !== game.teams[b];
}

function teamKey(game: Game, owner: Owner) {
  return owner === "neutral" ? "neutral" : game.teams[owner] ?? owner;
}


// @@@building-body - A building is a body no unit enters, as a forest is (see @@@terrain): its footprint's cells (see
// @@@building-footprint) are ground no land unit's center stands on, so a step or a slide (see @@@push) into them stops
// as at a wall, and units parting from each other are never pushed onto them. A foundation is as solid as a finished
// building: a site laid where units stand moves them aside (see keepUnitsOutOfBuildings). Units used to walk through
// buildings, and a melee fighter struck a town hall from inside it. That holds on a map with terrain, whose
// routing takes a unit round buildings (see @@@building-pathing); a map without terrain is open everywhere and plays as
// it did (see @@@terrain): its walks are straight lines, and a building in their way would stop them for good (a V2
// economy on verdantCrossroads never reached its expansion with its own farms in its workers' way).
const MAX_BUILDING_RADIUS = Math.max(...Object.values(BUILDING_DEFS).map((def) => def.radius));
const MAX_UNIT_RADIUS = Math.max(...Object.values(UNIT_DEFS).map((def) => def.radius));

// Whether a walk (a move or an attack-move) to `goal` is over: the unit stands within `within` of where it ends (the
// walkable point nearest the goal, or as near as its ground comes when it cannot reach it: see walkDestination), or as
// near as a building lets it come (see restsAgainstGoalBody), or against a friend already there (see @@@group-arrival).
// Measured to an unreachable point itself, the order never ended and the unit stood at the shore for good.
function walkEnded(game: Game, unit: Unit, goal: { x: number; y: number }, within: number) {
  const map = game.map;
  const travel=unit.order;
  if((travel.type==="move"||travel.type==="attackMove") && travel.deckShipId && travel.deckShipId!==unit.deck?.shipId && game.units.some(ship=>ship.id===travel.deckShipId && ship.hp>0))return false;
  if(unit.deck && (travel.type==="move"||travel.type==="attackMove") && !travel.deckShipId && isOpenGround(map,goal.x,goal.y,"land"))return false;
  if(unit.deck){const ship=game.units.find(ship=>ship.id===unit.deck!.shipId);if(!ship)return true;const order=unit.order;if((order.type==="move"||order.type==="attackMove")&&order.deckShipId && order.deckShipId!==ship.id && game.units.some(target=>target.id===order.deckShipId && target.hp>0))return false;const local=deckPlacement(ship,unit,game.units,worldToLocal(ship,deckGoal(unit,ship,goal,game.units)),false);return !local || distance(unit,localToWorld(ship,local))<within || restsAgainstArrivedFriend(game,unit,goal,localToWorld(ship,local));}
  if(shipProfile(unit)) {
    if(travel.type==="move" && travel.heading!==undefined && Math.abs(headingDifference(unit.sailing!.heading,travel.heading))>1e-6)return false;
    const route=unit.sailing?.route;
    if(map.terrain && route && route.goalX===goal.x && route.goalY===goal.y)return !route.partial && route.points.length===0 && distance(unit,route.end)<within;
    const end=nearestShipPose(map,unit,goal);
    return !end || distance(unit,end)<within;
  }
  if (!map.terrain) return distance(unit, goal) < within || restsAgainstArrivedFriend(game, unit, goal, goal);
  const mover = unitMover(unit.kind);
  const point = isWalkable(map, goal.x, goal.y, mover) ? goal : walkableGoal(map, goal.x, goal.y, mover);
  const end = walkDestination(map, unit, point, mover);
  return distance(unit, end) < within || restsAgainstGoalBody(game, unit, point, within) || restsAgainstArrivedFriend(game, unit, goal, end);
}

function arrive(unit: Unit, goal: { x: number; y: number }) {
  unit.order = { type: "idle" };
  unit.arrivedAt = { x: goal.x, y: goal.y };
}

// A walk whose goal lies within a building's reach, or `within` of it, ends where the unit stands pressed against that
// building: it can come no nearer. A goal just past the reach (a rally point beside a sanctum) kept four lancers pressed
// at 15 from it for good.
function restsAgainstGoalBody(game: Game, unit: Unit, goal: { x: number; y: number }, within: number) {
  // Only a unit within a building's reach of its goal can be pressed against one that covers it.
  if (distance(unit, goal) > 2 * (MAX_BUILDING_RADIUS + MAX_UNIT_RADIUS) + within + 2) return false;
  let resting = false;
  forEachNearbyBuilding(game, goal, MAX_BUILDING_RADIUS + unit.radius + within, (building) => {
    const reach = building.radius + unit.radius;
    if (!resting && distance(goal, building) < reach + within && distance(unit, building) <= reach + 2) resting = true;
  });
  return resting;
}

// @@@group-arrival - A group sent to one point gathers round it, as in StarCraft II: a unit's walk ends where it stands
// against a friend that has already ended its walk to the same point (and is still standing there), within CROWD_REACH
// of it. Only one unit can stand on the point; the rest pressed round the first to come for good, holding their orders
// (seven lancers on the shore across from an island). Any other friend standing about is no reason to stop: a band
// walking through its own camp stopped at the first idle soldier there and never reached the enemy.
const CROWD_REACH = 100;

// `goal` is the order's point (whose walk a friend shares), `end` where that walk ends for this unit (see walkEnded): a
// group sent to an island stands round the shore across from it, never within two bodies of the island's point.
function restsAgainstArrivedFriend(game: Game, unit: Unit, goal: { x: number; y: number }, end: { x: number; y: number }) {
  const gap = distance(unit, end);
  if (gap > CROWD_REACH) return false;
  const friend = firstNearbyUnit(game, unit, unit.radius + MAX_UNIT_RADIUS + 2, (other) => {
    if (other === unit || other.owner !== unit.owner || distance(other, unit) > other.radius + unit.radius + 2) return false;
    const there = other.order.type === "idle" && other.arrivedAt?.x === goal.x && other.arrivedAt.y === goal.y;
    // Round the point itself (within two bodies of it) a friend still walking there counts too: three archers pressing
    // round a point, none of them within reach of it, circled it for good with nobody there yet to stop against.
    const huddled = gap <= 2 * (unit.radius + other.radius) && (other.order.type === "move" || other.order.type === "attackMove") && other.order.x === goal.x && other.order.y === goal.y;
    return there || huddled;
  });
  return friend !== undefined;
}

// A land unit a footprint has come down on (a site laid where it stood, a unit set down by a building) steps out to the
// center of the open cell nearest it (see isOpenGround); one on ground nothing walks (only a seeded scenario puts it
// there) walks out (see @@@terrain-walk).
function keepUnitsOutOfBuildings(game: Game) {
  const map = game.map;
  for (const unit of game.units) {
    if(unit.deck)continue;
    if (unitMover(unit.kind) !== "land" || isOpenGround(map, unit.x, unit.y) || !isWalkable(map, unit.x, unit.y)) continue;
    const out = openGroundNear(map, unit);
    if (!out) continue;
    unit.x = out.x;
    unit.y = out.y;
  }
}

function slideUnits(game: Game) {
  for (const unit of game.units) if (!isInCabin(unit) && unit.pushX !== undefined) {
    if(!unit.deck){
      const from={x:unit.x,y:unit.y};slide(unit,game.map,game.units);
      const at=constrainGroundShipStep(game.map,unit,from,unit,game.units);
      if(at.x!==unit.x || at.y!==unit.y){unit.x=at.x;unit.y=at.y;unit.pushX=undefined;unit.pushY=undefined;}
      continue;
    }
    const point={x:unit.x+perTick(unit.pushX),y:unit.y+perTick(unit.pushY??0)};
    const at=deckSeparationPoint(game,unit,point);
    Object.assign(unit,{x:at.x,y:at.y});
    const speed=Math.hypot(unit.pushX,unit.pushY??0),next=Math.max(0,speed-perTick(PUSH_FRICTION));
    if(next===0 || at===unit){unit.pushX=undefined;unit.pushY=undefined;}else{unit.pushX*=next/speed;unit.pushY=(unit.pushY??0)*next/speed;}
  }
}

function separateUnits(game: Game) {
  const cellSize = 80;
  const buckets = new Map<number, { x: number; y: number; units: Unit[] }>();
  // Hull contact is constrained by advanceShip's swept collision check.
  // Land separation must never relocate a ship sideways after navigation.
  for (const unit of game.units) {
    // Mining workers already pass through every body; exclude them once rather than testing every nearby pair.
    if (isInCabin(unit) || isShipKind(unit.kind) || minerGhost(unit)) continue;
    const x = Math.floor(unit.x / cellSize);
    const y = Math.floor(unit.y / cellSize);
    const key = numericBucketKey(x, y);
    const bucket = buckets.get(key);
    if (bucket) bucket.units.push(unit);
    else buckets.set(key, { x, y, units: [unit] });
  }

  for (const bucket of buckets.values()) {
    separateUnitBuckets(game, bucket.units, bucket.units);
    for (const [ox, oy] of SEPARATION_NEIGHBORS) {
      const neighbor = buckets.get(numericBucketKey(bucket.x + ox, bucket.y + oy));
      if (neighbor) separateUnitBuckets(game, bucket.units, neighbor.units);
    }
  }
}

const SEPARATION_NEIGHBORS = [
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

function separateUnitBuckets(game: Game, aUnits: Unit[], bUnits: Unit[]) {
  const sameBucket = aUnits === bUnits;
  for (let i = 0; i < aUnits.length; i += 1) {
    const start = sameBucket ? i + 1 : 0;
    for (let j = start; j < bUnits.length; j += 1) {
      separateUnitPair(game, aUnits[i]!, bUnits[j]!);
    }
  }
}

// @@@miner-ghost - A worker on a mining run passes through other units, as in Warcraft III and StarCraft:
// with a tower or a farm by the lane, ten workers going to and fro jammed in
// the gap and stood there for minutes. It still walks round buildings.
function minerGhost(unit: Unit) {
  return unit.kind === "worker" && unit.order.type === "mine";
}

// Hulls are constrained by swept motion. Ground separation cannot push a body
// underneath a reachable hull; passengers use the deck's local floor instead.
function separateUnitPair(game: Game, a: Unit, b: Unit) {
  const minDistance = a.radius + b.radius;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq >= minDistance * minDistance) return;
  if(a.deck || b.deck){if(!a.deck || !b.deck || a.deck.shipId!==b.deck.shipId)return;}
  if (unitMover(a.kind) !== unitMover(b.kind)) return;
  const length = Math.hypot(dx, dy);
  const nx = length === 0 ? 1 : dx / length;
  const ny = length === 0 ? 0 : dy / length;
  if (a.pushX !== undefined || b.pushX !== undefined) pushContact(a, b, nx, ny);
  const push = (minDistance - length) / 2;
  const ax = clamp(a.x - nx * push, 0, game.map.width);
  const ay = clamp(a.y - ny * push, 0, game.map.height);
  const bx = clamp(b.x + nx * push, 0, game.map.width);
  const by = clamp(b.y + ny * push, 0, game.map.height);
  // Neither is pushed onto ground it cannot stand on (see @@@terrain): one by a wall slides along it (see openStep).
  const aAt = a.deck ? deckSeparationPoint(game,a,{x:ax,y:ay}) : constrainGroundShipStep(game.map,a,a,openStep(game.map, a, { x: ax, y: ay }, unitMover(a.kind)),game.units);
  const bAt = b.deck ? deckSeparationPoint(game,b,{x:bx,y:by}) : constrainGroundShipStep(game.map,b,b,openStep(game.map, b, { x: bx, y: by }, unitMover(b.kind)),game.units);
  a.x = aAt.x;
  a.y = aAt.y;
  b.x = bAt.x;
  b.y = bAt.y;
}

function deckSeparationPoint(game:Game,unit:Unit,point:{x:number;y:number}) {
  const ship=game.units.find(ship=>ship.id===unit.deck!.shipId);
  if(!ship)return unit;
  const local=worldToLocal(ship,point);
  if(!deckPointFits(ship,unit,local,game.units,false))return unit;
  Object.assign(unit.deck!,local);return point;
}

function numericBucketKey(x: number, y: number) {
  return x * 1000 + y;
}

function spatialBucketKey(entity: SpatialEntity, cellSize: number) {
  return numericBucketKey(Math.floor(entity.x / cellSize), Math.floor(entity.y / cellSize));
}

function createSpatialIndex<T extends SpatialEntity>(entities: T[], cellSize: number): SpatialIndex<T> {
  const buckets = new Map<number, T[]>();
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const entity of entities) {
    const x = Math.floor(entity.x / cellSize), y = Math.floor(entity.y / cellSize);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    const key = numericBucketKey(x, y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entity);
    else buckets.set(key, [entity]);
  }
  return { team: undefined, cellSize, buckets, left, right, top, bottom };
}

function createTeamSpatialIndexes<T extends SpatialEntity & { owner: Owner }>(game: Game, entities: T[], cellSize: number) {
  const indexes = new Map<string, SpatialIndex<T>>();
  for (const entity of entities) {
    const team = teamKey(game, entity.owner);
    let index = indexes.get(team);
    if (!index) indexes.set(team, index = { team, cellSize, buckets: new Map(), left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    const x = Math.floor(entity.x / cellSize), y = Math.floor(entity.y / cellSize);
    index.left = Math.min(index.left, x); index.right = Math.max(index.right, x);
    index.top = Math.min(index.top, y); index.bottom = Math.max(index.bottom, y);
    const key = numericBucketKey(x, y), bucket = index.buckets.get(key);
    if (bucket) bucket.push(entity);
    else index.buckets.set(key, [entity]);
  }
  return indexes;
}

const entityIndexes = new WeakMap<Unit[], { units: number; buildings: Building[]; buildingCount: number; index: Map<string, Unit | Building> }>();
function createEntityIndex(game: Game) {
  const cached = entityIndexes.get(game.units);
  if (cached && cached.units === game.units.length && cached.buildings === game.buildings && cached.buildingCount === game.buildings.length) return cached.index;
  const index = new Map<string, Unit | Building>();
  for (const unit of game.units) index.set(unit.id, unit);
  for (const building of game.buildings) index.set(building.id, building);
  entityIndexes.set(game.units, { units: game.units.length, buildings: game.buildings, buildingCount: game.buildings.length, index });
  return index;
}

function forEachNearbyUnit(game: Game, point: { x: number; y: number }, range: number, visit: (unit: Unit) => void) {
  forEachNearbyEntity(game.unitSpatial, game.units, point, range, unit => { if (!isInCabin(unit)) visit(unit); });
}

// The first unit near the point that passes the test, visiting in forEachNearbyUnit's order and stopping there.
function firstNearbyUnit(game: Game, point: { x: number; y: number }, range: number, test: (unit: Unit) => boolean): Unit | undefined {
  const index = game.unitSpatial;
  if (!index) return game.units.find(unit => !isInCabin(unit) && test(unit));
  const radius = Math.ceil(range / index.cellSize);
  const bx = Math.floor(point.x / index.cellSize);
  const by = Math.floor(point.y / index.cellSize);
  for (let ox = -radius; ox <= radius; ox += 1) {
    for (let oy = -radius; oy <= radius; oy += 1) {
      const bucket = index.buckets.get(numericBucketKey(bx + ox, by + oy));
      if (!bucket) continue;
      for (const unit of bucket) if (!isInCabin(unit) && test(unit)) return unit;
    }
  }
  return undefined;
}

function forEachNearbyBuilding(game: Game, point: { x: number; y: number }, range: number, visit: (building: Building) => void) {
  forEachNearbyEntity(game.buildingSpatial, game.buildings, point, range, visit);
}

function forEachNearbyEnemyUnit(game: Game, owner: Owner, point: { x: number; y: number }, range: number, visit: (unit: Unit) => void) {
  const indexes = game.unitSpatialByTeam;
  if (!indexes) {
    forEachNearbyUnit(game, point, range, (unit) => {
      if (areEnemyOwners(game, owner, unit.owner)) visit(unit);
    });
    return;
  }
  const ownTeam = teamKey(game, owner);
  for (const index of indexes.values()) if (index.team !== ownTeam) forEachNearbyEntity(index, game.units, point, range, visit);
}

function forEachNearbyEnemyBuilding(game: Game, owner: Owner, point: { x: number; y: number }, range: number, visit: (building: Building) => void) {
  const indexes = game.buildingSpatialByTeam;
  if (!indexes) {
    forEachNearbyBuilding(game, point, range, (building) => {
      if (areEnemyOwners(game, owner, building.owner)) visit(building);
    });
    return;
  }
  const ownTeam = teamKey(game, owner);
  for (const index of indexes.values()) if (index.team !== ownTeam) forEachNearbyEntity(index, game.buildings, point, range, visit);
}

function forEachNearbyEntity<T extends SpatialEntity>(
  index: SpatialIndex<T> | undefined,
  unindexedEntities: T[],
  point: { x: number; y: number },
  range: number,
  visit: (entity: T) => void,
) {
  if (!index) {
    for (const entity of unindexedEntities) visit(entity);
    return;
  }
  // Only the squares the range reaches (the visitors drop whoever stands beyond it): a search a little wider than a square
  // (a building's, by its radius) looked at 25 squares round the point's, where 9 hold all it can find.
  const size = index.cellSize;
  // Skip empty space outside this index's occupied extent. The order of every
  // occupied bucket stays unchanged, including deterministic target tie breaks.
  const right = Math.min(index.right, Math.floor((point.x + range) / size));
  const bottom = Math.min(index.bottom, Math.floor((point.y + range) / size));
  const top = Math.max(index.top, Math.floor((point.y - range) / size));
  for (let x = Math.max(index.left, Math.floor((point.x - range) / size)); x <= right; x += 1) {
    for (let y = top; y <= bottom; y += 1) {
      const bucket = index.buckets.get(numericBucketKey(x, y));
      if (!bucket) continue;
      for (const entity of bucket) visit(entity);
    }
  }
}

function moveToward(unit: Unit, x: number, y: number, map: GameMap, units: readonly Unit[] = []) {
  // A rooted or stunned unit stands, a netted one walks slower (see @@@creep-status).
  const pace = statusPace(unit);
  if (pace === 0) return;
  if(shipProfile(unit)){sailToward(unit,{x,y,...(unit.order.type==="move" && unit.order.heading!==undefined?{heading:unit.order.heading}:{})},map,units,pace);return;}
  const ship=unit.deck && units.find(ship=>ship.id===unit.deck!.shipId);
  const goal=deckGoal(unit,ship || undefined,{x,y},units);
  if(walkConnectedSurfaces(unit,goal,units,map,pace))return;
  if(unit.deck){if(ship)moveOnDeck(unit,ship,goal,units,pace);return;}
  const from={x:unit.x,y:unit.y};
  if (map.terrain) {
    walkToward(unit, x, y, map, pace);
    const at=constrainGroundShipStep(map,unit,from,unit,units);
    if(at!==unit){unit.x=at.x;unit.y=at.y;}
    return;
  }
  const speed = perTick(unit.speed) * pace;
  const dx = x - unit.x;
  const dy = y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length <= speed || length === 0) {
    unit.x = clamp(x, 0, map.width);
    unit.y = clamp(y, 0, map.height);
    const at=constrainGroundShipStep(map,unit,from,unit,units);
    if(at!==unit){unit.x=at.x;unit.y=at.y;}
    return;
  }
  unit.x = clamp(unit.x + (dx / length) * speed, 0, map.width);
  unit.y = clamp(unit.y + (dy / length) * speed, 0, map.height);
  const at=constrainGroundShipStep(map,unit,from,unit,units);
  if(at!==unit){unit.x=at.x;unit.y=at.y;}
}

// @@@terrain-walk - On a map with terrain a unit walks round what blocks it: it heads for the goal when it sees it, else
// for the farthest cell it sees on the way (see terrain steerPoint), and a goal in a forest or on rock is its nearest
// walkable cell. A step that would end on blocked ground slides along it on one axis, or waits; a unit that stands on
// blocked ground (only a seeded scenario puts one there) walks out. A ship sails the same way over the water (see @@@naval).
function walkToward(unit: Unit, x: number, y: number, map: GameMap, pace = 1) {
  const mover = unitMover(unit.kind);
  const goal = x >= 0 && y >= 0 && x <= map.width && y <= map.height && isWalkable(map, x, y, mover) ? { x, y } : walkableGoal(map, x, y, mover);
  const aim = steerPoint(map, unit, goal, mover);
  const dx = aim.x - unit.x;
  const dy = aim.y - unit.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return;
  // A shallow or a bog slows a land unit to its ground's pace (see groundUnder).
  const speed = perTick(unit.speed) * pace * groundUnder(map, unit.x, unit.y, mover).pace;
  const nextX = clamp(length <= speed ? aim.x : unit.x + (dx / length) * speed, 0, map.width);
  const nextY = clamp(length <= speed ? aim.y : unit.y + (dy / length) * speed, 0, map.height);
  const step = openStep(map, unit, { x: nextX, y: nextY }, mover);
  unit.x = step.x;
  unit.y = step.y;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
