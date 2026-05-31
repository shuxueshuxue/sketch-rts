import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS } from "./catalog";
import type { Building, BuildingKind, GameCommand, GameSnapshot, PlayerId, ResourceNode, TrainableUnitKind, Unit } from "./types";

export type PresetAiPolicyOptions = {
  teams?: Partial<Record<PlayerId, string>>;
  version?: AiScriptVersion;
  disabledBehaviors?: AiBehaviorId[];
  telemetry?: AiTelemetry;
};

export type AiScriptVersion = "v1" | "v2";
export type AiBehaviorId = "earlyHarassment" | "skirmishPreservation" | "expansionFallback" | "economicCatchUp";
export type AiBehaviorStats = {
  attempts: number;
  workerRaidCommands: number;
  retreatCommands: number;
  disabledSkips: number;
  disadvantagedRetreats: number;
  woundedMeleeSaves: number;
  woundedRangedPullbacks: number;
  expansionFallbackRetreats: number;
  catchUpExpansions: number;
  catchUpTowers: number;
};
export type AiTelemetry = {
  behaviors: Record<AiBehaviorId, AiBehaviorStats>;
};

export type AiScript = {
  id: string;
  phase: "economy" | "tactics";
  run: LocalScript;
};

const BUILD_RANGE = 46;
const AUTO_ACQUIRE_RANGE = 230;
const ATTACK_MOVE_REDIRECT_DISTANCE = 240;

export const AI_SCRIPT_LIBRARY = {
  economy: { id: "economy", phase: "economy", run: planEconomy },
  constructionRecovery: { id: "constructionRecovery", phase: "economy", run: planConstructionRecovery },
  supply: { id: "supply", phase: "economy", run: planSupply },
  defense: { id: "defense", phase: "economy", run: planDefense },
  expansion: { id: "expansion", phase: "economy", run: planExpansion },
  economicCatchUp: { id: "economicCatchUp", phase: "economy", run: planEconomicCatchUp },
  productionBuilding: { id: "productionBuilding", phase: "economy", run: planProductionBuilding },
  mercenary: { id: "mercenary", phase: "economy", run: planMercenary },
  training: { id: "training", phase: "economy", run: planTraining },
  abilities: { id: "abilities", phase: "tactics", run: planAbilities },
  expansionFallback: { id: "expansionFallback", phase: "tactics", run: planExpansionFallback },
  skirmishPreservation: { id: "skirmishPreservation", phase: "tactics", run: planSkirmishPreservation },
  earlyHarassment: { id: "earlyHarassment", phase: "tactics", run: planEarlyHarassment },
  attackWave: { id: "attackWave", phase: "tactics", run: planAttackWave },
} satisfies Record<string, AiScript>;

// @@@bot-script-stack - Room AI slots and SDK-controlled human slots import this exact preset.
export const SKETCH_RTS_PRESET_AI_STACK: AiScript[] = [
  AI_SCRIPT_LIBRARY.economy,
  AI_SCRIPT_LIBRARY.constructionRecovery,
  AI_SCRIPT_LIBRARY.supply,
  AI_SCRIPT_LIBRARY.defense,
  AI_SCRIPT_LIBRARY.expansion,
  AI_SCRIPT_LIBRARY.productionBuilding,
  AI_SCRIPT_LIBRARY.mercenary,
  AI_SCRIPT_LIBRARY.training,
  AI_SCRIPT_LIBRARY.abilities,
  AI_SCRIPT_LIBRARY.attackWave,
];

export const AI_SCRIPT_VERSIONS: Record<AiScriptVersion, AiScript[]> = {
  v1: SKETCH_RTS_PRESET_AI_STACK,
  v2: [
    AI_SCRIPT_LIBRARY.economy,
    AI_SCRIPT_LIBRARY.constructionRecovery,
    AI_SCRIPT_LIBRARY.supply,
    AI_SCRIPT_LIBRARY.economicCatchUp,
    AI_SCRIPT_LIBRARY.productionBuilding,
    AI_SCRIPT_LIBRARY.expansion,
    AI_SCRIPT_LIBRARY.defense,
    AI_SCRIPT_LIBRARY.mercenary,
    AI_SCRIPT_LIBRARY.training,
    AI_SCRIPT_LIBRARY.expansionFallback,
    AI_SCRIPT_LIBRARY.skirmishPreservation,
    AI_SCRIPT_LIBRARY.earlyHarassment,
    AI_SCRIPT_LIBRARY.abilities,
    AI_SCRIPT_LIBRARY.attackWave,
  ],
};

export function createAiTelemetry(): AiTelemetry {
  return {
    behaviors: {
      earlyHarassment: emptyBehaviorStats(),
      skirmishPreservation: emptyBehaviorStats(),
      expansionFallback: emptyBehaviorStats(),
      economicCatchUp: emptyBehaviorStats(),
    },
  };
}

