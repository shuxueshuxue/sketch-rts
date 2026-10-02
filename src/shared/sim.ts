import { ABILITY_DEFS, BUILDING_DEFS, HEAVY_ARMOR_DAMAGE, HIGH_UPKEEP_SUPPLY, LOW_UPKEEP_SUPPLY, POISON_DAMAGE, POISON_TICKS, SLOW_PACE, SLOW_TICKS, SPLASH_RADIUS, SPLASH_SHARE, MAX_UPGRADE_LEVEL, MERCENARY_HIRE_RANGE, MERCENARY_UNIT_KINDS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, UPGRADE_KINDS, XP_STAR_THRESHOLDS, constructionStartHp, hasSpell, isHealingBuildingKind, maxUpgradeLevel, requiredSupplyCap, unitMover, unitRules, type UnitDef } from "./catalog";
import { abilityCooldown, tickedAbilityCooldowns, withAbilityCooldown } from "./ability-cooldowns";
import { autocastEnabled, canAutocast, withAutocast } from "./autocast";
import { buildingPlacementBlocker, terrainBlocksPlacement } from "./build-placement";
import { groundUnder, isWalkable, setBuildingBodies, steerPoint, walkableGoal, walkDestination } from "./terrain";
import { alongside, canReach, carries, landingSpot } from "./naval";
import { detCos, detSin } from "./det-math";
import { BRACE_DAMAGE_SHARE, MAX_SLIDE_STEP, SHOCK_DAMAGE_TAKEN, blowStrength, canTakeStance, isStaggered, lungeStrength, pushContact, shove, slide } from "./push";
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
import { generateMap } from "./generated-map";
import { BOOTS_SPEED, HEALING_SCROLL_HEAL, HEALING_SCROLL_RADIUS, IVORY_TOWER_REACH, MAX_CARRIED_ITEMS, RING_REGEN_PER_SECOND, buyRefusal, carriedItemCount, createShop, restockShops, shopBuyer } from "./shop";
import { poolMap } from "./map-pool";
import { seconds } from "./time";
import { ownUnitLookup } from "./unit-lookup";
import type { AbilityKind, Building, GameCommand, GameMap, GameSetupOptions, GameSnapshot, MapId, MatchState, Obstacle, Owner, PlayerId, PlayerNumberMap, PlayerState, PlayerStateMap, Projectile, RallyTarget, ScenarioOverride, ScenarioPlayerSeed, SettledUnitOrder, TrainableUnitKind, Unit, UnitKind, UnitOrder, UnitStatusEffect, UpgradeKind, WorldEffect, WorldItem } from "./types";

export type CreateGameOptions = GameSetupOptions;

export type Game = GameSnapshot & {
  nextId: number;
  activePlayers: PlayerId[];
  teams: Record<PlayerId, string>;
  unitSpatial?: SpatialIndex<Unit>;
  unitSpatialByTeam?: Map<string, SpatialIndex<Unit>>;
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
};

