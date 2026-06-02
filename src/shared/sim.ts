import { BUILDING_DEFS, MAX_UPGRADE_LEVEL, MERCENARY_HIRE_RANGE, MERCENARY_UNIT_KINDS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, UPGRADE_KINDS, XP_STAR_THRESHOLDS, maxUpgradeLevel } from "./catalog";
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
  trainTimeFor,
} from "./map";
import { seconds } from "./time";
import type { AbilityKind, Building, GameCommand, GameMap, GameSetupOptions, GameSnapshot, MapId, MatchState, Owner, PlayerId, PlayerNumberMap, PlayerState, PlayerStateMap, RallyTarget, ScenarioOverride, TrainableUnitKind, Unit, UnitKind, UpgradeKind, WorldEffect, WorldItem } from "./types";

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
  entityById?: Map<string, Unit | Building>;
  spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number): Unit;
};

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
const LOW_UPKEEP_SUPPLY = 51;
const HIGH_UPKEEP_SUPPLY = 81;
const LOW_UPKEEP_GOLD_RATE = 0.7;
const HIGH_UPKEEP_GOLD_RATE = 0.4;
const VETERANCY_STEP = 0.25;
const ITEM_PICKUP_RANGE = 72;
const CURSE_DURATION = seconds(18);
const SUMMONED_SPIRIT_DURATION = seconds(45);
const GUARDIAN_SCROLL_DURATION = seconds(7);
const GUARDIAN_SCROLL_COOLDOWN = seconds(45);
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
const REPAIR_FULL_COST_FRACTION = 0.35;
const AUTO_ACQUIRE_RANGE = 230;
const NEUTRAL_LEASH_RANGE = 520;
const NEUTRAL_TARGET_LEASH_RANGE = 320;
const NEUTRAL_RETURN_STOP_RANGE = 8;
const NEUTRAL_ASSIST_RANGE = 360;
const DEFAULT_PLAYERS: PlayerId[] = ["player", "enemy"];
const DEFAULT_TEAMS: Record<string, string> = { player: "player", enemy: "enemy", enemy2: "enemy2" };
const DEFAULT_RACES: Record<string, PlayerState["race"]> = { player: "grove", enemy: "ember", enemy2: "grove" };
// @@@runtime-id-band - Map-authored ids stay human-readable; runtime ids live above this band.
const RUNTIME_ID_START = 1000;

