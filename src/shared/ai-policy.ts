import { BUILDING_DEFS, MAX_UPGRADE_LEVEL, MERCENARY_HIRE_RANGE, UNIT_DEFS, UPGRADE_DEFS, XP_STAR_THRESHOLDS } from "./catalog";
import type { Building, BuildingKind, GameCommand, GameSnapshot, MercenaryCamp, MercenaryUnitKind, PlayerId, ResourceNode, TrainableUnitKind, Unit, UpgradeKind } from "./types";

type ProductionBuildingKind = Exclude<BuildingKind, "townHall" | "farm" | "defenseTower" | "moonWell">;

type AiPlaybook = {
  productionPlan: ProductionBuildingKind[];
  barracksUnits: TrainableUnitKind[];
  stablesUnits: TrainableUnitKind[];
  sanctumUnits: TrainableUnitKind[];
};

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
  rangedKites: number;
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

export type AiCommandEntry = {
  scriptId: string;
  command: GameCommand;
};

const BUILD_RANGE = 46;
const AUTO_ACQUIRE_RANGE = 230;
const ATTACK_MOVE_REDIRECT_DISTANCE = 240;
const SUPPLY_BUILDING_LIMIT = 15;
const AI_PLAYBOOK: AiPlaybook = {
  productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
  barracksUnits: ["footman", "lancer"],
  stablesUnits: ["knight", "raider"],
  sanctumUnits: ["priest", "summoner", "witch"],
};

export const AI_SCRIPT_LIBRARY = {
  economy: { id: "economy", phase: "economy", run: planEconomy },
  constructionRecovery: { id: "constructionRecovery", phase: "economy", run: planConstructionRecovery },
  emergencyDefense: { id: "emergencyDefense", phase: "economy", run: planEmergencyDefense },
  supply: { id: "supply", phase: "economy", run: planSupply },
  defense: { id: "defense", phase: "economy", run: planDefense },
  expansion: { id: "expansion", phase: "economy", run: planExpansion },
  economicCatchUp: { id: "economicCatchUp", phase: "economy", run: planEconomicCatchUp },
  earlyTech: { id: "earlyTech", phase: "economy", run: planEarlyTech },
  productionBuilding: { id: "productionBuilding", phase: "economy", run: planProductionBuilding },
  tech: { id: "tech", phase: "economy", run: planTech },
  healingWell: { id: "healingWell", phase: "economy", run: planHealingWell },
  mercenary: { id: "mercenary", phase: "economy", run: planMercenary },
  training: { id: "training", phase: "economy", run: planTraining },
  items: { id: "items", phase: "tactics", run: planItems },
  abilities: { id: "abilities", phase: "tactics", run: planAbilities },
  focusFire: { id: "focusFire", phase: "tactics", run: planFocusFire },
  expansionFallback: { id: "expansionFallback", phase: "tactics", run: planExpansionFallback },
  skirmishPreservation: { id: "skirmishPreservation", phase: "tactics", run: planSkirmishPreservation },
  earlyHarassment: { id: "earlyHarassment", phase: "tactics", run: planEarlyHarassment },
  expansionDenial: { id: "expansionDenial", phase: "tactics", run: planExpansionDenial },
  objectiveControl: { id: "objectiveControl", phase: "tactics", run: planObjectiveControl },
  workerDefense: { id: "workerDefense", phase: "tactics", run: planWorkerDefense },
  attackWave: { id: "attackWave", phase: "tactics", run: planAttackWave },
} satisfies Record<string, AiScript>;

// @@@bot-script-stack - Room AI slots and SDK-controlled human slots import this exact preset.
export const SKETCH_RTS_PRESET_AI_STACK: AiScript[] = [
  AI_SCRIPT_LIBRARY.economy,
  AI_SCRIPT_LIBRARY.constructionRecovery,
  AI_SCRIPT_LIBRARY.emergencyDefense,
  AI_SCRIPT_LIBRARY.supply,
  AI_SCRIPT_LIBRARY.defense,
  AI_SCRIPT_LIBRARY.healingWell,
  AI_SCRIPT_LIBRARY.mercenary,
  AI_SCRIPT_LIBRARY.expansion,
  AI_SCRIPT_LIBRARY.productionBuilding,
  AI_SCRIPT_LIBRARY.tech,
  AI_SCRIPT_LIBRARY.training,
  AI_SCRIPT_LIBRARY.items,
  AI_SCRIPT_LIBRARY.abilities,
  AI_SCRIPT_LIBRARY.objectiveControl,
  AI_SCRIPT_LIBRARY.workerDefense,
  AI_SCRIPT_LIBRARY.attackWave,
];

export const AI_SCRIPT_VERSIONS: Record<AiScriptVersion, AiScript[]> = {
  v1: SKETCH_RTS_PRESET_AI_STACK,
  v2: [
    AI_SCRIPT_LIBRARY.economy,
    AI_SCRIPT_LIBRARY.constructionRecovery,
    AI_SCRIPT_LIBRARY.emergencyDefense,
    AI_SCRIPT_LIBRARY.supply,
    AI_SCRIPT_LIBRARY.earlyTech,
    AI_SCRIPT_LIBRARY.economicCatchUp,
    AI_SCRIPT_LIBRARY.mercenary,
    AI_SCRIPT_LIBRARY.productionBuilding,
    AI_SCRIPT_LIBRARY.expansion,
    AI_SCRIPT_LIBRARY.tech,
    AI_SCRIPT_LIBRARY.defense,
    AI_SCRIPT_LIBRARY.healingWell,
    AI_SCRIPT_LIBRARY.training,
    AI_SCRIPT_LIBRARY.expansionFallback,
    AI_SCRIPT_LIBRARY.skirmishPreservation,
    AI_SCRIPT_LIBRARY.earlyHarassment,
    AI_SCRIPT_LIBRARY.items,
    AI_SCRIPT_LIBRARY.abilities,
    AI_SCRIPT_LIBRARY.focusFire,
    AI_SCRIPT_LIBRARY.expansionDenial,
    AI_SCRIPT_LIBRARY.objectiveControl,
    AI_SCRIPT_LIBRARY.workerDefense,
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
  return { attempts: 0, workerRaidCommands: 0, retreatCommands: 0, disabledSkips: 0, disadvantagedRetreats: 0, woundedMeleeSaves: 0, woundedRangedPullbacks: 0, rangedKites: 0, expansionFallbackRetreats: 0, catchUpExpansions: 0, catchUpTowers: 0 };
}

export function planPresetAiCommands(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions = {}): GameCommand[] {
  return planPresetAiCommandEntries(snapshot, owner, options).map((entry) => entry.command);
}

export function planPresetAiCommandEntries(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions = {}): AiCommandEntry[] {
  return planAiCommandEntriesFromScripts(snapshot, owner, AI_SCRIPT_VERSIONS[options.version ?? "v1"], options);
}

export function planAiCommandsFromScripts(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: PresetAiPolicyOptions = {}): GameCommand[] {
  return planAiCommandEntriesFromScripts(snapshot, owner, scripts, options).map((entry) => entry.command);
}

export function planAiCommandEntriesFromScripts(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: PresetAiPolicyOptions = {}): AiCommandEntry[] {
  if (!snapshot.players[owner] || snapshot.match.winner) return [];
  const commands: AiCommandEntry[] = [];
  const movedUnitIds = new Set<string>();

  for (const script of scripts.filter((candidate) => candidate.phase === "economy")) {
    const result = script.run(snapshot, owner, options);
    const scriptCommands = asCommands(result);
    if (scriptCommands.length > 0) {
      commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
      reserveOrderedUnits(scriptCommands, movedUnitIds);
      if (script.id === "economy") continue;
      break;
    }
  }
  for (const script of scripts.filter((candidate) => candidate.phase === "tactics")) {
    const scriptCommands = removeOrderedUnitConflicts(asCommands(script.run(snapshot, owner, options)), movedUnitIds, groupAttackMoveMinimum(script.id, snapshot, owner, options));
    reserveOrderedUnits(scriptCommands, movedUnitIds);
    commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
  }
  return commands;
}

type LocalScript = (snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) => GameCommand | GameCommand[] | undefined;

function asCommands(result: GameCommand | GameCommand[] | undefined): GameCommand[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function removeOrderedUnitConflicts(commands: GameCommand[], movedUnitIds: Set<string>, minimumAttackMoveUnits: number): GameCommand[] {
  if (movedUnitIds.size === 0) return commands;
  const filtered: GameCommand[] = [];
  for (const command of commands) {
    if (command.type === "attack") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else if (command.type === "attackMove") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length >= minimumAttackMoveUnits) filtered.push({ ...command, unitIds });
    } else if (command.type === "move") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else {
      filtered.push(command);
    }
  }
  return filtered;
}

function reserveOrderedUnits(commands: GameCommand[], movedUnitIds: Set<string>) {
  for (const command of commands) {
    if (command.type === "move" || command.type === "attackMove" || command.type === "attack") for (const unitId of command.unitIds) movedUnitIds.add(unitId);
  }
}

function groupAttackMoveMinimum(scriptId: string, snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (scriptId === "objectiveControl") return objectiveControlMinimumArmy(snapshot, owner, options);
  if (scriptId === "expansionDenial") return 5;
  if (scriptId === "expansion") return 4;
  if (scriptId === "attackWave") return 5;
  return 1;
}

