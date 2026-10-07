import { cancelCrewRendezvous, prepareCrewRendezvous } from './crew-rendezvous';
import { GOLD_MINE_RULES, prepareMiningFrame, type MiningFrame } from "./mining";
import { canReceiveHealing } from './healing';
import { innateMissile, type AttackKind } from "./attack-presentation";
import { invalidateItemIndex } from "./item-index";
import { settleGroundItems } from './item-surfaces';
import { strikePoint, strikeGap, bodyGap } from "./combat-geometry";
import { purchasePlacement, type PurchasePlacement } from "./purchase";
import { SHIP_WEAPONS, damageShipParts, initializeShipEquipment, installedWeapons, isShipEquipment, mountedWeaponPose, rebuildShipFittings, repairShipParts, shipNeedsRepair, shipPartMax, shipGunCanAim, shipMounts, bestFiringHeading } from "./ship-equipment";
import { ITEM_DEFS, canEquip, dropRefusal, equipmentProtection, freeItemSlot, itemEquipped, normalizeEquipment, removeFromHands, transferRefusal, weaponRules, wieldRefusal, itemHands, unitItemMass, shipItemMass, itemsFor } from "./equipment";
import { BREACH_CHARGE, FLAME_CLOAK, GUARDIAN_SCROLL, IVORY_TOWER_HP_SHARE, LIGHTNING_ROD, STORM_STAFF } from "./item-rules";
import { EXPERIENCE_BOOK_XP, VETERANCY_GAIN_PER_STAR, killXpReward, xpStarThresholds } from "./unit-value";
import { automaticTargetAllowed, combatTargetScore, combatVictimId, shouldSwitchCombatTarget, type TargetThreat } from "./combat-target";
import { boltIntersection, inWeaponCone, weaponDamage } from "./weapons";
import { aimAt, aimingProfile, invalidateMovedAim, markAimShot, RANGED_ATTACK_RANGE_THRESHOLD } from "./aiming";
export { RANGED_ATTACK_RANGE_THRESHOLD } from "./aiming";
import type { WeaponDef } from "./catalog";
import { ABILITY_DEFS, BUILDING_DEFS, DOCK_REPAIR, SUPPORT_BUILDING_HEAL, HEAVY_ARMOR_DAMAGE, HIGH_UPKEEP_SUPPLY, LOW_UPKEEP_SUPPLY, POISON_DAMAGE, POISON_TICKS, SLOW_PACE, SLOW_TICKS, SPLASH_RADIUS, SPLASH_SHARE, MAX_UPGRADE_LEVEL, MERCENARY_HIRE_RANGE, MERCENARY_UNIT_KINDS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, UPGRADE_KINDS, constructionStartHp, hasSpell, isHealingBuildingKind, maxUpgradeLevel, requiredSupplyCap, unitMover, unitRules, type UnitDef } from "./catalog";
import { abilityCooldown, tickedAbilityCooldowns, withAbilityCooldown } from "./ability-cooldowns";
import { autocastEnabled, canAutocast, withAutocast } from "./autocast";
import { buildingPlacementBlocker, terrainBlocksPlacement } from "./build-placement";
import { sameGround, footprintHalf, groundUnder, isOpenGround, isWalkable, openGroundNear, openStep, setBuildingBodies, snapToFootprint, steerPoint, walkableGoal, walkDestination } from "./terrain";
import { alongside, boardingBerth, canReach, carries, landingSpot } from "./naval";
import { detCos, detSin } from "./det-math";
import { canBoard, boardUnit, deckPlacement, deckPointFits, moveOnDeck, restoreCargoDecks, syncDecks } from "./decks";
import { bodyMass } from "./physical-body";
import { walkConnectedSurfaces, settleDeckSupport, decksTouch } from "./connected-decks";
import { deckHullDamageShare, passengerDamageMultiplier } from "./deck-combat";
import { shipsIn, isShipKind, circleInPolygon, distanceToHull, localToWorld, shipPassengers, shipProfile, shipWeaponPose, worldToLocal } from "./ship-geometry";
import { keepShipsOnWater, sailToward, turnShipToward } from "./sailing";
import { beginShipMotionFrame } from './ship-motion';
import { shipTraffic } from './ship-avoidance';
import { headingDifference, nearestShipPose } from "./ship-navigation";
import { BRACE_DAMAGE_SHARE, MAX_SLIDE_STEP, PUSH_FRICTION, SHOCK_DAMAGE_TAKEN, blowStrength, canTakeStance, isStaggered, lungeStrength, pushContact, shove, slide } from "./push";
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
import { perTick, seconds } from "./time";
import { ownUnitLookup } from "./unit-lookup";
import type { AbilityKind, Building, GameCommand, GameMap, GameSetupOptions, GameSnapshot, MapId, MatchState, Obstacle, Owner, PlayerId, PlayerNumberMap, PlayerState, PlayerStateMap, Projectile, RallyTarget, ScenarioOverride, ScenarioPlayerSeed, SettledUnitOrder, TrainableUnitKind, Unit, UnitKind, UnitOrder, UnitStatusEffect, UpgradeKind, WorldEffect, WorldItem } from "./types";

export type CreateGameOptions = GameSetupOptions;

export type Game = GameSnapshot & {
  miningFrame?: MiningFrame;
  deckDamageBatch?: Map<string, { ship: Unit; direct: number; collateral: number; source?: Unit | Building; impact?:{x:number;y:number}; blastRadius?:number }>;
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
  spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number): Unit;
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
  cellSize: number;
  buckets: Map<number, T[]>;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const MINE_RANGE = 44;