export function createGame(mapId: MapId = DEFAULT_MAP_ID, options: CreateGameOptions = {}): Game {
  const aiPlayers = options.aiPlayers ?? ["enemy"];
  const activePlayers = uniquePlayers(options.players ?? [...DEFAULT_PLAYERS, ...aiPlayers]);
  const teams = Object.fromEntries(activePlayers.map((owner, index) => [owner, options.teams?.[owner] ?? DEFAULT_TEAMS[owner] ?? `team-${index + 1}`]));
  const game = {
    tick: 0,
    match: createMatchState(activePlayers),
    map: createMap(mapId),
    players: createPlayerStates(activePlayers, options),
    units: createInitialUnits(mapId, activePlayers, teams),
    buildings: createInitialBuildings(activePlayers, mapId, teams),
    resources: createInitialResources(mapId, activePlayers, teams),
    mercenaryCamps: createInitialMercenaryCamps(mapId),
    items: createInitialItems(mapId),
    effects: [],
    nextId: RUNTIME_ID_START,
    activePlayers,
    teams,
    spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number) {
      const unit = createUnit(`unit-${owner}-${kind}-${this.nextId}`, owner, kind, x, y);
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
    ...game.items.map((item) => item.id),
    ...game.map.landmarks.map((landmark) => landmark.id),
  ]);
  const claimId = (id: string) => {
    if (ids.has(id)) throw new Error(`Duplicate scenario id ${id}`);
    ids.add(id);
  };

  for (const resource of scenario.addResources ?? []) {
    claimId(resource.id);
    game.resources.push({ ...resource });
  }
  for (const camp of scenario.addMercenaryCamps ?? []) {
    claimId(camp.id);
    game.mercenaryCamps.push({ ...camp });
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
    if (seed.order) unit.order = { ...seed.order };
    game.units.push(unit);
  }
  for (const seed of scenario.addBuildings ?? []) {
    claimId(seed.id);
    game.buildings.push(createBuilding(seed.id, seed.owner, seed.kind, seed.x, seed.y, seed.complete ?? true));
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
  if (command.type === "startMap") {
    throw new Error("startMap is a server session command, not a simulation order");
  }

  if (command.type === "move") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      unit.order = { type: "move", x: command.x, y: command.y };
    }
    addEffect(game, "move", command.x, command.y, 24);
    return;
  }

  if (command.type === "attackMove") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      unit.order = { type: "attackMove", x: command.x, y: command.y };
    }
    addEffect(game, "attack", command.x, command.y, 28);
    return;
  }

  if (command.type === "attack") {
    for (const unit of unitsByIds(game, command.unitIds, owner)) {
      unit.order = { type: "attack", targetId: command.targetId };
    }
    const target = findTarget(game, command.targetId);
    if (target) addEffect(game, "attackTarget", target.x, target.y, 32);
    return;
  }

  if (command.type === "mine") {
    const resource = game.resources.find((candidate) => candidate.id === command.resourceId);
    if (!resource) throw new Error(`Unknown resource ${command.resourceId}`);
    for (const unit of unitsByIds(game, command.unitIds, owner).filter((unit) => unit.kind === "worker")) {
      unit.order = { type: "mine", resourceId: command.resourceId, phase: "toMine", timer: 0 };
    }
    addEffect(game, "mine", resource.x, resource.y, 30);
    return;
  }

  if (command.type === "repair") {
    const building = game.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) throw new Error(`Unknown ${owner} building ${command.buildingId}`);
    if (building.hp >= building.maxHp) throw new Error(`${building.kind} is already fully repaired`);
    for (const unit of unitsByIds(game, command.unitIds, owner).filter((unit) => unit.kind === "worker")) {
      unit.order = { type: "repair", buildingId: building.id };
    }
    addEffect(game, "heal", building.x, building.y, 26);
    return;
  }

  if (command.type === "build") {
    const worker = game.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) throw new Error(`Unknown ${owner} worker ${command.unitId}`);
    if (!RACE_DEFS[playerState(game, owner).race].buildableBuildings.includes(command.buildingKind)) throw new Error(`${playerState(game, owner).race} race cannot build ${command.buildingKind}`);
    spendGold(game, owner, BUILDING_DEFS[command.buildingKind].cost);
    const building = createBuilding(`building-${owner}-${command.buildingKind}-${game.nextId}`, owner, command.buildingKind, command.x, command.y, false);
    applyDerivedBuildingStats(game, building);
    game.nextId += 1;
    game.buildings.push(building);
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

  if (command.type === "hire") {
    hireMercenary(game, owner, command.campId);
    return;
  }

  if (command.type === "research") {
    const building = game.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) throw new Error(`Unknown ${owner} building ${command.buildingId}`);
    queueResearch(game, building, command.upgradeKind);
    return;
  }

  if (command.type === "pickupItem") {
    pickupItem(game, owner, command.unitId, command.itemId);
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
  updateWorldEffects(game);
  updateUnitStatusEffects(game);
  updateConstruction(game);
  updateTraining(game);
  updateResearch(game);
  updateResources(game);
  updateMercenaryCamps(game);
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
  updateTowerAttacks(game);
  updateUnits(game);
  separateUnits(game);
  removeExpiredUnits(game);
  removeDead(game);
  updateVictory(game);
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
    players: Object.fromEntries(Object.entries(game.players).map(([owner, player]) => [owner, { ...player, upgrades: { ...player.upgrades } }])) as PlayerStateMap,
    units: game.units.map((unit) => ({ ...unit, order: { ...unit.order } })),
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
    items: game.items.map((item) => ({ ...item })),
    effects: game.effects.map((effect) => ({ ...effect })),
  };
}