function planEconomy(snapshot: GameSnapshot, owner: PlayerId): GameCommand | undefined {
  const workers = units(snapshot, owner).filter((unit) => unit.kind === "worker" && !nearOwnIncompleteBuilding(snapshot, owner, unit));
  if (workers.length === 0) return undefined;
  const assignmentCounts = mineAssignmentCounts(workers);
  const idleWorkers = workers.filter((unit) => unit.order.type === "idle");
  const oversaturatedWorkers = workers.filter((unit) => unit.order.type === "mine" && (assignmentCounts.get(unit.order.resourceId) ?? 0) > 5);
  const bases = completeBuildings(snapshot, owner, "townHall");
  const assignableWorkers = [...idleWorkers, ...oversaturatedWorkers];

  for (const base of bases) {
    const mine = nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), base);
    if (!mine || (assignmentCounts.get(mine.id) ?? 0) > 0) continue;
    const worker = nearestEntity(
      assignableWorkers.filter((candidate) => candidate.order.type !== "mine" || candidate.order.resourceId !== mine.id),
      base,
    );
    if (worker) return { type: "mine", unitIds: [worker.id], resourceId: mine.id };
  }

  for (const base of bases) {
    const mine = nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), base);
    if (!mine) continue;
    const assigned = assignmentCounts.get(mine.id) ?? 0;
    if (assigned >= 5) continue;
    const candidates = nearestEntities(
      assignableWorkers.filter((worker) => worker.order.type !== "mine" || worker.order.resourceId !== mine.id),
      base,
    );
    const selected = candidates.slice(0, 5 - assigned);
    if (selected.length > 0) return { type: "mine", unitIds: selected.map((worker) => worker.id), resourceId: mine.id };
  }

  if (idleWorkers.length === 0) return undefined;
  const mine = nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), mainBase(snapshot, owner));
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

function planSupply(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  const farms = buildings(snapshot, owner).filter((building) => building.kind === "farm");
  if (farms.some((building) => !building.complete)) return undefined;
  if (farms.length >= SUPPLY_BUILDING_LIMIT || player.supplyCap - player.supplyUsed > 5 || player.gold < BUILDING_DEFS.farm.cost) return undefined;
  if (needsMainGuardTower(snapshot, owner, options) && player.gold >= BUILDING_DEFS.defenseTower.cost) return undefined;
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.farm.cost) return undefined;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + BUILDING_DEFS.farm.cost) return undefined;
  const base = mainBase(snapshot, owner);
  const builder = availableBuilder(snapshot, owner, base);
  if (!builder) return undefined;
  const point = safeMainBuildPoint(snapshot, owner, farms.length + 4);
  return { type: "build", unitId: builder.id, buildingKind: "farm", x: point.x, y: point.y };
}

function planExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (snapshot.resources.length <= activePlayerIds(snapshot).length) return undefined;
  if (missingCombatProductionKind(snapshot, owner)) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return undefined;
  if (activeMiningBaseCount(snapshot, owner) >= expansionBaseTarget(options)) return undefined;

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

  const main = completeBuildings(snapshot, owner, "townHall")[0];
  if (!main) return undefined;
  if (needsMainGuardTower(snapshot, owner, options) && playerState(snapshot, owner).gold >= BUILDING_DEFS.defenseTower.cost) {
    const builder = availableBuilder(snapshot, owner, main);
    if (builder) {
      const point = towerPointFor(snapshot, owner, main, undefined);
      recordBehavior(options, "economicCatchUp", "attempts");
      recordBehavior(options, "economicCatchUp", "catchUpTowers");
      return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y };
    }
  }
  const missingProduction = missingCombatProductionKind(snapshot, owner);
  const mainThreat = nearestOpponentThreat(snapshot, owner, main, 680, options);
  if (options.version === "v2" && missingProduction && hasCoreProduction(snapshot, owner) && completeBuildings(snapshot, owner, "townHall").length === 1 && combatUnits(snapshot, owner).length >= 4) {
    const mine = desiredCatchUpExpansionMine(snapshot, owner);
    if (mine && playerState(snapshot, owner).gold >= BUILDING_DEFS.townHall.cost && !enemyPressure(snapshot, owner, mine, 360, options)) {
      const builder = availableBuilder(snapshot, owner, mine);
      if (builder) {
        const offset = expansionOffset(snapshot, owner);
        recordBehavior(options, "economicCatchUp", "attempts");
        recordBehavior(options, "economicCatchUp", "catchUpExpansions");
        return { type: "build", unitId: builder.id, buildingKind: "townHall", x: mine.x + offset.x, y: mine.y + offset.y };
      }
    }
  }
  if (missingProduction && !mainThreat) return undefined;
  if (missingProduction) return undefined;

  if (shouldPrioritizeCatchUpExpansionBeforeMacro(snapshot, owner, options)) {
    return catchUpExpansionCommand(snapshot, owner, options);
  }

  if (needsDuplicateCoreProduction(snapshot, owner, options)) return undefined;
  if (shouldReserveForClearedExpansion(snapshot, owner, options)) {
    return playerState(snapshot, owner).gold >= BUILDING_DEFS.townHall.cost ? catchUpExpansionCommand(snapshot, owner, options) : undefined;
  }

  const mainGuarded = buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430);
  const hasAnyCoreProduction = buildings(snapshot, owner).some((building) => isCoreProductionBuilding(building) && building.complete);
  if (shouldReserveForExpansion(snapshot, owner, options)) return undefined;
  if (options.version === "v2" && hasAnyCoreProduction && combatUnits(snapshot, owner).length >= 2 && !mainGuarded && opponentPlayerIds(snapshot, owner, options).length >= 2 && playerState(snapshot, owner).gold >= BUILDING_DEFS.defenseTower.cost) {
    const builder = availableBuilder(snapshot, owner, main);
    if (builder) {
      const point = towerPointFor(snapshot, owner, main, undefined);
      recordBehavior(options, "economicCatchUp", "attempts");
      recordBehavior(options, "economicCatchUp", "catchUpTowers");
      return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y };
    }
  }

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

  return catchUpExpansionCommand(snapshot, owner, options);
}

function planProductionBuilding(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const missing = nextProductionBuildingKind(snapshot, owner, options);
  if (!missing) return undefined;
  if (shouldFinishCoreArmyBeforeMoreProduction(snapshot, owner, options)) return undefined;
  const player = playerState(snapshot, owner);
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS[missing].cost) return undefined;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + BUILDING_DEFS[missing].cost) return undefined;
  if (shouldReserveForExpansion(snapshot, owner, options) && player.gold < BUILDING_DEFS.townHall.cost + BUILDING_DEFS[missing].cost) return undefined;
  const base = mainBase(snapshot, owner);
  const builder = availableBuilder(snapshot, owner, base);
  if (!builder) return undefined;
  const index = aiPlaybook().productionPlan.indexOf(missing);
  const point = safeMainBuildPoint(snapshot, owner, index);
  return { type: "build", unitId: builder.id, buildingKind: missing, x: point.x, y: point.y };
}

function planEmergencyDefense(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const ownCombat = combatUnits(snapshot, owner);
  if (playerState(snapshot, owner).gold < BUILDING_DEFS.defenseTower.cost) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return undefined;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return undefined;
  const threat = nearestOpponentThreat(snapshot, owner, main, 1_200, options);
  if (!threat) return undefined;
  const threatenedEnemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, main) <= 1_200);
  const underTwoSidedPressure = new Set(threatenedEnemies.map((unit) => unit.owner)).size >= 2 && armyPower(threatenedEnemies) > armyPower(ownCombat) * 1.15;
  if (ownCombat.length < 5 && !underTwoSidedPressure) return undefined;
  const builder = availableBuilder(snapshot, owner, main);
  if (!builder) return undefined;
  const point = towerPointFor(snapshot, owner, main as Building, threat);
  return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y };
}

function planTech(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const upgradeKind = nextUpgradeKind(snapshot, owner, options);
  if (!upgradeKind) return undefined;
  if (upgradeKind !== "weaponTraining" && missingCombatProductionKind(snapshot, owner)) return undefined;
  const level = nextUpgradeLevelDef(snapshot, owner, upgradeKind);
  if (!level) return undefined;
  const player = playerState(snapshot, owner);
  if (player.gold < level.cost) return undefined;
  if (needsMainGuardTower(snapshot, owner, options)) return undefined;
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + level.cost) return undefined;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + level.cost) return undefined;
  const reserveClearedExpansion = shouldReserveForClearedExpansion(snapshot, owner, options);
  if ((reserveClearedExpansion || !isV2PriorityWeaponTiming(snapshot, owner, upgradeKind, options)) && shouldReserveForExpansion(snapshot, owner, options) && player.gold < BUILDING_DEFS.townHall.cost + level.cost) return undefined;
  const building = researchBuilding(snapshot, owner, upgradeKind);
  if (!building) return undefined;
  return { type: "research", buildingId: building.id, upgradeKind };
}

function planEarlyTech(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const upgradeKind = nextUpgradeKind(snapshot, owner, options);
  if (!upgradeKind || !isV2PriorityWeaponTiming(snapshot, owner, upgradeKind, options)) return undefined;
  const level = nextUpgradeLevelDef(snapshot, owner, upgradeKind);
  if (!level) return undefined;
  const missingProduction = productionBuildingNeedKind(snapshot, owner, options);
  if (missingProduction && !desiredMissingProductionKind(snapshot, owner)) return undefined;
  if (missingProduction && playerState(snapshot, owner).gold >= BUILDING_DEFS[missingProduction].cost + level.cost) return undefined;
  return planTech(snapshot, owner, options);
}

function isV2PriorityWeaponTiming(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || upgradeKind !== "weaponTraining") return false;
  const currentLevel = upgradeLevel(snapshot, owner, "weaponTraining");
  const weaponUnits = upgradeBenefitingUnits(snapshot, owner, "weaponTraining");
  if (currentLevel === 0) return weaponUnits.length >= 2;
  if (currentLevel >= MAX_UPGRADE_LEVEL) return false;
  return completeBuildings(snapshot, owner, "townHall").length >= 2 && weaponUnits.length >= 7 + currentLevel;
}

function nextUpgradeKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): UpgradeKind | undefined {
  if (upgradeAvailable(snapshot, owner, "weaponTraining")) {
    const weaponUnits = upgradeBenefitingUnits(snapshot, owner, "weaponTraining");
    const level = upgradeLevel(snapshot, owner, "weaponTraining");
    if (options.version === "v2" && level === 0 && weaponUnits.length >= 2) return "weaponTraining";
    if (weaponUnits.length >= 5 + level * 3 || playerState(snapshot, owner).gold > 780 + level * 360) return "weaponTraining";
  }
  if (upgradeAvailable(snapshot, owner, "reinforcedPlating")) {
    if (upgradeLevel(snapshot, owner, "weaponTraining") < 1) return undefined;
    const platingUnits = upgradeBenefitingUnits(snapshot, owner, "reinforcedPlating");
    const level = upgradeLevel(snapshot, owner, "reinforcedPlating");
    if (platingUnits.length >= (options.version === "v2" ? 8 : 11) + level * 3 || playerState(snapshot, owner).gold > 1_020 + level * 420) return "reinforcedPlating";
  }
  return undefined;
}

function upgradeBenefitingUnits(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind) {
  const affected = new Set<string>(UPGRADE_DEFS[upgradeKind].affectedUnitKinds);
  return units(snapshot, owner).filter((unit) => affected.has(unit.kind));
}

function upgradeAvailable(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind) {
  if (upgradeLevel(snapshot, owner, upgradeKind) >= MAX_UPGRADE_LEVEL) return false;
  return !buildings(snapshot, owner).some((building) => building.researchQueue.some((job) => job.upgradeKind === upgradeKind));
}

function upgradeLevel(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind) {
  return playerState(snapshot, owner).upgrades[upgradeKind] ?? 0;
}

function nextUpgradeLevelDef(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind) {
  return UPGRADE_DEFS[upgradeKind].levels[upgradeLevel(snapshot, owner, upgradeKind)];
}

function researchBuilding(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind) {
  const upgrade = UPGRADE_DEFS[upgradeKind];
  return buildings(snapshot, owner).find(
    (building) =>
      building.complete &&
      building.kind === upgrade.buildingKind &&
      building.researchQueue.length === 0 &&
      BUILDING_DEFS[building.kind].researches.includes(upgradeKind),
  );
}

function nextProductionBuildingKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  const missing = productionBuildingNeedKind(snapshot, owner, options);
  if (!missing || playerState(snapshot, owner).gold < BUILDING_DEFS[missing].cost) return undefined;
  return missing;
}

function productionBuildingNeedKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  return desiredMissingProductionKind(snapshot, owner) ?? duplicateCoreProductionKind(snapshot, owner, options);
}

function desiredMissingProductionKind(snapshot: GameSnapshot, owner: PlayerId): ProductionBuildingKind | undefined {
  const player = playerState(snapshot, owner);
  const plan = aiPlaybook().productionPlan;
  const army = combatUnits(snapshot, owner);
  const armyGates = [0, 3, 6, 8, 11];
  const goldGates = [0, 420, 620, 820, 1040];
  const desired = plan.filter((_, index) => index === 0 || army.length >= armyGates[index]! || player.gold > goldGates[index]!);
  if (buildings(snapshot, owner).some((building) => !building.complete && building.kind !== "farm" && building.kind !== "moonWell")) return undefined;

  const missing = desired.find((kind) => !buildings(snapshot, owner).some((building) => building.kind === kind));
  return missing;
}

function missingCombatProductionKind(snapshot: GameSnapshot, owner: PlayerId): ProductionBuildingKind | undefined {
  const requiredCombatChain = aiPlaybook().productionPlan.slice(0, 3);
  return requiredCombatChain.find((kind) => !buildings(snapshot, owner).some((building) => building.kind === kind && building.complete));
}

function needsDuplicateCoreProduction(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  return Boolean(duplicateCoreProductionKind(snapshot, owner, options));
}

function duplicateCoreProductionKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  if (desiredMissingProductionKind(snapshot, owner)) return undefined;
  const noExpansionMap = isOneBaseNoExpansionPressure(snapshot, owner);
  if (!noExpansionMap && completeBuildings(snapshot, owner, "townHall").length < 2) return undefined;
  const minimumWorkers = noExpansionMap ? 5 : 9;
  const minimumCombat = noExpansionMap ? 2 : 6;
  if (units(snapshot, owner).filter((unit) => unit.kind === "worker").length < minimumWorkers || combatUnits(snapshot, owner).length < minimumCombat) return undefined;
  if (buildings(snapshot, owner).some((building) => !building.complete && isCoreProductionBuilding(building))) return undefined;
  const candidates: ProductionBuildingKind[] = ["barracks", "archeryRange", "stables"];
  const counts = new Map(candidates.map((kind) => [kind, buildings(snapshot, owner).filter((building) => building.kind === kind).length]));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total >= (noExpansionMap ? 3 : 6)) return undefined;
  return candidates.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0];
}

function shouldFinishCoreArmyBeforeMoreProduction(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const missing = productionBuildingNeedKind(snapshot, owner, options);
  if (!missing) return false;
  const ownCombat = combatUnits(snapshot, owner);
  return (
    options.version === "v2" &&
    opponentPlayerIds(snapshot, owner, options).length >= 2 &&
    hasCoreProduction(snapshot, owner) &&
    units(snapshot, owner).filter((unit) => unit.kind === "worker").length >= 5 &&
    ownCombat.length < 2
  );
}

function isNoExpansionMap(snapshot: GameSnapshot) {
  return snapshot.resources.filter((resource) => resource.amount > 0).length <= activePlayerIds(snapshot).length;
}

function isOneBaseNoExpansionPressure(snapshot: GameSnapshot, owner: PlayerId) {
  return isNoExpansionMap(snapshot) && completeBuildings(snapshot, owner, "townHall").length <= 1;
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
    const wantsExpansionGuard = hasCoreProduction && bases.length > 1 && player.gold > 460 && !alreadyCovered;
    if (!threat && !wantsExpansionGuard) continue;
    if (threat && alreadyCovered) continue;

    const builder = availableBuilder(snapshot, owner, base);
    if (!builder) continue;
    const point = towerPointFor(snapshot, owner, base, threat);
    return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y };
  }
  return undefined;
}

function planHealingWell(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.moonWell.cost) return undefined;
  if (!hasCoreProduction(snapshot, owner)) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "moonWell" && !building.complete)) return undefined;

  const main = mainBase(snapshot, owner);
  const wellsNearMain = buildings(snapshot, owner).filter((building) => building.kind === "moonWell" && distance(building, main) < 520).length;
  const desiredWells = completeBuildings(snapshot, owner, "townHall").length >= 2 && combatUnits(snapshot, owner).length >= 8 ? 2 : 1;
  if (wellsNearMain >= desiredWells) return undefined;

  const ownCombat = combatUnits(snapshot, owner);
  const woundedDefenders = ownCombat.filter((unit) => unit.hp < unit.maxHp * 0.72 && distance(unit, main) <= 720);
  const pressured = healingWellPressure(snapshot, owner, main, options);
  const wantsWell = woundedDefenders.length >= 2 || (options.version === "v2" && pressured && ownCombat.some((unit) => unit.hp < unit.maxHp * 0.86));
  if (!wantsWell) return undefined;
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.moonWell.cost) return undefined;
  if (!pressured && shouldReserveForExpansion(snapshot, owner, options) && player.gold < BUILDING_DEFS.townHall.cost + BUILDING_DEFS.moonWell.cost) return undefined;

  const builder = availableBuilder(snapshot, owner, main);
  if (!builder) return undefined;
  const point = healingWellPointFor(snapshot, owner, main);
  return { type: "build", unitId: builder.id, buildingKind: "moonWell", x: point.x, y: point.y };
}

function planMercenary(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  const candidates = snapshot.mercenaryCamps
    .filter((camp) => camp.stock > 0 && camp.cooldownRemaining === 0)
    .filter((camp) => neutralGuardsNear(snapshot, camp, 260).length === 0)
    .filter((camp) => hiredMercenaryCount(snapshot, owner, camp.hireKind) < mercenaryRoleLimit(camp.hireKind))
    .filter((camp) => player.gold >= camp.cost && canSupply(snapshot, owner, camp.hireKind))
    .filter((camp) => !shouldReserveForHealingWell(snapshot, owner, options) || player.gold >= BUILDING_DEFS.moonWell.cost + camp.cost)
    .filter((camp) => !shouldReserveForExpansion(snapshot, owner, options) || player.gold >= BUILDING_DEFS.townHall.cost + camp.cost || shouldSpendExpansionReserveOnControlledMercenary(snapshot, owner, camp, options));
  const camp = candidates.sort((a, b) => mercenaryCampScore(b, snapshot, owner, options) - mercenaryCampScore(a, snapshot, owner, options))[0];
  if (!camp) return undefined;
  if (friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0) return moveToMercenaryCamp(snapshot, owner, camp, options);
  return { type: "hire", campId: camp.id };
}

function moveToMercenaryCamp(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (mainBaseNeedsObjectivePause(snapshot, owner, options)) return undefined;
  const squad = combatUnits(snapshot, owner).filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove");
  if (squad.length === 0) return undefined;
  const movers = staleAttackMovers(squad, camp);
  const claimants = movers.length > 0 ? movers : squad.filter((unit) => unit.order.type === "attackMove" && distance(unit.order, camp) <= ATTACK_MOVE_REDIRECT_DISTANCE);
  return claimants.length > 0 ? { type: "attackMove", unitIds: claimants.map((unit) => unit.id), x: camp.x, y: camp.y } : undefined;
}