const TOWN_HALL_DROP_RANGE = 74;
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
  const layout = options.layout ?? poolMap(mapId)?.layout ?? (mapId === LADDER_MAP_ID ? { seed: "ladder" } : undefined);
  // Named two-shore maps retain their geometry when players change alliances.
  // Only the layout uses these physical sides; game diplomacy uses `teams`.
  const teamSizes = [...new Set(Object.values(teams))].map(team => activePlayers.filter(id => teams[id] === team).length);
  const layoutTeams = !options.layout && poolMap(mapId)?.layout.kind === "sides" && (teamSizes.length !== 2 || teamSizes[0] !== teamSizes[1])
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
    spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number) {
      // A unit comes out on walkable ground (see @@@terrain): beside a hall backed onto a forest, at its nearest edge; a ship
      // on the nearest water.
      const at = walkableGoal(this.map, x, y, unitMover(kind));
      const unit = createUnit(`unit-${owner}-${kind}-${this.nextId}`, owner, kind, at.x, at.y);
      if(shipProfile(unit)) {
        const traffic=shipTraffic(unit,this.units,Infinity);
        const pose=nearestShipPose(this.map,unit,at,unit,pose=>traffic(pose,pose));
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
  if("unitIds" in command && !("queued" in command && command.queued) && ["move","attackMove","stop","holdPosition","unload","follow","aim","attack"].includes(command.type)){
    const ships=new Set(unitsByIds(game,command.unitIds,owner).filter(ship=>shipProfile(ship)).map(ship=>ship.id));
    if(ships.size)cancelCrewRendezvous(game.units,ships);
  }

  if (command.type === "move") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      assignUnitOrder(unit, deckPointOrder(game, unit, { type: "move", x: command.x, y: command.y, ...(command.avoidCombat ? {avoidCombat:true} : {}) }), command.queued);
    }
    addEffect(game, command.queued ? "queuedMove" : "move", command.x, command.y, command.queued ? 38 : 24);
    return;
  }

  if (command.type === "attackMove") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      assignUnitOrder(unit, deckPointOrder(game, unit, { type: unit.attackDamage > 0 ? "attackMove" : "move", x: command.x, y: command.y }), command.queued);
    }
    addEffect(game, command.queued ? "queuedAttack" : "attack", command.x, command.y, command.queued ? 42 : 28);
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
    if (target) addEffect(game, command.queued ? "queuedAttackTarget" : "attackTarget", target.x, target.y, command.queued ? 44 : 32);
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
    addEffect(game, command.queued ? "queuedMove" : "move", target.x, target.y, command.queued ? 38 : 24);
    return;
  }

  if (command.type === "mine") {
    const resource = game.resources.find((candidate) => candidate.id === command.resourceId);
    if (!resource) throw new Error(`Unknown resource ${command.resourceId}`);
    for (const unit of unitsByIds(game, command.unitIds, owner).filter((unit) => unit.kind === "worker")) {
      assignUnitOrder(unit, { type: "mine", resourceId: command.resourceId, phase: unit.carryingGold > 0 ? "return" : "toMine", timer: 0 }, command.queued);
    }
    addEffect(game, command.queued ? "queuedMine" : "mine", resource.x, resource.y, command.queued ? 44 : 30);
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
  if (command.type === "repairShip") {
    const ship = game.units.find(candidate => candidate.id === command.targetId && candidate.owner === owner && unitMover(candidate.kind) === "sea");
    if (!ship) throw new Error(`Unknown ${owner} ship ${command.targetId}`);
    if (!shipNeedsRepair(game,ship)) throw new Error(`${ship.kind} is already fully repaired`);
    for (const worker of unitsByIds(game, command.unitIds, owner).filter(unit => unit.kind === "worker"))
      assignUnitOrder(worker, { type: "repairShip", targetId: ship.id }, command.queued);
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
    playerState(game, owner).gold += UNIT_DEFS[job!.unitKind].cost;
    game.match.stats.goldSpent[owner] = Math.max(0, (game.match.stats.goldSpent[owner] ?? 0) - UNIT_DEFS[job!.unitKind].cost);
    updateSupplyState(game);
    return;
  }

  if (command.type === "setRally") {
    setRally(game, owner, command.buildingIds, command.x, command.y, command.target);
    return;
  }

  if (command.type === "cast") {
    castAbility(game, owner, command.unitId, command.ability, command.targetId, command.x, command.y, command.queued);
    return;
  }

  if (command.type === "setAutocast") {
    if (!canAutocast(command.ability)) throw new Error(`${command.ability} cannot be autocast`);
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (!UNIT_DEFS[unit.kind].abilities.includes(command.ability)) continue;
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
      if(source && !command.queued)assignUnitOrder(source,{type:"idle"});
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
    addEffect(game, command.queued ? "queuedMove" : "move", command.x, command.y, command.queued ? 38 : 24);
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
  if(game.units.some(unit=>unit.cargo))restoreCargoDecks(game.units);
  syncDecks(game.units);
  game.tick += 1;
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
  beginShipMotionFrame(game.units);
  prepareCrewRendezvous(game.map,game.units);
  const ferry = updateUnits(game);
  updateMountedWeapons(game,starts);
  if (ferry) ferryUnits(game, ferry);
  for (const ship of shipsIn(game.units)) { const start = starts.get(ship.id); if (start && ship.sailing && start.x === ship.x && start.y === ship.y) ship.sailing.speed = 0; }
  syncDecks(game.units);
  settleDeckSupport(game.units,game.map);
  slideUnits(game);
  separateUnits(game);
  syncDecks(game.units);
  if (game.map.terrain) keepUnitsOutOfBuildings(game);
  for (const unit of game.units) if(unit.aim)invalidateMovedAim(unit, weaponRules(game, unit));
  removeExpiredUnits(game);
  removeDead(game);
  if(settleGroundItems(game.items,game.units,game.map))refreshEquipmentMass(game);
  updateShipOwnership(game);
  syncBuildingBodies(game);
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
  return {
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
    map: game.map,
    teams: { ...game.teams },
    players: Object.fromEntries(Object.entries(game.players).map(([owner, player]) => [owner, { ...player, upgrades: { ...player.upgrades } }])) as PlayerStateMap,
    units: game.units.map((unit) => {
      // Most units have no deck or gun state. Copy only the nested state present,
      // rather than allocating empty intermediate objects for every optional field.
      const copy = { ...unit, order: copyUnitOrder(unit.order), orderQueue: unit.orderQueue?.map(copyUnitOrder) ?? [] };
      if (unit.aim) copy.aim = { ...unit.aim };
      if (unit.deck) copy.deck = { ...unit.deck };
      if (unit.hands) copy.hands = { ...unit.hands };
      if (unit.shipParts) copy.shipParts = { ...unit.shipParts };
      if (unit.fittings) copy.fittings = unit.fittings.map(fitting => ({ ...fitting, accepts: [...fitting.accepts] }));
      if (unit.sailing) {
        copy.sailing = { ...unit.sailing };
        if (unit.sailing.route) copy.sailing.route = { ...unit.sailing.route, end: { ...unit.sailing.route.end }, points: unit.sailing.route.points.map(point => ({ ...point,...(point.pivot?{pivot:{...point.pivot}}:{}) })) };
      }
      if (unit.abilityCooldowns) copy.abilityCooldowns = { ...unit.abilityCooldowns };
      if (unit.autocast) copy.autocast = { ...unit.autocast };
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
    projectiles: game.projectiles.map((projectile) => ({ ...projectile })),
    effects: game.effects.map((effect) => ({ ...effect })),
    ...(game.corpses ? { corpses: game.corpses.map(corpse => ({ ...corpse })) } : {}),
    // A variant's rules are replaced whole when they change, never edited, so the snapshot may share them.
    ...(game.variants ? { variants: { ...game.variants } } : {}),
    ...(game.obstacles ? { obstacles: game.obstacles.map((obstacle) => ({ ...obstacle, along: { ...obstacle.along } })) } : {}),
  };
}

export function restoreSnapshotIntoGame(game: Game, snapshot: GameSnapshot, nextId: number): void {
  game.equipmentVersion = 1;
  game.rateUnits = "perSecond";
  game.tick = snapshot.tick;
  game.match = cloneSnapshotValue(snapshot.match);
  game.map = cloneSnapshotValue(snapshot.map);
  game.teams = snapshot.teams ? definedTeams(snapshot.teams) : { ...game.teams };
  game.players = cloneSnapshotValue(snapshot.players);
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
  restoreCargoDecks(game.units);
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
    const builders = game.units.filter((unit) => unit.order.type === "repair" && unit.order.buildingId === building.id && workGap(unit, building) <= WORK_REACH);
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
    if(unitMover(job.unitKind)==="sea"){
      const launch=createUnit('launch',building.owner,job.unitKind,building.x,building.y),traffic=shipTraffic(launch,game.units,Infinity);
      if(!nearestShipPose(game.map,launch,walkableGoal(game.map,building.x,building.y,'sea'),launch,pose=>traffic(pose,pose)))continue;
    }
    building.queue.shift();
    const angle = ((game.nextId * 47) % 360) * (Math.PI / 180);
    // A ship is launched from the shipyard's own water, the nearest to it (see @@@shore-footprint).
    const from = unitMover(job.unitKind) === "sea" ? building : { x: building.x + detCos(angle) * 80, y: building.y + detSin(angle) * 80 };
    const unit = game.spawnUnit(building.owner, job.unitKind, from.x, from.y);
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
    if (!canReceiveHealing(unit) || unit.owner !== building.owner || unit.kind === "worker" || unit.hp >= unit.maxHp || distance(unit, building) > building.attackRange) return;
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
    if (unitMover(ship.kind)!=="sea" || !shipNeedsRepair(game,ship) || !isPlayerId(ship.owner) || ship.order.type==="attack" || ship.order.type==="attackMove") continue;
    const dock=game.buildings.find(building=>building.owner===ship.owner && building.kind==="shipyard" && building.complete && distance(ship,building)<DOCK_REPAIR.range);
    if (!dock || playerState(game,ship.owner).gold<DOCK_REPAIR.goldPerSecond)continue;
    spendGold(game,ship.owner,DOCK_REPAIR.goldPerSecond);repairShipParts(game,ship,DOCK_REPAIR.hpPerSecond);
  }
}

function updateRegeneration(game: Game) {
  for (const unit of game.units) {
    const regenPerSecond = unitRegenPerSecond(game, unit);
    if (regenPerSecond <= 0 || unit.hp >= unit.maxHp) continue;
    unit.hp = Math.min(unit.maxHp, unit.hp + regenPerSecond / 20);
  }
}

// A unit's own regeneration (the cinder revenant's) plus what leadership gives its veterans.
export function unitRegenPerSecond(game: GameSnapshot, unit: Unit) {
  return canReceiveHealing(unit) ? (unitRules(game, unit).regenPerSecond ?? 0) + leadershipRegenPerSecond(game, unit) : 0;
}

export { unitRules };

export function leadershipRegenPerSecond(game: GameSnapshot, unit: Unit) {
  if (!canReceiveHealing(unit) || !isPlayerId(unit.owner) || unit.level <= 0) return 0;
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
  const proxy={...ship,x:pose.pivot.x,y:pose.pivot.y,deck:undefined,aim:item.aim};
  const {naval:_hull,...weaponBase}=unitRules(game,ship);
  const ready=aimAt(proxy,{...weaponBase,attackDamage:def.damage,attackRange:def.range,aimSpeed:def.aimSpeed,weapon:def.weapon},point,game.tick);
  if(proxy.aim)item.aim=proxy.aim;else delete item.aim;
  if(proxy.facing!==undefined)item.facing=proxy.facing;
  return ready?proxy:undefined;
}
function updateMountedWeapons(game:Game,starts:Map<string,{x:number;y:number;heading:number}>){
  const crossing=new Set(game.units.filter(unit=>unit.order.type==="board" && unit.deck).flatMap(unit=>unit.order.type==="board"?[unit.deck!.shipId,unit.order.transportId]:[]));
  for(const ship of shipsIn(game.units)){
    if(ship.hp<=0 || isStaggered(ship) || isStunned(ship) || !shipProfile(ship) || "avoidCombat" in ship.order && ship.order.avoidCombat)continue;
    const order=ship.order;
    const intrinsic=unitRules(game,ship).intrinsicAttack;
    const ordered=(order.type==="attack" || order.type==="attackMove") && order.targetId ? findStrikeTarget(game,order.targetId) : undefined;
    const explicit=order.type==='attack' && order.leashX===undefined;
    const requested=ordered && (explicit || isObstacle(ordered) || automaticTargetAllowed(game.units,ship.owner,ordered)) ? ordered : undefined;
    let facingPoint=order.type==="aim" ? order : requested ?? (["attackMove","idle","hold"].includes(order.type) ? nearestEnemyTarget(game,ship,ship.attackRange) : undefined);
    if(facingPoint && "owner" in facingPoint && !isObstacle(facingPoint))facingPoint=navalCombatTarget(game,ship,facingPoint);
    if(!crossing.has(ship.id) && facingPoint && strikeGap(ship,facingPoint)<=ship.attackRange && (["attack","attackMove","idle","hold","aim"].includes(order.type))) {
      ship.sailing!.speed=0;
      turnShipToward(ship,bestFiringHeading(game,ship,facingPoint),game.map,game.units,Math.abs(headingDifference(starts.get(ship.id)!.heading,ship.sailing!.heading)));
    }
    for(const item of installedWeapons(game,ship)){
      if((item.durability ?? 1)<=0 || item.cooldownRemaining>0 || item.mountId==="bow" && !intrinsic && ship.cooldown>0)continue;
      const def=SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS],pose=mountedWeaponPose(ship,item)!;
      let target=requested && areEnemyOwners(game,ship.owner,requested.owner) ? requested : nearestEnemyTargetFromPoint(game,ship.owner,pose.pivot,def.range,ship,candidate=>shipGunCanAim(ship,item,candidate) && (!["move","unload","follow"].includes(order.type) || candidate.attackDamage>0));
      if(target && !isObstacle(target))target=navalCombatTarget(game,ship,target);
      const aimTarget=order.type==="aim" && !target ? order : target;
      const point=aimTarget && strikePoint(pose.pivot,aimTarget);
      if(!point || !shipGunCanAim(ship,item,point) || distance(pose.pivot,point)>def.range || def.weapon.minRange && distance(pose.pivot,point)<def.weapon.minRange)continue;
      const proxy=aimMountedWeapon(game,ship,item,point,pose);
      if(!proxy || !target)continue;
      const multiplier=1+ship.level*VETERANCY_GAIN_PER_STAR;
      fireWeapon(game,ship,target,Math.round(def.damage*(nonStarUnitStats(game,ship).attackDamage/Math.max(1,weaponRules(game,ship).attackDamage))*multiplier*outgoingDamageMultiplier(game,ship)),def.weapon,def.range,{},target.id,{item,pose:mountedWeaponPose(ship,item)!});
      markAimShot(proxy);item.cooldownRemaining=def.cooldown;if(item.mountId==="bow" && !intrinsic)ship.cooldown=def.cooldown;
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
    if (item.kind === "flameCloak" && itemEquipped(game,carrier,item)) applyFlameCloak(game, carrier, item);
    if (canReceiveHealing(carrier) && item.kind === "regenRing" && itemEquipped(game,carrier,item) && carrier.hp < carrier.maxHp && !ringed?.has(carrier.id)) {
      carrier.hp = Math.min(carrier.maxHp, carrier.hp + perTick(RING_REGEN_PER_SECOND));
      (ringed ??= new Set()).add(carrier.id);
    }
    if (carrier.owner === "neutral" && itemEquipped(game,carrier,item)) activateNeutralItem(game, carrier, item);
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

function updateUnits(game: Game): Ferry | undefined {
  let ferry: Ferry | undefined;
  const vessels=shipsIn(game.units);
  const ordered=vessels.length ? [...vessels,...game.units.filter(unit=>!isShipKind(unit.kind))] : game.units.slice();
  for (const unit of ordered) {
    if(unit.aim)invalidateMovedAim(unit, weaponRules(game, unit));
    unit.cooldown = Math.max(0, unit.cooldown - 1);
    if (unit.abilityCooldowns) {
      const left = tickedAbilityCooldowns(unit.abilityCooldowns);
      if (left) unit.abilityCooldowns = left;
      else unit.abilityCooldowns = undefined;
    }
    // A charging rider rides its own slide (see @@@charge); any other unit off its feet (see @@@push) neither walks,
    // strikes nor casts, and its order waits for it.
    if (unit.order.type !== "charge") {
      if (isStaggered(unit) || isStunned(unit)) continue;
      activateQueuedOrder(unit);
      if (updateNeutralLeash(game, unit)) continue;
      if (autoRepairDeckShip(game, unit)) continue;
      autocastStep(game, unit);
    }
    if (unit.order.type === "charge") {
      updateChargeOrder(game, unit);
      continue;
    }
    if (unit.order.type === "move") {
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
    if (unit.order.type === "repairShip") {
      updateShipRepairOrder(game, unit);
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
    if (unit.order.type === "unload") {
      moveToward(unit, unit.order.x, unit.order.y, game.map, game.units);
      (ferry ??= { boarding: [], unloading: [] }).unloading.push(unit);
      continue;
    }
    if (unit.kind === "worker" && !unit.deck && updateAutoRepair(game, unit)) continue;
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
    if(ship.sailing){ship.sailing.speed=0;ship.sailing.route=undefined;}
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
  if (unit.sailing) unit.sailing.route = undefined;
}

function activateQueuedOrder(unit: Unit) {
  if (unit.order.type !== "idle") return;
  const next = unit.orderQueue?.shift();
  if (!next) return;
  unit.order = next;
  if (unit.sailing) unit.sailing.route = undefined;
}

function updateFollowOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "follow") return;
  const order = unit.order;
  const target = game.units.find((candidate) => candidate.id === order.targetId && !areEnemyOwners(game, candidate.owner, unit.owner));
  if (!target) {
    unit.order = { type: "idle" };
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
  if (!aimAt(unit, weaponRules(game, unit), strikePoint(unit,target), game.tick)) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit))), unit.attackRange);
  markAimShot(unit);
  unit.cooldown = attackCooldownOf(unit);
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
  else aimAt(unit, weaponRules(game, unit), point, game.tick);
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

  const target = nearestEnemyTarget(game, unit, unitRules(game,unit).weapon ? Math.max(AUTO_ACQUIRE_RANGE,unit.attackRange) : AUTO_ACQUIRE_RANGE);
  if (target) {
    unit.order = { ...order, targetId: target.id };
    attackMoveTowardTarget(game, unit, target);
    return;
  }
  moveToward(unit, order.x, order.y, game.map, game.units);
  if (walkEnded(game, unit, order, 8)) arrive(unit, order);
}

function attackMoveTowardTarget(game: Game, unit: Unit, target: Unit | Building) {
  target = navalCombatTarget(game, unit, target);
  const gap = targetGap(unit, target);
  const ownDeck=unit.deck && game.units.find(ship=>ship.id===unit.deck!.shipId);
  const enemyDeck=isUnit(target)&&target.deck && game.units.find(ship=>ship.id===target.deck!.shipId);
  if(ownDeck && enemyDeck && ownDeck.id!==enemyDeck.id && unitRules(game,unit).attackRange<=RANGED_ATTACK_RANGE_THRESHOLD && decksTouch(ownDeck,enemyDeck,unit) && gap>unit.radius+target.radius+3){moveToward(unit,target.x,target.y,game.map,game.units);return;}
  if (backOutOfDeadZone(game, unit, target)) return;
  if (gap > unit.attackRange) {
    moveToward(unit, target.x, target.y, game.map, game.units);
    return;
  }
  if(shipProfile(unit) && !unitRules(game,unit).intrinsicAttack)return;
  if (unit.cooldown > 0) return;
  if (!aimAt(unit, weaponRules(game, unit), strikePoint(unit,target), game.tick)) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit))), unit.attackRange);
  markAimShot(unit);
  unit.cooldown = attackCooldownOf(unit);
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
  const ownDeck=unit.deck && game.units.find(ship=>ship.id===unit.deck!.shipId);
  const enemyDeck=isUnit(target)&&target.deck && game.units.find(ship=>ship.id===target.deck!.shipId);
  if(ownDeck && enemyDeck && ownDeck.id!==enemyDeck.id && unitRules(game,unit).attackRange<=RANGED_ATTACK_RANGE_THRESHOLD && decksTouch(ownDeck,enemyDeck,unit) && gap>unit.radius+target.radius+3){moveToward(unit,target.x,target.y,game.map,game.units);return;}
  if (backOutOfDeadZone(game, unit, target)) return;
  if (gap > unit.attackRange) {
    if (isPlayerId(unit.owner) && order.leashX !== undefined && order.leashY !== undefined && distance(unit, { x: order.leashX, y: order.leashY }) > GUARD_LEASH_RANGE) {
      unit.order = { type: "move", x: order.leashX, y: order.leashY };
      return;
    }
    moveToward(unit, target.x, target.y, game.map, game.units);
    return;
  }
  if(shipProfile(unit) && !unitRules(game,unit).intrinsicAttack)return;
  if (unit.cooldown > 0) return;
  if (!aimAt(unit, weaponRules(game, unit), strikePoint(unit,target), game.tick)) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(game, unit))), unit.attackRange);
  markAimShot(unit);
  unit.cooldown = attackCooldownOf(unit);
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
    const occupied = game.miningFrame!.occupied;
    if (!unit.mineSlot) {
      const count = occupied.get(order.resourceId) ?? 0;
      if (count >= GOLD_MINE_RULES.workstations) return;
      unit.mineSlot = order.resourceId;
      occupied.set(order.resourceId, count + 1);
    }
    if ((resource!.harvestCooldownRemaining ?? 0) > 0) return;
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
    if(source.id!==transport.id && !decksTouch(source,transport,unit))return;
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
    } else if(decksTouch(source,transport,unit))moveToward(unit,goal.x,goal.y,game.map,game.units);
    return;
  }
  if (alongside(unit, transport)) return;
  const goal = transport.order.type === "idle" ? unit.order.berth?.shore ?? unit.order.berth ?? transport : transport;
  moveToward(unit, goal.x, goal.y, game.map, game.units);
}