function emptyBehaviorStats(): AiBehaviorStats {
  return { attempts: 0, workerRaidCommands: 0, retreatCommands: 0, disabledSkips: 0, disadvantagedRetreats: 0, woundedMeleeSaves: 0, woundedRangedPullbacks: 0, expansionFallbackRetreats: 0, catchUpExpansions: 0, catchUpTowers: 0 };
}

export function planPresetAiCommands(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions = {}): GameCommand[] {
  return planAiCommandsFromScripts(snapshot, owner, AI_SCRIPT_VERSIONS[options.version ?? "v1"], options);
}

export function planAiCommandsFromScripts(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: PresetAiPolicyOptions = {}): GameCommand[] {
  if (!snapshot.players[owner] || snapshot.match.winner) return [];
  const commands: GameCommand[] = [];

  for (const script of scripts.filter((candidate) => candidate.phase === "economy")) {
    const result = script.run(snapshot, owner, options);
    const scriptCommands = asCommands(result);
    if (scriptCommands.length > 0) {
      commands.push(...scriptCommands);
      break;
    }
  }
  for (const script of scripts.filter((candidate) => candidate.phase === "tactics")) {
    commands.push(...asCommands(script.run(snapshot, owner, options)));
  }
  return commands;
}

type LocalScript = (snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) => GameCommand | GameCommand[] | undefined;

function asCommands(result: GameCommand | GameCommand[] | undefined) {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function planEconomy(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const idleWorkers = units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "idle" && !nearOwnIncompleteBuilding(snapshot, owner, unit));
  if (idleWorkers.length === 0) return undefined;
  const base = mainBase(snapshot, owner);
  const mine = nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), base);
  if (!mine) return undefined;
  return { type: "mine", unitIds: idleWorkers.map((worker) => worker.id), resourceId: mine.id };
}

function planConstructionRecovery(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const stalled = buildings(snapshot, owner).find((building) => !building.complete && !hasAssignedBuilder(snapshot, owner, building));
  if (!stalled) return undefined;
  const builder = availableBuilder(snapshot, owner, stalled);
  if (!builder) return undefined;
  return { type: "move", unitIds: [builder.id], x: stalled.x - ownerDirection(snapshot, owner) * 30, y: stalled.y };
}

function planSupply(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  const farms = buildings(snapshot, owner).filter((building) => building.kind === "farm");
  if (farms.some((building) => !building.complete)) return undefined;
  if (farms.length >= 7 || player.supplyCap - player.supplyUsed > 5 || player.gold < BUILDING_DEFS.farm.cost) return undefined;
  const base = mainBase(snapshot, owner);
  const builder = availableBuilder(snapshot, owner, base);
  if (!builder) return undefined;
  const direction = ownerDirection(snapshot, owner);
  return { type: "build", unitId: builder.id, buildingKind: "farm", x: base.x + direction * (70 + farms.length * 42), y: base.y + direction * (170 - farms.length * 36) };
}

function planExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (snapshot.resources.length <= activePlayerIds(snapshot).length) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return undefined;
  if (completeBuildings(snapshot, owner, "townHall").length >= 2) return undefined;

  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return undefined;

  const nearbyNeutral = snapshot.units.some((unit) => unit.owner === "neutral" && distance(unit, mine) < 280);
  if (nearbyNeutral) {
    const soldiers = combatUnits(snapshot, owner).filter((unit) => unit.order.type === "idle" || unit.order.type === "move");
    if (soldiers.length >= 4) return { type: "attackMove", unitIds: soldiers.map((unit) => unit.id), x: mine.x, y: mine.y };
    return undefined;
  }

  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.townHall.cost) return undefined;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return undefined;
  const builder = availableBuilder(snapshot, owner, mine);
  if (!builder) return undefined;
  const offset = expansionOffset(snapshot, owner);
  return { type: "build", unitId: builder.id, buildingKind: "townHall", x: mine.x + offset.x, y: mine.y + offset.y };
}