function shouldSpendExpansionReserveOnControlledMercenary(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (!shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  if (friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0) return false;
  return camp.hireKind !== "fieldMedic" || units(snapshot, owner).some((unit) => unit.kind !== "worker" && unit.hp < unit.maxHp * 0.72);
}

function mercenaryCampScore(camp: MercenaryCamp, snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const army = combatUnits(snapshot, owner);
  const anchor = army.length > 0 ? averagePoint(army) : mainBase(snapshot, owner);
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  const wounded = units(snapshot, owner).some((unit) => unit.kind !== "worker" && unit.hp < unit.maxHp * 0.72);
  const outnumbered = armyPower(enemies) > armyPower(army) * 1.2;
  const hasCombatMercenary = units(snapshot, owner).some((unit) => unit.kind === "mercenary" || unit.kind === "contractArcher");
  const firstCombatBonus = hasCombatMercenary ? 0 : camp.hireKind === "fieldMedic" ? -70 : 72;
  const roleBonus =
    camp.hireKind === "fieldMedic" ? (wounded ? 90 : 34) : camp.hireKind === "contractArcher" ? (outnumbered ? 76 : 44) : 38;
  return roleBonus + firstCombatBonus - distance(camp, anchor) / 18 - hiredMercenaryCount(snapshot, owner, camp.hireKind) * 24;
}

function hiredMercenaryCount(snapshot: GameSnapshot, owner: PlayerId, kind: MercenaryUnitKind) {
  return units(snapshot, owner).filter((unit) => unit.kind === kind).length;
}

function friendlyUnitsAtMercenaryCamp(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp) {
  return units(snapshot, owner).filter((unit) => distance(unit, camp) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE);
}

function mercenaryRoleLimit(kind: MercenaryUnitKind) {
  if (kind === "fieldMedic") return 2;
  if (kind === "contractArcher") return 3;
  return 2;
}

function planTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const player = playerState(snapshot, owner);
  const workerCount = units(snapshot, owner).filter((unit) => unit.kind === "worker").length;
  const routineWantedWorkers = routineWorkerCount(snapshot, owner);
  const cheapWorkerRecovery = needsCheapWorkerRecovery(snapshot, owner, options);
  const wantedWorkers = cheapWorkerRecovery ? Math.max(routineWantedWorkers, 8) : routineWantedWorkers;
  const needsCoreArmy = shouldFinishCoreArmyBeforeMoreProduction(snapshot, owner, options);
  const missingProduction = needsCoreArmy ? undefined : productionBuildingNeedKind(snapshot, owner, options);
  const reserveMainGuardTower = needsMainGuardTower(snapshot, owner, options);
  const reserveEmergencyTower = shouldReserveForEmergencyTower(snapshot, owner, options);
  const reserveHealingWell = shouldReserveForHealingWell(snapshot, owner, options);
  const commands: GameCommand[] = [];
  let remainingGold = player.gold;
  let reservedSupply = projectedSupplyUsed(snapshot, owner);
  let queuedWorkers = queuedUnitCount(snapshot, owner, "worker");

  for (const building of buildings(snapshot, owner).filter((candidate) => candidate.complete && candidate.queue.length === 0)) {
    const projectedWorkers = workerCount + queuedWorkers;
    const needsRoutineWorker = !needsCoreArmy && projectedWorkers < routineWantedWorkers;
    const needsRecoveryWorker = cheapWorkerRecovery && projectedWorkers >= routineWantedWorkers && projectedWorkers < wantedWorkers;
    const needsWorker = building.kind === "townHall" && (needsRoutineWorker || needsRecoveryWorker);
    const unitKind = needsWorker ? "worker" : trainingChoice(snapshot, owner, building);
    if (!unitKind) continue;
    const cost = UNIT_DEFS[unitKind].cost;
    const nearTowerMoney = remainingGold >= BUILDING_DEFS.defenseTower.cost - 10;
    const reserveSensitive = unitKind !== "worker" || !cheapWorkerRecovery || ((reserveMainGuardTower || reserveEmergencyTower) && nearTowerMoney);
    if (reserveSensitive && missingProduction && remainingGold < BUILDING_DEFS[missingProduction].cost + cost) continue;
    if (reserveSensitive && reserveMainGuardTower && remainingGold < BUILDING_DEFS.defenseTower.cost + cost) continue;
    if (reserveSensitive && reserveEmergencyTower && remainingGold < BUILDING_DEFS.defenseTower.cost + cost) continue;
    if (reserveSensitive && reserveHealingWell && remainingGold < BUILDING_DEFS.moonWell.cost + cost) continue;
    if (reserveSensitive && shouldReserveForExpansion(snapshot, owner, options) && remainingGold < BUILDING_DEFS.townHall.cost + cost) continue;
    if (remainingGold < cost || reservedSupply + UNIT_DEFS[unitKind].supplyUsed > player.supplyCap) continue;
    commands.push({ type: "train", buildingId: building.id, unitKind });
    remainingGold -= cost;
    reservedSupply += UNIT_DEFS[unitKind].supplyUsed;
    if (unitKind === "worker") queuedWorkers += 1;
  }
  return commands;
}

function routineWorkerCount(snapshot: GameSnapshot, owner: PlayerId) {
  return Math.min(12, 2 + completeBuildings(snapshot, owner, "townHall").length * 4);
}

function needsCheapWorkerRecovery(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const player = playerState(snapshot, owner);
  if (player.gold < UNIT_DEFS.worker.cost) return false;
  if (combatUnits(snapshot, owner).length >= 2) return false;
  const main = mainBase(snapshot, owner);
  return snapshot.units.some((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, main) <= 900);
}

function planItems(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands: GameCommand[] = [];
  const ownUnits = units(snapshot, owner);
  const ownCombat = ownUnits.filter((unit) => unit.kind !== "worker");
  const ownUnitIds = new Set(ownUnits.map((unit) => unit.id));

  for (const item of snapshot.items.filter((candidate) => candidate.carrierId && candidate.cooldownRemaining === 0 && ownUnitIds.has(candidate.carrierId))) {
    const carrier = ownUnits.find((unit) => unit.id === item.carrierId);
    if (!carrier) continue;
    const command = itemUseCommand(snapshot, owner, carrier, item, options);
    if (command) commands.push(command);
  }

  const groundItems = snapshot.items.filter((item) => !item.carrierId);
  for (const item of nearestEntities(groundItems, mainBase(snapshot, owner))) {
    const carrier = bestItemCarrier(snapshot, owner, item, options);
    if (!carrier) continue;
    commands.push({ type: "pickupItem", unitId: carrier.id, itemId: item.id });
    if (commands.length >= Math.max(1, Math.min(2, ownCombat.length))) break;
  }
  return commands;
}

function itemUseCommand(snapshot: GameSnapshot, owner: PlayerId, carrier: Unit, item: GameSnapshot["items"][number], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (item.kind === "experienceBook") return { type: "useItem", unitId: carrier.id, itemId: item.id };
  if (item.kind === "guardianScroll") {
    const allies = combatUnits(snapshot, owner).filter((unit) => distance(unit, carrier) <= 260);
    const enemies = snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && distance(unit, carrier) <= 300);
    return allies.length >= 4 && enemies.length >= 3 ? { type: "useItem", unitId: carrier.id, itemId: item.id } : undefined;
  }
  const range = item.kind === "stormStaff" ? 320 : 280;
  const target = nearestEntity(snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && distance(unit, carrier) <= range), carrier);
  if (!target) return undefined;
  if (item.kind === "stormStaff") return { type: "useItem", unitId: carrier.id, itemId: item.id, x: target.x, y: target.y };
  if (item.kind === "lightningRod") return { type: "useItem", unitId: carrier.id, itemId: item.id, targetId: target.id };
  return undefined;
}

function bestItemCarrier(snapshot: GameSnapshot, owner: PlayerId, item: GameSnapshot["items"][number], options: PresetAiPolicyOptions): Unit | undefined {
  const occupiedCarrierIds = new Set(snapshot.items.flatMap((candidate) => (candidate.carrierId ? [candidate.carrierId] : [])));
  return units(snapshot, owner)
    .filter((unit) => unit.kind !== "worker")
    .filter((unit) => !occupiedCarrierIds.has(unit.id))
    .filter((unit) => distance(unit, item) <= 72)
    .sort((a, b) => itemCarrierScore(b, item, options) - itemCarrierScore(a, item, options))[0];
}

function itemCarrierScore(unit: Unit, item: GameSnapshot["items"][number], options: PresetAiPolicyOptions) {
  const health = unit.hp / Math.max(1, unit.maxHp);
  const melee = unit.attackRange <= 80 ? 1 : 0;
  const ranged = unit.attackRange > 100 ? 1 : 0;
  const star = unit.level;
  const durable = unit.maxHp / 100;
  const v2Bonus = options.version === "v2" ? 1 : 0;
  if (item.kind === "flameCloak") return durable * 7 + melee * 18 + star * (6 + v2Bonus * 4) + health * 5 - unit.attackRange / 80;
  if (item.kind === "experienceBook") return experienceBookCarrierScore(unit, durable);
  if (item.kind === "lightningRod" || item.kind === "stormStaff") return ranged * 14 + unit.attackRange / 14 + star * 3 + health * 3;
  if (item.kind === "guardianScroll") return durable * 6 + melee * 6 + health * 5;
  return 0;
}