const BUILD_RANGE = 46;
const MINE_RANGE = 44;
const TOWN_HALL_DROP_RANGE = 74;
const GOLD_PER_TRIP = 10;
const GATHER_DURATION = seconds(5);
const GOLD_MINE_ENTRY_COOLDOWN = seconds(1.6);
const LOW_UPKEEP_GOLD_RATE = 0.7;
const HIGH_UPKEEP_GOLD_RATE = 0.4;
const VETERANCY_STEP = 0.25;
const ITEM_PICKUP_RANGE = 72;
const GUARDIAN_SCROLL_DURATION = seconds(7);
const SCORCH_DURATION = seconds(8);
const LIGHTNING_ROD_COOLDOWN = seconds(18);
const STORM_STAFF_DURATION = seconds(4.8);
const STORM_STAFF_TICK_INTERVAL = seconds(1.2);
const STORM_STAFF_COOLDOWN = seconds(27);
const BREACH_CHARGE_RANGE = 280;
const BREACH_CHARGE_DAMAGE = 260;
const FLAME_CLOAK_VISUAL_DURATION = seconds(1.7);
const FLAME_CLOAK_COOLDOWN = seconds(2);
const MOON_WELL_HEAL_AMOUNT = 5;
const MOON_WELL_HEAL_EFFECT_DURATION = seconds(1.1);
const REPAIR_RANGE = BUILD_RANGE + 20;
// @@@repair - A worker repairs a building as fast as a footman strikes one (the owner's word, 10-02: a tower held by its
// workers holds), at the price it always had: 1 gold for each REPAIR_FULL_COST_FRACTION-th of the building's price worth
// of its health, paid as often as that rate asks (a tower every 6 ticks, a hall every 9).
const REPAIR_FULL_COST_FRACTION = 0.35;
const REPAIR_HP_PER_TICK = UNIT_DEFS.footman.attackDamage / UNIT_DEFS.footman.attackCooldown;
const REPAIR_HAMMER_EFFECT_DURATION = seconds(3);
const AUTO_ACQUIRE_RANGE = 230;
// A weapon reaching farther than this throws a missile; within it, it strikes in melee.
export const RANGED_ATTACK_RANGE_THRESHOLD = 90;
// A shot flies at one speed, so a shot across an archer's full reach (399) takes the 22 ticks every shot used to take
// and one at point blank lands at once; with a fixed flight time a shot from close in crept to its target.
const PROJECTILE_SPEED = 18;
const NEUTRAL_LEASH_RANGE = 520;
// @@@neutral-damage-response - Damage response must cover any legal ranged hit before leash cleanup can erase the aggro.
const NEUTRAL_DAMAGE_RESPONSE_RANGE = Math.max(BUILDING_DEFS.defenseTower.attackRange, ...Object.values(UNIT_DEFS).map((unit) => unit.attackRange));
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
const AGGRESSOR_TARGET_BONUS = 90;
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
  const generated = layout ? generateMap(layout, activePlayers, teams) : undefined;
  const shops = (generated?.sites ?? []).filter((site) => site.kind === "shop").map((site, index) => createShop(`shop-${index + 1}`, site.x, site.y));
  const game = {
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
      this.nextId += 1;
      applyUnitUpgrades(this, unit);
      this.units.push(unit);
      return unit;
    },
  } satisfies Game;

  if (options.scenario) applyScenarioOverride(game, options.scenario);
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

  if (command.type === "move") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      assignUnitOrder(unit, { type: "move", x: command.x, y: command.y }, command.queued);
    }
    addEffect(game, command.queued ? "queuedMove" : "move", command.x, command.y, command.queued ? 38 : 24);
    return;
  }

  if (command.type === "attackMove") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      assignUnitOrder(unit, { type: unit.attackDamage > 0 ? "attackMove" : "move", x: command.x, y: command.y }, command.queued);
    }
    addEffect(game, command.queued ? "queuedAttack" : "attack", command.x, command.y, command.queued ? 42 : 28);
    return;
  }

  if (command.type === "stop") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) assignUnitOrder(unit, { type: "idle" });
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

  if (command.type === "mine") {
    const resource = game.resources.find((candidate) => candidate.id === command.resourceId);
    if (!resource) throw new Error(`Unknown resource ${command.resourceId}`);
    for (const unit of unitsByIds(game, command.unitIds, owner).filter((unit) => unit.kind === "worker")) {
      assignUnitOrder(unit, { type: "mine", resourceId: command.resourceId, phase: "toMine", timer: 0 }, command.queued);
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

  if (command.type === "build") {
    const worker = game.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) throw new Error(`Unknown ${owner} worker ${command.unitId}`);
    if (!RACE_DEFS[playerState(game, owner).race].buildableBuildings.includes(command.buildingKind)) throw new Error(`${playerState(game, owner).race} race cannot build ${command.buildingKind}`);
    const blocker = buildingPlacementBlocker(game, command.buildingKind, command);
    if (blocker) throw new Error(`${command.buildingKind} placement is too close to ${blocker.kind}`);
    if (terrainBlocksPlacement(game.map, command.buildingKind, command)) throw new Error(`${command.buildingKind} placement is on blocked ground`);
    spendGold(game, owner, BUILDING_DEFS[command.buildingKind].cost);
    const building = createBuilding(`building-${owner}-${command.buildingKind}-${game.nextId}`, owner, command.buildingKind, command.x, command.y, false);
    applyDerivedBuildingStats(game, building);
    building.hp = constructionStartHp(building.maxHp);
    game.nextId += 1;
    game.buildings.push(building);
    // Where a building is a body (see @@@building-body) this spot lies inside it: the walk ends at the wall (restsAgainstGoalBody).
    worker.order = { type: "move", x: command.x - BUILD_RANGE + 10, y: command.y };
    addEffect(game, "build", command.x, command.y, 60);
    return;
  }

  if (command.type === "setRally") {
    setRally(game, owner, command.buildingIds, command.x, command.y, command.target);
    return;
  }

  if (command.type === "cast") {
    castAbility(game, owner, command.unitId, command.ability, command.targetId, command.x, command.y);
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
    buyGood(game, owner, command.shopId, command.item);
    return;
  }

  // Told to board, soldiers walk to the transport, and an idle transport sails in to meet them (see @@@transport).
  if (command.type === "board") {
    const transport = game.units.find((unit) => unit.id === command.transportId && unit.owner === owner && carries(unit) > 0);
    if (!transport) throw new Error(`Unknown ${owner} transport ${command.transportId}`);
    const boarders = unitsByIds(game, command.unitIds, owner).filter((unit) => unitMover(unit.kind) === "land");
    for (const unit of boarders) assignUnitOrder(unit, { type: "board", transportId: transport.id }, command.queued);
    return;
  }

  if (command.type === "unload") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      if (carries(unit) > 0) assignUnitOrder(unit, { type: "unload", x: command.x, y: command.y }, command.queued);
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
  game.tick += 1;
  syncBuildingBodies(game);
  updateWorldEffects(game);
  updateProjectiles(game);
  updateUnitStatusEffects(game);
  updateConstruction(game);
  updateTraining(game);
  updateResearch(game);
  updateResources(game);
  updateMercenaryCamps(game);
  if (game.shops) restockShops(game.shops);
  game.unitSpatial = createSpatialIndex(game.units, 320);
  game.unitSpatialByTeam = createTeamSpatialIndexes(game, game.units, 230);
  if (!game.buildingSpatial || game.buildingSpatialCount !== game.buildings.length) {
    game.buildingSpatial = createSpatialIndex(game.buildings, 420);
    game.buildingSpatialByTeam = createTeamSpatialIndexes(game, game.buildings, 260);
    game.buildingSpatialCount = game.buildings.length;
  }
  game.entityById = createEntityIndex(game);
  updateItems(game);
  updateMoonWellHealing(game);
  updateRegeneration(game);
  updateTowerAttacks(game);
  const ferry = updateUnits(game);
  if (ferry) ferryUnits(game, ferry);
  slideUnits(game);
  separateUnits(game);
  if (game.map.terrain) keepUnitsOutOfBuildings(game);
  removeExpiredUnits(game);
  removeDead(game);
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

export function snapshotGame(game: Game): GameSnapshot {
  return {
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
    units: game.units.map((unit) => ({
      ...unit,
      ...(unit.abilityCooldowns ? { abilityCooldowns: { ...unit.abilityCooldowns } } : {}),
      ...(unit.autocast ? { autocast: { ...unit.autocast } } : {}),
      order: { ...unit.order },
      orderQueue: unit.orderQueue?.map((order) => ({ ...order })) ?? [],
    })),
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
    items: game.items.map((item) => ({ ...item })),
    projectiles: game.projectiles.map((projectile) => ({ ...projectile })),
    effects: game.effects.map((effect) => ({ ...effect })),
    // A variant's rules are replaced whole when they change, never edited, so the snapshot may share them.
    ...(game.variants ? { variants: { ...game.variants } } : {}),
    ...(game.obstacles ? { obstacles: game.obstacles.map((obstacle) => ({ ...obstacle, along: { ...obstacle.along } })) } : {}),
  };
}

export function restoreSnapshotIntoGame(game: Game, snapshot: GameSnapshot, nextId: number): void {
  game.tick = snapshot.tick;
  game.match = cloneSnapshotValue(snapshot.match);
  game.map = cloneSnapshotValue(snapshot.map);
  game.teams = snapshot.teams ? definedTeams(snapshot.teams) : { ...game.teams };
  game.players = cloneSnapshotValue(snapshot.players);
  game.units = cloneSnapshotValue(snapshot.units).map(withUnitShape);
  game.buildings = cloneSnapshotValue(snapshot.buildings);
  game.resources = cloneSnapshotValue(snapshot.resources);
  game.mercenaryCamps = cloneSnapshotValue(snapshot.mercenaryCamps);
  if (snapshot.shops) game.shops = cloneSnapshotValue(snapshot.shops);
  else delete game.shops;
  game.items = cloneSnapshotValue(snapshot.items);
  game.projectiles = cloneSnapshotValue(snapshot.projectiles);
  game.effects = cloneSnapshotValue(snapshot.effects);
  if (snapshot.variants) game.variants = cloneSnapshotValue(snapshot.variants);
  else delete game.variants;
  if (snapshot.obstacles) game.obstacles = cloneSnapshotValue(snapshot.obstacles);
  else delete game.obstacles;
  game.nextId = nextId;
  invalidateGameRuntimeCaches(game);
}

function invalidateGameRuntimeCaches(game: Game): void {
  delete game.unitSpatial;
  delete game.unitSpatialByTeam;
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
    const builders = game.units.filter(
      (unit) => unit.owner === building.owner && unit.kind === "worker" && distance(unit, building) <= BUILD_RANGE + 20,
    );
    if (builders.length === 0) continue;
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
    job.remaining -= 1;
    if (job.remaining > 0) continue;
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
    target.hp = Math.min(target.maxHp, target.hp + MOON_WELL_HEAL_AMOUNT);
    building.cooldown = building.attackCooldown;
    addEffect(game, "heal", target.x, target.y, MOON_WELL_HEAL_EFFECT_DURATION, { fromX: building.x, fromY: building.y, toX: target.x, toY: target.y });
  }
}

function mostWoundedSoldierNear(game: Game, building: Building) {
  let target: Unit | undefined;
  let targetScore = 0;
  forEachNearbyUnit(game, building, building.attackRange, (unit) => {
    if (unit.owner !== building.owner || unit.kind === "worker" || unit.hp >= unit.maxHp || distance(unit, building) > building.attackRange) return;
    const score = (unit.maxHp - unit.hp) * 2 + (1 - unit.hp / Math.max(1, unit.maxHp)) * 80;
    if (score <= targetScore) return;
    target = unit;
    targetScore = score;
  });
  return target;
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
  return (unitRules(game, unit).regenPerSecond ?? 0) + leadershipRegenPerSecond(game, unit);
}

export { unitRules };