function planEconomicCatchUp(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (behaviorDisabled(options, "economicCatchUp")) {
    recordBehavior(options, "economicCatchUp", "disabledSkips");
    return undefined;
  }
  if (!opponentEconomyAhead(snapshot, owner, options)) return undefined;
  if (buildings(snapshot, owner).some((building) => !building.complete && (building.kind === "townHall" || building.kind === "defenseTower"))) return undefined;

  const exposedExpansion = unguardedExpansion(snapshot, owner);
  if (exposedExpansion && playerState(snapshot, owner).gold >= BUILDING_DEFS.defenseTower.cost) {
    const builder = availableBuilder(snapshot, owner, exposedExpansion);
    if (builder) {
      const point = towerPointFor(snapshot, owner, exposedExpansion, undefined);
      recordBehavior(options, "economicCatchUp", "attempts");
      recordBehavior(options, "economicCatchUp", "catchUpTowers");
      return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y };
    }
  }

  const mine = desiredCatchUpExpansionMine(snapshot, owner);
  if (!mine || playerState(snapshot, owner).gold < BUILDING_DEFS.townHall.cost || enemyPressure(snapshot, owner, mine, 360, options)) return undefined;
  const builder = availableBuilder(snapshot, owner, mine);
  if (!builder) return undefined;
  const offset = expansionOffset(snapshot, owner);
  recordBehavior(options, "economicCatchUp", "attempts");
  recordBehavior(options, "economicCatchUp", "catchUpExpansions");
  return { type: "build", unitId: builder.id, buildingKind: "townHall", x: mine.x + offset.x, y: mine.y + offset.y };
}

function planProductionBuilding(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  const plan = RACE_DEFS[player.race].productionPlan;
  const army = combatUnits(snapshot, owner);
  const armyGates = [0, 3, 6, 8, 11];
  const goldGates = [0, 700, 1000, 1300, 1600];
  const desired = plan.filter((_, index) => index === 0 || army.length >= armyGates[index]! || player.gold > goldGates[index]!);
  if (buildings(snapshot, owner).some((building) => !building.complete && building.kind !== "farm")) return undefined;

  const missing = desired.find((kind) => !buildings(snapshot, owner).some((building) => building.kind === kind));
  if (!missing || player.gold < BUILDING_DEFS[missing].cost) return undefined;
  const base = mainBase(snapshot, owner);
  const builder = availableBuilder(snapshot, owner, base);
  if (!builder) return undefined;
  const direction = ownerDirection(snapshot, owner);
  const index = desired.indexOf(missing);
  return { type: "build", unitId: builder.id, buildingKind: missing, x: base.x + direction * (120 + index * 82), y: base.y + direction * (100 - index * 66) };
}

function planDefense(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.defenseTower.cost) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return undefined;

  const bases = completeBuildings(snapshot, owner, "townHall");
  const towers = buildings(snapshot, owner).filter((building) => building.kind === "defenseTower");
  const hasCoreProduction = buildings(snapshot, owner).some((building) => isCoreProductionBuilding(building) && building.complete);
  if (towers.length >= bases.length + 1) return undefined;

  for (const base of bases) {
    const threat = nearestOpponentThreat(snapshot, owner, base, 680, options);
    const alreadyCovered = towers.some((tower) => distance(tower, base) < 430);
    const wantsExpansionGuard = hasCoreProduction && bases.length > 1 && player.gold > 900 && !alreadyCovered;
    if (!threat && !wantsExpansionGuard) continue;
    if (threat && alreadyCovered) continue;

    const builder = availableBuilder(snapshot, owner, base);
    if (!builder) continue;
    const point = towerPointFor(snapshot, owner, base, threat);
    return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y };
  }
  return undefined;
}

function planMercenary(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const camp = snapshot.mercenaryCamps[0];
  if (!camp || camp.stock <= 0 || camp.cooldownRemaining > 0) return undefined;
  const existing = units(snapshot, owner).filter((unit) => unit.kind === "mercenary").length;
  if (existing >= 2 || playerState(snapshot, owner).gold < camp.cost || !canSupply(snapshot, owner, camp.hireKind)) return undefined;
  return { type: "hire", campId: camp.id };
}

function planTraining(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  const workerCount = units(snapshot, owner).filter((unit) => unit.kind === "worker").length;
  const wantedWorkers = Math.min(12, 2 + completeBuildings(snapshot, owner, "townHall").length * 4);

  for (const building of buildings(snapshot, owner).filter((candidate) => candidate.complete && candidate.queue.length === 0)) {
    const unitKind = building.kind === "townHall" && workerCount + queuedUnitCount(snapshot, owner, "worker") < wantedWorkers ? "worker" : trainingChoice(snapshot, owner, building);
    if (unitKind && player.gold >= UNIT_DEFS[unitKind].cost && canSupply(snapshot, owner, unitKind)) {
      return { type: "train", buildingId: building.id, unitKind };
    }
  }
  return undefined;
}