// After every unit has moved: soldiers alongside the transport they were told to board go aboard while their supply fits
// (the rest stop), and a transport that has reached the water nearest its unloading point sets its passengers ashore (any
// that find no land near enough stay aboard) and stops (see @@@transport).
function ferryUnits(game: Game, { boarding, unloading }: Ferry) {
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
    if(ship.order.type!=="unload" || !walkEnded(game,ship,ship.order,8))continue;
    unloadCargo(game,ship);
    ship.order={type:"idle"};
  }
}

// A portrait click lands one crew member, without replacing the ship's order.
function unloadCargo(game: Game, ship: Unit, passengerId?: string) {
  if(ship.cargo)restoreCargoDecks(game.units);
  const crew=shipPassengers(game.units,ship);
  crew.forEach((passenger,index)=>{
    if(passenger.owner!==ship.owner || passengerId!==undefined && passenger.id!==passengerId)return;
    const spot=landingSpot(game.map,ship,index,crew.length,game.units,passenger);
    if(!spot)return;
    passenger.deck=undefined;
    passenger.aim=undefined;
    Object.assign(passenger,spot);
    assignUnitOrder(passenger,{type:"idle"});
    addEffect(game,"unload",spot.x,spot.y,seconds(.4),{unitId:passenger.id,sourceKind:passenger.kind});
  });
  syncDecks(game.units);
  updateSupplyState(game);
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
  if (gap > WORK_REACH) {
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
  if (workGap(unit, building) > WORK_REACH) {
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
    (candidate) => candidate.owner === unit.owner && candidate.complete && candidate.hp > 0 && candidate.hp < candidate.maxHp && workGap(unit, candidate) <= WORK_REACH,
  );
  if (!building) return false;
  return repairBuildingTick(game, unit, building);
}

function updateShipRepairOrder(game: Game, worker: Unit) {
  if (worker.order.type !== "repairShip" || !isPlayerId(worker.owner)) return;
  const targetId = worker.order.targetId;
  const ship = game.units.find(unit => unit.id === targetId && unit.owner === worker.owner && unitMover(unit.kind) === "sea");
  if (!ship || ship.hp <= 0 || !shipNeedsRepair(game,ship)) { worker.order = { type: "idle" }; return; }
  if (worker.deck?.shipId !== ship.id && (worker.deck || distance(worker, ship) > worker.radius + ship.radius + WORK_REACH)) {
    moveToward(worker, ship.x, ship.y, game.map, game.units);
    return;
  }
  repairShipTick(game, worker, ship);
}

function autoRepairDeckShip(game: Game, worker: Unit) {
  if (worker.kind !== "worker" || !worker.deck || !isPlayerId(worker.owner) || worker.orderQueue?.length || !["idle", "hold"].includes(worker.order.type)) return false;
  const ship=game.units.find(unit=>unit.id===worker.deck!.shipId && unit.owner===worker.owner && unit.hp>0);
  if (!ship || !shipNeedsRepair(game,ship) || playerState(game,worker.owner).gold<1) return false;
  repairShipTick(game,worker,ship);
  return true;
}

function repairShipTick(game: Game, worker: Unit, ship: Unit) {
  if (!isPlayerId(worker.owner)) return;
  if (worker.cooldown > 0) return;
  const player = playerState(game, worker.owner);
  if (player.gold < 1) return;
  emitWorkerWork(game, worker, ship);
  const fullCost = Math.max(1, Math.round(UNIT_DEFS[ship.kind].cost * REPAIR_FULL_COST_FRACTION));
  const healed = Math.max(1, ship.maxHp / fullCost);
  spendGold(game, worker.owner, 1);
  repairShipParts(game,ship,healed);
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
  addEffect(game, queued ? "queuedRepair" : "repair", building.x, building.y, REPAIR_HAMMER_EFFECT_DURATION);
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
  building.queue.push({ id: `training-${game.nextId++}`, unitKind, remaining: trainTimeFor(unitKind) });
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
  addEffect(game, "move", normalized.x, normalized.y, 24);
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
  if (target?.type === "unit" && game.units.some((candidate) => candidate.id === target.unitId && candidate.owner === unit.owner)) {
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
  addEffect(game,"itemReceived",recipient.x,recipient.y,seconds(.8));
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
  if (!caster) throw new Error(`Unknown ${owner} caster ${unitId}`);
  if (!UNIT_DEFS[caster.kind].abilities.includes(ability)) throw new Error(`${caster.kind} cannot cast ${ability}`);
  if (abilityCooldown(caster, ability) > 0) throw new Error(`${caster.kind} is on cooldown`);
  const def = ABILITY_DEFS[ability];
  // Out of reach, or after the orders before it (shift), the caster walks to cast (see @@@cast-order).
  const later = (order: Extract<UnitOrder, { type: "cast" }>, at: { x: number; y: number }) => {
    assignUnitOrder(caster, order, queued);
    addEffect(game, queued ? "queuedMove" : "move", at.x, at.y, queued ? 38 : 24);
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
    if (!canReceiveHealing(target)) throw new Error("Healing cannot repair ships");
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
  if (order.targetId !== undefined && (!target || target.hp <= 0 || areEnemyOwners(game, target.owner, unit.owner) !== (def.behavior !== "heal"))) return end();
  if (def.behavior === "heal" && target && (!isUnit(target) || !canReceiveHealing(target))) return end();
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
    if (!aimAt(unit, weaponRules(game, unit), at, game.tick)) return;
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
  if (!canReceiveHealing(target) || distance(caster, target) > def.range) return;
  target.hp = Math.min(target.maxHp, target.hp + def.healAmount);
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, target.x, target.y, 36, { sourceKind: caster.kind, unitId: caster.id, owner: caster.owner });
}

function syncSummonLoad(game: Game, ship: Unit, probe: Unit) {
  return shipPassengers(game.units, ship).reduce((mass, unit) => mass + bodyMass(unit), bodyMass(probe)) > shipProfile(ship)!.loadCapacity;
}

function applySummon(game: Game, caster: Unit, ability: AbilityKind, x: number, y: number, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "summon" }>) {
  if (distance(caster, { x, y }) > def.range) return;
  const ship = game.units.find(ship => {
    const profile = shipProfile(ship);
    return profile && ship.owner === caster.owner && circleInPolygon(worldToLocal(ship, { x, y }), 0, profile.deck);
  });
  if (!ship && !isWalkable(game.map, x, y)) return;
  const probe = ship && createUnit("summon-probe", caster.owner, def.summonKind, x, y);
  const point = ship && probe && deckPlacement(ship, probe, game.units, worldToLocal(ship, { x, y }));
  if (ship && (!point || syncSummonLoad(game, ship, probe!))) return;
  const spirit = game.spawnUnit(caster.owner, def.summonKind, x, y);
  if (ship && point) { spirit.deck = { shipId: ship.id, ...point }; Object.assign(spirit, localToWorld(ship, point)); }
  spirit.expiresTick = game.tick + def.summonDuration;
  spirit.order = { type: "idle" };
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, spirit.x, spirit.y, 50, { sourceKind: caster.kind, unitId: caster.id, owner: caster.owner });
}

