import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";
import {
  createBuilding,
  createInitialBuildings,
  createInitialMercenaryCamps,
  createInitialResources,
  createInitialUnits,
  createUnit,
  createMap,
  DEFAULT_MAP_ID,
  trainTimeFor,
} from "./map";
import type { AbilityKind, Building, GameCommand, GameMap, GameSetupOptions, GameSnapshot, MapId, MatchState, Owner, PlayerId, PlayerNumberMap, PlayerState, PlayerStateMap, ScenarioOverride, TrainableUnitKind, Unit, UnitKind, WorldEffect } from "./types";

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
const GOLD_PER_TRIP = 70;
const GATHER_TICKS = 70;
const AUTO_ACQUIRE_RANGE = 230;
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
    players: Object.fromEntries(
      [...new Set([...activePlayers, "player", "enemy", "enemy2"])].map((owner, index) => [
        owner,
        { race: options.races?.[owner] ?? DEFAULT_RACES[owner] ?? (index % 2 === 0 ? "grove" : "ember"), gold: owner === "player" ? 500 : 620, supplyUsed: 0, supplyCap: 0 },
      ]),
    ) as PlayerStateMap,
    units: createInitialUnits(mapId, activePlayers),
    buildings: createInitialBuildings(activePlayers, mapId),
    resources: createInitialResources(mapId, activePlayers),
    mercenaryCamps: createInitialMercenaryCamps(mapId),
    effects: [],
    nextId: RUNTIME_ID_START,
    activePlayers,
    teams,
    spawnUnit(owner: Unit["owner"], kind: UnitKind, x: number, y: number) {
      const unit = createUnit(`unit-${owner}-${kind}-${this.nextId}`, owner, kind, x, y);
      this.nextId += 1;
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
    },
  };
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
  const ids = new Set([
    ...game.units.map((unit) => unit.id),
    ...game.buildings.map((building) => building.id),
    ...game.resources.map((resource) => resource.id),
    ...game.mercenaryCamps.map((camp) => camp.id),
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
  for (const seed of scenario.addUnits ?? []) {
    claimId(seed.id);
    const unit = createUnit(seed.id, seed.owner, seed.kind, seed.x, seed.y);
    if (seed.hp !== undefined) {
      if (!Number.isFinite(seed.hp) || seed.hp <= 0 || seed.hp > unit.maxHp) throw new Error(`Invalid scenario hp for ${seed.id}`);
      unit.hp = seed.hp;
    }
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

  if (command.type === "build") {
    const worker = game.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) throw new Error(`Unknown ${owner} worker ${command.unitId}`);
    spendGold(game, owner, BUILDING_DEFS[command.buildingKind].cost);
    const building = createBuilding(`building-${owner}-${command.buildingKind}-${game.nextId}`, owner, command.buildingKind, command.x, command.y, false);
    game.nextId += 1;
    game.buildings.push(building);
    worker.order = { type: "move", x: command.x - BUILD_RANGE + 10, y: command.y };
    addEffect(game, "build", command.x, command.y, 60);
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
  updateMercenaryCamps(game);
  game.unitSpatial = createSpatialIndex(game.units, 320);
  game.unitSpatialByTeam = createTeamSpatialIndexes(game, game.units, 230);
  if (!game.buildingSpatial || game.buildingSpatialCount !== game.buildings.length) {
    game.buildingSpatial = createSpatialIndex(game.buildings, 420);
    game.buildingSpatialByTeam = createTeamSpatialIndexes(game, game.buildings, 260);
    game.buildingSpatialCount = game.buildings.length;
  }
  game.entityById = createEntityIndex(game);
  updateTowerAttacks(game);
  updateUnits(game);
  separateUnits(game);
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
      },
    },
    map: game.map,
    players: Object.fromEntries(Object.entries(game.players).map(([owner, player]) => [owner, { ...player }])) as PlayerStateMap,
    units: game.units.map((unit) => ({ ...unit, order: { ...unit.order } })),
    buildings: game.buildings.map((building) => ({ ...building, queue: building.queue.map((job) => ({ ...job })) })),
    resources: game.resources.map((resource) => ({ ...resource })),
    mercenaryCamps: game.mercenaryCamps.map((camp) => ({ ...camp })),
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
    unit.order = { type: "move", x: building.rallyX, y: building.rallyY };
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

function updateMercenaryCamps(game: Game) {
  for (const camp of game.mercenaryCamps) {
    camp.cooldownRemaining = Math.max(0, camp.cooldownRemaining - 1);
  }
}

function updateUnits(game: Game) {
  for (const unit of game.units) {
    unit.cooldown = Math.max(0, unit.cooldown - 1);
    if (unit.order.type === "move") {
      moveToward(unit, unit.order.x, unit.order.y, game.map);
      if (distance(unit, unit.order) < 5) unit.order = { type: "idle" };
      continue;
    }
    if (unit.order.type === "attackMove") {
      updateAttackMoveOrder(game, unit);
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
    unit.order = { ...order, phase: "gather", timer: GATHER_TICKS };
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
    playerState(game, unit.owner).gold += unit.carryingGold;
  }
  unit.carryingGold = 0;
  unit.order = { type: "mine", resourceId: resource.id, phase: "toMine", timer: 0 };
}

function queueTraining(game: Game, building: Building, unitKind: TrainableUnitKind) {
  if (!building.complete) throw new Error(`Cannot train from incomplete ${building.kind}`);
  if (!BUILDING_DEFS[building.kind].trains.includes(unitKind)) throw new Error(`${building.kind} cannot train ${unitKind}`);
  if (projectedSupplyUsed(game, building.owner) + UNIT_DEFS[unitKind].supplyUsed > playerState(game, building.owner).supplyCap) {
    throw new Error(`Need more supply to train ${unitKind}`);
  }
  spendGold(game, building.owner, UNIT_DEFS[unitKind].cost);
  building.queue.push({ unitKind, remaining: trainTimeFor(unitKind) });
  updateSupplyState(game);
}

function hireMercenary(game: Game, owner: PlayerId, campId: string) {
  const camp = game.mercenaryCamps.find((candidate) => candidate.id === campId);
  if (!camp) throw new Error(`Unknown mercenary camp ${campId}`);
  if (camp.stock <= 0) throw new Error(`${camp.id} has no mercenary stock`);
  if (camp.cooldownRemaining > 0) throw new Error(`${camp.id} is restocking`);
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
  spirit.order = { type: "idle" };
  caster.cooldown = 220;
  addEffect(game, "summon", x, y, 50);
}

function applyCurse(game: Game, caster: Unit, target: Unit) {
  if (distance(caster, target) > 280) return;
  target.effects = target.effects.filter((effect) => effect.type !== "curse");
  target.effects.push({ type: "curse", remaining: 360 });
  caster.cooldown = 150;
  addEffect(game, "curse", target.x, target.y, 46);
}

function updateWorldEffects(game: Game) {
  for (const effect of game.effects) effect.remaining -= 1;
  game.effects = game.effects.filter((effect) => effect.remaining > 0);
}

function updateUnitStatusEffects(game: Game) {
  for (const unit of game.units) {
    for (const effect of unit.effects) effect.remaining -= 1;
    unit.effects = unit.effects.filter((effect) => effect.remaining > 0);
  }
}

function applyAttackDamage(game: Game, attacker: Unit | Building, target: Unit | Building, damage: number, attackRange: number) {
  const hpBefore = target.hp;
  target.hp -= damage;
  if (hpBefore > 0 && target.hp <= 0) {
    recordKill(game, attacker, target);
  }
  const from = { x: attacker.x, y: attacker.y };
  const to = { x: target.x, y: target.y };
  const kind: WorldEffect["type"] = attackRange > 90 ? "projectile" : "melee";
  addEffect(game, kind, to.x, to.y, kind === "projectile" ? 22 : 16, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
  addEffect(game, "hit", to.x, to.y, 14);
}

function recordKill(game: Game, attacker: Unit | Building, target: Unit | Building) {
  const attackerOwner = attacker.owner;
  if (isPlayerId(attackerOwner) || attackerOwner === "neutral") {
    incrementStat(game.match.stats.unitsKilled, attackerOwner, isUnit(target) ? 1 : 0);
  }
  if (isUnit(attacker) && isUnit(target)) {
    attacker.kills += 1;
    awardKillXp(game, attacker, target);
    if (isPlayerId(attacker.owner) && attacker.kind === "mercenary" && areEnemyOwners(game, attacker.owner, target.owner)) {
      incrementStat(game.match.stats.mercenaryKills, attacker.owner, 1);
    }
    if (isPlayerId(attacker.owner) && target.owner === "neutral") {
      incrementStat(game.match.stats.neutralUnitsKilled, attacker.owner, 1);
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
  vectors?: Pick<WorldEffect, "fromX" | "fromY" | "toX" | "toY">,
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
  if (attacker.level === 1 && attacker.xp >= 20) {
    attacker.level = 2;
    attacker.maxHp += Math.min(12, Math.ceil(UNIT_DEFS[attacker.kind].hp * 0.07));
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + 10);
    attacker.attackDamage += 1;
  }
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
  return targetPriorityBase(target) - distancePenalty;
}

function targetPriorityBase(target: Unit | Building) {
  if (isUnit(target)) return target.kind === "worker" ? 260 : 430;
  if (target.kind === "defenseTower") return 360;
  if (target.kind === "townHall") return 120;
  return 220;
}

function findTarget(game: Game, targetId: string): Unit | Building | undefined {
  return game.entityById?.get(targetId) ?? game.units.find((unit) => unit.id === targetId) ?? game.buildings.find((building) => building.id === targetId);
}

function removeDead(game: Game) {
  const deadUnits = game.units.filter((unit) => unit.hp <= 0);
  const deadBuildings = game.buildings.filter((building) => building.hp <= 0);
  for (const unit of deadUnits) incrementStat(game.match.stats.unitsLost, unit.owner, 1);
  game.units = game.units.filter((unit) => unit.hp > 0);
  game.buildings = game.buildings.filter((building) => building.hp > 0);
  if (deadUnits.length > 0 || deadBuildings.length > 0) updateSupplyState(game);
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
  fallback: T[],
  point: { x: number; y: number },
  range: number,
  visit: (entity: T) => void,
) {
  if (!index) {
    for (const entity of fallback) visit(entity);
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