function planAbilities(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands: GameCommand[] = [];
  for (const caster of units(snapshot, owner).filter((unit) => unit.cooldown === 0)) {
    const abilities = UNIT_DEFS[caster.kind].abilities;
    if (abilities.includes("heal")) {
      const target = units(snapshot, owner).find((unit) => unit.hp < unit.maxHp * 0.7 && distance(unit, caster) <= 220);
      if (target) {
        commands.push({ type: "cast", unitId: caster.id, ability: "heal", targetId: target.id });
        continue;
      }
    }
    if (abilities.includes("summon")) {
      const target = nearestEnemyUnit(snapshot, owner, caster, 240, options);
      const hasSpirit = units(snapshot, owner).some((unit) => unit.kind === "spirit" && distance(unit, caster) < 320);
      if (target && !hasSpirit) {
        commands.push({ type: "cast", unitId: caster.id, ability: "summon", x: caster.x + 54, y: caster.y + 28 });
        continue;
      }
    }
    if (abilities.includes("curse")) {
      const target = nearestEnemyUnit(snapshot, owner, caster, 260, options);
      if (target && !target.effects.some((effect) => effect.type === "curse")) commands.push({ type: "cast", unitId: caster.id, ability: "curse", targetId: target.id });
    }
  }
  return commands;
}

function planExpansionFallback(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (behaviorDisabled(options, "expansionFallback")) {
    recordBehavior(options, "expansionFallback", "disabledSkips");
    return undefined;
  }

  const townHalls = completeBuildings(snapshot, owner, "townHall");
  if (townHalls.length < 2) return undefined;

  const ownCombat = combatUnits(snapshot, owner);
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  for (const mine of ownedMiningLocations(snapshot, owner, townHalls)) {
    const anchor = nearestEntity(ownCombat.filter((unit) => distance(unit, mine) <= 620), mine);
    if (!anchor) continue;
    const allies = ownCombat.filter((unit) => distance(unit, anchor) <= 520);
    if (allies.length < 2) continue;
    const localEnemies = enemies.filter((unit) => distance(unit, anchor) <= 560);
    if (localEnemies.length < 2) continue;
    if (armyPower(localEnemies) <= armyPower(allies) * 1.35) continue;
    const nearestMineTownHall = nearestEntity(townHalls, mine);
    const fallback = nearestEntity(townHalls.filter((building) => building.id !== nearestMineTownHall?.id), mine);
    if (!fallback) continue;
    recordBehavior(options, "expansionFallback", "attempts");
    recordBehavior(options, "expansionFallback", "expansionFallbackRetreats");
    return { type: "move", unitIds: allies.map((unit) => unit.id), x: fallback.x, y: fallback.y };
  }
  return undefined;
}

function planSkirmishPreservation(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  if (behaviorDisabled(options, "skirmishPreservation")) {
    recordBehavior(options, "skirmishPreservation", "disabledSkips");
    return [];
  }

  const ownBase = mainBase(snapshot, owner);
  const ownCombat = combatUnits(snapshot, owner);
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  const commands: GameCommand[] = [];

  for (const unit of ownCombat) {
    if (unit.hp >= unit.maxHp * 0.36) continue;
    const nearbyEnemies = enemies.filter((enemy) => distance(enemy, unit) <= 380);
    if (nearbyEnemies.length === 0) continue;
    if (unit.attackRange > 100) {
      const pull = pullbackPoint(unit, ownBase, 0.36);
      commands.push({ type: "move", unitIds: [unit.id], x: pull.x, y: pull.y });
      recordBehavior(options, "skirmishPreservation", "woundedRangedPullbacks");
    } else {
      commands.push({ type: "move", unitIds: [unit.id], x: ownBase.x, y: ownBase.y });
      recordBehavior(options, "skirmishPreservation", "woundedMeleeSaves");
    }
  }
  if (commands.length > 0) return commands;

  const skirmish = localSkirmish(snapshot, owner, ownCombat, enemies, ownBase, options);
  if (!skirmish) return [];
  recordBehavior(options, "skirmishPreservation", "attempts");
  recordBehavior(options, "skirmishPreservation", "disadvantagedRetreats");
  return [{ type: "move", unitIds: skirmish.allies.map((unit) => unit.id), x: ownBase.x, y: ownBase.y }];
}