function applyCurse(game: Game, caster: Unit, ability: AbilityKind, target: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "curse" }>) {
  if (distance(caster, target) > def.range) return;
  const damageMultiplier = target.effects.some((effect) => effect.type === "scorch")
    ? (def.scorchedDamageMultiplier ?? def.damageMultiplier)
    : def.damageMultiplier;
  target.effects = target.effects.filter((effect) => effect.type !== def.statusType);
  target.effects.push({ type: def.statusType, remaining: def.effectDuration, ...(damageMultiplier !== 0.4 ? { damageMultiplier } : {}) });
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, target.x, target.y, 46, { sourceKind: caster.kind, unitId: caster.id, owner: caster.owner });
  if (def.summonedDamage && target.expiresTick !== undefined) applyDamage(game, caster, target, def.summonedDamage);
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
  for (const ability of UNIT_DEFS[unit.kind].abilities) {
    if (abilityCooldown(unit, ability) > 0 || !autocastEnabled(unit, ability)) continue;
    const def = ABILITY_DEFS[ability];
    if (def.behavior === "heal") {
      const target = autocastHealTarget(game, unit, def);
      if (target) return applyHeal(game, unit, ability, target, def);
    } else if (def.behavior === "curse") {
      const target = autocastCurseTarget(game, unit, def);
      if (target) return applyCurse(game, unit, ability, target, def);
    } else if (def.behavior === "summon") {
      const point = autocastSummonPoint(game, unit, def);
      if (point) return applySummon(game, unit, ability, point.x, point.y, def);
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
    if (distance(caster, candidate) <= def.range && isAutocastFoe(game, caster, candidate)) struck.push(candidate);
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
    if (distance(caster, candidate) > def.range || candidate.hp <= 0 || candidate.owner !== caster.owner || !isEngaged(candidate)) return;
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
    if (distance(caster, candidate) > def.range || !isAutocastFoe(game, caster, candidate) || candidate.effects.some((effect) => effect.type === "root")) return;
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

function isStunned(unit: Unit) {
  return unit.effects.length > 0 && unit.effects.some((effect) => effect.type === "stun");
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
function attackCooldownOf(unit: Unit) {
  if (unit.effects.length === 0 || !unit.effects.some((effect) => effect.type === "bloodlust")) return unit.attackCooldown;
  return Math.max(1, Math.round(unit.attackCooldown / (ABILITY_DEFS.bloodlust as Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "bloodlust" }>).attackSpeed));
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
    if (!canReceiveHealing(candidate) || candidate.hp <= 0 || areEnemyOwners(game, caster.owner, candidate.owner) || distance(caster, candidate) > def.range) return;
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
    if (!isAutocastFoe(game, caster, candidate) || distance(caster, candidate) > def.range) return;
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
    return target && isUnit(target) && isAutocastFoe(game, rider, target) && inChargeWindow(rider, target, def) && canReach(game.map, rider, target, game.units) ? target : undefined;
  }
  if (order.type !== "idle" && order.type !== "attackMove") return undefined;
  let charged: Set<string> | undefined;
  let free: Unit | undefined;
  let any: Unit | undefined;
  forEachNearbyUnit(game, rider, def.range, (candidate) => {
    if (!isAutocastFoe(game, rider, candidate) || !inChargeWindow(rider, candidate, def) || !canReach(game.map, rider, candidate, game.units)) return;
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
  const target = nearestEnemyInRange(game, carrier, item.kind === "stormStaff" ? 280 : 240);
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
    applyAttackDamage(game, carrier, target, BREACH_CHARGE.damage, BREACH_CHARGE.range);
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
      if (!canReceiveHealing(unit) || distance(unit, carrier) > HEALING_SCROLL_RADIUS || areEnemyOwners(game, carrier.owner, unit.owner)) return;
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
    applyAttackDamage(game, carrier, current, damage*outgoingDamageMultiplier(game,carrier), 240);
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
    applyAttackDamage(game, carrier, target, STORM_STAFF.impactDamage*outgoingDamageMultiplier(game,carrier), STORM_STAFF.range);
  });
  addEffect(game, "storm", x, y, STORM_STAFF.duration, { owner: carrier.owner, damage: STORM_STAFF.pulseDamage*outgoingDamageMultiplier(game,carrier), radius: STORM_STAFF.radius, tickEvery: STORM_STAFF.pulseEvery });
  item.cooldownRemaining = STORM_STAFF.cooldown;
}

function applyFlameCloak(game: Game, carrier: Unit, item: WorldItem) {
  if (item.cooldownRemaining > 0) return;
  let burned = false;
  forEachNearbyUnit(game, carrier, FLAME_CLOAK.radius, (target) => {
    if (distance(target, carrier) > FLAME_CLOAK.radius || !areEnemyOwners(game, carrier.owner, target.owner)) return;
    applyAttackDamage(game, carrier, target, FLAME_CLOAK.damage*outgoingDamageMultiplier(game,carrier), 70);
    addEffect(game, "flameBurn", target.x, target.y, FLAME_CLOAK_VISUAL_DURATION);
    burned = true;
  });
  if (!burned) return;
  item.cooldownRemaining = FLAME_CLOAK.interval;
}

function updateWorldEffects(game: Game) {
  for (const effect of game.effects) {
    applyWorldEffectTick(game, effect);
    effect.remaining -= 1;
  }
  game.effects = game.effects.filter((effect) => effect.remaining > 0);
}

function applyWorldEffectTick(game: Game, effect: WorldEffect) {
  if (effect.type === "burningGround" && effect.owner && effect.damage && effect.radius && effect.tickEvery) {
    if (effect.remaining % effect.tickEvery !== 0) return;
    const source = effect.unitId ? findTarget(game,effect.unitId) : undefined;
    const attacker = source ?? scriptSource({id:effect.unitId ?? effect.id,owner:effect.owner,x:effect.x,y:effect.y});
    for (const target of [...game.units,...game.buildings]) if (target.hp>0 && areEnemyOwners(game,effect.owner,target.owner) && distance(effect,target)<=effect.radius+target.radius) {
      const taken=applyDamage(game,attacker,target,effect.damage);if(taken!==undefined)addHitEffect(game,target,taken,source);
    }
    return;
  }
  if (effect.type !== "storm" || !effect.owner || !effect.damage || !effect.radius || !effect.tickEvery) return;
  if (effect.remaining !== effect.duration && effect.remaining % effect.tickEvery !== 0) return;
  forEachNearbyUnit(game, effect, effect.radius, (target) => {
    if (distance(target, effect) > effect.radius! || !areEnemyOwners(game, effect.owner!, target.owner)) return;
    applyAttackDamage(game, { owner: effect.owner!, x: effect.x, y: effect.y } as Building, target, effect.damage!, 260);
  });
}

function updateProjectiles(game: Game) {
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
  const taken = applyDamage(game, attacker, target, attackDamageAgainstTarget(game, attacker, target, projectile.damage), projectile.hullDamageShare);
  if (taken === undefined) return;
  applyAttackStatusEffects(game, attacker, target);
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
    for (const effect of unit.effects) {
      effect.remaining -= 1;
      // Poison bites once a second (see @@@creep-trait-numbers), for its biter while it lives.
      if (effect.type === "poison" && effect.remaining % 20 === 0 && unit.hp > 0) {
        const source = effect.sourceId ? findTarget(game, effect.sourceId) : undefined;
        if (source && source.hp > 0) applyDamage(game, source, unit, POISON_DAMAGE);
        else unit.hp -= POISON_DAMAGE;
      }
    }
    unit.effects = unit.effects.filter((effect) => effect.remaining > 0);
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

function fireWeapon(game:Game,attacker:Unit|Building,at:{x:number;y:number;id?:string},damage:number,weapon:WeaponDef,range:number,skill:{rootTicks?:number;burnTicks?:number}={},targetId=at.id, mounted?:{item:WorldItem;pose:NonNullable<ReturnType<typeof mountedWeaponPose>>}){
  const origin = mounted?.pose.muzzle ?? weaponOrigin(attacker);
  const target = targetId ? findStrikeTarget(game,targetId) : undefined;
  const point = target ? strikePoint(origin,target) : at;
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
    const hits=[...game.units,...game.buildings].filter(target=>target.hp>0&&areEnemyOwners(game,attacker.owner,target.owner)&&inWeaponCone(origin,point,target,range,weapon.coneAngle??.6));
    withDeckDamageBatch(game,()=>{for(const target of crewBeforeHulls(hits))hitWeapon(game,attacker,target,damage*(weapon.burst??1),weapon);});
    addEffect(game,"grapeshot",point.x,point.y,seconds(.7),{...visuals,radius:range});return;
  }
  const flight=Math.max(seconds(0.2),Math.ceil(distance(origin,point)/perTick(weapon.delivery==="shell"?240:560)));
  const projectile:Projectile={id:`projectile-${game.nextId++}`,owner:attacker.owner,attackerId:attacker.id,targetId:targetId??"",fromX:origin.x,fromY:origin.y,toX:point.x,toY:point.y,damage,remaining:flight,duration:flight,attackKind,weapon:{...weapon},...(isUnit(attacker)?{sourceKind:attacker.kind}:{}),...skill};
  game.projectiles.push(projectile);
  addEffect(game,weapon.delivery==="shell"?"shellFlight":"siegeBolt",point.x,point.y,flight,{...visuals,radius:weapon.radius??0});
}
function hitWeapon(game:Game,attacker:Unit|Building,target:Unit|Building|Obstacle,damage:number,weapon:WeaponDef,share=1,rootTicks?:number,impact=strikePoint(attacker,target)){
  const dealt=weaponDamage(weapon,damage,!isUnit(target),isUnit(target)&&unitMover(target.kind)==="sea",share);
  const armored=weapon.delivery==="ram"?dealt:heavyArmoredDamage(game,attacker,target,dealt);
  const taken=applyDamage(game,attacker,target,armored,deckHullDamageShare(game,attacker,weapon),impact,weapon.blastRadius ?? weapon.radius ?? 0);if(taken===undefined)return;
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
  const foes=[...game.units,...game.buildings,...(game.obstacles??[])].filter(t=>t.hp>0&&areEnemyOwners(game,projectile.owner,t.owner));
  if(weapon.delivery==="bolt"){
    const intersections=foes.map(target=>({target,along:boltIntersection(from,to,target,weapon.radius??12)})).filter(h=>h.along!==undefined).sort((a,b)=>a.along!-b.along!);
    const eligible=new Set(crewBeforeHulls(intersections.map(hit=>hit.target)));
    const hits=intersections.filter(hit=>eligible.has(hit.target)).slice(0,weapon.maxHits??1);
    if(weapon.blastRadius && hits[0]){
      const impact=impactAt(hits[0].along!);
      for(const target of crewBeforeHulls(foes.filter(target=>bodyGap(impact,target)<=weapon.blastRadius!))) {
        const share=Math.max(.4,1-bodyGap(impact,target)/weapon.blastRadius*.6);
        hitWeapon(game,attacker,target,projectile.damage,weapon,share,projectile.rootTicks,impact);
      }
      addEffect(game,"siegeImpact",impact.x,impact.y,seconds(.65),{radius:weapon.blastRadius,owner:projectile.owner,...(projectile.sourceKind?{sourceKind:projectile.sourceKind}:{})});
      return;
    }
    hits.forEach(({target,along},i)=>hitWeapon(game,attacker,target,projectile.damage,weapon,(weapon.pierceShare??1)**i,projectile.rootTicks,impactAt(along!)));
  }else{
    for(const target of crewBeforeHulls(foes.filter(target=>bodyGap(to,target)<=(weapon.radius??0)))){const gap=bodyGap(to,target);
      const falloff=Math.max(.35,1-gap/Math.max(1,weapon.radius??1)*.65);hitWeapon(game,attacker,target,projectile.damage,weapon,falloff,projectile.rootTicks,to);
    }
    addEffect(game,"siegeImpact",to.x,to.y,24,{radius:weapon.radius??0,owner:projectile.owner,...(projectile.sourceKind?{sourceKind:projectile.sourceKind}:{})});
    if(projectile.burnTicks)addEffect(game,"burningGround",to.x,to.y,projectile.burnTicks,{owner:projectile.owner,unitId:projectile.attackerId,damage:3,radius:weapon.radius??0,tickEvery:10,...(projectile.sourceKind?{sourceKind:projectile.sourceKind}:{})});
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
    launchProjectile(game, attacker, target, heavyArmoredDamage(game, attacker, target, buildingTargetDamage(attacker, target, damage)));
    return;
  }
  // Range upgrades extend a melee weapon; they do not turn it into a projectile or change its armor interaction.
  applyAttackDamage(game, attacker, target, damage, baseRange);
}

// Heavy armor is settled when the shot is fired, so a shot still counts as a shooter's after its shooter has died.
function heavyArmoredDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number) {
  if (!isUnit(target) || unitRules(game, target).armor !== "heavy") return damage;
  const multiplier = isUnit(attacker) ? HEAVY_ARMOR_DAMAGE.rangedUnit : attacker.kind === "defenseTower" ? HEAVY_ARMOR_DAMAGE.tower : 1;
  return Math.max(1, Math.round(damage * multiplier));
}