export function leadershipRegenPerSecond(game: GameSnapshot, unit: Unit) {
  if (!isPlayerId(unit.owner) || unit.level <= 0) return 0;
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

function updateItems(game: Game) {
  // The carriers a ring has healed this tick: a second ring heals no more (see @@@shop-goods).
  let ringed: Set<string> | undefined;
  for (const item of game.items) {
    item.cooldownRemaining = Math.max(0, item.cooldownRemaining - 1);
    const carrier = carrierFor(game, item);
    if (!carrier) continue;
    item.x = carrier.x;
    item.y = carrier.y;
    if (item.kind === "flameCloak") applyFlameCloak(game, carrier, item);
    if (item.kind === "regenRing" && carrier.hp < carrier.maxHp && !ringed?.has(carrier.id)) {
      carrier.hp = Math.min(carrier.maxHp, carrier.hp + RING_REGEN_PER_SECOND / 20);
      (ringed ??= new Set()).add(carrier.id);
    }
    if (carrier.owner === "neutral") activateNeutralItem(game, carrier, item);
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
  for (const unit of game.units) {
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
      autocastStep(game, unit);
    }
    if (unit.order.type === "charge") {
      updateChargeOrder(game, unit);
      continue;
    }
    if (unit.order.type === "move") {
      moveToward(unit, unit.order.x, unit.order.y, game.map);
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
    if (unit.order.type === "follow") {
      updateFollowOrder(game, unit);
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
    if (unit.order.type === "repair") {
      updateRepairOrder(game, unit);
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
      moveToward(unit, unit.order.x, unit.order.y, game.map);
      (ferry ??= { boarding: [], unloading: [] }).unloading.push(unit);
      continue;
    }
    if (unit.kind === "worker" && updateAutoRepair(game, unit)) continue;
    if (unit.kind !== "worker") {
      const target = nearestEnemyTarget(game, unit, AUTO_ACQUIRE_RANGE);
      if (target) unit.order = { type: "attack", targetId: target.id, leashX: unit.x, leashY: unit.y };
    }
    if (unit.owner === "neutral") {
      const target = firstNearbyUnit(game, unit, 150, (candidate) => areEnemyOwners(game, unit.owner, candidate.owner) && distanceSquared(unit, candidate) <= 150 * 150 && canReach(game.map, unit, candidate));
      if (target) unit.order = { type: "attack", targetId: target.id };
    }
  }
  return ferry;
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
}

function activateQueuedOrder(unit: Unit) {
  if (unit.order.type !== "idle") return;
  const next = unit.orderQueue?.shift();
  if (!next) return;
  unit.order = next;
}

function updateFollowOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "follow") return;
  const order = unit.order;
  const target = game.units.find((candidate) => candidate.id === order.targetId && candidate.owner === unit.owner);
  if (!target) {
    unit.order = { type: "idle" };
    return;
  }
  if (distance(unit, target) > Math.max(72, target.radius + unit.radius + 26)) {
    moveToward(unit, target.x, target.y, game.map);
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
  if (homeDistance <= NEUTRAL_LEASH_RANGE && (!target || distance(target, responseOrigin) <= NEUTRAL_DAMAGE_RESPONSE_RANGE)) return false;

  // @@@neutral-leash - Creeps reset to their authored camp instead of dragging fights into worker lines forever.
  unit.order = { type: "move", x: home.x, y: home.y };
  moveToward(unit, home.x, home.y, game.map);
  if (distance(unit, home) <= NEUTRAL_RETURN_STOP_RANGE) unit.order = { type: "idle" };
  return true;
}

function updateHoldOrder(game: Game, unit: Unit) {
  if (unit.cooldown > 0 || unit.attackDamage <= 0) return;
  const target = nearestEnemyTarget(game, unit, unit.attackRange);
  if (!target) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(unit))), unit.attackRange);
  unit.cooldown = attackCooldownOf(unit);
}

function updateAttackMoveOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "attackMove") return;
  const order = unit.order;
  if (order.targetId) {
    const target = findTarget(game, order.targetId);
    if (target && target.hp > 0 && areEnemyOwners(game, unit.owner, target.owner) && canReach(game.map, unit, target)) {
      attackMoveTowardTarget(game, unit, target);
      return;
    }
    unit.order = { type: "attackMove", x: order.x, y: order.y };
  }

  const target = nearestEnemyTarget(game, unit, AUTO_ACQUIRE_RANGE);
  if (target) {
    unit.order = { type: "attackMove", x: order.x, y: order.y, targetId: target.id };
    attackMoveTowardTarget(game, unit, target);
    return;
  }
  moveToward(unit, order.x, order.y, game.map);
  if (walkEnded(game, unit, order, 8)) arrive(unit, order);
}

function attackMoveTowardTarget(game: Game, unit: Unit, target: Unit | Building) {
  const gap = targetGap(unit, target);
  if (gap > unit.attackRange) {
    moveToward(unit, target.x, target.y, game.map);
    return;
  }
  if (unit.cooldown > 0) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(unit))), unit.attackRange);
  unit.cooldown = attackCooldownOf(unit);
}

function updateAttackOrder(game: Game, unit: Unit) {
  const order = unit.order;
  if (order.type !== "attack") return;
  const target = findStrikeTarget(game, order.targetId);
  if (!target) {
    unit.order = { type: "idle" };
    return;
  }
  // A target that is as good as dead, or out of reach from the attacker's ground (see @@@reach), gives way to the next.
  if (projectedHpAfterPendingProjectiles(game, unit.owner, target) <= 0 || !canReach(game.map, unit, target)) {
    const replacement = nearestEnemyTarget(game, unit, Math.max(AUTO_ACQUIRE_RANGE, unit.attackRange));
    if (!replacement) {
      unit.order = { type: "idle" };
      return;
    }
    unit.order = { ...order, targetId: replacement.id };
    updateAttackOrder(game, unit);
    return;
  }
  const gap = targetGap(unit, target);
  if (gap > unit.attackRange) {
    if (isPlayerId(unit.owner) && order.leashX !== undefined && order.leashY !== undefined && distance(unit, { x: order.leashX, y: order.leashY }) > GUARD_LEASH_RANGE) {
      unit.order = { type: "move", x: order.leashX, y: order.leashY };
      return;
    }
    moveToward(unit, target.x, target.y, game.map);
    return;
  }
  if (unit.cooldown > 0) return;
  applyWeaponAttack(game, unit, target, Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(unit))), unit.attackRange);
  unit.cooldown = attackCooldownOf(unit);
}

function updateMineOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "mine") return;
  const order = unit.order;
  const resource = game.resources.find((candidate) => candidate.id === order.resourceId);
  if (!resource || resource.amount <= 0) {
    unit.order = { type: "idle" };
    return;
  }

  if (order.phase === "toMine") {
    if (distance(unit, resource) > MINE_RANGE) {
      moveToward(unit, resource.x, resource.y, game.map);
      return;
    }
    if ((resource.harvestCooldownRemaining ?? 0) > 0) return;
    resource.harvestCooldownRemaining = GOLD_MINE_ENTRY_COOLDOWN;
    unit.order = { ...order, phase: "gather", timer: GATHER_DURATION };
    return;
  }

  if (order.phase === "gather") {
    order.timer -= 1;
    if (order.timer > 0) return;
    const mined = Math.min(GOLD_PER_TRIP, resource.amount);
    resource.amount -= mined;
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
    moveToward(unit, townHall.x, townHall.y, game.map);
    return;
  }
  if (isPlayerId(unit.owner)) {
    const player = playerState(game, unit.owner);
    player.gold += upkeepGoldIncome(unit.carryingGold, player.supplyUsed);
  }
  unit.carryingGold = 0;
  unit.order = { type: "mine", resourceId: resource.id, phase: "toMine", timer: 0 };
}

// A soldier told to board walks to its transport (see @@@transport); it goes aboard in ferryUnits. An idle transport
// sails in to the water nearest it, so the two meet at the shore wherever each stopped.
function updateBoardOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "board") return;
  const transport = findTarget(game, unit.order.transportId);
  if (!transport || !isUnit(transport) || transport.owner !== unit.owner) {
    unit.order = { type: "idle" };
    return;
  }
  if (alongside(unit, transport)) return;
  moveToward(unit, transport.x, transport.y, game.map);
  if (transport.order.type === "idle") moveToward(transport, unit.x, unit.y, game.map);
}