function planEarlyHarassment(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (behaviorDisabled(options, "earlyHarassment")) {
    recordBehavior(options, "earlyHarassment", "disabledSkips");
    return undefined;
  }

  const ownBase = mainBase(snapshot, owner);
  const enemyBase = nearestEnemyBase(snapshot, owner, ownBase, options);
  if (!enemyBase) return undefined;
  const enemyWorkers = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind === "worker" && distance(unit, enemyBase) <= 560);
  if (enemyWorkers.length === 0) return undefined;

  const soldiers = combatUnits(snapshot, owner).filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack");
  if (soldiers.length < 2 || soldiers.length > 4) return undefined;
  const harassers = nearestEntities(soldiers, enemyBase).slice(0, Math.min(2, soldiers.length));
  const harassCenter = averagePoint(harassers);
  const enemyDefenders = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, harassCenter) <= 520);
  const exposedWorker = nearestEntity(enemyWorkers, harassCenter);
  if (!exposedWorker) return undefined;

  // @@@v2-harass-semantics - Small raids hunt workers only while local defenders are weaker; otherwise they preserve the group.
  if (enemyDefenders.length > harassers.length + 1) {
    recordBehavior(options, "earlyHarassment", "attempts");
    recordBehavior(options, "earlyHarassment", "retreatCommands");
    return { type: "move", unitIds: harassers.map((unit) => unit.id), x: ownBase.x, y: ownBase.y };
  }
  if (enemyDefenders.length <= harassers.length) {
    recordBehavior(options, "earlyHarassment", "attempts");
    recordBehavior(options, "earlyHarassment", "workerRaidCommands");
    return { type: "attack", unitIds: harassers.map((unit) => unit.id), targetId: exposedWorker.id };
  }
  return undefined;
}

function planAttackWave(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const soldiers = combatUnits(snapshot, owner);
  const enemyArmy = snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  const movable = soldiers.filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove");

  const pressuredBuilding = mostPressuredAlliedBuilding(snapshot, owner, options);
  if (pressuredBuilding && soldiers.length >= 3) {
    const stale = staleAttackMovers(soldiers, pressuredBuilding);
    return stale.length > 0 ? { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: pressuredBuilding.x, y: pressuredBuilding.y } : undefined;
  }

  if (movable.length === 0) return undefined;

  const expansionMine = desiredExpansionMine(snapshot, owner);
  const needsExpansionClear =
    expansionMine &&
    completeBuildings(snapshot, owner, "townHall").length < 2 &&
    snapshot.units.some((unit) => unit.owner === "neutral" && distance(unit, expansionMine) < 280);
  if (needsExpansionClear) {
    const stale = staleAttackMovers(movable, expansionMine);
    return soldiers.length >= 4 && stale.length > 0 ? { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: expansionMine.x, y: expansionMine.y } : undefined;
  }

  if (soldiers.length < 5 && !(soldiers.length > 0 && enemyArmy.length <= 2)) return undefined;

  const objective = nearestOpponentObjective(snapshot, owner, averagePoint(soldiers), options);
  const point = wavePointFor(snapshot, owner, soldiers, objective);
  const stale = staleAttackMovers(movable, point);
  return stale.length > 0 ? { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: point.x, y: point.y } : undefined;
}

function mostPressuredAlliedBuilding(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): Building | undefined {
  const candidates = alliedBuildings(snapshot, owner, options).filter((building) => building.complete);
  if (candidates.length === 0) return undefined;
  const pressures = new Map<string, number>();
  const pressureRangeSq = 620 * 620;
  for (const unit of snapshot.units) {
    if (!isOpponentOwner(snapshot, owner, unit.owner, options)) continue;
    for (const building of candidates) {
      if (distanceSquared(unit, building) < pressureRangeSq) pressures.set(building.id, (pressures.get(building.id) ?? 0) + 1);
    }
  }

  let best: { building: Building; pressure: number } | undefined;
  for (const building of candidates) {
    const pressure = pressures.get(building.id) ?? 0;
    if (pressure < 5 && !(pressure >= 2 && building.hp < building.maxHp * 0.75)) continue;
    if (!best || pressuredBuildingBeats(owner, building, pressure, best.building, best.pressure)) best = { building, pressure };
  }
  return best?.building;
}

function pressuredBuildingBeats(owner: PlayerId, candidate: Building, candidatePressure: number, current: Building, currentPressure: number) {
  const candidateOwn = candidate.owner === owner;
  const currentOwn = current.owner === owner;
  if (candidateOwn !== currentOwn) return candidateOwn;
  if (candidatePressure !== currentPressure) return candidatePressure > currentPressure;
  return candidate.kind === "townHall" && current.kind !== "townHall";
}

function alliedBuildings(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const ownTeam = teamFor(snapshot, owner, options);
  return snapshot.buildings.filter((building) => teamFor(snapshot, building.owner, options) === ownTeam);
}

function staleAttackMovers(units: Unit[], point: Point) {
  return units.filter((unit) => unit.order.type !== "attackMove" || distance(unit.order, point) > ATTACK_MOVE_REDIRECT_DISTANCE);
}