function experienceBookCarrierScore(unit: Unit, durable: number) {
  if (unit.level >= MAX_UPGRADE_LEVEL) return -10_000 + unit.attackDamage * 0.1;
  const nextThreshold = XP_STAR_THRESHOLDS[unit.level] ?? Number.POSITIVE_INFINITY;
  const xpNeeded = Math.max(0, nextThreshold - unit.xp);
  const bookXp = 160;
  const willLevel = xpNeeded <= bookXp ? 1 : 0;
  return willLevel * 90 + Math.max(0, bookXp - xpNeeded) * 0.4 + unit.attackDamage * 1.2 + durable * 2;
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

function planFocusFire(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  const fighters = combatUnits(snapshot, owner).filter((unit) => unit.hp >= unit.maxHp * 0.36);
  if (fighters.length < 2) return undefined;
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  const candidates = enemies.filter((enemy) => fighters.some((fighter) => distance(fighter, enemy) <= focusFireJoinRange(fighter)));
  const target = candidates.sort((a, b) => focusFireTargetScore(b, fighters) - focusFireTargetScore(a, fighters))[0];
  if (!target) return undefined;
  const attackers = fighters.filter((fighter) => distance(fighter, target) <= focusFireJoinRange(fighter));
  return attackers.length >= 2 ? { type: "attack", unitIds: attackers.map((unit) => unit.id), targetId: target.id } : undefined;
}

function focusFireJoinRange(unit: Unit) {
  return unit.attackRange + (unit.attackRange > 100 ? 80 : 95);
}

function focusFireTargetScore(unit: Unit, fighters: Unit[]) {
  const center = averagePoint(fighters);
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 5 + (unit.attackRange > 100 ? 28 : 0);
  return missingHp * 2.4 + threat - distance(unit, center) * 0.18;
}

function planObjectiveControl(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version === "v2" && (mainBaseNeedsObjectivePause(snapshot, owner, options) || ownedBaseNeedsObjectivePause(snapshot, owner, options))) return undefined;
  const army = combatUnits(snapshot, owner).filter((unit) => (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove") && objectiveReadyUnit(snapshot, owner, unit, options));
  const minimumArmy = objectiveControlMinimumArmy(snapshot, owner, options);
  if (army.length < minimumArmy) return undefined;
  if (options.version === "v2" && armyCommittedToEnemyObjective(snapshot, owner, army, minimumArmy, options)) return undefined;
  const anchor = averagePoint(army);
  const maxObjectiveDistance = options.version === "v2" ? 1_450 : 900;
  const requiredPowerRatio = options.version === "v2" ? 1.05 : 1.15;
  const mercenaryTarget = snapshot.mercenaryCamps
    .map((camp) => ({ camp, guards: neutralGuardsNear(snapshot, camp, 280) }))
    .filter((candidate) => candidate.guards.length > 0)
    .filter((candidate) => distance(candidate.camp, anchor) <= maxObjectiveDistance)
    .filter((candidate) => armyPower(army) >= armyPower(candidate.guards) * requiredPowerRatio)
    .sort((a, b) => objectiveCampScore(b.camp, b.guards, anchor) - objectiveCampScore(a.camp, a.guards, anchor))[0];
  const target = mercenaryTarget ? { point: mercenaryTarget.camp } : neutralCampObjective(snapshot, army, anchor, maxObjectiveDistance, requiredPowerRatio);
  if (!target) return undefined;
  const stale = staleAttackMovers(army, target.point);
  return stale.length >= minimumArmy ? { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: target.point.x, y: target.point.y } : undefined;
}

function objectiveReadyUnit(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return true;
  if (unit.hp >= unit.maxHp * 0.58 || unit.order.type !== "move") return true;
  const main = mainBase(snapshot, owner);
  return distance(unit.order, main) >= distance(unit, main);
}

function armyCommittedToEnemyObjective(snapshot: GameSnapshot, owner: PlayerId, army: Unit[], minimumArmy: number, options: PresetAiPolicyOptions) {
  const committed = army.filter((unit) => unit.order.type === "attackMove" && attackMoveTargetsEnemyObjective(snapshot, owner, unit.order, options));
  return committed.length >= minimumArmy;
}

function attackMoveTargetsEnemyObjective(snapshot: GameSnapshot, owner: PlayerId, point: Point, options: PresetAiPolicyOptions) {
  return snapshot.buildings.some(
    (building) =>
      isOpponentOwner(snapshot, owner, building.owner, options) &&
      distance(building, point) <= 360 &&
      (building.kind !== "townHall" || !isMainBaseForOwner(snapshot, building.owner, building) || !building.complete),
  );
}

function objectiveControlMinimumArmy(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return 5;
  return opponentPlayerIds(snapshot, owner, options).length >= 2 ? 5 : 3;
}

function mainBaseNeedsObjectivePause(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const main = mainBase(snapshot, owner);
  const threatRange = options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2 ? 1_550 : 1_050;
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, main) <= threatRange);
  if (enemies.length < 3) return false;
  const nearbyDefenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, main) <= 900);
  return armyPower(enemies) >= armyPower(nearbyDefenders) * 0.55;
}

function ownedBaseNeedsObjectivePause(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  const main = mainBase(snapshot, owner);
  for (const base of completeBuildings(snapshot, owner, "townHall")) {
    if (base.id === (main as Partial<Building>).id) continue;
    const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, base) <= 700);
    if (enemies.length < 2) continue;
    const defenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, base) <= 720);
    if (armyPower(enemies) >= armyPower(defenders) * 0.35) return true;
  }
  for (const base of fragileMiningExpansions(snapshot, owner)) {
    const approaching = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, base) <= 1_500);
    if (approaching.length >= 2 && armyPower(approaching) >= 1.8) return true;
  }
  return false;
}

function fragileMiningExpansions(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  return completeBuildings(snapshot, owner, "townHall").filter((base) => {
    if (base.id === (main as Partial<Building>).id) return false;
    const mine = nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), base);
    if (!mine || distance(mine, base) > 260) return false;
    const miners = units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === mine.id);
    const hasTower = buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, base) <= 430);
    return miners.length < 3 || !hasTower;
  });
}

function neutralCampObjective(snapshot: GameSnapshot, army: Unit[], anchor: Point, maxDistance: number, requiredPowerRatio: number) {
  const visited = new Set<string>();
  const itemByCarrier = new Map(snapshot.items.flatMap((item) => (item.carrierId ? [[item.carrierId, item]] as const : [])));
  const camps = [];
  for (const neutral of snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, anchor) <= maxDistance)) {
    if (visited.has(neutral.id)) continue;
    const guards = neutralCampCluster(snapshot, neutral, visited);
    const point = averagePoint(guards);
    if (distance(point, anchor) > maxDistance) continue;
    if (armyPower(army) < armyPower(guards) * requiredPowerRatio) continue;
    const itemBonus = guards.reduce((total, guard) => total + neutralCampItemBonus(itemByCarrier.get(guard.id)), 0);
    const bounty = guards.reduce((total, guard) => total + (UNIT_DEFS[guard.kind].goldBounty ?? 0), 0);
    const score = 50 + itemBonus + bounty * 0.65 + armyPower(guards) * 5 - distance(point, anchor) / 12;
    camps.push({ point, score });
  }
  return camps.sort((a, b) => b.score - a.score)[0];
}

function neutralCampCluster(snapshot: GameSnapshot, seed: Unit, visited: Set<string>) {
  const guards: Unit[] = [];
  const pending = [seed];
  visited.add(seed.id);
  while (pending.length > 0) {
    const current = pending.pop()!;
    guards.push(current);
    for (const candidate of snapshot.units.filter((unit) => unit.owner === "neutral" && !visited.has(unit.id) && distance(unit, current) <= 240)) {
      visited.add(candidate.id);
      pending.push(candidate);
    }
  }
  return guards;
}

function neutralCampItemBonus(item: GameSnapshot["items"][number] | undefined) {
  if (!item) return 0;
  if (item.kind === "experienceBook") return 80;
  if (item.kind === "flameCloak" || item.kind === "lightningRod" || item.kind === "stormStaff") return 95;
  return 55;
}

function planExpansionDenial(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const soldiers = combatUnits(snapshot, owner).filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove");
  if (soldiers.length < 5) return undefined;
  const ownMain = mainBase(snapshot, owner);
  if (nearestOpponentThreat(snapshot, owner, ownMain, 850, options)) return undefined;
  if (ownGuardedNaturalNeedsClearing(snapshot, owner, options)) return undefined;
  const target = exposedEnemyExpansion(snapshot, owner, soldiers, options);
  if (!target) return undefined;
  if (expansionDenialRouteCovered(snapshot, owner, soldiers, target, options)) return undefined;
  const stale = staleAttackMovers(soldiers, target);
  return stale.length > 0 ? { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: target.x, y: target.y } : undefined;
}

function ownGuardedNaturalNeedsClearing(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (hasEstablishedExpansion(snapshot, owner)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  return Boolean(mine && snapshot.units.some((unit) => unit.owner === "neutral" && distance(unit, mine) < 280));
}

function expansionDenialRouteCovered(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], target: Point, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const start = averagePoint(soldiers);
  const routeEnemies = snapshot.units.filter(
    (unit) =>
      isOpponentOwner(snapshot, owner, unit.owner, options) &&
      unit.kind !== "worker" &&
      distance(unit, target) > 520 &&
      pointToSegmentDistance(unit, start, target) <= 360,
  );
  return armyPower(routeEnemies) > armyPower(soldiers) * 1.2;
}

function exposedEnemyExpansion(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], options: PresetAiPolicyOptions): Building | undefined {
  const soldierCenter = averagePoint(soldiers);
  const ownPower = armyPower(soldiers);
  return snapshot.buildings
    .filter((building) => isOpponentOwner(snapshot, owner, building.owner, options) && building.kind === "townHall")
    .filter((building) => !isMainBaseForOwner(snapshot, building.owner, building))
    .map((building) => {
      const defenders = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, building) <= 520);
      const workers = snapshot.units.filter((unit) => unit.owner === building.owner && unit.kind === "worker" && distance(unit, building) <= 460);
      return { building, defenders, workers };
    })
    .filter(({ building, defenders, workers }) => !building.complete || workers.length > 0)
    .filter(({ defenders }) => ownPower >= armyPower(defenders) * 1.25)
    .sort((a, b) => enemyExpansionDenialScore(b.building, b.defenders, b.workers, soldierCenter) - enemyExpansionDenialScore(a.building, a.defenders, a.workers, soldierCenter))[0]?.building;
}