// After every unit has moved: soldiers alongside the transport they were told to board go aboard while their supply fits
// (the rest stop), and a transport that has reached the water nearest its unloading point sets its passengers ashore (any
// that find no land near enough stay aboard) and stops (see @@@transport).
function ferryUnits(game: Game, { boarding, unloading }: Ferry) {
  if (boarding.length > 0) {
    const aboard = new Set<Unit>();
    for (const unit of boarding) {
      if (unit.order.type !== "board") continue;
      const transport = findTarget(game, unit.order.transportId);
      if (!transport || !isUnit(transport) || !alongside(unit, transport)) continue;
      unit.order = { type: "idle" };
      unit.orderQueue = [];
      if (cargoSupply(game, transport) + unitRules(game, unit).supplyUsed > carries(transport)) continue;
      transport.cargo = [...(transport.cargo ?? []), unit];
      aboard.add(unit);
    }
    if (aboard.size > 0) game.units = game.units.filter((unit) => !aboard.has(unit));
  }
  for (const transport of unloading) {
    if (transport.order.type !== "unload" || !walkEnded(game, transport, transport.order, 8)) continue;
    const passengers = transport.cargo ?? [];
    const staying: Unit[] = [];
    passengers.forEach((passenger, index) => {
      if (passenger.expiresTick !== undefined && passenger.expiresTick <= game.tick) {
        // A summon whose time ran out aboard is gone; what it carried is left where the transport is.
        passenger.x = transport.x;
        passenger.y = transport.y;
        dropItemsFromDeadUnits(game, [passenger]);
        return;
      }
      const spot = landingSpot(game.map, transport, index, passengers.length);
      if (!spot) {
        staying.push(passenger);
        return;
      }
      passenger.x = spot.x;
      passenger.y = spot.y;
      passenger.order = { type: "idle" };
      game.units.push(passenger);
    });
    transport.cargo = staying.length > 0 ? staying : undefined;
    transport.order = { type: "idle" };
    updateSupplyState(game);
  }
}

function cargoSupply(game: Game, transport: Unit) {
  return (transport.cargo ?? []).reduce((total, passenger) => total + unitRules(game, passenger).supplyUsed, 0);
}

function upkeepGoldIncome(carriedGold: number, supplyUsed: number) {
  if (supplyUsed >= HIGH_UPKEEP_SUPPLY) return Math.floor(carriedGold * HIGH_UPKEEP_GOLD_RATE);
  if (supplyUsed >= LOW_UPKEEP_SUPPLY) return Math.floor(carriedGold * LOW_UPKEEP_GOLD_RATE);
  return carriedGold;
}

function updateRepairOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "repair" || !isPlayerId(unit.owner)) return;
  const order = unit.order;
  const building = game.buildings.find((candidate) => candidate.id === order.buildingId && candidate.owner === unit.owner);
  if (!building || building.hp <= 0 || building.hp >= building.maxHp) {
    unit.order = { type: "idle" };
    return;
  }
  if (distance(unit, building) > REPAIR_RANGE) {
    moveToward(unit, building.x, building.y, game.map);
    return;
  }
  if (unit.cooldown > 0) return;
  if (!repairBuildingTick(game, unit, building)) unit.order = { type: "idle" };
}

function updateAutoRepair(game: Game, unit: Unit) {
  if (unit.order.type !== "idle" || !isPlayerId(unit.owner)) return false;
  if (unit.cooldown > 0) return false;
  const building = game.buildings.find(
    (candidate) => candidate.owner === unit.owner && candidate.complete && candidate.hp > 0 && candidate.hp < candidate.maxHp && distance(unit, candidate) <= REPAIR_RANGE,
  );
  if (!building) return false;
  return repairBuildingTick(game, unit, building);
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
  unit.cooldown = Math.max(1, Math.round(hpPerGold / REPAIR_HP_PER_TICK));
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
  building.queue.push({ unitKind, remaining: trainTimeFor(unitKind) });
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
function buyGood(game: Game, owner: PlayerId, shopId: string, kind: WorldItem["kind"]) {
  const refusal = buyRefusal(game, owner, shopId, kind);
  if (refusal) throw new Error(refusal.message);
  const shop = game.shops!.find((candidate) => candidate.id === shopId)!;
  const good = shop.goods.find((candidate) => candidate.kind === kind)!;
  spendGold(game, owner, good.cost);
  good.stock -= 1;
  if (good.restockRemaining <= 0) good.restockRemaining = good.restock;
  const item: WorldItem = { id: `item-${owner}-${kind}-${game.nextId}`, kind, x: shop.x, y: shop.y + shop.radius + 16, cooldownRemaining: 0 };
  game.nextId += 1;
  game.items.push(item);
  const buyer = shopBuyer(game, owner, shop);
  if (buyer) attachItemToUnit(game, item, buyer);
  addEffect(game, "summon", shop.x, shop.y, 24);
  return item;
}

function hasFriendlyUnitAtMercenaryCamp(game: Game, owner: PlayerId, camp: { x: number; y: number; radius: number }) {
  return game.units.some((unit) => unit.owner === owner && distance(unit, camp) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE);
}

function updatePickupItemOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "pickupItem") return;
  const itemId = unit.order.itemId;
  const item = game.items.find((candidate) => candidate.id === itemId);
  if (!item || item.carrierId) {
    unit.order = { type: "idle" };
    return;
  }
  if (distance(unit, item) > ITEM_PICKUP_RANGE) {
    moveToward(unit, item.x, item.y, game.map);
    return;
  }
  if (carriedItemCount(game, unit.id) < MAX_CARRIED_ITEMS) attachItemToUnit(game, item, unit);
  unit.order = { type: "idle" };
}

function pickupItem(game: Game, owner: PlayerId, unitId: string, itemId: string, queued = false) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item carrier ${unitId}`);
  const item = game.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  if (item.carrierId) throw new Error(`${item.id} is already carried`);
  if (unitMover(unit.kind) === "sea") throw new Error("A ship carries no items");
  if (carriedItemCount(game, unit.id) >= MAX_CARRIED_ITEMS) throw new Error(`${unit.id} carries ${MAX_CARRIED_ITEMS} items already`);
  if (distance(unit, item) > ITEM_PICKUP_RANGE) {
    assignUnitOrder(unit, { type: "pickupItem", itemId }, queued);
    return;
  }
  attachItemToUnit(game, item, unit);
}

function attachItemToUnit(game: Game, item: WorldItem, unit: Unit) {
  item.carrierId = unit.id;
  item.x = unit.x;
  item.y = unit.y;
  // Boots change their carrier's pace (see @@@shop-goods).
  if (item.kind === "speedBoots" && isPlayerId(unit.owner)) applyDerivedUnitStats(game, unit);
}

function dropItem(game: Game, owner: PlayerId, unitId: string, itemId: string, x: number, y: number) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item carrier ${unitId}`);
  const item = carriedItem(game, unit, itemId);
  delete item.carrierId;
  item.x = clamp(x, 0, game.map.width);
  item.y = clamp(y, 0, game.map.height);
  if (item.kind === "speedBoots" && isPlayerId(unit.owner)) applyDerivedUnitStats(game, unit);
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
  activateItem(game, unit, item, targetId, x, y);
}

function castAbility(
  game: Game,
  owner: PlayerId,
  unitId: string,
  ability: AbilityKind,
  targetId: string | undefined,
  x: number | undefined,
  y: number | undefined,
) {
  const caster = game.units.find((unit) => unit.id === unitId && unit.owner === owner);
  if (!caster) throw new Error(`Unknown ${owner} caster ${unitId}`);
  if (!UNIT_DEFS[caster.kind].abilities.includes(ability)) throw new Error(`${caster.kind} cannot cast ${ability}`);
  if (abilityCooldown(caster, ability) > 0) throw new Error(`${caster.kind} is on cooldown`);
  const def = ABILITY_DEFS[ability];

  if (def.behavior === "heal") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && !areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Heal requires an allied unit target");
    applyHeal(game, caster, ability, target, def);
    return;
  }
  if (def.behavior === "curse") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Curse requires an enemy unit target");
    applyCurse(game, caster, ability, target, def);
    return;
  }
  if (def.behavior === "charge") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Charge requires an enemy unit target");
    if (!inChargeWindow(caster, target, def)) throw new Error(`Charge target must be ${def.minRange} to ${def.range} away`);
    if (!canReach(game.map, caster, target)) throw new Error("Charge target is out of reach");
    startCharge(game, caster, ability, target, def, true);
    return;
  }
  if (def.behavior !== "summon") throw new Error(`${ability} is cast by its creep alone`);
  if (!isNumber(x) || !isNumber(y)) throw new Error("Summon requires a target point");
  applySummon(game, caster, ability, x, y, def);
}