function trainingChoice(snapshot: GameSnapshot, owner: PlayerId, building: Building): TrainableUnitKind | undefined {
  const player = playerState(snapshot, owner);
  if (building.kind === "barracks") return soldierChoice(snapshot, owner);
  if (building.kind === "archeryRange") return "archer";
  if (building.kind === "stables") {
    const knights = units(snapshot, owner).filter((unit) => unit.kind === "knight").length;
    const raiders = units(snapshot, owner).filter((unit) => unit.kind === "raider").length;
    if (player.race === "ember" && raiders < 3) return "raider";
    return knights < 2 && player.gold > 900 ? "knight" : "raider";
  }
  if (building.kind === "sanctum") {
    const priests = units(snapshot, owner).filter((unit) => unit.kind === "priest").length;
    const summoners = units(snapshot, owner).filter((unit) => unit.kind === "summoner").length;
    const witches = units(snapshot, owner).filter((unit) => unit.kind === "witch").length;
    if (player.race === "ember") {
      if (witches < 1) return "witch";
      if (summoners < 1) return "summoner";
      if (priests < 1) return "priest";
      return "witch";
    }
    if (priests < 1) return "priest";
    if (summoners < 1) return "summoner";
    if (witches < 1) return "witch";
    return "priest";
  }
  if (building.kind === "workshop") return "golem";
  return undefined;
}

function soldierChoice(snapshot: GameSnapshot, owner: PlayerId): TrainableUnitKind {
  const player = playerState(snapshot, owner);
  const army = combatUnits(snapshot, owner);
  const footmen = army.filter((unit) => unit.kind === "footman").length;
  const lancers = army.filter((unit) => unit.kind === "lancer").length;
  if (player.race === "ember") {
    if (lancers < 3) return "lancer";
    return footmen <= lancers - 2 ? "footman" : "lancer";
  }
  if (footmen < 2) return "footman";
  if (lancers < Math.ceil(footmen / 2)) return "lancer";
  return "footman";
}

function desiredExpansionMine(snapshot: GameSnapshot, owner: PlayerId) {
  const townHalls = completeBuildings(snapshot, owner, "townHall");
  const base = mainBase(snapshot, owner);
  return snapshot.resources
    .filter((resource) => resource.amount > 0)
    .filter((resource) => townHalls.every((townHall) => distance(resource, townHall) > 520))
    .filter((resource) => snapshot.buildings.every((building) => building.kind !== "townHall" || distance(resource, building) > 340))
    .sort((a, b) => distance(a, base) - distance(b, base))[0];
}

function desiredCatchUpExpansionMine(snapshot: GameSnapshot, owner: PlayerId) {
  const townHalls = completeBuildings(snapshot, owner, "townHall");
  const base = mainBase(snapshot, owner);
  return snapshot.resources
    .filter((resource) => resource.amount > 0)
    .filter((resource) => townHalls.every((townHall) => distance(resource, townHall) > 520))
    .filter((resource) => snapshot.buildings.every((building) => building.kind !== "townHall" || distance(resource, building) > 340))
    .sort((a, b) => distance(a, base) - distance(b, base))[0];
}

function unguardedExpansion(snapshot: GameSnapshot, owner: PlayerId) {
  const bases = completeBuildings(snapshot, owner, "townHall");
  const main = mainBase(snapshot, owner);
  const towers = buildings(snapshot, owner).filter((building) => building.kind === "defenseTower");
  return bases
    .filter((base) => distance(base, main) > 500)
    .find((base) => !towers.some((tower) => distance(tower, base) < 430));
}

function opponentEconomyAhead(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const ownBases = completeBuildings(snapshot, owner, "townHall").length;
  const enemyOwners = activePlayerIds(snapshot).filter((candidate) => isOpponentOwner(snapshot, owner, candidate, options));
  const enemyBases = enemyOwners.reduce((total, candidate) => total + completeBuildings(snapshot, candidate, "townHall").length, 0);
  if (enemyBases > ownBases) return true;
  const ownWorkers = units(snapshot, owner).filter((unit) => unit.kind === "worker").length;
  const enemyWorkers = enemyOwners.reduce((total, candidate) => total + units(snapshot, candidate).filter((unit) => unit.kind === "worker").length, 0);
  return enemyWorkers >= ownWorkers + 4;
}

function nearestOpponentObjective(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions): Point {
  const nonBase = snapshot.buildings.filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind !== "townHall");
  const nearestNonBase = nearestEntity(nonBase, from);
  if (nearestNonBase) return nearestNonBase;
  const base = nearestEntity(snapshot.buildings.filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind === "townHall"), from);
  if (base) return base;
  const army = snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  return army.length > 0 ? averagePoint(army) : fallbackBase(snapshot, owner);
}

function nearestEnemyBase(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions) {
  return nearestEntity(snapshot.buildings.filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind === "townHall" && building.complete), from);
}

function ownedMiningLocations(snapshot: GameSnapshot, owner: PlayerId, townHalls: Building[]) {
  return snapshot.resources.filter((resource) => resource.amount > 0 && townHalls.some((townHall) => townHall.owner === owner && distance(resource, townHall) <= 620));
}