function updateConstruction(game: Game) {
  for (const building of game.buildings) {
    if (building.complete) continue;
    const builders = game.units.filter(
      (unit) => unit.owner === building.owner && unit.kind === "worker" && distance(unit, building) <= BUILD_RANGE + 20,
    );
    if (builders.length === 0) continue;
    building.buildProgress += builders.length;
    if (building.buildProgress >= building.buildTime) {
      applyDerivedBuildingStats(game, building);
      building.complete = true;
      building.hp = building.maxHp;
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
    const unit = game.spawnUnit(building.owner, job.unitKind, building.x + Math.cos(angle) * 80, building.y + Math.sin(angle) * 80);
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
    const target = nearestEnemyUnit(game, building.owner, building.x, building.y, building.attackRange);
    if (!target) continue;
    applyAttackDamage(game, building, target, building.attackDamage, building.attackRange);
    building.cooldown = building.attackCooldown;
  }
}

function updateMoonWellHealing(game: Game) {
  for (const building of game.buildings) {
    if (!building.complete || building.kind !== "moonWell") continue;
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

function updateMercenaryCamps(game: Game) {
  for (const camp of game.mercenaryCamps) {
    camp.cooldownRemaining = Math.max(0, camp.cooldownRemaining - 1);
  }
}

function updateItems(game: Game) {
  for (const item of game.items) {
    item.cooldownRemaining = Math.max(0, item.cooldownRemaining - 1);
    const carrier = carrierFor(game, item);
    if (!carrier) continue;
    item.x = carrier.x;
    item.y = carrier.y;
    if (item.kind === "flameCloak") applyFlameCloak(game, carrier, item);
    if (carrier.owner === "neutral") activateNeutralItem(game, carrier, item);
  }
}

function updateResources(game: Game) {
  for (const resource of game.resources) {
    resource.harvestCooldownRemaining = Math.max(0, (resource.harvestCooldownRemaining ?? 0) - 1);
  }
}

function updateUnits(game: Game) {
  for (const unit of game.units) {
    unit.cooldown = Math.max(0, unit.cooldown - 1);
    if (updateNeutralLeash(game, unit)) continue;
    if (unit.order.type === "move") {
      moveToward(unit, unit.order.x, unit.order.y, game.map);
      if (distance(unit, unit.order) < 5) unit.order = { type: "idle" };
      continue;
    }
    if (unit.order.type === "attackMove") {
      updateAttackMoveOrder(game, unit);
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
    if (unit.kind === "worker" && updateAutoRepair(game, unit)) continue;
    if (unit.kind !== "worker") {
      const target = nearestEnemyTarget(game, unit, AUTO_ACQUIRE_RANGE);
      if (target) unit.order = { type: "attack", targetId: target.id };
    }
    if (unit.owner === "neutral") {
      const target = nearestEnemyInRange(game, unit, 150);
      if (target) unit.order = { type: "attack", targetId: target.id };
    }
  }
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
  const homeDistance = distance(unit, home);
  if (homeDistance <= NEUTRAL_RETURN_STOP_RANGE && unit.order.type === "move" && distance(unit.order, home) <= NEUTRAL_RETURN_STOP_RANGE) {
    unit.order = { type: "idle" };
    return false;
  }
  const target = unit.order.type === "attack" ? findTarget(game, unit.order.targetId) : undefined;
  if (homeDistance <= NEUTRAL_LEASH_RANGE && (!target || distance(target, home) <= NEUTRAL_TARGET_LEASH_RANGE)) return false;

  // @@@neutral-leash - Creeps reset to their authored camp instead of dragging fights into worker lines forever.
  unit.order = { type: "move", x: home.x, y: home.y };
  moveToward(unit, home.x, home.y, game.map);
  if (distance(unit, home) <= NEUTRAL_RETURN_STOP_RANGE) unit.order = { type: "idle" };
  return true;
}

function updateAttackMoveOrder(game: Game, unit: Unit) {
  if (unit.order.type !== "attackMove") return;
  const order = unit.order;
  if (order.targetId) {
    const target = findTarget(game, order.targetId);
    if (target && target.hp > 0 && areEnemyOwners(game, unit.owner, target.owner)) {
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
  if (distance(unit, order) < 8) unit.order = { type: "idle" };
}

function attackMoveTowardTarget(game: Game, unit: Unit, target: Unit | Building) {
  const gap = distance(unit, target);
  if (gap > unit.attackRange) {
    moveToward(unit, target.x, target.y, game.map);
    return;
  }
  if (unit.cooldown > 0) return;
  const damageMultiplier = unit.effects.some((effect) => effect.type === "curse") ? 0.62 : 1;
  applyAttackDamage(game, unit, target, Math.max(1, Math.round(unit.attackDamage * damageMultiplier)), unit.attackRange);
  unit.cooldown = unit.attackCooldown;
}

function updateAttackOrder(game: Game, unit: Unit) {
  const target = findTarget(game, unit.order.type === "attack" ? unit.order.targetId : "");
  if (!target) {
    unit.order = { type: "idle" };
    return;
  }
  const gap = distance(unit, target);
  if (gap > unit.attackRange) {
    moveToward(unit, target.x, target.y, game.map);
    return;
  }
  if (unit.cooldown > 0) return;
  const damageMultiplier = unit.effects.some((effect) => effect.type === "curse") ? 0.62 : 1;
  applyAttackDamage(game, unit, target, Math.max(1, Math.round(unit.attackDamage * damageMultiplier)), unit.attackRange);
  unit.cooldown = unit.attackCooldown;
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
  if (!repairBuildingTick(game, unit.owner, building)) unit.order = { type: "idle" };
}

function updateAutoRepair(game: Game, unit: Unit) {
  if (unit.order.type !== "idle" || !isPlayerId(unit.owner)) return false;
  const building = game.buildings.find(
    (candidate) => candidate.owner === unit.owner && candidate.complete && candidate.hp > 0 && candidate.hp < candidate.maxHp && distance(unit, candidate) <= REPAIR_RANGE,
  );
  if (!building) return false;
  return repairBuildingTick(game, unit.owner, building);
}

function repairBuildingTick(game: Game, owner: PlayerId, building: Building) {
  const player = playerState(game, owner);
  if (player.gold < 1 || building.hp >= building.maxHp) return false;
  const fullRepairCost = Math.max(1, Math.round(BUILDING_DEFS[building.kind].cost * REPAIR_FULL_COST_FRACTION));
  const hpPerGold = Math.max(1, building.maxHp / fullRepairCost);
  spendGold(game, owner, 1);
  building.hp = Math.min(building.maxHp, building.hp + hpPerGold);
  addEffect(game, "heal", building.x, building.y, 12);
  return true;
}

function queueTraining(game: Game, building: Building, unitKind: TrainableUnitKind) {
  if (!building.complete) throw new Error(`Cannot train from incomplete ${building.kind}`);
  if (!BUILDING_DEFS[building.kind].trains.includes(unitKind)) throw new Error(`${building.kind} cannot train ${unitKind}`);
  if (!RACE_DEFS[playerState(game, building.owner).race].trainableUnits.includes(unitKind)) throw new Error(`${playerState(game, building.owner).race} race cannot train ${unitKind}`);
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
  if (upgrade.buildingKind !== building.kind || !BUILDING_DEFS[building.kind].researches.includes(upgradeKind)) {
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
  attachItemToUnit(item, unit);
  unit.order = { type: "idle" };
}

function pickupItem(game: Game, owner: PlayerId, unitId: string, itemId: string) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item carrier ${unitId}`);
  const item = game.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  if (item.carrierId) throw new Error(`${item.id} is already carried`);
  if (distance(unit, item) > ITEM_PICKUP_RANGE) {
    unit.order = { type: "pickupItem", itemId };
    return;
  }
  attachItemToUnit(item, unit);
}

function attachItemToUnit(item: WorldItem, unit: Unit) {
  item.carrierId = unit.id;
  item.x = unit.x;
  item.y = unit.y;
}

function dropItem(game: Game, owner: PlayerId, unitId: string, itemId: string, x: number, y: number) {
  const unit = game.units.find((candidate) => candidate.id === unitId && candidate.owner === owner);
  if (!unit) throw new Error(`Unknown ${owner} item carrier ${unitId}`);
  const item = carriedItem(game, unit, itemId);
  delete item.carrierId;
  item.x = clamp(x, 0, game.map.width);
  item.y = clamp(y, 0, game.map.height);
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
  if (caster.cooldown > 0) throw new Error(`${caster.kind} is on cooldown`);

  if (ability === "heal") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && !areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Heal requires an allied unit target");
    applyHeal(game, caster, target);
    return;
  }
  if (ability === "curse") {
    const target = targetId ? game.units.find((unit) => unit.id === targetId && areEnemyOwners(game, unit.owner, owner)) : undefined;
    if (!target) throw new Error("Curse requires an enemy unit target");
    applyCurse(game, caster, target);
    return;
  }
  if (!isNumber(x) || !isNumber(y)) throw new Error("Summon requires a target point");
  applySummon(game, caster, x, y);
}

function applyHeal(game: Game, caster: Unit, target: Unit) {
  if (distance(caster, target) > 240) return;
  target.hp = Math.min(target.maxHp, target.hp + 55);
  caster.cooldown = 120;
  addEffect(game, "heal", target.x, target.y, 36);
}

function applySummon(game: Game, caster: Unit, x: number, y: number) {
  if (distance(caster, { x, y }) > 260) return;
  const spirit = game.spawnUnit(caster.owner, "spirit", x, y);
  spirit.expiresTick = game.tick + SUMMONED_SPIRIT_DURATION;
  spirit.order = { type: "idle" };
  caster.cooldown = 220;
  addEffect(game, "summon", x, y, 50);
}

function applyCurse(game: Game, caster: Unit, target: Unit) {
  if (distance(caster, target) > 280) return;
  target.effects = target.effects.filter((effect) => effect.type !== "curse");
  target.effects.push({ type: "curse", remaining: CURSE_DURATION });
  caster.cooldown = 150;
  addEffect(game, "curse", target.x, target.y, 46);
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
  // @@@neutral-treasure-rule - Camps can weaponize carried treasure, except scrolls that are explicitly inert on monsters.
  if (item.kind === "guardianScroll" || item.kind === "experienceBook" || item.kind === "breachCharge" || item.cooldownRemaining > 0) return;
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
    item.cooldownRemaining = GUARDIAN_SCROLL_COOLDOWN;
    return;
  }
  if (item.kind === "breachCharge") {
    if (carrier.owner === "neutral") return;
    const target = targetId ? game.buildings.find((building) => building.id === targetId && areEnemyOwners(game, carrier.owner, building.owner)) : undefined;
    if (!target || distance(carrier, target) > BREACH_CHARGE_RANGE) return;
    applyAttackDamage(game, carrier, target, BREACH_CHARGE_DAMAGE, BREACH_CHARGE_RANGE);
    game.items = game.items.filter((candidate) => candidate.id !== item.id);
    return;
  }
  if (item.kind === "experienceBook") {
    if (carrier.owner === "neutral") return;
    carrier.xp += 160;
    applyXpLevel(game, carrier);
    addEffect(game, "experienceBurst", carrier.x, carrier.y, 48);
    game.items = game.items.filter((candidate) => candidate.id !== item.id);
  }
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

function updateUnitStatusEffects(game: Game) {
  for (const unit of game.units) {
    for (const effect of unit.effects) effect.remaining -= 1;
    unit.effects = unit.effects.filter((effect) => effect.remaining > 0);
  }
}

function applyAttackDamage(game: Game, attacker: Unit | Building, target: Unit | Building, damage: number, attackRange: number) {
  if (isUnit(target) && target.effects.some((effect) => effect.type === "guardian")) return;
  const hpBefore = target.hp;
  target.hp -= damage;
  if (hpBefore > 0 && isUnit(target) && target.owner === "neutral") triggerNeutralAssist(game, target, attacker);
  if (hpBefore > 0 && target.hp <= 0) {
    recordKill(game, attacker, target);
  }
  const from = { x: attacker.x, y: attacker.y };
  const to = { x: target.x, y: target.y };
  const kind: WorldEffect["type"] = attackRange > 90 ? "projectile" : "melee";
  addEffect(game, kind, to.x, to.y, kind === "projectile" ? 22 : 16, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
  addEffect(game, "hit", to.x, to.y, 14);
}

function triggerNeutralAssist(game: Game, damagedNeutral: Unit, attacker: Unit | Building) {
  if (!areEnemyOwners(game, damagedNeutral.owner, attacker.owner)) return;
  // @@@neutral-assist - Damage is louder than idle acquisition, but existing valid targets should not twitch on every hit.
  for (const unit of game.units) {
    if (unit.owner !== "neutral" || unit.hp <= 0) continue;
    if (distance(unit, damagedNeutral) > NEUTRAL_ASSIST_RANGE) continue;
    if (neutralHasValidAttackTarget(game, unit)) continue;
    unit.order = { type: "attack", targetId: attacker.id };
  }
}

function neutralHasValidAttackTarget(game: Game, unit: Unit) {
  if (unit.order.type !== "attack") return false;
  const target = findTarget(game, unit.order.targetId);
  if (!target || target.hp <= 0 || !areEnemyOwners(game, unit.owner, target.owner)) return false;
  if (unit.homeX !== undefined && unit.homeY !== undefined && distance(target, { x: unit.homeX, y: unit.homeY }) > NEUTRAL_TARGET_LEASH_RANGE) return false;
  return true;
}

function recordKill(game: Game, attacker: Unit | Building, target: Unit | Building) {
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
  vectors?: Partial<Pick<WorldEffect, "fromX" | "fromY" | "toX" | "toY" | "owner" | "damage" | "radius" | "tickEvery">>,
) {
  game.effects.push({ id: `effect-${game.nextId}`, type, x, y, remaining, duration: remaining, ...vectors });
  game.nextId += 1;
}

function isUnit(entity: Unit | Building): entity is Unit {
  return "order" in entity;
}

function awardKillXp(game: Game, attacker: Unit, target: Unit) {
  if (attacker.owner === "neutral" || !areEnemyOwners(game, attacker.owner, target.owner)) return;
  attacker.xp += UNIT_DEFS[target.kind].xpReward;
  applyXpLevel(game, attacker);
}

function awardNeutralGoldBounty(game: Game, owner: PlayerId, target: Unit) {
  const bounty = UNIT_DEFS[target.kind].goldBounty ?? 0;
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
  const nextLevel = starLevelForXp(unit.xp);
  if (nextLevel <= unit.level) return;
  unit.level = Math.min(MAX_UPGRADE_LEVEL, nextLevel);
  applyDerivedUnitStats(game, unit);
  addEffect(game, "levelUp", unit.x, unit.y, 54);
}

function applyDerivedUnitStats(game: Game, unit: Unit) {
  const previousMaxHp = unit.maxHp;
  const base = nonStarUnitStats(game, unit);
  const multiplier = 1 + Math.min(MAX_UPGRADE_LEVEL, Math.max(0, unit.level)) * VETERANCY_STEP;
  unit.attackDamage = Math.round(base.attackDamage * multiplier);
  unit.maxHp = Math.round(base.maxHp * multiplier);
  unit.hp = Math.min(unit.maxHp, Math.max(1, unit.hp + unit.maxHp - previousMaxHp));
}

function nonStarUnitStats(game: Game, unit: Unit) {
  const stats = UNIT_DEFS[unit.kind];
  let attackDamage = stats.attackDamage;
  let maxHp = stats.hp;
  if (!isPlayerId(unit.owner)) return { attackDamage, maxHp };
  const upgrades = playerState(game, unit.owner).upgrades;
  for (const upgradeKind of UPGRADE_KINDS) {
    const upgrade = UPGRADE_DEFS[upgradeKind];
    if (!upgrade.affectedUnitKinds.includes(unit.kind as TrainableUnitKind)) continue;
    for (let level = 0; level < (upgrades[upgradeKind] ?? 0); level += 1) {
      const levelDef = upgrade.levels[level];
      if (!levelDef) throw new Error(`${upgradeKind} missing level ${level + 1}`);
      attackDamage += levelDef.attackBonus;
      maxHp += levelDef.maxHpBonus;
    }
  }
  return { attackDamage, maxHp };
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
    .reduce((total, unit) => total + UNIT_DEFS[unit.kind].supplyUsed, 0);
  const queuedSupply = game.buildings
    .filter((building) => building.owner === owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  return unitSupply + queuedSupply;
}

function unitsByIds(game: Game, unitIds: string[], owner: PlayerId) {
  const units = unitIds.map((id) => game.units.find((unit) => unit.id === id && unit.owner === owner));
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

function nearestEnemyInRange(game: Game, unit: Unit, range: number) {
  const limit = range * range;
  let found: Unit | undefined;
  forEachNearbyUnit(game, unit, range, (candidate) => {
    if (found) return;
    if (areEnemyOwners(game, unit.owner, candidate.owner) && distanceSquared(unit, candidate) <= limit) found = candidate;
  });
  return found;
}

function nearestEnemyUnit(game: Game, owner: PlayerId, x: number, y: number, range: number) {
  const point = { x, y };
  const limit = range * range;
  let best: Unit | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  forEachNearbyEnemyUnit(game, owner, point, range, (unit) => {
    const candidateDistance = distanceSquared(unit, point);
    if (candidateDistance > limit) return;
    const score = targetPriorityScore(unit, candidateDistance);
    if (score <= bestScore) return;
    best = unit;
    bestScore = score;
  });
  return best;
}

function nearestEnemyTarget(game: Game, unit: Unit, range: number): Unit | Building | undefined {
  if (!isPlayerId(unit.owner)) return undefined;
  const point = { x: unit.x, y: unit.y };
  const limit = range * range;
  let best: Unit | Building | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  forEachNearbyEnemyUnit(game, unit.owner, point, range, (candidate) => {
    const candidateDistance = distanceSquared(unit, candidate);
    if (candidateDistance > limit) return;
    const score = targetPriorityScore(candidate, candidateDistance);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  forEachNearbyEnemyBuilding(game, unit.owner, unit, range, (building) => {
    const candidateDistance = distanceSquared(unit, building);
    if (candidateDistance > limit) return;
    const score = targetPriorityScore(building, candidateDistance);
    if (score > bestScore) {
      best = building;
      bestScore = score;
    }
  });
  return best;
}

function targetPriorityScore(target: Unit | Building, distanceSq: number) {
  const distancePenalty = Math.sqrt(distanceSq) * 0.9;
  return targetPriorityBase(target) + targetThreatBonus(target) - distancePenalty;
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
  const deadBuildings = game.buildings.filter((building) => building.hp <= 0);
  for (const unit of deadUnits) incrementStat(game.match.stats.unitsLost, unit.owner, 1);
  dropItemsFromDeadUnits(game, deadUnits);
  game.units = game.units.filter((unit) => unit.hp > 0);
  game.buildings = game.buildings.filter((building) => building.hp > 0);
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
  if (game.match.winner) return;
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

function separateUnitPair(game: Game, a: Unit, b: Unit) {
  const minDistance = a.radius + b.radius;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq >= minDistance * minDistance) return;
  const length = Math.hypot(dx, dy);
  const nx = length === 0 ? 1 : dx / length;
  const ny = length === 0 ? 0 : dy / length;
  const push = (minDistance - length) / 2;
  a.x = clamp(a.x - nx * push, 0, game.map.width);
  a.y = clamp(a.y - ny * push, 0, game.map.height);
  b.x = clamp(b.x + nx * push, 0, game.map.width);
  b.y = clamp(b.y + ny * push, 0, game.map.height);
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
  const radius = Math.ceil(range / index.cellSize);
  const bx = Math.floor(point.x / index.cellSize);
  const by = Math.floor(point.y / index.cellSize);
  for (let ox = -radius; ox <= radius; ox += 1) {
    for (let oy = -radius; oy <= radius; oy += 1) {
      const bucket = index.buckets.get(numericBucketKey(bx + ox, by + oy));
      if (!bucket) continue;
      for (const entity of bucket) visit(entity);
    }
  }
}

function moveToward(unit: Unit, x: number, y: number, map: GameMap) {
  const dx = x - unit.x;
  const dy = y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length <= unit.speed || length === 0) {
    unit.x = clamp(x, 0, map.width);
    unit.y = clamp(y, 0, map.height);
    return;
  }
  unit.x = clamp(unit.x + (dx / length) * unit.speed, 0, map.width);
  unit.y = clamp(unit.y + (dy / length) * unit.speed, 0, map.height);
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