function applyHeal(game: Game, caster: Unit, ability: AbilityKind, target: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "heal" }>) {
  if (distance(caster, target) > def.range) return;
  target.hp = Math.min(target.maxHp, target.hp + def.healAmount);
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, target.x, target.y, 36);
}

function applySummon(game: Game, caster: Unit, ability: AbilityKind, x: number, y: number, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "summon" }>) {
  if (distance(caster, { x, y }) > def.range) return;
  const spirit = game.spawnUnit(caster.owner, def.summonKind, x, y);
  spirit.expiresTick = game.tick + def.summonDuration;
  spirit.order = { type: "idle" };
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, x, y, 50);
}

function applyCurse(game: Game, caster: Unit, ability: AbilityKind, target: Unit, def: Extract<(typeof ABILITY_DEFS)[AbilityKind], { behavior: "curse" }>) {
  if (distance(caster, target) > def.range) return;
  const damageMultiplier = target.effects.some((effect) => effect.type === "scorch")
    ? (def.scorchedDamageMultiplier ?? def.damageMultiplier)
    : def.damageMultiplier;
  target.effects = target.effects.filter((effect) => effect.type !== def.statusType);
  target.effects.push({ type: def.statusType, remaining: def.effectDuration, ...(damageMultiplier !== 0.4 ? { damageMultiplier } : {}) });
  caster.abilityCooldowns = withAbilityCooldown(caster, ability, def.cooldown);
  addEffect(game, def.effectType, target.x, target.y, 46);
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
    const damage = Math.max(1, Math.round(unit.attackDamage * outgoingDamageMultiplier(unit) * def.damageMultiplier));
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
const AUTOCAST_ORDERS = new Set<UnitOrder["type"]>(["idle", "attack", "attackMove", "hold"]);
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
    } else if (unit.order.type !== "hold") {
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
  addEffect(game, "stomp", caster.x, caster.y, 24, { radius: def.range });
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
  addEffect(game, "bloodlust", best.x, best.y, 30);
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
  addEffect(game, "web", best.x, best.y, def.effectDuration);
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
    if (candidate.hp <= 0 || areEnemyOwners(game, caster.owner, candidate.owner) || distance(caster, candidate) > def.range) return;
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
    return target && isUnit(target) && isAutocastFoe(game, rider, target) && inChargeWindow(rider, target, def) && canReach(game.map, rider, target) ? target : undefined;
  }
  if (order.type !== "idle" && order.type !== "attackMove") return undefined;
  const charged = new Set(game.units.flatMap((unit) => (unit.owner === rider.owner && unit.order.type === "charge" ? [unit.order.targetId] : [])));
  let free: Unit | undefined;
  let any: Unit | undefined;
  forEachNearbyUnit(game, rider, def.range, (candidate) => {
    if (!isAutocastFoe(game, rider, candidate) || !inChargeWindow(rider, candidate, def) || !canReach(game.map, rider, candidate)) return;
    if (!any || distance(rider, candidate) < distance(rider, any)) any = candidate;
    if (!charged.has(candidate.id) && (!free || distance(rider, candidate) < distance(rider, free))) free = candidate;
  });
  return free ?? any;
}

function outgoingDamageMultiplier(unit: Unit) {
  const cursed = unit.effects.reduce((multiplier, effect) => Math.min(multiplier, effect.damageMultiplier ?? (effect.type === "curse" ? 0.4 : 1)), 1);
  return unit.stance === "brace" ? cursed * BRACE_DAMAGE_SHARE : cursed;
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
    if (!target || distance(carrier, target) > 280) return;
    applyChainLightning(game, carrier, item, target);
    return;
  }
  if (item.kind === "stormStaff") {
    const point = targetId ? game.units.find((unit) => unit.id === targetId) : isNumber(x) && isNumber(y) ? { x, y } : undefined;
    if (!point || distance(carrier, point) > 320) return;
    applyStormStaff(game, carrier, item, point.x, point.y);
    return;
  }
  if (item.kind === "guardianScroll") {
    if (carrier.owner === "neutral") return;
    forEachNearbyUnit(game, carrier, 280, (unit) => {
      if (distance(unit, carrier) > 280 || areEnemyOwners(game, carrier.owner, unit.owner)) return;
      unit.effects = unit.effects.filter((effect) => effect.type !== "guardian");
      unit.effects.push({ type: "guardian", remaining: GUARDIAN_SCROLL_DURATION });
    });
    addEffect(game, "guardianField", carrier.x, carrier.y, GUARDIAN_SCROLL_DURATION, { radius: 280 });
    consumeItem(game, item);
    return;
  }
  if (item.kind === "breachCharge") {
    if (carrier.owner === "neutral") return;
    const target = targetId ? game.buildings.find((building) => building.id === targetId && areEnemyOwners(game, carrier.owner, building.owner)) : undefined;
    if (!target || distance(carrier, target) > BREACH_CHARGE_RANGE) return;
    applyAttackDamage(game, carrier, target, BREACH_CHARGE_DAMAGE, BREACH_CHARGE_RANGE);
    consumeItem(game, item);
    return;
  }
  if (item.kind === "experienceBook") {
    if (carrier.owner === "neutral") return;
    carrier.xp += 160;
    applyXpLevel(game, carrier);
    addEffect(game, "experienceBurst", carrier.x, carrier.y, 48);
    consumeItem(game, item);
    return;
  }
  if (item.kind === "healingScroll") {
    if (carrier.owner === "neutral") return;
    forEachNearbyUnit(game, carrier, HEALING_SCROLL_RADIUS, (unit) => {
      if (distance(unit, carrier) > HEALING_SCROLL_RADIUS || areEnemyOwners(game, carrier.owner, unit.owner)) return;
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
    const tower = createBuilding(`building-${carrier.owner}-defenseTower-${game.nextId}`, carrier.owner, "defenseTower", x, y, true);
    game.nextId += 1;
    tower.hp = Math.round(tower.maxHp / 2);
    game.buildings.push(tower);
    addEffect(game, "summon", x, y, 34);
    consumeItem(game, item);
  }
}

function isShopOnlyItem(kind: WorldItem["kind"]) {
  return kind === "speedBoots" || kind === "regenRing" || kind === "healingScroll" || kind === "ivoryTower";
}

function consumeItem(game: Game, item: WorldItem) {
  game.items = game.items.filter((candidate) => candidate.id !== item.id);
}

function applyChainLightning(game: Game, carrier: Unit, item: WorldItem, firstTarget: Unit) {
  const struck = new Set<string>();
  let current = firstTarget;
  let damage = 84;
  for (let bounce = 0; bounce < 3; bounce += 1) {
    struck.add(current.id);
    applyAttackDamage(game, carrier, current, damage, 240);
    addEffect(game, "chainLightning", current.x, current.y, 28, { fromX: carrier.x, fromY: carrier.y, toX: current.x, toY: current.y });
    const next = nearestChainTarget(game, carrier, current, struck, 170);
    if (!next) break;
    current = next;
    damage = Math.max(18, Math.round(damage * 0.68));
  }
  item.cooldownRemaining = LIGHTNING_ROD_COOLDOWN;
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
  forEachNearbyUnit(game, { x, y }, 145, (target) => {
    if (distance(target, { x, y }) > 145 || !areEnemyOwners(game, carrier.owner, target.owner)) return;
    applyAttackDamage(game, carrier, target, 24, 260);
  });
  addEffect(game, "storm", x, y, STORM_STAFF_DURATION, { owner: carrier.owner, damage: 6, radius: 145, tickEvery: STORM_STAFF_TICK_INTERVAL });
  item.cooldownRemaining = STORM_STAFF_COOLDOWN;
}

function applyFlameCloak(game: Game, carrier: Unit, item: WorldItem) {
  if (item.cooldownRemaining > 0) return;
  let burned = false;
  forEachNearbyUnit(game, carrier, 90, (target) => {
    if (distance(target, carrier) > 90 || !areEnemyOwners(game, carrier.owner, target.owner)) return;
    applyAttackDamage(game, carrier, target, 12, 70);
    addEffect(game, "flameBurn", target.x, target.y, FLAME_CLOAK_VISUAL_DURATION);
    burned = true;
  });
  if (!burned) return;
  item.cooldownRemaining = FLAME_CLOAK_COOLDOWN;
}

function updateWorldEffects(game: Game) {
  for (const effect of game.effects) {
    applyWorldEffectTick(game, effect);
    effect.remaining -= 1;
  }
  game.effects = game.effects.filter((effect) => effect.remaining > 0);
}

function applyWorldEffectTick(game: Game, effect: WorldEffect) {
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
  const target = findStrikeTarget(game, projectile.targetId);
  if (!target || target.hp <= 0 || !areEnemyOwners(game, projectile.owner, target.owner)) return;
  const shooter = findTarget(game, projectile.attackerId);
  const attacker = shooter ?? projectileAttacker(projectile);
  const taken = applyDamage(game, attacker, target, attackDamageAgainstTarget(game, attacker, target, projectile.damage));
  if (taken === undefined) return;
  applyAttackStatusEffects(game, attacker, target);
  addHitEffect(game, target, taken, shooter);
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

function applyWeaponAttack(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, attackRange: number) {
  if (attackRange > RANGED_ATTACK_RANGE_THRESHOLD) {
    launchProjectile(game, attacker, target, heavyArmoredDamage(game, attacker, target, damage));
    return;
  }
  applyAttackDamage(game, attacker, target, damage, attackRange);
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
  const flight = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / PROJECTILE_SPEED));
  const projectile = {
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
  } satisfies Projectile;
  game.nextId += 1;
  game.projectiles.push(projectile);
  addEffect(game, "projectile", target.x, target.y, flight, {
    fromX: projectile.fromX,
    fromY: projectile.fromY,
    toX: projectile.toX,
    toY: projectile.toY,
    sourceKind: attacker.kind,
  });
}

function applyAttackDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number, attackRange: number) {
  const dealt = attackDamageAgainstTarget(game, attacker, target, damage);
  const taken = applyDamage(game, attacker, target, dealt);
  if (taken === undefined) return;
  applyAttackStatusEffects(game, attacker, target);
  if (attackRange <= RANGED_ATTACK_RANGE_THRESHOLD && isUnit(attacker) && isUnit(target)) stanceBlow(attacker, target, dealt);
  const from = { x: attacker.x, y: attacker.y };
  const to = { x: target.x, y: target.y };
  const kind: WorldEffect["type"] = attackRange > 90 ? "projectile" : "melee";
  addEffect(game, kind, to.x, to.y, kind === "projectile" ? 22 : 16, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
  addHitEffect(game, target, taken, attacker);
}

// The flinch of whatever was struck, carrying who it was and what it took, so the client shakes it by the share of its
// full health the blow took, and the kind of who struck it (a weapon's blow; a spell's or a gone shooter's has none) so
// the client can sound the blow.
function addHitEffect(game: Game, target: Unit | Building | Obstacle, taken: number, striker?: Unit | Building) {
  addEffect(game, "hit", target.x, target.y, 14, { unitId: target.id, damage: taken, ...(striker ? { sourceKind: striker.kind } : {}) });
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
function applyDamage(game: Game, attacker: Unit | Building, target: Unit | Building | Obstacle, damage: number): number | undefined {
  if (isObstacle(target)) {
    // A rock pile or gate wakes nobody and pays nothing when it falls (see @@@obstacle).
    const hpBefore = target.hp;
    target.hp -= damage;
    game.observer?.hit(attacker, target, damage, hpBefore);
    return damage;
  }
  if (isUnit(target) && target.effects.some((effect) => effect.type === "guardian")) return undefined;
  const taken = isUnit(target) && target.stance === "shock" ? Math.max(1, Math.round(damage * SHOCK_DAMAGE_TAKEN)) : damage;
  const hpBefore = target.hp;
  target.hp -= taken;
  game.observer?.hit(attacker, target, taken, hpBefore);
  if (hpBefore > 0 && isUnit(target) && target.owner === "neutral") triggerNeutralAssist(game, target, attacker);
  if (hpBefore > 0 && isPlayerId(target.owner)) triggerPlayerAggro(game, target, attacker);
  if (hpBefore > 0 && target.hp <= 0) {
    recordKill(game, attacker, target);
  }
  return taken;
}

function triggerNeutralAssist(game: Game, damagedNeutral: Unit, attacker: Unit | Building) {
  if (!areEnemyOwners(game, damagedNeutral.owner, attacker.owner)) return;
  const origin = neutralHomeOrCurrentPoint(damagedNeutral);
  // @@@neutral-assist - Damage is louder than idle acquisition, but existing valid targets should not twitch on every hit.
  for (const unit of game.units) {
    if (unit.owner !== "neutral" || unit.hp <= 0) continue;
    if (distance(unit, damagedNeutral) > NEUTRAL_ASSIST_RANGE) continue;
    if (neutralHasValidAttackTarget(game, unit) || (isUnit(attacker) && !canReach(game.map, unit, attacker))) continue;
    unit.order = { type: "attack", targetId: attacker.id, leashX: origin.x, leashY: origin.y };
  }
}

// A hit wakes the victim and every soldier of its owner within call range, even when the victim is a worker or a
// building or did not survive the hit. Attackers that are already gone (a tower's arrow still flying, a storm) are nobody
// to turn on.
function triggerPlayerAggro(game: Game, victim: Unit | Building, attacker: Unit | Building) {
  if (!areEnemyOwners(game, victim.owner, attacker.owner) || attacker.hp <= 0 || findTarget(game, attacker.id) !== attacker) return;
  if (isUnit(victim)) takeUpAttacker(game, victim, attacker);
  const reach = HELP_CALL_RANGE + (isUnit(victim) ? 0 : victim.radius);
  forEachNearbyUnit(game, victim, reach, (ally) => {
    if (ally === victim || ally.owner !== victim.owner || distance(ally, victim) > reach) return;
    takeUpAttacker(game, ally, attacker);
  });
}

function takeUpAttacker(game: Game, unit: Unit, attacker: Unit | Building) {
  if (unit.hp <= 0 || unit.kind === "worker" || unit.attackDamage <= 0 || !canReach(game.map, unit, attacker)) return;
  const order = unit.order;
  if (order.type === "idle") {
    if (!unit.orderQueue?.length) unit.order = { type: "attack", targetId: attacker.id, leashX: unit.x, leashY: unit.y };
    return;
  }
  if (order.type === "attackMove") {
    if (!order.targetId || attackerOutranksUnreachedTarget(game, unit, order.targetId, attacker)) unit.order = { ...order, targetId: attacker.id };
    return;
  }
  const selfDirected = order.type === "attack" && order.leashX !== undefined;
  if (selfDirected && attackerOutranksUnreachedTarget(game, unit, order.targetId, attacker)) unit.order = { ...order, targetId: attacker.id };
}

// A unit already fighting keeps its target. One still walking to it may turn to the attacker, but only when the attacker is
// the better target by the ordinary priority score, so a tower's arrow cannot pull a soldier off the soldier it is chasing.
function attackerOutranksUnreachedTarget(game: Game, unit: Unit, targetId: string, attacker: Unit | Building) {
  if (targetId === attacker.id) return false;
  const current = findTarget(game, targetId);
  if (!current || current.hp <= 0) return true;
  if (targetGap(unit, current) <= unit.attackRange) return false;
  return targetPriorityScore(game, unit.owner, attacker, distanceSquared(unit, attacker)) > targetPriorityScore(game, unit.owner, current, distanceSquared(unit, current));
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
  if (isUnit(target)) for (const passenger of target.cargo ?? []) recordKill(game, attacker, passenger);
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
    if (isPlayerId(attacker.owner) && target.owner === "neutral") {
      incrementStat(game.match.stats.neutralUnitsKilled, attacker.owner, 1);
      awardNeutralGoldBounty(game, attacker.owner, target);
    }
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
  vectors?: Partial<Pick<WorldEffect, "fromX" | "fromY" | "toX" | "toY" | "owner" | "damage" | "radius" | "tickEvery" | "sourceKind" | "unitId">>,
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
  attacker.xp += unitRules(game, target).xpReward;
  applyXpLevel(game, attacker);
}

function awardNeutralGoldBounty(game: Game, owner: PlayerId, target: Unit) {
  const bounty = unitRules(game, target).goldBounty ?? 0;
  if (bounty <= 0) return;
  playerState(game, owner).gold += bounty;
}

function starLevelForXp(xp: number) {
  if (xp >= XP_STAR_THRESHOLDS[2]!) return 3;
  if (xp >= XP_STAR_THRESHOLDS[1]!) return 2;
  if (xp >= XP_STAR_THRESHOLDS[0]!) return 1;
  return 0;
}

function applyXpLevel(game: Game, unit: Unit) {
  if (unit.variant !== undefined && game.variants?.[unit.variant]?.heroic) return;
  const nextLevel = starLevelForXp(unit.xp);
  if (nextLevel <= unit.level) return;
  unit.level = Math.min(MAX_UPGRADE_LEVEL, nextLevel);
  applyDerivedUnitStats(game, unit);
}

function applyDerivedUnitStats(game: Game, unit: Unit) {
  const previousMaxHp = unit.maxHp;
  const base = nonStarUnitStats(game, unit);
  const multiplier = 1 + Math.min(MAX_UPGRADE_LEVEL, Math.max(0, unit.level)) * VETERANCY_STEP;
  unit.attackDamage = Math.round(base.attackDamage * multiplier);
  unit.maxHp = Math.round(base.maxHp * multiplier);
  unit.speed = base.speed;
  unit.attackRange = base.attackRange;
  unit.hp = Math.min(unit.maxHp, Math.max(1, unit.hp + unit.maxHp - previousMaxHp));
}

function nonStarUnitStats(game: Game, unit: Unit) {
  const stats = unitRules(game, unit);
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
  if (game.items.some((item) => item.carrierId === unit.id && item.kind === "speedBoots")) speed = roundUnitScalar(speed * BOOTS_SPEED);
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
  return completeBuildings(game, owner, "townHall").reduce<Building | undefined>((best, building) => {
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
  if (!isPlayerId(unit.owner) || unit.attackDamage <= 0) return undefined;
  return nearestEnemyTargetFromPoint(game, unit.owner, unit, range, unit);
}

// @@@building-reach - A building is reached at its edge, a unit at its center (see building-body): a footman's 48 reaches a
// town hall's wall, 48 from a center 66 away. While units could walk into a building they struck it from inside.
function targetGap(from: { x: number; y: number }, target: Unit | Building | Obstacle) {
  return isUnit(target) ? distance(from, target) : Math.max(0, distance(from, target) - target.radius);
}

function nearestEnemyTargetFromPoint(game: Game, owner: PlayerId, point: { x: number; y: number }, range: number, attacker?: Unit): Unit | Building | undefined {
  const limit = range * range;
  let best: Unit | Building | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  forEachNearbyEnemyUnit(game, owner, point, range, (candidate) => {
    const candidateDistance = distanceSquared(point, candidate);
    if (candidateDistance > limit) return;
    if (attacker && !canReach(game.map, attacker, candidate)) return;
    const score = targetPriorityScore(game, owner, candidate, candidateDistance);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  forEachNearbyEnemyBuilding(game, owner, point, range + MAX_BUILDING_RADIUS, (building) => {
    const gap = targetGap(point, building);
    if (gap > range) return;
    if (attacker && !canReach(game.map, attacker, building)) return;
    const score = targetPriorityScore(game, owner, building, gap * gap);
    if (score > bestScore) {
      best = building;
      bestScore = score;
    }
  });
  return best;
}

function targetPriorityScore(game: Game, attackerOwner: Owner, target: Unit | Building, distanceSq: number) {
  if (projectedHpAfterPendingProjectiles(game, attackerOwner, target) <= 0) return Number.NEGATIVE_INFINITY;
  const distancePenalty = Math.sqrt(distanceSq) * 0.9;
  return targetPriorityBase(target) + targetThreatBonus(target) + aggressorBonus(game, attackerOwner, target) - distancePenalty;
}

function aggressorBonus(game: Game, owner: Owner, target: Unit | Building) {
  if (!isUnit(target)) return 0;
  const victimId = target.order.type === "attack" || target.order.type === "attackMove" ? target.order.targetId : undefined;
  const victim = victimId ? findTarget(game, victimId) : undefined;
  return victim && !areEnemyOwners(game, owner, victim.owner) ? AGGRESSOR_TARGET_BONUS : 0;
}

function projectedHpAfterPendingProjectiles(game: Game, attackerOwner: Owner, target: Unit | Building | Obstacle) {
  let pendingDamage = 0;
  for (const projectile of projectilesAt(game, target.id)) if (projectile.owner === attackerOwner) pendingDamage += projectile.damage;
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

function targetPriorityBase(target: Unit | Building) {
  if (isUnit(target)) return target.kind === "worker" ? 260 : 430;
  if (target.kind === "defenseTower") return 360;
  if (target.kind === "townHall") return 120;
  return 220;
}

function targetThreatBonus(target: Unit | Building) {
  if (!isUnit(target)) return 0;
  const missingHp = Math.max(0, target.maxHp - target.hp);
  return missingHp * 1.4 + target.attackDamage * 2 + (target.attackRange > 100 ? 20 : 0);
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
  for (const unit of [...deadUnits]) {
    for (const passenger of unit.cargo ?? []) {
      passenger.x = unit.x;
      passenger.y = unit.y;
      deadUnits.push(passenger);
    }
  }
  const deadBuildings = game.buildings.filter((building) => building.hp <= 0);
  for (const unit of deadUnits) incrementStat(game.match.stats.unitsLost, unit.owner, 1);
  dropItemsFromDeadUnits(game, deadUnits);
  game.units = game.units.filter((unit) => unit.hp > 0);
  game.buildings = game.buildings.filter((building) => building.hp > 0);
  // A rock pile or gate broken is gone, and its way open (see @@@obstacle).
  if (game.obstacles?.some((obstacle) => obstacle.hp <= 0)) game.obstacles = game.obstacles.filter((obstacle) => obstacle.hp > 0);
  if (deadUnits.length > 0 || deadBuildings.length > 0) updateSupplyState(game);
}

function dropItemsFromDeadUnits(game: Game, deadUnits: Unit[]) {
  if (deadUnits.length === 0) return;
  const deadById = new Map(deadUnits.map((unit) => [unit.id, unit]));
  for (const item of game.items) {
    if (!item.carrierId) continue;
    const dead = deadById.get(item.carrierId);
    if (!dead) continue;
    delete item.carrierId;
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

function enemyTeamKeys(game: Game, owner: Owner, indexes: Map<string, unknown>) {
  const ownTeam = teamKey(game, owner);
  if (ownTeam === "neutral") return [...indexes.keys()].filter((team) => team !== "neutral");
  return [...indexes.keys()].filter((team) => team !== ownTeam);
}

// @@@building-body - A building is a body no unit enters, as a forest is (see @@@terrain) but round and its own size:
// after the units part from each other, any unit within a building's radius and its own is set back on the building's
// rim, out along the line from its center, and the part of a slide (see @@@push) heading into it is spent, as against a
// wall. A foundation is as solid as a finished building: a site laid where units stand moves them aside. Units used to
// walk through buildings, and a melee fighter struck a town hall from inside it. That holds on a map with terrain, whose
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
  if (unit.kind === "worker" || gap > CROWD_REACH) return false;
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

// Each unit is held against the buildings whose reach (their radius and the widest unit's) touches the square it stands
// in, the squares filled once per set of buildings (see syncBuildingBodies). Each building used to look through the
// tick's unit index, whose squares are 320 wide: the sixty units of a whole base, for each building in it.
const BODY_SQUARE = 64;
const bodySquares = new WeakMap<(Building | Obstacle)[], Map<number, (Building | Obstacle)[]>>();

function keepUnitsOutOfBuildings(game: Game) {
  const seen = game.buildingBodiesSeen!;
  let squares = bodySquares.get(seen);
  if (!squares) {
    squares = new Map();
    for (const building of seen) {
      const reach = building.radius + MAX_UNIT_RADIUS;
      const right = Math.floor((building.x + reach) / BODY_SQUARE);
      const bottom = Math.floor((building.y + reach) / BODY_SQUARE);
      for (let x = Math.floor((building.x - reach) / BODY_SQUARE); x <= right; x += 1) {
        for (let y = Math.floor((building.y - reach) / BODY_SQUARE); y <= bottom; y += 1) {
          const key = numericBucketKey(x, y);
          const square = squares.get(key);
          if (square) square.push(building);
          else squares.set(key, [building]);
        }
      }
    }
    bodySquares.set(seen, squares);
  }
  for (const unit of game.units) {
    const square = squares.get(numericBucketKey(Math.floor(unit.x / BODY_SQUARE), Math.floor(unit.y / BODY_SQUARE)));
    if (square) for (const building of square) keepOutOfBuilding(game, unit, building);
  }
}

function keepOutOfBuilding(game: Game, unit: Unit, building: Building | Obstacle) {
  const reach = unit.radius + building.radius;
  const dx = unit.x - building.x;
  const dy = unit.y - building.y;
  const gapSq = dx * dx + dy * dy;
  if (gapSq >= reach * reach) return;
  const length = Math.sqrt(gapSq);
  const nx = length === 0 ? 1 : dx / length;
  const ny = length === 0 ? 0 : dy / length;
  const x = clamp(building.x + nx * reach, 0, game.map.width);
  const y = clamp(building.y + ny * reach, 0, game.map.height);
  // Set back only onto ground the unit stands on: a ship by its shipyard onto the water, never ashore (see @@@naval).
  if (!game.map.terrain || isWalkable(game.map, x, y, unitMover(unit.kind))) {
    unit.x = x;
    unit.y = y;
  }
  if (unit.pushX !== undefined && unit.pushY !== undefined) {
    const into = unit.pushX * nx + unit.pushY * ny;
    if (into < 0) {
      unit.pushX -= into * nx;
      unit.pushY -= into * ny;
    }
  }
}

function slideUnits(game: Game) {
  for (const unit of game.units) if (unit.pushX !== undefined) slide(unit, game.map);
}

function separateUnits(game: Game) {
  const cellSize = 80;
  const buckets = new Map<number, { x: number; y: number; units: Unit[] }>();
  for (const unit of game.units) {
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

function separateUnitPair(game: Game, a: Unit, b: Unit) {
  if (minerGhost(game, a) || minerGhost(game, b)) return;
  const minDistance = a.radius + b.radius;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq >= minDistance * minDistance) return;
  const length = Math.hypot(dx, dy);
  const nx = length === 0 ? 1 : dx / length;
  const ny = length === 0 ? 0 : dy / length;
  if (a.pushX !== undefined || b.pushX !== undefined) pushContact(a, b, nx, ny);
  const push = (minDistance - length) / 2;
  const ax = clamp(a.x - nx * push, 0, game.map.width);
  const ay = clamp(a.y - ny * push, 0, game.map.height);
  const bx = clamp(b.x + nx * push, 0, game.map.width);
  const by = clamp(b.y + ny * push, 0, game.map.height);
  // Neither is pushed onto ground it cannot stand on (see @@@terrain): the one by a wall stays and the other gives way; a
  // ship by the shore stays on the water and the soldier beside it on land (see @@@naval).
  if (!game.map.terrain || isWalkable(game.map, ax, ay, unitMover(a.kind))) {
    a.x = ax;
    a.y = ay;
  }
  if (!game.map.terrain || isWalkable(game.map, bx, by, unitMover(b.kind))) {
    b.x = bx;
    b.y = by;
  }
}

function numericBucketKey(x: number, y: number) {
  return x * 1000 + y;
}

function spatialBucketKey(entity: SpatialEntity, cellSize: number) {
  return numericBucketKey(Math.floor(entity.x / cellSize), Math.floor(entity.y / cellSize));
}

function createSpatialIndex<T extends SpatialEntity>(entities: T[], cellSize: number): SpatialIndex<T> {
  const buckets = new Map<number, T[]>();
  for (const entity of entities) {
    const key = spatialBucketKey(entity, cellSize);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entity);
    else buckets.set(key, [entity]);
  }
  return { cellSize, buckets };
}

function createTeamSpatialIndexes<T extends SpatialEntity & { owner: Owner }>(game: Game, entities: T[], cellSize: number) {
  const byTeam = new Map<string, T[]>();
  for (const entity of entities) {
    const team = teamKey(game, entity.owner);
    const bucket = byTeam.get(team);
    if (bucket) bucket.push(entity);
    else byTeam.set(team, [entity]);
  }
  return new Map([...byTeam.entries()].map(([team, teamEntities]) => [team, createSpatialIndex(teamEntities, cellSize)]));
}

function createEntityIndex(game: Game) {
  const entities = new Map<string, Unit | Building>();
  for (const unit of game.units) entities.set(unit.id, unit);
  for (const building of game.buildings) entities.set(building.id, building);
  return entities;
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
  for (const team of enemyTeamKeys(game, owner, indexes)) {
    const index = indexes.get(team);
    if (index) forEachNearbyEntity(index, [], point, range, visit);
  }
}

function forEachNearbyEnemyBuilding(game: Game, owner: Owner, point: { x: number; y: number }, range: number, visit: (building: Building) => void) {
  const indexes = game.buildingSpatialByTeam;
  if (!indexes) {
    forEachNearbyBuilding(game, point, range, (building) => {
      if (areEnemyOwners(game, owner, building.owner)) visit(building);
    });
    return;
  }
  for (const team of enemyTeamKeys(game, owner, indexes)) {
    const index = indexes.get(team);
    if (index) forEachNearbyEntity(index, [], point, range, visit);
  }
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
  const right = Math.floor((point.x + range) / size);
  const bottom = Math.floor((point.y + range) / size);
  const top = Math.floor((point.y - range) / size);
  for (let x = Math.floor((point.x - range) / size); x <= right; x += 1) {
    for (let y = top; y <= bottom; y += 1) {
      const bucket = index.buckets.get(numericBucketKey(x, y));
      if (!bucket) continue;
      for (const entity of bucket) visit(entity);
    }
  }
}

function moveToward(unit: Unit, x: number, y: number, map: GameMap) {
  // A rooted or stunned unit stands, a netted one walks slower (see @@@creep-status).
  const pace = statusPace(unit);
  if (pace === 0) return;
  if (map.terrain) {
    walkToward(unit, x, y, map, pace);
    return;
  }
  const speed = unit.speed * pace;
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
  const speed = unit.speed * pace * groundUnder(map, unit.x, unit.y, mover).pace;
  const nextX = clamp(length <= speed ? aim.x : unit.x + (dx / length) * speed, 0, map.width);
  const nextY = clamp(length <= speed ? aim.y : unit.y + (dy / length) * speed, 0, map.height);
  if (isWalkable(map, nextX, nextY, mover) || !isWalkable(map, unit.x, unit.y, mover)) {
    unit.x = nextX;
    unit.y = nextY;
  } else if (isWalkable(map, nextX, unit.y, mover)) {
    unit.x = nextX;
  } else if (isWalkable(map, unit.x, nextY, mover)) {
    unit.y = nextY;
  }
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