function localSkirmish(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], ownBase: Point, options: PresetAiPolicyOptions): { allies: Unit[]; enemies: Unit[] } | undefined {
  const enemyBase = nearestEnemyBase(snapshot, owner, ownBase, options);
  for (const anchor of ownCombat) {
    if (distance(anchor, ownBase) < 700 || (enemyBase && distance(anchor, enemyBase) < 700)) continue;
    const allies = ownCombat.filter((unit) => distance(unit, anchor) <= 520);
    if (allies.length < 2) continue;
    const localEnemies = enemies.filter((unit) => distance(unit, anchor) <= 560);
    if (localEnemies.length < 2) continue;
    if (armyPower(localEnemies) <= armyPower(allies) * 1.35) continue;
    return { allies, enemies: localEnemies };
  }
  return undefined;
}

function armyPower(units: Unit[]) {
  return units.reduce((total, unit) => total + Math.max(1, unit.hp / Math.max(1, unit.maxHp)) * (1 + unit.attackDamage / 18 + unit.attackRange / 260), 0);
}

function pullbackPoint(unit: Unit, ownBase: Point, amount: number): Point {
  return {
    x: unit.x + (ownBase.x - unit.x) * amount,
    y: unit.y + (ownBase.y - unit.y) * amount,
  };
}

function wavePointFor(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], objective: Point): Point {
  const average = averagePoint(soldiers);
  const dx = average.x - objective.x;
  const dy = average.y - objective.y;
  const length = Math.hypot(dx, dy);
  if (length > 900) {
    return {
      x: clamp(objective.x + (dx / length) * 760, 0, snapshot.map.width),
      y: clamp(objective.y + (dy / length) * 760, 0, snapshot.map.height),
    };
  }
  return { x: clamp(objective.x, 0, snapshot.map.width), y: clamp(objective.y, 0, snapshot.map.height) };
}

function enemyPressure(snapshot: GameSnapshot, owner: PlayerId, point: Point, range: number, options: PresetAiPolicyOptions) {
  return snapshot.units.some((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && distance(unit, point) <= range);
}

function nearestOpponentThreat(snapshot: GameSnapshot, owner: PlayerId, point: Point, range: number, options: PresetAiPolicyOptions): Unit | Building | undefined {
  return nearestEntity(
    [
      ...snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && distance(unit, point) <= range),
      ...snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options) && distance(building, point) <= range),
    ],
    point,
  );
}

function towerPointFor(snapshot: GameSnapshot, owner: PlayerId, base: Building, threat: Point | undefined): Point {
  if (threat) {
    const dx = threat.x - base.x;
    const dy = threat.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: clamp(base.x - (dx / length) * 150, 0, snapshot.map.width),
      y: clamp(base.y - (dy / length) * 150, 0, snapshot.map.height),
    };
  }
  const direction = ownerDirection(snapshot, owner);
  return {
    x: clamp(base.x + direction * 150, 0, snapshot.map.width),
    y: clamp(base.y + direction * 120, 0, snapshot.map.height),
  };
}

function availableBuilder(snapshot: GameSnapshot, owner: PlayerId, point: Point) {
  return units(snapshot, owner)
    .filter((unit) => unit.kind === "worker")
    .filter((unit) => !isReservedBuilder(snapshot, owner, unit))
    .sort((a, b) => distance(a, point) - distance(b, point))[0];
}

function isReservedBuilder(snapshot: GameSnapshot, owner: PlayerId, worker: Unit) {
  if (worker.order.type !== "move") return false;
  return buildings(snapshot, owner).some((building) => !building.complete && distance(worker.order as Point, building) <= BUILD_RANGE + 40);
}

function hasAssignedBuilder(snapshot: GameSnapshot, owner: PlayerId, building: Building) {
  return units(snapshot, owner).some(
    (unit) =>
      unit.kind === "worker" &&
      (distance(unit, building) <= BUILD_RANGE + 20 || (unit.order.type === "move" && distance(unit.order, building) <= BUILD_RANGE + 40)),
  );
}

function nearOwnIncompleteBuilding(snapshot: GameSnapshot, owner: PlayerId, worker: Unit) {
  return buildings(snapshot, owner).some((building) => !building.complete && distance(worker, building) <= BUILD_RANGE + 35);
}

function mainBase(snapshot: GameSnapshot, owner: PlayerId) {
  return completeBuildings(snapshot, owner, "townHall")[0] ?? fallbackBase(snapshot, owner);
}