function enemyExpansionDenialScore(building: Building, defenders: Unit[], workers: Unit[], from: Point) {
  const incompleteBonus = building.complete ? 0 : 100;
  const workerBonus = workers.length * 18;
  const defenderPenalty = armyPower(defenders) * 28;
  return incompleteBonus + workerBonus - defenderPenalty - distance(building, from) / 22;
}

function isMainBaseForOwner(snapshot: GameSnapshot, owner: PlayerId, building: Building) {
  const main = mainBase(snapshot, owner);
  return building.id === (main as Partial<Building>).id;
}

function neutralGuardsNear(snapshot: GameSnapshot, point: Point, range: number) {
  return snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, point) <= range);
}

function objectiveCampScore(camp: MercenaryCamp, guards: Unit[], anchor: Point) {
  return 80 + camp.stock * 14 + mercenaryRoleObjectiveBonus(camp.hireKind) + armyPower(guards) * 4 - distance(camp, anchor) / 12;
}

function mercenaryRoleObjectiveBonus(kind: MercenaryUnitKind) {
  if (kind === "contractArcher") return 34;
  if (kind === "fieldMedic") return 28;
  return 18;
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
  // @@@creep-preservation - Neutral camps are real combat threats; v2 must stop donating wounded units while creeping.
  const enemies = snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  const commands: GameCommand[] = [];

  for (const unit of ownCombat) {
    const kite = rangedKiteCommand(snapshot, owner, unit, enemies, ownBase, options);
    if (kite) {
      commands.push(kite);
      recordBehavior(options, "skirmishPreservation", "rangedKites");
      continue;
    }
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

function rangedKiteCommand(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, enemies: Unit[], safePoint: Point, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || unit.attackRange <= 100 || unit.hp >= unit.maxHp * 0.82) return undefined;
  const closeMelee = enemies
    .filter((enemy) => enemy.attackRange <= 80 && distance(enemy, unit) <= Math.max(75, enemy.attackRange + enemy.radius + unit.radius))
    .filter((enemy) => unit.hp / Math.max(1, unit.maxHp) < enemy.hp / Math.max(1, enemy.maxHp))
    .sort((a, b) => distance(a, unit) - distance(b, unit))[0];
  if (!closeMelee) return undefined;
  const dx = unit.x - closeMelee.x;
  const dy = unit.y - closeMelee.y;
  const length = Math.hypot(dx, dy) || 1;
  const homeBiasX = safePoint.x - unit.x;
  const homeBiasY = safePoint.y - unit.y;
  const homeLength = Math.hypot(homeBiasX, homeBiasY) || 1;
  const x = clamp(unit.x + (dx / length) * 150 + (homeBiasX / homeLength) * 45, 0, snapshot.map.width);
  const y = clamp(unit.y + (dy / length) * 150 + (homeBiasY / homeLength) * 45, 0, snapshot.map.height);
  return { type: "move", unitIds: [unit.id], x, y };
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
  if (options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2 && soldiers.length < 3) return undefined;
  if (soldiers.length < 2 || soldiers.length > 4) return undefined;
  const harassers = nearestEntities(soldiers, enemyBase).slice(0, Math.min(2, soldiers.length));
  const harassCenter = averagePoint(harassers);
  const exposedWorker = nearestEntity(enemyWorkers, harassCenter);
  if (!exposedWorker) return undefined;
  if (options.version === "v2" && distance(harassCenter, exposedWorker) > 780) return undefined;
  const enemyDefenders = snapshot.units.filter(
    (unit) =>
      isOpponentOwner(snapshot, owner, unit.owner, options) &&
      unit.kind !== "worker" &&
      (distance(unit, exposedWorker) <= 600 || distance(unit, harassCenter) <= 420),
  );

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

function planWorkerDefense(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const main = mainBase(snapshot, owner);
  const vulnerableBuildings = buildings(snapshot, owner).filter((building) => building.complete && building.kind !== "farm" && distance(building, main) <= 560);
  const enemies = snapshot.units.filter(
    (unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && vulnerableBuildings.some((building) => distance(unit, building) <= 520),
  );
  if (enemies.length < 3) return undefined;
  const ownCombat = combatUnits(snapshot, owner).filter((unit) => distance(unit, main) <= 680);
  if (armyPower(enemies) <= armyPower(ownCombat) * 1.15) return undefined;
  const workers = units(snapshot, owner)
    .filter((unit) => unit.kind === "worker" && distance(unit, main) <= 520)
    .sort((a, b) => distance(a, main) - distance(b, main))
    .slice(0, 5);
  if (workers.length < 2) return undefined;
  if (options.version === "v2" && mainHallNeedsDesperateWorkerFight(snapshot, owner, main, ownCombat)) {
    const target = enemies.sort((a, b) => mainDefenseTargetScore(b, main, snapshot, owner) - mainDefenseTargetScore(a, main, snapshot, owner))[0];
    return target ? { type: "attack", unitIds: workers.map((unit) => unit.id), targetId: target.id } : undefined;
  }
  if (mainWorkerEvacuationThreat(snapshot, owner, options)) {
    const point = workerEvacuationPoint(snapshot, main, averagePoint(enemies));
    return { type: "move", unitIds: workers.map((unit) => unit.id), x: point.x, y: point.y };
  }
  const target = enemies.sort((a, b) => mainDefenseTargetScore(b, main, snapshot, owner) - mainDefenseTargetScore(a, main, snapshot, owner))[0];
  return target ? { type: "attack", unitIds: workers.map((unit) => unit.id), targetId: target.id } : undefined;
}

function mainHallNeedsDesperateWorkerFight(snapshot: GameSnapshot, owner: PlayerId, main: Point, ownCombat: Unit[]) {
  if (ownCombat.length > 0) return false;
  const mainHall = completeBuildings(snapshot, owner, "townHall").find((building) => distance(building, main) <= 80);
  return Boolean(mainHall && mainHall.hp < mainHall.maxHp * 0.45);
}

function mainWorkerEvacuationThreat(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const main = mainBase(snapshot, owner);
  const vulnerableBuildings = buildings(snapshot, owner).filter((building) => building.complete && building.kind !== "farm" && distance(building, main) <= 560);
  const enemies = snapshot.units.filter(
    (unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && vulnerableBuildings.some((building) => distance(unit, building) <= 520),
  );
  if (enemies.length < 3) return false;
  const ownCombat = combatUnits(snapshot, owner).filter((unit) => distance(unit, main) <= 680);
  if (armyPower(enemies) <= armyPower(ownCombat) * 1.15) return false;
  return hasMainDefenseLine(snapshot, owner, main, ownCombat);
}

function hasMainDefenseLine(snapshot: GameSnapshot, owner: PlayerId, main: Point, ownCombat: Unit[]) {
  return (
    ownCombat.length >= 2 ||
    buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, main) <= 520) ||
    buildings(snapshot, owner).some((building) => building.kind === "moonWell" && building.complete && distance(building, main) <= 520)
  );
}

function workerEvacuationPoint(snapshot: GameSnapshot, main: Point, enemyCenter: Point): Point {
  const dx = main.x - enemyCenter.x;
  const dy = main.y - enemyCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: clamp(main.x + (dx / length) * 220, 0, snapshot.map.width),
    y: clamp(main.y + (dy / length) * 220, 0, snapshot.map.height),
  };
}

function planAttackWave(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const soldiers = combatUnits(snapshot, owner);
  const enemyArmy = snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  const movable = soldiers.filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove");

  const focus = mainDefenseFocusCommand(snapshot, owner, soldiers, enemyArmy, options);
  if (focus) return focus;

  const closeout = closeoutAttackWaveTarget(snapshot, owner, soldiers, movable, enemyArmy, options);
  if (closeout) {
    const stale = staleAttackMovers(movable, closeout);
    if (stale.length > 0) return { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: closeout.x, y: closeout.y };
  }

  const pressuredBuilding = mostPressuredAlliedBuilding(snapshot, owner, options);
  if (pressuredBuilding && soldiers.length >= 3) {
    const localEnemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, pressuredBuilding) <= 620);
    const isMainPressure = pressuredBuilding.owner === owner && distance(pressuredBuilding, mainBase(snapshot, owner)) <= 500;
    if (options.version === "v2" && !isMainPressure && armyPower(localEnemies) > armyPower(soldiers) * 1.25) {
      const rally = defensiveRallyPoint(snapshot, owner);
      const stale = soldiers.filter((unit) => distance(unit, rally) > 220);
      return stale.length > 0 ? { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y } : undefined;
    }
    if (options.version === "v2" && isMainPressure && armyPower(localEnemies) > armyPower(soldiers) * 1.15) {
      const rally = defensiveRallyPoint(snapshot, owner);
      const nearest = nearestEntity(localEnemies, rally);
      if (nearest && distance(nearest, rally) > AUTO_ACQUIRE_RANGE + 30) {
        const stale = soldiers.filter((unit) => distance(unit, rally) > 220);
        if (stale.length > 0) return { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y };
      }
    }
    const stale = staleAttackMovers(soldiers, pressuredBuilding);
    return stale.length > 0 ? { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: pressuredBuilding.x, y: pressuredBuilding.y } : undefined;
  }

  const mainHold = mainDefenseHoldCommand(snapshot, owner, soldiers, enemyArmy, options);
  if (mainHold) return mainHold;

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

  if (options.version !== "v2" && snapshot.resources.length > activePlayerIds(snapshot).length && !hasEstablishedExpansion(snapshot, owner)) return undefined;

  const outnumberedV2 = options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2;
  const minimumWaveSize = outnumberedV2 ? 7 : 5;
  const smallPressureAllowed = !outnumberedV2 && soldiers.length > 0 && enemyArmy.length <= 2;
  if (soldiers.length < minimumWaveSize && !smallPressureAllowed) return undefined;
  if (outnumberedV2 && armyPower(enemyArmy) > armyPower(soldiers) * 1.25) return undefined;

  const armyTarget = options.version === "v2" ? significantOpponentArmyTarget(snapshot, owner, averagePoint(soldiers), options) : undefined;
  if (armyTarget) return { type: "attack", unitIds: movable.map((unit) => unit.id), targetId: armyTarget.id };

  const objective = nearestOpponentObjective(snapshot, owner, averagePoint(soldiers), options);
  const point = shouldCloseOutObjective(snapshot, owner, objective, options) ? objective : wavePointFor(snapshot, owner, soldiers, objective);
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