function launchProjectile(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number) {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const flight = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / perTick(PROJECTILE_SPEED)));
  const projectile = {
    attackKind: innateMissile(attacker.kind),
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

function applyAttackDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, attackRange: number) {
  const dealt = attackDamageAgainstTarget(game, attacker, target, buildingTargetDamage(attacker, target, damage));
  const taken = applyDamage(game, attacker, target, dealt);
  if (taken === undefined) return;
  applyAttackStatusEffects(game, attacker, target);
  if (attackRange <= RANGED_ATTACK_RANGE_THRESHOLD && isUnit(attacker) && isUnit(target)) stanceBlow(attacker, target, dealt);
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

function applyAttackStatusEffects(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle) {
  if (!isUnit(attacker)) return;
  const rules = unitRules(game, attacker);
  // A red dragon's fire (see @@@creep-traits) falls on buildings' neighbours too.
  if (rules.splash) {
    const share = Math.max(1, Math.round(attacker.attackDamage * SPLASH_SHARE));
    const burned: Unit[] = [];
    forEachNearbyUnit(game, target, SPLASH_RADIUS, (unit) => {
      if (unit !== target && unit.hp > 0 && distance(unit, target) <= SPLASH_RADIUS && areEnemyOwners(game, attacker.owner, unit.owner)) burned.push(unit);
    });
    for (const unit of burned) applyDamage(game, attacker, unit, share);
    addEffect(game, "flameBurn", target.x, target.y, 20);
  }
  if (!isUnit(target)) return;
  if (rules.slowOnHit) setStatus(target, { type: "slow", remaining: SLOW_TICKS });
  if (rules.poisonOnHit) setStatus(target, { type: "poison", remaining: POISON_TICKS, sourceId: attacker.id });
  if (attacker.kind !== "sparkArcher") return;
  target.effects = target.effects.filter((effect) => effect.type !== "scorch");
  target.effects.push({ type: "scorch", remaining: SCORCH_DURATION });
  addEffect(game, "scorch", target.x, target.y, 28);
}

// The damage the target took, or undefined when a guardian field turned the blow aside.
function applyDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, hullShare?: number,impact?:{x:number;y:number},blastRadius=0): number | undefined {
  if ('invulnerable' in target && target.invulnerable) return undefined;
  if (isObstacle(target)) {
    // A rock pile or gate wakes nobody and pays nothing when it falls (see @@@obstacle).
    const hpBefore = target.hp;
    target.hp -= damage;
    game.observer?.hit(attacker, target, damage, hpBefore);
    return damage;
  }
  if (isUnit(target) && target.effects.some((effect) => effect.type === "guardian")) return undefined;
  const impactDamage=damage;
  if(isUnit(target))damage*=1-equipmentProtection(game,target);
  const taken = isUnit(target) && target.stance === "shock" ? Math.max(1, Math.round(damage * SHOCK_DAMAGE_TAKEN)) : damage;
  const hpBefore = target.hp;
  target.hp -= taken;
  if(isUnit(target) && shipProfile(target)){damageShipParts(game,target,impact ?? strikePoint(attacker,target),taken,blastRadius);if(target.hp>0)applyDerivedUnitStats(game,target);}
  if (hpBefore > 0 && isUnit(target)) {
    if (shipProfile(target) && game.deckDamageBatch) {
      const entry = game.deckDamageBatch.get(target.id) ?? { ship: target, direct: 0, collateral: 0 };
      entry.direct += taken;
      game.deckDamageBatch.set(target.id, entry);
    }
    const hull = target.deck && game.units.find(ship => ship.id === target.deck!.shipId && ship.hp > 0);
    if (hull && areEnemyOwners(game, attacker.owner, hull.owner)) {
      const collateral = impactDamage * (hullShare ?? deckHullDamageShare(game,attacker));
      if (game.deckDamageBatch) {
        const entry = game.deckDamageBatch.get(hull.id) ?? { ship: hull, direct: 0, collateral: 0, source: attacker };
        if (collateral > entry.collateral) { entry.collateral = collateral; entry.source = attacker; }
        game.deckDamageBatch.set(hull.id,{...entry,impact:{x:target.x,y:target.y},blastRadius});
      } else applyDamage(game, attacker, hull, collateral, 0,target);
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
  for (const { ship, direct, collateral, source,impact,blastRadius } of batch.values()) {
    if (source && ship.hp > 0 && collateral > direct) applyDamage(game, source, ship, collateral - direct, 0,impact,blastRadius);
  }
}

/** Ship orders address the fighting deck and remain on the hull after its last passenger dies. */
function navalCombatTarget(game: Game, attacker: Unit | Building, target: Unit | Building): Unit | Building {
  if (!isUnit(target) || !shipProfile(target)) return target;
  const crew = shipPassengers(game.units, target).filter(unit => unit.hp > 0 && areEnemyOwners(game, attacker.owner, unit.owner)
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
  vectors?: Partial<Pick<WorldEffect, "fromX" | "fromY" | "fromHeight" | "toX" | "toY" | "toHeight" | "owner" | "damage" | "radius" | "tickEvery" | "sourceKind" | "unitId" | "itemId" | "amount" | "attackKind">>,
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
  applyDerivedUnitStats(game, unit);
}

function applyDerivedUnitStats(game: Game, unit: Unit) {
  const previousMaxHp = unit.maxHp;
  const base = nonStarUnitStats(game, unit);
  const multiplier = 1 + Math.min(MAX_UPGRADE_LEVEL, Math.max(0, unit.level)) * VETERANCY_GAIN_PER_STAR;
  const heavy=itemsFor(game,unit).some(item=>ITEM_DEFS[item.kind].span===4);
  unit.bodyRadius=unitRules(game,unit).radius;unit.radius=unit.bodyRadius;
  unit.attackDamage = Math.round(base.attackDamage * multiplier);
  unit.maxHp = Math.round(base.maxHp * multiplier);
  unit.speed = base.speed*(heavy?.45:1);
  unit.attackRange = base.attackRange;
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

// @@@building-work - A worker builds or repairs a building from beside its walls: within WORK_REACH of its footprint's
// square (see @@@building-footprint), from the cell next to it, whatever the building's size.
const WORK_REACH = TERRAIN_CELL;

function workGap(unit: Unit, building: Building) {
  const half = footprintHalf(building.radius, TERRAIN_CELL);
  return Math.hypot(Math.max(0, Math.abs(unit.x - building.x) - half), Math.max(0, Math.abs(unit.y - building.y) - half));
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
    if(!automaticTargetAllowed(game.units,owner,candidate))return;
    if (shipProfile(candidate) && shipPassengers(game.units, candidate).some(unit => unit.hp > 0 && (!attacker || canReach(game.map, attacker, unit, game.units)))) return;
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
  return game.entityById?.get(targetId) ?? game.units.find((unit) => unit.id === targetId) ?? game.buildings.find((building) => building.id === targetId);
}

// What an attack order or a shot may strike: a unit, a building, or rocks or a gate (see @@@obstacle), which nothing else
// looks for.
function findStrikeTarget(game: Game, targetId: string): Unit | Building | Obstacle | undefined {
  return findTarget(game, targetId) ?? game.obstacles?.find((obstacle) => obstacle.id === targetId);
}

function removeExpiredUnits(game: Game) {
  const expiredUnits = game.units.filter((unit) => unit.expiresTick !== undefined && unit.expiresTick <= game.tick);
  if (expiredUnits.length === 0) return;
  dropItemsFromDeadUnits(game, expiredUnits);
  const expiredIds = new Set(expiredUnits.map((unit) => unit.id));
  game.units = game.units.filter((unit) => !expiredIds.has(unit.id));
  updateSupplyState(game);
}

function removeDead(game: Game) {
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
  unit.radius = rules.radius;
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
    const taken = applyDamage(game, attacker, target, attackDamageAgainstTarget(game, attacker, target, dealt));
    if (taken !== undefined) addHitEffect(game, target, taken);
    return;
  }
  applyAttackDamage(game, attacker, target, style === "ranged" ? heavyArmoredDamage(game, attacker, target, dealt) : dealt, style === "ranged" ? RANGED_ATTACK_RANGE_THRESHOLD + 1 : 0);
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
  for (const unit of game.units) if (unit.pushX !== undefined) {
    if(!unit.deck){slide(unit,game.map,game.units);continue;}
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
    if (isShipKind(unit.kind) || minerGhost(game, unit)) continue;
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

// @@@miner-ghost - A worker on a mining run passes through other units, as in Warcraft III and StarCraft, on a map whose
// buildings are bodies (see @@@building-body): with a tower or a farm by the lane, ten workers going to and fro jammed in
// the gap and stood there for minutes. It still walks round buildings.
function minerGhost(game: Game, unit: Unit) {
  return unit.kind === "worker" && unit.order.type === "mine" && game.map.terrain !== undefined;
}

// @@@ship-layer - A ship and a land unit do not shove each other: they move on different layers, as Warcraft III's boats
// and ground units do, and a soldier or worker wading the shallows passes under a ship's hull there. A ship by a beach
// and the workers wading its shallows jammed each other for minutes, every walk ending where it began (six of the pool's
// games at ddec752 and 7fbb5d1, on the way to an island's hall site and out of a landing).
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
  const aAt = a.deck ? deckSeparationPoint(game,a,{x:ax,y:ay}) : openStep(game.map, a, { x: ax, y: ay }, unitMover(a.kind));
  const bAt = b.deck ? deckSeparationPoint(game,b,{x:bx,y:by}) : openStep(game.map, b, { x: bx, y: by }, unitMover(b.kind));
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
  return { cellSize, buckets, left, right, top, bottom };
}

function createTeamSpatialIndexes<T extends SpatialEntity & { owner: Owner }>(game: Game, entities: T[], cellSize: number) {
  const indexes = new Map<string, SpatialIndex<T>>();
  for (const entity of entities) {
    const team = teamKey(game, entity.owner);
    let index = indexes.get(team);
    if (!index) indexes.set(team, index = { cellSize, buckets: new Map(), left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
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
  forEachNearbyEntity(game.unitSpatial, game.units, point, range, visit);
}

// The first unit near the point that passes the test, visiting in forEachNearbyUnit's order and stopping there.
function firstNearbyUnit(game: Game, point: { x: number; y: number }, range: number, test: (unit: Unit) => boolean): Unit | undefined {
  const index = game.unitSpatial;
  if (!index) return game.units.find(test);
  const radius = Math.ceil(range / index.cellSize);
  const bx = Math.floor(point.x / index.cellSize);
  const by = Math.floor(point.y / index.cellSize);
  for (let ox = -radius; ox <= radius; ox += 1) {
    for (let oy = -radius; oy <= radius; oy += 1) {
      const bucket = index.buckets.get(numericBucketKey(bx + ox, by + oy));
      if (!bucket) continue;
      for (const unit of bucket) if (test(unit)) return unit;
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
  for (const [team,index] of indexes) if (team !== ownTeam) forEachNearbyEntity(index, [], point, range, visit);
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
  for (const [team,index] of indexes) if (team !== ownTeam) forEachNearbyEntity(index, [], point, range, visit);
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
  if (map.terrain) {
    walkToward(unit, x, y, map, pace);
    return;
  }
  const speed = perTick(unit.speed) * pace;
  const dx = x - unit.x;
  const dy = y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length <= speed || length === 0) {
    unit.x = clamp(x, 0, map.width);
    unit.y = clamp(y, 0, map.height);
    return;
  }
  unit.x = clamp(unit.x + (dx / length) * speed, 0, map.width);
  unit.y = clamp(unit.y + (dy / length) * speed, 0, map.height);
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