function fallbackBase(snapshot: GameSnapshot, owner: PlayerId): Point {
  const start = units(snapshot, owner)[0] ?? buildings(snapshot, owner)[0];
  if (start) return { x: start.x, y: start.y };
  return { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
}

function expansionOffset(snapshot: GameSnapshot, owner: PlayerId): Point {
  const direction = ownerDirection(snapshot, owner);
  return { x: -direction * 90, y: direction > 0 ? -70 : 70 };
}

function ownerDirection(snapshot: GameSnapshot, owner: PlayerId) {
  return mainBaseX(snapshot, owner) < snapshot.map.width / 2 ? 1 : -1;
}

function mainBaseX(snapshot: GameSnapshot, owner: PlayerId) {
  const base = completeBuildings(snapshot, owner, "townHall")[0] ?? buildings(snapshot, owner)[0] ?? units(snapshot, owner)[0];
  return base?.x ?? snapshot.map.width / 2;
}

function canSupply(snapshot: GameSnapshot, owner: PlayerId, unitKind: keyof typeof UNIT_DEFS) {
  return projectedSupplyUsed(snapshot, owner) + UNIT_DEFS[unitKind].supplyUsed <= playerState(snapshot, owner).supplyCap;
}

function playerState(snapshot: GameSnapshot, owner: PlayerId) {
  const player = snapshot.players[owner];
  if (!player) throw new Error(`Unknown player ${owner}`);
  return player;
}

function projectedSupplyUsed(snapshot: GameSnapshot, owner: PlayerId) {
  const queued = buildings(snapshot, owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  return units(snapshot, owner).reduce((total, unit) => total + UNIT_DEFS[unit.kind].supplyUsed, 0) + queued;
}

function queuedUnitCount(snapshot: GameSnapshot, owner: PlayerId, unitKind: TrainableUnitKind) {
  return buildings(snapshot, owner)
    .flatMap((building) => building.queue)
    .filter((job) => job.unitKind === unitKind).length;
}

function nearestEnemyUnit(snapshot: GameSnapshot, owner: PlayerId, from: Point, range: number, options: PresetAiPolicyOptions) {
  return nearestEntity(snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && distance(unit, from) <= range), from);
}

function isEnemyOwner(snapshot: GameSnapshot, owner: PlayerId, other: string, options: PresetAiPolicyOptions) {
  if (other === "neutral") return true;
  return isOpponentOwner(snapshot, owner, other, options);
}

function isOpponentOwner(snapshot: GameSnapshot, owner: PlayerId, other: string, options: PresetAiPolicyOptions) {
  if (other === "neutral") return false;
  return teamFor(snapshot, owner, options) !== teamFor(snapshot, other, options);
}

function isCoreProductionBuilding(building: Building) {
  return building.kind !== "townHall" && building.kind !== "farm" && building.kind !== "defenseTower";
}

function teamFor(snapshot: GameSnapshot, owner: string, options: PresetAiPolicyOptions) {
  return options.teams?.[owner] ?? (snapshot.players[owner] ? owner : "neutral");
}

function activePlayerIds(snapshot: GameSnapshot) {
  return Object.keys(snapshot.players).filter((owner) => snapshot.units.some((unit) => unit.owner === owner) || snapshot.buildings.some((building) => building.owner === owner));
}

function combatUnits(snapshot: GameSnapshot, owner: PlayerId) {
  return units(snapshot, owner).filter((unit) => unit.kind !== "worker");
}

function completeBuildings(snapshot: GameSnapshot, owner: PlayerId, kind: BuildingKind) {
  return buildings(snapshot, owner).filter((building) => building.kind === kind && building.complete);
}

function buildings(snapshot: GameSnapshot, owner: PlayerId) {
  return snapshot.buildings.filter((building) => building.owner === owner);
}

function units(snapshot: GameSnapshot, owner: PlayerId) {
  return snapshot.units.filter((unit) => unit.owner === owner);
}

function nearestResource(resources: ResourceNode[], from: Point) {
  return nearestEntity(resources, from);
}

function nearestEntity<T extends Point>(entities: T[], from: Point): T | undefined {
  return entities.sort((a, b) => distance(a, from) - distance(b, from))[0];
}

function nearestEntities<T extends Point>(entities: T[], from: Point): T[] {
  return [...entities].sort((a, b) => distance(a, from) - distance(b, from));
}

function averagePoint(points: Point[]): Point {
  return points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }), { x: 0, y: 0 });
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceSquared(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function behaviorDisabled(options: PresetAiPolicyOptions, behavior: AiBehaviorId) {
  return options.disabledBehaviors?.includes(behavior) ?? false;
}

function recordBehavior(options: PresetAiPolicyOptions, behavior: AiBehaviorId, stat: keyof AiBehaviorStats) {
  if (!options.telemetry) return;
  options.telemetry.behaviors[behavior][stat] += 1;
}

type Point = { x: number; y: number };