function mainDefenseHoldCommand(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || soldiers.length < 3) return undefined;
  const main = mainBase(snapshot, owner);
  const rally = defensiveRallyPoint(snapshot, owner);
  const approaching = enemyArmy.filter((unit) => distance(unit, main) <= 1_050);
  if (approaching.length < 4) return undefined;
  if (armyPower(approaching) <= armyPower(soldiers) * 1.15) return undefined;
  if (nearestEntity(approaching, rally) && distance(nearestEntity(approaching, rally)!, rally) <= AUTO_ACQUIRE_RANGE + 30) return undefined;
  const stale = soldiers.filter((unit) => distance(unit, rally) > 220);
  return stale.length > 0 ? { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y } : undefined;
}

function mainDefenseFocusCommand(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || soldiers.length < 3) return undefined;
  const rally = defensiveRallyPoint(snapshot, owner);
  const defenders = soldiers.filter((unit) => distance(unit, rally) <= 520 && (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack"));
  if (defenders.length < 3) return undefined;
  const targets = enemyArmy.filter((unit) => distance(unit, rally) <= 360);
  if (targets.length === 0) return undefined;
  const target = targets.sort((a, b) => mainDefenseTargetScore(b, rally, snapshot, owner) - mainDefenseTargetScore(a, rally, snapshot, owner))[0];
  if (!target) return undefined;
  const attackers = defenders.filter((unit) => canJoinMainDefenseFocus(unit, target));
  return attackers.length > 0 ? { type: "attack", unitIds: attackers.map((unit) => unit.id), targetId: target.id } : undefined;
}

function mainDefenseTargetScore(unit: Unit, rally: Point, snapshot: GameSnapshot, owner: PlayerId) {
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 4 + (unit.attackRange > 100 ? 35 : 0);
  const vulnerableBuilding = nearestEntity(buildings(snapshot, owner).filter((building) => building.kind !== "farm"), unit);
  const buildingPressure = vulnerableBuilding ? Math.max(0, 520 - distance(unit, vulnerableBuilding)) * 0.65 : 0;
  return missingHp * 2 + threat + buildingPressure - distance(unit, rally) * 0.2;
}

function canJoinMainDefenseFocus(unit: Unit, target: Unit) {
  const leash = unit.attackRange > 100 ? 80 : 35;
  return distance(unit, target) <= unit.attackRange + leash;
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
  if (building.kind === "barracks") return soldierChoice(snapshot, owner);
  if (building.kind === "archeryRange") return "archer";
  if (building.kind === "stables") {
    const knights = units(snapshot, owner).filter((unit) => unit.kind === "knight").length;
    const raiders = units(snapshot, owner).filter((unit) => unit.kind === "raider").length;
    const playbook = aiPlaybook();
    const preferred = playbook.stablesUnits[0] ?? "raider";
    if (preferred === "raider" && raiders < 3) return "raider";
    return knights < 2 && playerState(snapshot, owner).gold > 520 ? "knight" : "raider";
  }
  if (building.kind === "sanctum") {
    const priests = units(snapshot, owner).filter((unit) => unit.kind === "priest").length;
    const summoners = units(snapshot, owner).filter((unit) => unit.kind === "summoner").length;
    const witches = units(snapshot, owner).filter((unit) => unit.kind === "witch").length;
    for (const kind of aiPlaybook().sanctumUnits) {
      if (kind === "priest" && priests < 1) return "priest";
      if (kind === "summoner" && summoners < 1) return "summoner";
      if (kind === "witch" && witches < 1) return "witch";
    }
    return aiPlaybook().sanctumUnits[0] ?? "priest";
  }
  if (building.kind === "workshop") return "golem";
  return undefined;
}

function soldierChoice(snapshot: GameSnapshot, owner: PlayerId): TrainableUnitKind {
  const army = combatUnits(snapshot, owner);
  const footmen = army.filter((unit) => unit.kind === "footman").length;
  const lancers = army.filter((unit) => unit.kind === "lancer").length;
  if (footmen < 2) return "footman";
  if (lancers < Math.ceil(footmen / 2)) return "lancer";
  return "footman";
}

function aiPlaybook() {
  return AI_PLAYBOOK;
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

function activeMiningBaseCount(snapshot: GameSnapshot, owner: PlayerId) {
  return completeBuildings(snapshot, owner, "townHall").filter((townHall) => {
    const mine = nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), townHall);
    return Boolean(mine && distance(mine, townHall) < 260);
  }).length;
}

function expansionBaseTarget(options: PresetAiPolicyOptions) {
  return options.version === "v2" ? 5 : 2;
}

function shouldReserveForExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (snapshot.resources.length <= activePlayerIds(snapshot).length) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  const ownCombatCount = combatUnits(snapshot, owner).length;
  if (ownCombatCount < 4 && !shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return false;
  if (snapshot.units.some((unit) => unit.owner === "neutral" && distance(unit, mine) < 280)) return options.version === "v2" && expansionIsNearlyCleared(snapshot, owner, mine);
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  if (completeBuildings(snapshot, owner, "townHall").length >= 2) return shouldPrioritizeCatchUpExpansionBeforeMacro(snapshot, owner, options);
  const missingProduction = missingCombatProductionKind(snapshot, owner);
  if (!missingProduction) return true;
  return options.version === "v2" && hasCoreProduction(snapshot, owner) && opponentEconomyAhead(snapshot, owner, options);
}

function shouldReserveForClearedExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  if (!opponentEconomyAhead(snapshot, owner, options)) return false;
  if (combatUnits(snapshot, owner).length < 3) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return false;
  if (snapshot.units.some((unit) => unit.owner === "neutral" && distance(unit, mine) < 280)) return false;
  return !enemyPressure(snapshot, owner, mine, 360, options);
}

function expansionIsNearlyCleared(snapshot: GameSnapshot, owner: PlayerId, mine: ResourceNode) {
  const remainingNeutralPower = snapshot.units
    .filter((unit) => unit.owner === "neutral" && distance(unit, mine) < 280)
    .reduce((total, unit) => total + (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) * (unit.hp / Math.max(1, unit.maxHp)), 0);
  if (remainingNeutralPower <= 0 || remainingNeutralPower > 0.5) return false;
  const nearbyArmy = combatUnits(snapshot, owner).filter((unit) => distance(unit, mine) <= 420);
  return nearbyArmy.length >= 3 && armyPower(nearbyArmy) >= remainingNeutralPower * 4;
}

function shouldReserveForEmergencyTower(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return false;
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, main) <= 1_200);
  if (new Set(enemies.map((unit) => unit.owner)).size < 2) return false;
  return armyPower(enemies) > armyPower(combatUnits(snapshot, owner)) * 1.05;
}

function needsMainGuardTower(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (!hasCoreProduction(snapshot, owner) || combatUnits(snapshot, owner).length < 2) return false;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return false;
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, main) <= 1_850);
  return enemies.length >= 2 && armyPower(enemies) >= 1.8;
}

function shouldReserveForHealingWell(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const player = playerState(snapshot, owner);
  if (player.gold >= BUILDING_DEFS.moonWell.cost || player.gold < BUILDING_DEFS.moonWell.cost - 25) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  if (shouldReserveForEmergencyTower(snapshot, owner, options)) return false;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "moonWell" && distance(building, main) < 520)) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "moonWell" && !building.complete)) return false;
  if (!healingWellPressure(snapshot, owner, main, options)) return false;
  return combatUnits(snapshot, owner).some((unit) => unit.hp < unit.maxHp * 0.86 && distance(unit, main) <= 720);
}

function healingWellPressure(snapshot: GameSnapshot, owner: PlayerId, main: Point, options: PresetAiPolicyOptions) {
  return snapshot.units.some((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, main) <= 1_650);
}

function shouldPrioritizeCatchUpExpansionBeforeMacro(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (activeMiningBaseCount(snapshot, owner) >= 4) return false;
  if (combatUnits(snapshot, owner).length < 6) return false;
  const ownBases = completeBuildings(snapshot, owner, "townHall").length;
  const enemyBases = opponentPlayerIds(snapshot, owner, options).reduce((total, candidate) => total + completeBuildings(snapshot, candidate, "townHall").length, 0);
  return enemyBases >= ownBases + 2;
}

function catchUpExpansionCommand(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const mine = desiredCatchUpExpansionMine(snapshot, owner);
  if (!mine || playerState(snapshot, owner).gold < BUILDING_DEFS.townHall.cost || enemyPressure(snapshot, owner, mine, 360, options)) return undefined;
  const builder = availableBuilder(snapshot, owner, mine);
  if (!builder) return undefined;
  const offset = expansionOffset(snapshot, owner);
  recordBehavior(options, "economicCatchUp", "attempts");
  recordBehavior(options, "economicCatchUp", "catchUpExpansions");
  return { type: "build", unitId: builder.id, buildingKind: "townHall", x: mine.x + offset.x, y: mine.y + offset.y };
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
  const enemyOwners = opponentPlayerIds(snapshot, owner, options);
  const enemyBases = enemyOwners.reduce((total, candidate) => total + completeBuildings(snapshot, candidate, "townHall").length, 0);
  if (enemyBases > ownBases) return true;
  const ownWorkers = units(snapshot, owner).filter((unit) => unit.kind === "worker").length;
  const enemyWorkers = enemyOwners.reduce((total, candidate) => total + units(snapshot, candidate).filter((unit) => unit.kind === "worker").length, 0);
  return enemyWorkers >= ownWorkers + 4;
}

function opponentPlayerIds(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  return activePlayerIds(snapshot).filter((candidate) => isOpponentOwner(snapshot, owner, candidate, options));
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

function significantOpponentArmyTarget(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions): Unit | undefined {
  const army = snapshot.units.filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker");
  if (army.length <= 4) return undefined;
  return army.sort((a, b) => strategicArmyTargetScore(b, from) - strategicArmyTargetScore(a, from))[0];
}

function strategicArmyTargetScore(unit: Unit, from: Point) {
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 4 + (unit.attackRange > 100 ? 35 : 0);
  return missingHp * 1.5 + threat - distance(unit, from) * 0.12;
}

function shouldCloseOutObjective(snapshot: GameSnapshot, owner: PlayerId, objective: Point, options: PresetAiPolicyOptions) {
  const building = nearestEntity(snapshot.buildings.filter((candidate) => isEnemyOwner(snapshot, owner, candidate.owner, options) && distance(candidate, objective) <= 4), objective);
  if (!building) return false;
  const targetTeam = teamFor(snapshot, building.owner, options);
  const defenders = snapshot.units.filter((unit) => teamFor(snapshot, unit.owner, options) === targetTeam && unit.kind !== "worker");
  return defenders.length <= 4;
}

function closeoutAttackWaveTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], movable: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  if (movable.length === 0) return undefined;
  if (options.version !== "v2" && snapshot.resources.length > activePlayerIds(snapshot).length && !hasEstablishedExpansion(snapshot, owner)) return undefined;
  const outnumberedV2 = options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2;
  const minimumWaveSize = outnumberedV2 ? 7 : 5;
  if (soldiers.length < minimumWaveSize) return undefined;
  const crippledCleanup = options.version === "v2" ? crippledOpponentCloseoutBuilding(snapshot, owner, averagePoint(movable), options, movable) : undefined;
  if (crippledCleanup) return crippledCleanup;
  if (outnumberedV2 && armyPower(enemyArmy) > armyPower(soldiers) * 1.25) return undefined;
  return weakOpponentCloseoutBuilding(snapshot, owner, averagePoint(movable), options, movable);
}

function weakOpponentCloseoutBuilding(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, soldiers: Unit[] = []) {
  const candidates = snapshot.buildings.filter((building) => isEnemyOwner(snapshot, owner, building.owner, options));
  const disabledTarget = options.version === "v2" ? crippledOpponentCloseoutBuilding(snapshot, owner, from, options, soldiers) : undefined;
  if (disabledTarget) return disabledTarget;
  const weakTargets = candidates.filter((building) => {
    const targetTeam = teamFor(snapshot, building.owner, options);
    const defenders = snapshot.units.filter((unit) => teamFor(snapshot, unit.owner, options) === targetTeam && unit.kind !== "worker");
    return defenders.length <= 4;
  });
  return weakTargets.sort((a, b) => closeoutBuildingScore(b, from) - closeoutBuildingScore(a, from))[0];
}

function crippledOpponentCloseoutBuilding(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, soldiers: Unit[]) {
  return snapshot.buildings
    .filter((building) => isEnemyOwner(snapshot, owner, building.owner, options))
    .filter((building) => crippledOpponentBuildingIsCleanable(snapshot, owner, building, from, soldiers, options))
    .sort((a, b) => crippledOpponentCleanupScore(b, from) - crippledOpponentCleanupScore(a, from))[0];
}

function crippledOpponentBuildingIsCleanable(snapshot: GameSnapshot, owner: PlayerId, building: Building, from: Point, soldiers: Unit[], options: PresetAiPolicyOptions) {
  if (soldiers.length < 5) return false;
  const targetWorkers = units(snapshot, building.owner).filter((unit) => unit.kind === "worker").length;
  const targetCombat = combatUnits(snapshot, building.owner);
  if (targetWorkers > 0 || targetCombat.length > 1) return false;
  const soldierPower = armyPower(soldiers);
  const localDefenders = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && distance(unit, building) <= 620);
  if (armyPower(localDefenders) > soldierPower * 0.5) return false;
  const routeDefenders = snapshot.units.filter(
    (unit) =>
      isOpponentOwner(snapshot, owner, unit.owner, options) &&
      unit.kind !== "worker" &&
      distance(unit, building) > 620 &&
      pointToSegmentDistance(unit, from, building) <= 360,
  );
  return armyPower(routeDefenders) <= soldierPower * 1.15;
}

function crippledOpponentCleanupScore(building: Building, from: Point) {
  const productionBonus = isCoreProductionBuilding(building) ? 130 : 0;
  const towerBonus = building.kind === "defenseTower" ? 110 : 0;
  const nonTownHallBonus = building.kind === "townHall" ? 0 : 70;
  const woundedBonus = (1 - building.hp / Math.max(1, building.maxHp)) * 60;
  return productionBonus + towerBonus + nonTownHallBonus + woundedBonus - distance(building, from) / 18;
}

function closeoutBuildingScore(building: Building, from: Point) {
  const townHallBonus = building.kind === "townHall" ? 120 : 0;
  const woundedBonus = (1 - building.hp / Math.max(1, building.maxHp)) * 60;
  return townHallBonus + woundedBonus - distance(building, from) / 20;
}

function nearestEnemyBase(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions) {
  return nearestEntity(snapshot.buildings.filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind === "townHall" && building.complete), from);
}

function ownedMiningLocations(snapshot: GameSnapshot, owner: PlayerId, townHalls: Building[]) {
  return snapshot.resources.filter((resource) => resource.amount > 0 && townHalls.some((townHall) => townHall.owner === owner && distance(resource, townHall) <= 620));
}

function hasMiningExpansion(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  const expansionTownHall = completeBuildings(snapshot, owner, "townHall").find((townHall) => distance(townHall, main) > 650);
  const expansionMine = expansionTownHall ? nearestResource(snapshot.resources.filter((resource) => resource.amount > 0), expansionTownHall) : undefined;
  return Boolean(
    expansionTownHall &&
      expansionMine &&
      distance(expansionMine, expansionTownHall) < 260 &&
      units(snapshot, owner).some((unit) => unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === expansionMine.id),
  );
}

function hasEstablishedExpansion(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  return completeBuildings(snapshot, owner, "townHall").some((townHall) => distance(townHall, main) > 650);
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

function safeMainBuildPoint(snapshot: GameSnapshot, owner: PlayerId, slot: number): Point {
  const base = mainBase(snapshot, owner);
  const direction = ownerDirection(snapshot, owner);
  const xSteps = [120, 190, 260, 330].map((x) => x + Math.floor(slot / 4) * 34);
  const ySteps = [100, -100, 180, -180, 260, -260].map((y) => y + (slot % 2 === 0 ? 0 : 28));
  const candidates = xSteps.flatMap((x) => ySteps.map((y) => ({ x: clamp(base.x + direction * x, 0, snapshot.map.width), y: clamp(base.y + y, 0, snapshot.map.height) })));
  return candidates.sort((a, b) => mainBuildPointScore(snapshot, owner, b, base) - mainBuildPointScore(snapshot, owner, a, base))[0] ?? base;
}

function mainBuildPointScore(snapshot: GameSnapshot, owner: PlayerId, point: Point, base: Point) {
  const neutralDistance = nearestEntity(snapshot.units.filter((unit) => unit.owner === "neutral"), point);
  const ownBuildingDistance = nearestEntity(buildings(snapshot, owner), point);
  const neutralScore = neutralDistance ? Math.min(distance(point, neutralDistance), 520) * 3 : 1_560;
  const spacingPenalty = ownBuildingDistance ? Math.max(0, 135 - distance(point, ownBuildingDistance)) * 5 : 0;
  return neutralScore - spacingPenalty - distance(point, base) * 0.25;
}

function healingWellPointFor(snapshot: GameSnapshot, owner: PlayerId, base: Point): Point {
  const direction = ownerDirection(snapshot, owner);
  return {
    x: clamp(base.x - direction * 86, 0, snapshot.map.width),
    y: clamp(base.y + 118, 0, snapshot.map.height),
  };
}

function defensiveRallyPoint(snapshot: GameSnapshot, owner: PlayerId): Point {
  const base = mainBase(snapshot, owner);
  const tower = nearestEntity(buildings(snapshot, owner).filter((building) => building.kind === "defenseTower" && building.complete && distance(building, base) <= 520), base);
  if (!tower) return base;
  return { x: (base.x + tower.x) / 2, y: (base.y + tower.y) / 2 };
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

function mineAssignmentCounts(workers: Unit[]) {
  const counts = new Map<string, number>();
  for (const worker of workers) {
    if (worker.order.type !== "mine") continue;
    counts.set(worker.order.resourceId, (counts.get(worker.order.resourceId) ?? 0) + 1);
  }
  return counts;
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
  return building.kind !== "townHall" && building.kind !== "farm" && building.kind !== "defenseTower" && building.kind !== "moonWell";
}

function hasCoreProduction(snapshot: GameSnapshot, owner: PlayerId) {
  return buildings(snapshot, owner).some((building) => isCoreProductionBuilding(building));
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

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
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
