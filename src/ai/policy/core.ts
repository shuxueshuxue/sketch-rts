import { BUILDING_DEFS, MAX_UPGRADE_LEVEL, MERCENARY_HIRE_RANGE, UNIT_DEFS, UPGRADE_DEFS } from "../../shared/catalog";
import type { Building, GameCommand, GameSnapshot, MercenaryCamp, MercenaryUnitKind, PlayerId, ResourceNode, Unit, UpgradeKind } from "../../shared/types";
import {
  healingWellPressure,
  hasReachedHealingWellLimit,
  needsMainGuardTower,
  shouldGuardFreshMiningExpansion,
  shouldReserveForCoreProductionRecovery,
  shouldReserveForEmergencyTower,
  shouldReserveForHealingWell,
} from "./base-defense-model";
import { defensiveRallyPoint, healingWellPointFor, legalBuildPointNear, safeMainBuildPoint, towerPointFor } from "./build-layout";
import { activeUnitClaim } from "./claims";
import { resolveAiCommandIntent } from "./commands";
import { armyPower } from "./combat-math";
import {
  activeMiningBaseCount,
  canClearGuardedExpansion,
  canExpandBeforeFullProductionChain,
  desiredCatchUpExpansionMine,
  desiredExpansionMine,
  desiredForwardExpansionMine,
  expansionBaseTarget,
  hasEstablishedExpansion,
  neutralGuardPower,
  opponentEconomyAhead,
  ownedMiningLocations,
  shouldPrioritizeCatchUpExpansionBeforeMacro,
  shouldReserveForClearedExpansion,
  shouldReserveForExpansion,
  unguardedExpansion,
} from "./expansion-model";
import { planItemCommands } from "./item-tactics";
import { isEnemyOwner, isOpponentOwner, opponentPlayerIds, teamFor } from "./ownership";
import { aiPlaybook, type ProductionBuildingKind } from "./playbook";
import {
  desiredMissingProductionKind,
  duplicateCoreProductionReserveKind,
  isOneBaseNoExpansionPressure,
  missingCombatProductionKind,
  needsDuplicateCoreProduction,
  nextProductionBuildingKind,
  productionBuildingNeedKind,
  shouldFinishCoreArmyBeforeMoreProduction,
} from "./production-model";
import { runAiCommandEntriesFromScripts } from "./script-runner";
import {
  activePlayerIds,
  activeResources,
  aiSnapshotQuery,
  allBuildings,
  buildings,
  combatUnits,
  completeBuildings,
  enemyBuildings,
  enemyBuildingsNear,
  enemyCombatUnits,
  enemyCombatUnitsNear,
  enemyUnitsNear,
  enemyUnits,
  enemyWorkers as enemyWorkerUnits,
  items,
  mercenaryCamps,
  neutralUnitsNear,
  resources,
  units,
} from "./snapshot";
import { averagePoint, clamp, distance, distanceSquared, nearestEntities, nearestEntity, pointToSegmentDistance, type Point } from "./spatial";
import { planSkirmishPreservation } from "./skirmish-tactics";
import { planAbilityCommands, planFocusFireCommand } from "./spell-tactics";
import { behaviorDisabled, recordBehavior } from "./telemetry";
import { enemyPressure, nearestOpponentThreat } from "./threats";
import { shouldPrioritizeWoundedPriestTraining, trainingChoice } from "./training-choice";
import type { AiCommandEntry, AiPolicyContext, AiScript, AiScriptVersion, PresetAiPolicyOptions } from "./types";
import {
  availableBuilder,
  canSupply,
  expansionOffset,
  currentBasePoint,
  hasAssignedBuilder,
  hasCoreProduction,
  isCoreProductionBuilding,
  mainBase,
  mainBaseX,
  mineAssignmentCounts,
  nearOwnIncompleteBuilding,
  nearestResource,
  ownerDirection,
  playerState,
  projectedSupplyUsed,
  queuedUnitCount,
} from "./world-model";

const AUTO_ACQUIRE_RANGE = 230;
const ATTACK_MOVE_REDIRECT_DISTANCE = 240;
const MAIN_APPROACH_THREAT_RANGE = 1_550;
const NEUTRAL_ASSIST_PLANNING_RANGE = 360;
const SUPPLY_BUILDING_LIMIT = 15;
const EXPANSION_CLAIM_MEMORY_TICKS = 3600;

const COMMAND_CONFLICT_BYPASS_SCRIPT_IDS = new Set(["workerPressureCloseout", "desperateWorkerFight"]);

export const AI_SCRIPT_LIBRARY = {
  economy: { id: "economy", phase: "economy", run: planEconomy },
  constructionRecovery: { id: "constructionRecovery", phase: "economy", run: planConstructionRecovery },
  emergencyDefense: { id: "emergencyDefense", phase: "economy", run: planEmergencyDefense },
  repair: { id: "repair", phase: "economy", run: planRepair },
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
  items: { id: "items", phase: "tactics", run: planItemCommands },
  abilities: { id: "abilities", phase: "tactics", run: planAbilityCommands },
  focusFire: { id: "focusFire", phase: "tactics", run: planFocusFireCommand },
  expansionRegroup: { id: "expansionRegroup", phase: "tactics", run: planExpansionRegroup },
  desperateWorkerFight: { id: "desperateWorkerFight", phase: "tactics", run: planDesperateWorkerFight },
  workerPressure: { id: "workerPressure", phase: "tactics", run: planWorkerPressure },
  workerPressureCloseout: { id: "workerPressureCloseout", phase: "tactics", run: planWorkerPressureCloseout },
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
  AI_SCRIPT_LIBRARY.skirmishPreservation,
  AI_SCRIPT_LIBRARY.focusFire,
  AI_SCRIPT_LIBRARY.workerPressure,
  AI_SCRIPT_LIBRARY.workerPressureCloseout,
  AI_SCRIPT_LIBRARY.objectiveControl,
  AI_SCRIPT_LIBRARY.workerDefense,
  AI_SCRIPT_LIBRARY.attackWave,
];

export const AI_SCRIPT_VERSIONS: Record<AiScriptVersion, AiScript[]> = {
  v1: SKETCH_RTS_PRESET_AI_STACK,
  v2: SKETCH_RTS_PRESET_AI_STACK,
};

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
  return runAiCommandEntriesFromScripts(snapshot, owner, scripts, options, {
    commandConflictBypassScriptIds: COMMAND_CONFLICT_BYPASS_SCRIPT_IDS,
    minimumAttackMoveUnits: groupAttackMoveMinimum,
  });
}

function groupAttackMoveMinimum(scriptId: string, command: Extract<GameCommand, { type: "attackMove" }>, snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (scriptId === "objectiveControl") return objectiveControlMinimumArmy(snapshot, owner, options);
  if (scriptId === "expansionDenial") return 5;
  if (scriptId === "expansion") return 4;
  // @@@attack-wave-threshold-owner - Attack wave has context-specific thresholds; the runner only removes already-reserved units.
  if (scriptId === "attackWave") return command.unitIds.length < 5 ? 1 : 5;
  return 1;
}

function planEconomy(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const workers = units(snapshot, owner).filter((unit) => unit.kind === "worker" && !nearOwnIncompleteBuilding(snapshot, owner, unit));
  if (workers.length === 0) return undefined;
  const assignmentCounts = mineAssignmentCounts(workers);
  const idleWorkers = workers.filter((unit) => unit.order.type === "idle");
  const oversaturatedWorkers = workers.filter((unit) => unit.order.type === "mine" && (assignmentCounts.get(unit.order.resourceId) ?? 0) > 5);
  const bases = completeBuildings(snapshot, owner, "townHall");
  const assignableWorkers = [...idleWorkers, ...oversaturatedWorkers];

  for (const base of bases) {
    const mine = nearestResource(activeResources(snapshot), base);
    if (!mine || (assignmentCounts.get(mine.id) ?? 0) > 0) continue;
    const worker = nearestEntity(
      assignableWorkers.filter((candidate) => candidate.order.type !== "mine" || candidate.order.resourceId !== mine.id),
      base,
    );
    if (worker) return resolveAiCommandIntent(snapshot, owner, { type: "mine", unitIds: [worker.id], resourceId: mine.id }, options);
  }

  for (const base of bases) {
    const mine = nearestResource(activeResources(snapshot), base);
    if (!mine) continue;
    const assigned = assignmentCounts.get(mine.id) ?? 0;
    if (assigned >= 5) continue;
    const candidates = nearestEntities(
      assignableWorkers.filter((worker) => worker.order.type !== "mine" || worker.order.resourceId !== mine.id),
      base,
    );
    const selected = candidates.slice(0, 5 - assigned);
    if (selected.length > 0) return resolveAiCommandIntent(snapshot, owner, { type: "mine", unitIds: selected.map((worker) => worker.id), resourceId: mine.id }, options);
  }

  if (idleWorkers.length === 0) return undefined;
  const mine = nearestResource(activeResources(snapshot), mainBase(snapshot, owner));
  if (!mine) return undefined;
  return resolveAiCommandIntent(snapshot, owner, { type: "mine", unitIds: idleWorkers.map((worker) => worker.id), resourceId: mine.id }, options);
}

function planConstructionRecovery(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const stalled = buildings(snapshot, owner).find((building) => !building.complete && !hasAssignedBuilder(snapshot, owner, building));
  if (!stalled) return undefined;
  const builder = availableBuilder(snapshot, owner, stalled, options);
  if (!builder) return undefined;
  return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [builder.id], x: stalled.x - ownerDirection(snapshot, owner) * 30, y: stalled.y }, options);
}

function planRepair(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  if (playerState(snapshot, owner).gold < 1) return undefined;
  const main = mainBase(snapshot, owner);
  const damagedTower = buildings(snapshot, owner)
    .filter((building) => building.complete && building.kind === "defenseTower" && building.hp > 0 && building.hp < building.maxHp && distance(building, main) <= 520)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!damagedTower) return undefined;
  const worker = nearestEntity(
    units(snapshot, owner)
      .filter((unit) => unit.kind === "worker")
      .filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "mine"),
    damagedTower,
  );
  if (!worker) return undefined;
  // @@@repair-worker-is-not-miner-cap - Five miners saturate a mine; a sixth worker can still be the right repair/builder unit.
  return resolveAiCommandIntent(snapshot, owner, { type: "repair", unitIds: [worker.id], buildingId: damagedTower.id }, options);
}

function planSupply(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  const farms = buildings(snapshot, owner).filter((building) => building.kind === "farm");
  if (farms.some((building) => !building.complete)) return undefined;
  if (farms.length >= SUPPLY_BUILDING_LIMIT || player.supplyCap - player.supplyUsed > 5 || player.gold < BUILDING_DEFS.farm.cost) return undefined;
  if (shouldReserveForCoreProductionRecovery(snapshot, owner, options, BUILDING_DEFS.farm.cost)) return undefined;
  if (needsMainGuardTower(snapshot, owner, options) && player.gold >= BUILDING_DEFS.defenseTower.cost) return undefined;
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.farm.cost) return undefined;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + BUILDING_DEFS.farm.cost) return undefined;
  if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, BUILDING_DEFS.farm.cost)) return undefined;
  if (shouldReserveForExpansion(snapshot, owner, options) && player.supplyUsed < player.supplyCap && player.gold < BUILDING_DEFS.townHall.cost + BUILDING_DEFS.farm.cost) return undefined;
  if (player.supplyUsed < player.supplyCap && shouldHoldClearedExpansionBank(snapshot, owner, options, BUILDING_DEFS.farm.cost)) return undefined;
  if (player.supplyUsed < player.supplyCap && shouldHoldFirstExpansionBank(snapshot, owner, options, BUILDING_DEFS.farm.cost)) return undefined;
  const base = mainBase(snapshot, owner);
  const builder = availableBuilder(snapshot, owner, base, options);
  if (!builder) return undefined;
  const point = safeMainBuildPoint(snapshot, owner, farms.length + 4, "farm");
  return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "farm", x: point.x, y: point.y }, options);
}

function planExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (resources(snapshot).length <= activePlayerIds(snapshot).length) return undefined;
  const forwardMine = desiredForwardExpansionMine(snapshot, owner, options);
  const missingCombatProduction = missingCombatProductionKind(snapshot, owner);
  if (!forwardMine && missingCombatProduction && failedExpansionAttemptBeforeCoreProduction(snapshot, owner, options)) return undefined;
  if (!forwardMine && missingCombatProduction && !canExpandBeforeFullProductionChain(snapshot, owner, options)) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return undefined;
  if (activeMiningBaseCount(snapshot, owner) >= expansionBaseTarget(options)) return undefined;
  if (options.version === "v2" && activeMiningBaseCount(snapshot, owner) >= 2 && combatUnits(snapshot, owner).length < catchUpExpansionMinimumCombat(snapshot, owner, options)) return undefined;

  const mine = forwardMine ?? desiredExpansionMine(snapshot, owner);
  if (!mine) return undefined;
  // @@@main-before-natural - Expansion clearing needs the army, but a ready cleared-natural hall is a worker economy action unless the worker line is already under contact.
  if (options.version === "v2" && mainBaseNeedsObjectivePause(snapshot, owner, options) && !canBuildReadyClearedFirstExpansionThroughMainPause(snapshot, owner, mine, options)) return undefined;

  const nearbyNeutral = neutralUnitsNear(snapshot, mine, 280).length > 0;
  if (nearbyNeutral) {
    const soldiers = combatUnits(snapshot, owner).filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || (options.version === "v2" && unit.order.type === "attackMove"));
    if (soldiers.length >= 4 && canClearGuardedExpansion(snapshot, mine, soldiers, options)) return resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: soldiers.map((unit) => unit.id), x: mine.x, y: mine.y }, options);
    return undefined;
  }

  if (!forwardMine && missingCombatProduction && !canExpandBeforeFullProductionChain(snapshot, owner, options)) return undefined;
  if (shouldWaitForOneOnOneFirstExpansionGroup(snapshot, owner, options)) return undefined;
  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.townHall.cost) return undefined;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return undefined;
  const builder = availableBuilder(snapshot, owner, mine, options);
  if (!builder) return undefined;
  const offset = expansionOffset(snapshot, owner);
  const point = legalBuildPointNear(snapshot, "townHall", { x: mine.x + offset.x, y: mine.y + offset.y });
  return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "townHall", x: point.x, y: point.y }, options);
}

function canBuildReadyClearedFirstExpansionThroughMainPause(snapshot: GameSnapshot, owner: PlayerId, mine: ResourceNode, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (playerState(snapshot, owner).gold < BUILDING_DEFS.townHall.cost) return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (!shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  if (neutralUnitsNear(snapshot, mine, 280).length > 0) return false;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  return !mainWorkerLineThreat(snapshot, owner, options);
}

function shouldWaitForOneOnOneFirstExpansionGroup(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (opponentPlayerIds(snapshot, owner, options).length !== 1) return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (rememberedClearedExpansionClaim(snapshot, owner, options)) return false;
  const combatCount = combatUnits(snapshot, owner).length;
  if (activeClearedExpansionClaim(snapshot, owner, options) && combatCount >= 6) return false;
  // @@@one-on-one-first-expansion-tempo - A cleared natural is not free if the first army is still too thin to hold the map after spending the hall gold.
  return combatCount < 7;
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
  if (
    needsMainGuardTower(snapshot, owner, options) &&
    combatUnits(snapshot, owner).length >= 5 &&
    playerState(snapshot, owner).gold >= BUILDING_DEFS.defenseTower.cost &&
    !shouldHoldClearedExpansionBank(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)
  ) {
    const builder = availableBuilder(snapshot, owner, main, options);
    if (builder) {
      const point = towerPointFor(snapshot, owner, main, undefined);
      recordBehavior(options, "economicCatchUp", "attempts");
      recordBehavior(options, "economicCatchUp", "catchUpTowers");
      return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y }, options);
    }
  }
  const missingProduction = missingCombatProductionKind(snapshot, owner);
  const mainThreat = nearestOpponentThreat(snapshot, owner, main, 680, options);
  if (
    options.version === "v2" &&
    missingProduction &&
    !failedExpansionAttemptBeforeCoreProduction(snapshot, owner, options) &&
    hasCoreProduction(snapshot, owner) &&
    completeBuildings(snapshot, owner, "townHall").length === 1 &&
    combatUnits(snapshot, owner).length >= catchUpExpansionMinimumCombat(snapshot, owner, options)
  ) {
    const mine = desiredCatchUpExpansionMine(snapshot, owner);
    if (mine && playerState(snapshot, owner).gold >= BUILDING_DEFS.townHall.cost && !enemyPressure(snapshot, owner, mine, 360, options)) {
      const builder = availableBuilder(snapshot, owner, mine, options);
      if (builder) {
        const offset = expansionOffset(snapshot, owner);
        const point = legalBuildPointNear(snapshot, "townHall", { x: mine.x + offset.x, y: mine.y + offset.y });
        recordBehavior(options, "economicCatchUp", "attempts");
        recordBehavior(options, "economicCatchUp", "catchUpExpansions");
        return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "townHall", x: point.x, y: point.y }, options);
      }
    }
  }
  if (missingProduction && !mainThreat) return undefined;
  if (missingProduction) return undefined;

  const exposedExpansion = unguardedExpansion(snapshot, owner);
  if (
    opponentPlayerIds(snapshot, owner, options).length < 2 &&
    exposedExpansion &&
    playerState(snapshot, owner).gold >= BUILDING_DEFS.defenseTower.cost &&
    !shouldHoldClearedExpansionBank(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)
  ) {
    const builder = availableBuilder(snapshot, owner, exposedExpansion, options);
    if (builder) {
      const point = towerPointFor(snapshot, owner, exposedExpansion, undefined);
      recordBehavior(options, "economicCatchUp", "attempts");
      recordBehavior(options, "economicCatchUp", "catchUpTowers");
      return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y }, options);
    }
  }

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
  if (options.version === "v2" && hasAnyCoreProduction && combatUnits(snapshot, owner).length >= 5 && !mainGuarded && opponentPlayerIds(snapshot, owner, options).length >= 2 && playerState(snapshot, owner).gold >= BUILDING_DEFS.defenseTower.cost) {
    const builder = availableBuilder(snapshot, owner, main, options);
    if (builder) {
      const point = towerPointFor(snapshot, owner, main, undefined);
      recordBehavior(options, "economicCatchUp", "attempts");
      recordBehavior(options, "economicCatchUp", "catchUpTowers");
      return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y }, options);
    }
  }

  return catchUpExpansionCommand(snapshot, owner, options);
}

function planProductionBuilding(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const missing = nextProductionBuildingKind(snapshot, owner, options);
  if (!missing) return undefined;
  if (shouldFinishCoreArmyBeforeMoreProduction(snapshot, owner, options)) return undefined;
  if (shouldTrainBeforeThirdProduction(snapshot, owner, missing, options)) return undefined;
  const player = playerState(snapshot, owner);
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS[missing].cost) return undefined;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + BUILDING_DEFS[missing].cost) return undefined;
  if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, BUILDING_DEFS[missing].cost)) return undefined;
  if (
    shouldReserveForExpansion(snapshot, owner, options) &&
    !canSpendExpansionRetryBankOnCoreProduction(snapshot, owner, missing, options) &&
    player.gold < BUILDING_DEFS.townHall.cost + BUILDING_DEFS[missing].cost
  )
    return undefined;
  const base = mainBase(snapshot, owner);
  const builder = availableBuilder(snapshot, owner, base, options);
  if (!builder) return undefined;
  const index = aiPlaybook().productionPlan.indexOf(missing);
  const point = safeMainBuildPoint(snapshot, owner, index, missing);
  return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: missing, x: point.x, y: point.y }, options);
}

function shouldTrainBeforeThirdProduction(snapshot: GameSnapshot, owner: PlayerId, missing: ProductionBuildingKind, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (missing !== "stables") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  const ownCombatCount = combatUnits(snapshot, owner).length;
  if (ownCombatCount < 3 || ownCombatCount >= 8) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  const main = mainBase(snapshot, owner);
  const contestedNatural = mine ? enemyPressure(snapshot, owner, mine, 360, options) : false;
  const pressuredMain = healingWellPressure(snapshot, owner, main, options);
  if (!contestedNatural && !pressuredMain) return false;
  const player = playerState(snapshot, owner);
  // @@@third-production-tempo - If the one-base army is already pressured, spend the small bank on immediate units before the third production tech step.
  return player.gold >= UNIT_DEFS.footman.cost && player.gold < BUILDING_DEFS.townHall.cost + BUILDING_DEFS[missing].cost;
}

function planEmergencyDefense(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  const ownCombat = combatUnits(snapshot, owner);
  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.defenseTower.cost) return undefined;
  if (shouldReserveForCoreProductionRecovery(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)) return undefined;
  if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)) return undefined;
  if (shouldHoldClearedExpansionBank(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return undefined;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return undefined;
  const threat = nearestOpponentThreat(snapshot, owner, main, 1_200, options);
  if (!threat) return undefined;
  const threatenedEnemies = enemyCombatUnitsNear(snapshot, owner, main, 1_200, options.teams);
  const underHeavyPressure = threatenedEnemies.length >= 3 && armyPower(threatenedEnemies) > armyPower(ownCombat) * 1.15;
  // @@@early-main-guard - Under direct main pressure, waiting for five soldiers means the tower starts after the base is already collapsing.
  if (ownCombat.length < 2 && !underHeavyPressure) return undefined;
  const builder = availableBuilder(snapshot, owner, main, options);
  if (!builder) return undefined;
  const point = towerPointFor(snapshot, owner, main as Building, threat);
  return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y }, options);
}

function planTech(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, reserveOptions: { forcePriorityWeaponTiming?: boolean } = {}): GameCommand | undefined {
  const upgradeKind = nextUpgradeKind(snapshot, owner, options);
  if (!upgradeKind) return undefined;
  if (upgradeKind !== "weaponTraining" && missingCombatProductionKind(snapshot, owner)) return undefined;
  const level = nextUpgradeLevelDef(snapshot, owner, upgradeKind);
  if (!level) return undefined;
  const player = playerState(snapshot, owner);
  if (player.gold < level.cost) return undefined;
  // @@@thin-army-tech-bank - Early upgrades are fine; spending the last bank before a five-body army recreates the low-peak-supply failures.
  if (
    options.version === "v2" &&
    upgradeKind === "weaponTraining" &&
    activeMiningBaseCount(snapshot, owner) >= 2 &&
    combatUnits(snapshot, owner).length < 5 &&
    player.gold < level.cost + UNIT_DEFS.footman.cost
  )
    return undefined;
  if (
    options.version === "v2" &&
    upgradeKind === "weaponTraining" &&
    opponentPlayerIds(snapshot, owner, options).length >= 2 &&
    activeMiningBaseCount(snapshot, owner) < 2 &&
    combatUnits(snapshot, owner).length < 5 &&
    player.gold < level.cost + UNIT_DEFS.footman.cost
  )
    return undefined;
  if (needsMainGuardTower(snapshot, owner, options)) return undefined;
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + level.cost) return undefined;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + level.cost) return undefined;
  if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, level.cost)) return undefined;
  const reserveClearedExpansion = shouldReserveForClearedExpansion(snapshot, owner, options);
  const priorityWeaponTiming = isV2PriorityWeaponTiming(snapshot, owner, upgradeKind, options);
  const priorityBreaksExpansionReserve = priorityWeaponTiming && (reserveOptions.forcePriorityWeaponTiming || opponentPlayerIds(snapshot, owner, options).length === 1);
  // @@@one-on-one-weapon-window - In 1v1, cheap slow weapon1 is a timing commitment; 1v2 catch-up expansion banks still stay intact.
  if ((reserveClearedExpansion || !priorityBreaksExpansionReserve) && shouldReserveForExpansion(snapshot, owner, options) && player.gold < BUILDING_DEFS.townHall.cost + level.cost) return undefined;
  const building = researchBuilding(snapshot, owner, upgradeKind);
  if (!building) return undefined;
  return resolveAiCommandIntent(snapshot, owner, { type: "research", buildingId: building.id, upgradeKind }, options);
}

function planEarlyTech(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const upgradeKind = nextUpgradeKind(snapshot, owner, options);
  if (!upgradeKind || !isV2PriorityWeaponTiming(snapshot, owner, upgradeKind, options)) return undefined;
  const level = nextUpgradeLevelDef(snapshot, owner, upgradeKind);
  if (!level) return undefined;
  const missingProduction = productionBuildingNeedKind(snapshot, owner, options);
  if (missingProduction && !desiredMissingProductionKind(snapshot, owner, options)) return undefined;
  if (missingProduction && playerState(snapshot, owner).gold >= BUILDING_DEFS[missingProduction].cost + level.cost) return undefined;
  return planTech(snapshot, owner, options, { forcePriorityWeaponTiming: true });
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

function planDefense(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.defenseTower.cost) return undefined;
  if (shouldReserveForCoreProductionRecovery(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)) return undefined;
  if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)) return undefined;
  if (shouldHoldClearedExpansionBank(snapshot, owner, options, BUILDING_DEFS.defenseTower.cost)) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return undefined;

  const bases = completeBuildings(snapshot, owner, "townHall");
  const towers = buildings(snapshot, owner).filter((building) => building.kind === "defenseTower");
  const hasCoreProduction = buildings(snapshot, owner).some((building) => isCoreProductionBuilding(building) && building.complete);
  if (towers.length >= bases.length + 1) return undefined;

  const main = mainBase(snapshot, owner);
  const wantsMainGuard = bases.length >= 2 && needsMainGuardTower(snapshot, owner, options);
  for (const base of bases) {
    const threatRange = wantsMainGuard && distance(base, main) < 120 ? 1_850 : 680;
    // @@@main-guard-range - The reserve gate already treats an approaching army as main pressure; defense must be able to spend that reserved tower bank.
    const threat = nearestOpponentThreat(snapshot, owner, base, threatRange, options);
    const alreadyCovered = towers.some((tower) => distance(tower, base) < 430);
    const wantsExpansionGuard = hasCoreProduction && bases.length > 1 && !alreadyCovered && (player.gold > 460 || shouldGuardFreshMiningExpansion(snapshot, owner, base, options));
    if (!threat && !wantsExpansionGuard) continue;
    if (threat && alreadyCovered) continue;

    const builder = availableBuilder(snapshot, owner, base, options);
    if (!builder) continue;
    const point = towerPointFor(snapshot, owner, base, threat);
    return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: point.x, y: point.y }, options);
  }
  return undefined;
}

function planHealingWell(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const player = playerState(snapshot, owner);
  if (player.gold < BUILDING_DEFS.moonWell.cost) return undefined;
  if (!hasCoreProduction(snapshot, owner)) return undefined;
  if (options.version === "v2" && hasReachedHealingWellLimit(snapshot, owner)) return undefined;
  if (buildings(snapshot, owner).some((building) => building.kind === "moonWell" && !building.complete)) return undefined;

  const main = mainBase(snapshot, owner);
  const wellsNearMain = buildings(snapshot, owner).filter((building) => building.kind === "moonWell" && distance(building, main) < 520).length;
  const desiredWells = completeBuildings(snapshot, owner, "townHall").length >= 2 && combatUnits(snapshot, owner).length >= 8 ? 2 : 1;
  const uncoveredRecovery = options.version === "v2" && hasUncoveredSettledWoundedRecovery(snapshot, owner, main);
  if (wellsNearMain >= desiredWells && !uncoveredRecovery) return undefined;

  const ownCombat = combatUnits(snapshot, owner);
  const woundedDefenders = ownCombat.filter((unit) => unit.hp < unit.maxHp * 0.72 && distance(unit, main) <= 720);
  const pressured = healingWellPressure(snapshot, owner, main, options);
  const firstWellBeforeExpansionBank = shouldBuildFirstHealingWellBeforeExpansionBank(snapshot, owner, woundedDefenders, options);
  const wantsWell = uncoveredRecovery || firstWellBeforeExpansionBank || woundedDefenders.length >= 2 || (options.version === "v2" && pressured && ownCombat.some((unit) => unit.hp < unit.maxHp * 0.86));
  if (!wantsWell) return undefined;
  if (shouldRebuildCombatBeforeHealingWell(snapshot, owner, ownCombat, options)) return undefined;
  if (needsMainGuardTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.moonWell.cost) return undefined;
  if (shouldReserveForEmergencyTower(snapshot, owner, options) && player.gold < BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.moonWell.cost) return undefined;
  if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, BUILDING_DEFS.moonWell.cost)) return undefined;
  if (!firstWellBeforeExpansionBank && shouldHoldClearedExpansionBank(snapshot, owner, options, BUILDING_DEFS.moonWell.cost)) return undefined;
  if (!firstWellBeforeExpansionBank && shouldHoldFirstExpansionBank(snapshot, owner, options, BUILDING_DEFS.moonWell.cost)) return undefined;
  if (
    !pressured &&
    !firstWellBeforeExpansionBank &&
    shouldReserveForExpansion(snapshot, owner, options) &&
    player.gold < BUILDING_DEFS.townHall.cost + BUILDING_DEFS.moonWell.cost
  )
    return undefined;

  const builder = availableBuilder(snapshot, owner, main, options);
  if (!builder) return undefined;
  const point = healingWellPointFor(snapshot, owner, main);
  return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "moonWell", x: point.x, y: point.y }, options);
}

function shouldBuildFirstHealingWellBeforeExpansionBank(snapshot: GameSnapshot, owner: PlayerId, woundedDefenders: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "moonWell")) return false;
  // @@@first-well-before-bank - A far-from-complete expansion bank should not strand wounded defenders without the first healing source.
  const gold = playerState(snapshot, owner).gold;
  if (woundedDefenders.some((unit) => unit.hp < unit.maxHp * 0.2)) return gold < BUILDING_DEFS.townHall.cost;
  return woundedDefenders.length >= 2 && gold < BUILDING_DEFS.townHall.cost - BUILDING_DEFS.moonWell.cost;
}

function hasUncoveredSettledWoundedRecovery(snapshot: GameSnapshot, owner: PlayerId, main: Point) {
  const wells = buildings(snapshot, owner).filter((building) => building.kind === "moonWell" && building.complete && building.hp > 0);
  if (wells.length === 0) return false;
  const uncovered = combatUnits(snapshot, owner).filter(
    (unit) =>
      unit.hp / Math.max(1, unit.maxHp) <= 0.5 &&
      distance(unit, main) <= 760 &&
      (unit.order.type === "idle" || unit.order.type === "move") &&
      wells.every((well) => distance(unit, well) > BUILDING_DEFS.moonWell.attackRange),
  );
  return uncovered.length >= 2;
}

function shouldRebuildCombatBeforeHealingWell(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (ownCombat.length >= 2) return false;
  const player = playerState(snapshot, owner);
  for (const building of buildings(snapshot, owner).filter((candidate) => candidate.complete && candidate.queue.length === 0)) {
    const unitKind = trainingChoice(snapshot, owner, building, options);
    if (!unitKind || unitKind === "worker") continue;
    const cost = UNIT_DEFS[unitKind].cost;
    // @@@thin-army-before-healing - A moon well helps wounded units, but with one defender left it must not consume the first rebuild unit.
    if (player.gold >= cost && player.gold < BUILDING_DEFS.moonWell.cost + cost && canSupply(snapshot, owner, unitKind)) return true;
  }
  return false;
}

function shouldHoldClearedExpansionBank(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, spendCost: number) {
  // @@@cleared-expansion-bank - A cleared natural is a near-finished economy action; comfort buildings must not keep resetting the hall clock.
  const mine = activeClearedExpansionClaim(snapshot, owner, options);
  if (!mine) return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  if (neutralUnitsNear(snapshot, mine, 280).length > 0) return false;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  return playerState(snapshot, owner).gold <= BUILDING_DEFS.townHall.cost + spendCost;
}

function activeClearedExpansionClaim(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ResourceNode | undefined {
  return claimedClearedExpansion(snapshot, owner, options, { includeActiveArmyClaim: true });
}

function rememberedClearedExpansionClaim(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ResourceNode | undefined {
  return claimedClearedExpansion(snapshot, owner, options, { includeActiveArmyClaim: false });
}

function claimedClearedExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, claimOptions: { includeActiveArmyClaim: boolean }): ResourceNode | undefined {
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine || !options.memory) return undefined;
  const hasActiveArmyClaim = Object.values(options.memory.unitClaims).some((claim) => claim.kind === "expansion" && claim.targetId === mine.id && claim.expiresTick >= snapshot.tick);
  if (hasActiveArmyClaim) return claimOptions.includeActiveArmyClaim ? mine : undefined;
  const plan = options.memory.strategicPlan;
  if (plan?.expansionClaimTargetId !== mine.id || plan.expansionClaimTick === undefined) return undefined;
  return plan.expansionClaimTick + EXPANSION_CLAIM_MEMORY_TICKS >= snapshot.tick ? mine : undefined;
}

function planMercenary(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const army = combatUnits(snapshot, owner);
  const movable = army.filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove");
  const enemyArmy = enemyCombatUnits(snapshot, owner, options.teams);
  // @@@merc-yields-to-closeout - Mercenary control converts spare map control into army value; it must not pull the main army away from a live kill window.
  if (options.version === "v2" && shouldMercenaryYieldToCloseout(snapshot, owner, army, movable, enemyArmy, options)) return undefined;
  const candidates = mercenaryCamps(snapshot)
    .filter((camp) => camp.stock > 0 && camp.cooldownRemaining === 0)
    .filter((camp) => neutralGuardsNear(snapshot, camp, 260).length === 0)
    .filter((camp) => hiredMercenaryCount(snapshot, owner, camp.hireKind) < mercenaryRoleLimit(camp.hireKind))
    .filter((camp) => canSupply(snapshot, owner, camp.hireKind))
    .filter((camp) => {
      // @@@merc-move-vs-hire - Affording a mercenary only matters once a unit controls the camp; walking there is a separate map-control decision.
      if (friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length > 0) return canHireMercenary(snapshot, owner, camp, options);
      return canMoveToMercenaryCampBeforeHire(snapshot, owner, camp, options);
    });
  const camp = candidates.sort((a, b) => mercenaryCampScore(b, snapshot, owner, options) - mercenaryCampScore(a, snapshot, owner, options))[0];
  if (!camp) return undefined;
  if (friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0) {
    if (shouldYieldMercenaryMoveToTrainingBacklog(snapshot, owner, options)) return undefined;
    return moveToMercenaryCamp(snapshot, owner, camp, options);
  }
  return canHireMercenary(snapshot, owner, camp, options) ? resolveAiCommandIntent(snapshot, owner, { type: "hire", campId: camp.id }, options) : undefined;
}

function shouldMercenaryYieldToCloseout(snapshot: GameSnapshot, owner: PlayerId, army: Unit[], movable: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  if (!closeoutAttackWaveTarget(snapshot, owner, army, movable, enemyArmy, options)) return false;
  if (enemyArmy.length <= 4) return true;
  // @@@merc-closeout-gate - A free camp walk should not be suppressed by base racing while the opponent still has a material combat ball.
  return armyPower(enemyArmy) <= armyPower(army) * 0.42;
}

function shouldYieldMercenaryMoveToTrainingBacklog(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (playerState(snapshot, owner).gold < 480) return false;
  if (activeMiningBaseCount(snapshot, owner) < 2 && combatUnits(snapshot, owner).length < 8) return false;
  // @@@merc-move-yields-to-production - Free camp walking is useful, but a late bank with idle core production must turn into army first.
  return planTraining(snapshot, owner, options).some(
    (command) => command.type === "train" && buildings(snapshot, owner).some((building) => building.id === command.buildingId && isCoreProductionBuilding(building)),
  );
}

function moveToMercenaryCamp(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (mainBaseNeedsObjectivePause(snapshot, owner, options)) return undefined;
  if (options.version === "v2" && !hasEstablishedExpansion(snapshot, owner) && enemyCombatUnits(snapshot, owner, options.teams).length > 0) return undefined;
  const squad = combatUnits(snapshot, owner).filter((unit) => (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove") && (options.version !== "v2" || !activeUnitClaim(snapshot, owner, unit, options)));
  if (squad.length === 0) return undefined;
  const movers = staleAttackMovers(squad, camp);
  const candidates = movers.length > 0 ? movers : squad.filter((unit) => unit.order.type === "attackMove" && distance(unit.order, camp) <= ATTACK_MOVE_REDIRECT_DISTANCE);
  const claimants = options.version === "v2" ? nearestEntities(candidates, camp).slice(0, Math.min(3, candidates.length)) : candidates;
  return claimants.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: claimants.map((unit) => unit.id), x: camp.x, y: camp.y }, options) : undefined;
}

function shouldSpendExpansionReserveOnControlledMercenary(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (!shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  if (playerState(snapshot, owner).gold >= BUILDING_DEFS.townHall.cost) return false;
  if (friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0) return false;
  // @@@controlled-merc-after-natural - A controlled camp is real value, but not at the exact tick the first cleared town hall can start.
  return camp.hireKind !== "fieldMedic" || units(snapshot, owner).some((unit) => unit.kind !== "worker" && unit.hp < unit.maxHp * 0.72);
}

function canHireMercenary(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp, options: PresetAiPolicyOptions) {
  const player = playerState(snapshot, owner);
  if (player.gold < camp.cost) return false;
  const missingProduction = options.version === "v2" ? productionBuildingNeedKind(snapshot, owner, options) : undefined;
  if (missingProduction && player.gold < BUILDING_DEFS[missingProduction].cost + camp.cost) return false;
  if (shouldReserveForHealingWell(snapshot, owner, options) && player.gold < BUILDING_DEFS.moonWell.cost + camp.cost) return false;
  // @@@merc-claim-before-spend - Walking to a cleared mercenary camp is free; only the hire itself competes with first-expansion gold.
  if (shouldReserveForExpansion(snapshot, owner, options) && player.gold < BUILDING_DEFS.townHall.cost + camp.cost && !shouldSpendExpansionReserveOnControlledMercenary(snapshot, owner, camp, options)) return false;
  return true;
}

function canMoveToMercenaryCampBeforeHire(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (opponentPlayerIds(snapshot, owner, options).length >= 2) return false;
  if (firstNaturalNeedsClearing(snapshot, owner)) return false;
  // @@@merc-preclaim-after-first-mine - Free walking is still a real army split; before the first expansion, keep the squad available while enemy combat exists.
  if (!hasEstablishedExpansion(snapshot, owner) && enemyCombatUnits(snapshot, owner, options.teams).length > 0) return false;
  if (!hasEstablishedExpansion(snapshot, owner) && !isLocalFirstMercenaryClaim(snapshot, owner, camp)) return false;
  if (hasEstablishedExpansion(snapshot, owner) && combatUnits(snapshot, owner).length < 8 && enemyCombatUnits(snapshot, owner, options.teams).length > 0) return false;
  return friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0;
}

function isLocalFirstMercenaryClaim(snapshot: GameSnapshot, owner: PlayerId, camp: MercenaryCamp) {
  const main = mainBase(snapshot, owner);
  const natural = desiredExpansionMine(snapshot, owner);
  // @@@merc-preclaim-radius - Before the first expansion, free camp pre-claims are map-control setup near home, not an excuse to drag the army into the enemy half.
  const localRadius = Math.max(1_400, natural ? distance(main, natural) + 360 : 0);
  return distance(main, camp) <= localRadius;
}

function firstNaturalNeedsClearing(snapshot: GameSnapshot, owner: PlayerId) {
  if (hasEstablishedExpansion(snapshot, owner)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  return Boolean(mine && neutralUnitsNear(snapshot, mine, 280).length > 0);
}

function mercenaryCampScore(camp: MercenaryCamp, snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const army = combatUnits(snapshot, owner);
  const anchor = army.length > 0 ? averagePoint(army) : mainBase(snapshot, owner);
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
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
  const routineWantedWorkers = routineWorkerCount(snapshot, owner, options);
  const repairLaborWorkers = wantsOneBaseRepairLabor(snapshot, owner, options) ? 1 : 0;
  const cheapWorkerRecovery = needsCheapWorkerRecovery(snapshot, owner, options);
  const wantedWorkers = cheapWorkerRecovery ? Math.max(routineWantedWorkers + repairLaborWorkers, 8) : routineWantedWorkers + repairLaborWorkers;
  const needsCoreArmy = shouldFinishCoreArmyBeforeMoreProduction(snapshot, owner, options);
  const nextMissingProduction = needsCoreArmy ? undefined : productionBuildingNeedKind(snapshot, owner, options);
  const missingProduction =
    nextMissingProduction && shouldTrainBeforeThirdProduction(snapshot, owner, nextMissingProduction, options) ? undefined : nextMissingProduction;
  const saturatingTwoMines = options.version === "v2" && activeMiningBaseCount(snapshot, owner) >= 2 && workerCount < routineWantedWorkers;
  const canRebuildArmyWhileSaturatingTwoMines = saturatingTwoMines && player.gold >= UNIT_DEFS.worker.cost + UNIT_DEFS.footman.cost;
  const reserveMainGuardTower = needsMainGuardTower(snapshot, owner, options);
  const reserveEmergencyTower = shouldReserveForEmergencyTower(snapshot, owner, options);
  const reserveHealingWell = shouldReserveForHealingWell(snapshot, owner, options);
  const reserveExpansion = shouldReserveForExpansion(snapshot, owner, options);
  const reserveDuplicateProduction = duplicateCoreProductionReserveKind(snapshot, owner, options);
  const needsFirstCombatRecovery =
    options.version === "v2" && hasCoreProduction(snapshot, owner) && combatUnits(snapshot, owner).length < 2 && workerCount >= Math.min(5, routineWantedWorkers);
  const restoreCombatBeforeWorkers = needsFirstCombatRecovery && player.gold >= UNIT_DEFS.footman.cost && !canRebuildArmyWhileSaturatingTwoMines;
  // @@@first-combat-recovery-bank - After the army is wiped, spending the 75g worker threshold can prevent ever reaching the first 100g fighting unit.
  const holdFirstCombatRecoveryGold =
    needsFirstCombatRecovery &&
    (completeBuildings(snapshot, owner, "townHall").length >= 2 || combatUnits(snapshot, owner).length > 0) &&
    enemyCombatUnits(snapshot, owner, options.teams).length > 0 &&
    player.gold >= UNIT_DEFS.worker.cost &&
    player.gold < UNIT_DEFS.footman.cost;
  const holdThinTwoMineDefenseBank = shouldHoldThinTwoMineDefenseBank(snapshot, owner, options, player.gold, workerCount, routineWantedWorkers);
  const commands: GameCommand[] = [];
  let remainingGold = player.gold;
  let reservedSupply = projectedSupplyUsed(snapshot, owner);
  let queuedWorkers = queuedUnitCount(snapshot, owner, "worker");

  for (const building of trainingBuildingsByPriority(snapshot, owner, options)) {
    const projectedWorkers = workerCount + queuedWorkers;
    const needsRoutineWorker = !needsCoreArmy && !restoreCombatBeforeWorkers && !holdFirstCombatRecoveryGold && !holdThinTwoMineDefenseBank && projectedWorkers < routineWantedWorkers;
    const needsRepairLaborWorker =
      !needsCoreArmy &&
      !restoreCombatBeforeWorkers &&
      !holdFirstCombatRecoveryGold &&
      !holdThinTwoMineDefenseBank &&
      projectedWorkers >= routineWantedWorkers &&
      projectedWorkers < routineWantedWorkers + repairLaborWorkers;
    const needsRecoveryWorker = !restoreCombatBeforeWorkers && !holdFirstCombatRecoveryGold && !holdThinTwoMineDefenseBank && cheapWorkerRecovery && projectedWorkers >= routineWantedWorkers && projectedWorkers < wantedWorkers;
    const needsWorker = building.kind === "townHall" && (needsRoutineWorker || needsRepairLaborWorker || needsRecoveryWorker);
    const unitKind = needsWorker ? "worker" : trainingChoice(snapshot, owner, building, options);
    if (!unitKind) continue;
    const cost = UNIT_DEFS[unitKind].cost;
    const routineWorkerSaturation = unitKind === "worker" && projectedWorkers < routineWantedWorkers;
    const workerSaturatingEstablishedMines = unitKind === "worker" && activeMiningBaseCount(snapshot, owner) >= 2 && projectedWorkers < routineWantedWorkers;
    const nearTowerMoney = remainingGold >= BUILDING_DEFS.defenseTower.cost - 10;
    const reserveSensitive = unitKind !== "worker" || (!routineWorkerSaturation && !cheapWorkerRecovery) || ((reserveMainGuardTower || reserveEmergencyTower) && nearTowerMoney);
    const canSpendTowerReserveOnTraining = unitKind !== "worker" && shouldSpendUnaffordableTowerReserveOnTraining(snapshot, owner, options, remainingGold);
    const canSpendExpansionReserveOnTraining = unitKind !== "worker" && shouldSpendExpansionReserveOnTraining(snapshot, owner, options, remainingGold, cost);
    const canSpendEarlyFirstExpansionBankOnTraining =
      unitKind !== "worker" && shouldSpendEarlyFirstExpansionBankOnTraining(snapshot, owner, options, remainingGold, cost);
    const canSpendProductionReserveOnTraining =
      unitKind !== "worker" && missingProduction ? shouldSpendStrategicBankOnBaseThreatTraining(snapshot, owner, options, remainingGold, cost) : false;
    if (
      reserveSensitive &&
      missingProduction &&
      !workerSaturatingEstablishedMines &&
      !canSpendProductionReserveOnTraining &&
      !canSpendEarlyFirstExpansionBankOnTraining &&
      remainingGold < BUILDING_DEFS[missingProduction].cost + cost
    )
      continue;
    if (reserveSensitive && reserveMainGuardTower && !canSpendTowerReserveOnTraining && remainingGold < BUILDING_DEFS.defenseTower.cost + cost) continue;
    if (reserveSensitive && reserveEmergencyTower && !canSpendTowerReserveOnTraining && remainingGold < BUILDING_DEFS.defenseTower.cost + cost) continue;
    if (reserveSensitive && reserveHealingWell && remainingGold < BUILDING_DEFS.moonWell.cost + cost) continue;
    if (shouldReserveForControlledMercenaryHire(snapshot, owner, options, cost, remainingGold)) continue;
    if (reserveSensitive && !canSpendEarlyFirstExpansionBankOnTraining && shouldHoldFirstExpansionBank(snapshot, owner, options, cost, remainingGold)) continue;
    if (reserveSensitive && shouldHoldTwoBaseWeaponUpgradeBank(snapshot, owner, options, remainingGold, cost)) continue;
    if (reserveSensitive && reserveExpansion && !canSpendExpansionReserveOnTraining && !canSpendEarlyFirstExpansionBankOnTraining && remainingGold < BUILDING_DEFS.townHall.cost + cost) continue;
    if (reserveSensitive && reserveDuplicateProduction && remainingGold < BUILDING_DEFS[reserveDuplicateProduction].cost + cost) continue;
    if (remainingGold < cost || reservedSupply + UNIT_DEFS[unitKind].supplyUsed > player.supplyCap) continue;
    commands.push(resolveAiCommandIntent(snapshot, owner, { type: "train", buildingId: building.id, unitKind }, options));
    remainingGold -= cost;
    reservedSupply += UNIT_DEFS[unitKind].supplyUsed;
    if (unitKind === "worker") queuedWorkers += 1;
  }
  return commands;
}

function shouldSpendUnaffordableTowerReserveOnTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, availableGold: number) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length < 2) return false;
  if (availableGold >= BUILDING_DEFS.defenseTower.cost) return false;
  const ownCombat = combatUnits(snapshot, owner);
  if (ownCombat.length >= 8) return false;
  const main = mainBase(snapshot, owner);
  const enemies = enemyCombatUnitsNear(snapshot, owner, main, 1_850, options.teams);
  // @@@unaffordable-tower-bank-break - A tower bank is only useful once the tower can start; while outpowered before 125g, idle production loses the army that would defend it.
  return enemies.length > ownCombat.length && armyPower(enemies) > armyPower(ownCombat) * 1.05;
}

function shouldSpendStrategicBankOnBaseThreatTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, availableGold: number, spendCost: number) {
  if (options.version !== "v2") return false;
  if (availableGold < spendCost) return false;
  const ownCombat = combatUnits(snapshot, owner);
  if (ownCombat.length < 6) return false;
  const bases = completeBuildings(snapshot, owner, "townHall");
  if (!bases.some((base) => enemyCombatUnitsNear(snapshot, owner, base, 1_250, options.teams).length >= 5)) return false;
  const enemyArmy = enemyCombatUnits(snapshot, owner, options.teams);
  // @@@strategic-bank-under-pressure - Tech and upgrade banks are plans; a stronger army entering base range is a current fight.
  return armyPower(enemyArmy) > armyPower(ownCombat) * 1.16;
}

function trainingBuildingsByPriority(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const candidates = buildings(snapshot, owner).filter((candidate) => candidate.complete && candidate.queue.length === 0);
  if (shouldPrioritizeFirstRangedTraining(snapshot, owner, options, candidates)) {
    return [...candidates].sort((a, b) => Number(b.kind === "archeryRange") - Number(a.kind === "archeryRange"));
  }
  if (!shouldPrioritizeWoundedPriestTraining(snapshot, owner, options)) return candidates;
  return [...candidates].sort((a, b) => Number(b.kind === "sanctum") - Number(a.kind === "sanctum"));
}

function shouldPrioritizeFirstRangedTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, candidates: Building[]) {
  if (options.version !== "v2") return false;
  if (!candidates.some((building) => building.kind === "archeryRange")) return false;
  const army = combatUnits(snapshot, owner);
  if (army.length < 3) return false;
  // @@@first-ranged-training - A low-gold melee-only army can keep feeding creep camps; the first ranged unit is a composition milestone, not routine variety.
  return !army.some((unit) => UNIT_DEFS[unit.kind].attackRange > 120);
}

function shouldHoldTwoBaseWeaponUpgradeBank(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, availableGold: number, spendCost: number) {
  if (options.version !== "v2") return false;
  if (activeMiningBaseCount(snapshot, owner) < 2) return false;
  if (upgradeLevel(snapshot, owner, "weaponTraining") !== 1) return false;
  if (!upgradeAvailable(snapshot, owner, "weaponTraining")) return false;
  if (upgradeBenefitingUnits(snapshot, owner, "weaponTraining").length < 8) return false;
  const level = nextUpgradeLevelDef(snapshot, owner, "weaponTraining");
  if (!level) return false;
  if (shouldSpendStrategicBankOnBaseThreatTraining(snapshot, owner, options, availableGold, spendCost)) return false;
  // @@@two-base-weapon-bank - After ranged/tower nerfs, a large two-base army needs weapon2; the first 100g unit spend keeps resetting the 215g timing.
  return availableGold < level.cost && availableGold >= UNIT_DEFS.footman.cost && availableGold - spendCost < level.cost;
}

function shouldSpendExpansionReserveOnTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, availableGold: number, spendCost: number) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (!buildings(snapshot, owner).some((building) => building.complete && isCoreProductionBuilding(building))) return false;
  const ownCombatCount = combatUnits(snapshot, owner).length;
  // @@@cleared-natural-bank - Once the first natural is cleared, five fighters are enough to stop dribbling the town-hall bank into one more unit.
  if (opponentPlayerIds(snapshot, owner, options).length >= 2 && ownCombatCount >= 5 && shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  // @@@thin-bank-tempo - A near-ready natural is not worth idling core production when the visible field army is already outnumbering the first squad.
  if (ownCombatCount < 7 && enemyCombatUnits(snapshot, owner, options.teams).length > ownCombatCount) return true;
  // @@@expansion-reserve-training - First natural reserve starts near the hall cost; before that, idle core production loses the map.
  if (availableGold < BUILDING_DEFS.townHall.cost - 80 && availableGold - spendCost >= UNIT_DEFS.worker.cost && ownCombatCount < 6) return true;
  return healingWellPressure(snapshot, owner, mainBase(snapshot, owner), options);
}

function shouldSpendEarlyFirstExpansionBankOnTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, availableGold: number, spendCost: number) {
  if (options.version !== "v2") return false;
  if (availableGold < spendCost || availableGold > BUILDING_DEFS.townHall.cost - 70) return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  if (!shouldReserveForExpansion(snapshot, owner, options)) return false;
  if (!buildings(snapshot, owner).some((building) => building.complete && isCoreProductionBuilding(building))) return false;
  const ownCombat = combatUnits(snapshot, owner);
  if (ownCombat.length < 7 || ownCombat.length >= 8) return false;
  const enemyCombat = enemyCombatUnits(snapshot, owner, options.teams);
  if (enemyCombat.length <= ownCombat.length) return false;
  // @@@early-expansion-bank-defender - At the first bank threshold, one more body can hold the cleared natural; near 320g the hall timing matters more.
  return armyPower(enemyCombat) >= armyPower(ownCombat) * 0.96;
}

function canSpendExpansionRetryBankOnCoreProduction(snapshot: GameSnapshot, owner: PlayerId, missing: ProductionBuildingKind, options: PresetAiPolicyOptions) {
  return failedExpansionAttemptBeforeCoreProduction(snapshot, owner, options) && missingCombatProductionKind(snapshot, owner) === missing;
}

function failedExpansionAttemptBeforeCoreProduction(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (options.memory?.strategicPlan?.expansionAttemptTick === undefined) return false;
  if (!missingCombatProductionKind(snapshot, owner)) return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  // @@@cleared-expansion-retry - Attempt memory marks a failed claim only while the natural is still blocked; once it is cleared, the bank should finish the hall.
  if (shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  return !buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete);
}

function shouldReserveForControlledMercenaryHire(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, spendCost: number, availableGold = playerState(snapshot, owner).gold) {
  const camp = controlledMercenaryHireReserveCamp(snapshot, owner, options);
  // @@@controlled-merc-bank-window - Combat mercenaries only bank near hire; a held field-medic camp with wounded troops must start banking before routine training resets the window.
  const reserveStart = camp?.hireKind === "fieldMedic" ? UNIT_DEFS.footman.cost : (camp?.cost ?? 0) - 45;
  return Boolean(camp && availableGold >= reserveStart && availableGold < camp.cost + spendCost);
}

function shouldReleaseFieldMedicReserveForCombatTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const ownCombat = combatUnits(snapshot, owner);
  if (ownCombat.length >= 8) return false;
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
  // @@@field-medic-bank-break - A future medic cannot matter if banking for it idles production while the visible army is already losing numbers and power.
  return enemies.length > ownCombat.length && armyPower(enemies) > armyPower(ownCombat) * 1.05;
}

function controlledMercenaryHireReserveCamp(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return undefined;
  const player = playerState(snapshot, owner);
  // @@@controlled-merc-bank - A held cleared camp is a near-certain combat conversion; routine spending should not reset the hire clock.
  return mercenaryCamps(snapshot)
    .filter((camp) => camp.stock > 0 && camp.cooldownRemaining === 0)
    .filter((camp) => neutralGuardsNear(snapshot, camp, 260).length === 0)
    .filter((camp) => friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length > 0)
    .filter((camp) => hiredMercenaryCount(snapshot, owner, camp.hireKind) < mercenaryRoleLimit(camp.hireKind))
    .filter((camp) => canSupply(snapshot, owner, camp.hireKind))
    .filter((camp) => camp.hireKind !== "fieldMedic" || units(snapshot, owner).some((unit) => unit.kind !== "worker" && unit.hp < unit.maxHp * 0.72))
    .filter((camp) => camp.hireKind !== "fieldMedic" || !shouldReleaseFieldMedicReserveForCombatTraining(snapshot, owner, options))
    .filter((camp) => player.gold < camp.cost)
    .sort((a, b) => mercenaryCampScore(b, snapshot, owner, options) - mercenaryCampScore(a, snapshot, owner, options))[0];
}

function shouldHoldFirstExpansionBank(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, spendCost: number, availableGold = playerState(snapshot, owner).gold) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  if (!shouldReserveForExpansion(snapshot, owner, options)) return false;
  if (combatUnits(snapshot, owner).length < 5) return false;
  if (availableGold < BUILDING_DEFS.townHall.cost - 80 || availableGold >= BUILDING_DEFS.townHall.cost + spendCost) return false;

  const main = mainBase(snapshot, owner);
  const directMainPressure = enemyCombatUnitsNear(snapshot, owner, main, 1_200, options.teams).length > 0;
  const mainGuarded = buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430);
  if (availableGold >= BUILDING_DEFS.townHall.cost - 20) {
    const immediateEnemies = enemyCombatUnitsNear(snapshot, owner, main, 760, options.teams);
    // @@@ready-hall-bank - Five seconds before the first expansion hall, distant pressure is not a reason to reset the economy timing with one routine unit.
    return immediateEnemies.length < 3 || armyPower(immediateEnemies) <= armyPower(combatUnits(snapshot, owner)) * 1.05;
  }
  // @@@first-expansion-bank - Once the natural is ready and the 320 gold is within reach, routine spending must stop unless the main is still naked under direct pressure.
  return !directMainPressure || mainGuarded || combatUnits(snapshot, owner).length >= 8;
}

function routineWorkerCount(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const bases = options.version === "v2" ? Math.max(1, activeMiningBaseCount(snapshot, owner)) : completeBuildings(snapshot, owner, "townHall").length;
  // @@@mine-worker-saturation - A mine pays up to five workers; repair/build labor is a separate need, not extra mine income.
  if (options.version === "v2") {
    return Math.min(12, bases * 5);
  }
  return Math.min(12, 2 + bases * 4);
}

function wantsOneBaseRepairLabor(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (activeMiningBaseCount(snapshot, owner) !== 1) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  const main = mainBase(snapshot, owner);
  // @@@one-base-labor - Five workers saturate one mine; a sixth worker is for building and tower repair, not extra income.
  return !units(snapshot, owner).some((unit) => unit.kind === "worker" && unit.order.type !== "mine" && distance(unit, main) <= 700);
}

function needsCheapWorkerRecovery(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const player = playerState(snapshot, owner);
  if (player.gold < UNIT_DEFS.worker.cost) return false;
  if (combatUnits(snapshot, owner).length >= 2) return false;
  const main = mainBase(snapshot, owner);
  return enemyCombatUnitsNear(snapshot, owner, main, 900, options.teams).length > 0;
}

function shouldHoldThinTwoMineDefenseBank(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, gold: number, workerCount: number, wantedWorkers: number) {
  if (options.version !== "v2") return false;
  if (activeMiningBaseCount(snapshot, owner) < 2 || workerCount >= wantedWorkers) return false;
  if (gold < UNIT_DEFS.worker.cost || gold >= BUILDING_DEFS.defenseTower.cost + UNIT_DEFS.worker.cost) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return false;
  const ownCombat = combatUnits(snapshot, owner);
  if (ownCombat.length < 2) return false;
  const enemies = enemyCombatUnitsNear(snapshot, owner, main, 1_850, options.teams);
  // @@@two-mine-defense-bank - Fresh two-mine income is fake if the next 100g becomes a worker while the first attack reaches an unguarded main.
  return enemies.length >= 2 && armyPower(enemies) > armyPower(ownCombat) * 1.05;
}

function planObjectiveControl(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const unsafeObjectiveRecall = recallUnsafeObjectiveClaims(snapshot, owner, options);
  if (unsafeObjectiveRecall) return unsafeObjectiveRecall;
  if (options.version === "v2" && (mainBaseNeedsObjectivePause(snapshot, owner, options) || ownedBaseNeedsObjectivePause(snapshot, owner, options))) return undefined;
  const firstNaturalRecovery = recallWoundedClearedExpansionClaim(snapshot, owner, options);
  if (firstNaturalRecovery) return firstNaturalRecovery;
  if (firstClearedExpansionClaimPausesObjectiveControl(snapshot, owner, options)) return undefined;
  const army = combatUnits(snapshot, owner).filter((unit) => (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove") && objectiveReadyUnit(snapshot, owner, unit, options));
  const minimumArmy = objectiveControlMinimumArmy(snapshot, owner, options);
  if (army.length < minimumArmy) return undefined;
  if (objectiveControlShouldYieldToCloseout(snapshot, owner, army, options)) return undefined;
  if (options.version === "v2" && armyCommittedToEnemyObjective(snapshot, owner, army, minimumArmy, options)) return undefined;
  const anchor = averagePoint(army);
  const maxObjectiveDistance = options.version === "v2" ? 1_450 : 900;
  const requiredPowerRatio = options.version === "v2" ? 1.05 : 1.15;
  const mercenaryTarget = mercenaryCamps(snapshot)
    .map((camp) => ({ camp, guards: neutralGuardsNear(snapshot, camp, 280) }))
    .filter((candidate) => candidate.guards.length > 0)
    .filter((candidate) => distance(candidate.camp, anchor) <= maxObjectiveDistance)
    .filter((candidate) => armyPower(army) >= armyPower(candidate.guards) * requiredPowerRatio)
    .filter((candidate) => !localEnemyControlNearObjective(snapshot, owner, candidate.camp, army, options))
    .filter((candidate) => !enemyControlsObjectiveRoute(snapshot, owner, anchor, candidate.camp, army, options))
    .sort((a, b) => objectiveCampScore(b.camp, b.guards, anchor) - objectiveCampScore(a.camp, a.guards, anchor))[0];
  const naturalTarget = guardedFirstNaturalObjective(snapshot, owner, army, anchor, maxObjectiveDistance, requiredPowerRatio, options);
  const target = naturalTarget ?? (mercenaryTarget ? { point: mercenaryTarget.camp } : neutralCampObjective(snapshot, owner, army, anchor, maxObjectiveDistance, requiredPowerRatio, options));
  if (!target) return undefined;
  const stale = staleAttackMovers(army, target.point);
  return stale.length >= minimumArmy ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: target.point.x, y: target.point.y }, options) : undefined;
}

function firstClearedExpansionClaimPausesObjectiveControl(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (hasEstablishedExpansion(snapshot, owner)) return false;
  if (firstNaturalNeedsClearing(snapshot, owner)) return false;
  // @@@first-natural-claim-pause - A cleared/claimed first natural is a bank-and-convert window; starting a second neutral objective splits the only army before the expansion pays back.
  return Boolean(activeClearedExpansionClaim(snapshot, owner, options) ?? rememberedClearedExpansionClaim(snapshot, owner, options));
}

function recallWoundedClearedExpansionClaim(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || !options.memory) return undefined;
  if (hasEstablishedExpansion(snapshot, owner)) return undefined;
  const mine = activeClearedExpansionClaim(snapshot, owner, options);
  if (!mine || firstNaturalNeedsClearing(snapshot, owner)) return undefined;
  const wells = buildings(snapshot, owner).filter((building) => building.kind === "moonWell" && building.complete && building.hp > 0);
  if (wells.length === 0) return undefined;
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
  const wounded = combatUnits(snapshot, owner)
    .filter((unit) => {
      const claim = activeUnitClaim(snapshot, owner, unit, options);
      return claim?.kind === "expansion" && claim.targetId === mine.id;
    })
    .filter((unit) => unit.hp < unit.maxHp * 0.72)
    .filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove")
    .filter((unit) => enemies.every((enemy) => distance(enemy, unit) > 520))
    .filter((unit) => {
      const well = nearestEntity(wells, unit);
      return Boolean(well && distance(unit, well) > BUILDING_DEFS.moonWell.attackRange - 12);
    });
  if (wounded.length === 0) return undefined;
  const point = healingRecoveryPoint(snapshot, wounded, wells);
  const stale = wounded.filter((unit) => distance(unit, point) > 110);
  // @@@first-natural-healing-recall - A cleared natural claim should bank the hall, but wounded claimants parked outside moon-well range are dead supply, not map control.
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: point.x, y: point.y }, options) : undefined;
}

function healingRecoveryPoint(snapshot: GameSnapshot, wounded: Unit[], wells: Building[]): Point {
  const center = averagePoint(wounded);
  const well = nearestEntity(wells, center) ?? wells[0]!;
  const dx = center.x - well.x;
  const dy = center.y - well.y;
  const length = Math.hypot(dx, dy) || 1;
  const radius = BUILDING_DEFS.moonWell.attackRange * 0.75;
  return {
    x: clamp(well.x + (dx / length) * radius, 0, snapshot.map.width),
    y: clamp(well.y + (dy / length) * radius, 0, snapshot.map.height),
  };
}

function objectiveControlShouldYieldToCloseout(snapshot: GameSnapshot, owner: PlayerId, army: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || army.length < 7) return false;
  if (opponentIsReducedToBuildings(snapshot, owner, options)) return Boolean(closeoutAttackWaveTarget(snapshot, owner, army, army, [], options));
  if (!hasEstablishedExpansion(snapshot, owner)) return false;
  // @@@closeout-before-creeps - After first expansion, a live closeout window with only residual defenders should not be lost to neutral cleanup.
  return Boolean(closeoutAttackWaveTarget(snapshot, owner, army, army, enemyCombatUnits(snapshot, owner, options.teams), options));
}

function recallUnsafeObjectiveClaims(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || !options.memory) return undefined;
  const groups = new Map<string, { point: Point; units: Unit[] }>();
  for (const unit of combatUnits(snapshot, owner)) {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    if (!claim || (claim.kind !== "creep" && claim.kind !== "mercenary")) continue;
    if (unit.order.type !== "idle" && unit.order.type !== "move" && unit.order.type !== "attackMove" && unit.order.type !== "attack") continue;
    const group = groups.get(claim.targetId) ?? { point: { x: claim.x, y: claim.y }, units: [] };
    group.units.push(unit);
    groups.set(claim.targetId, group);
  }
  for (const [targetId, group] of groups) {
    if (group.units.length < 3) continue;
    if (neutralClaimNeedsRecovery(snapshot, owner, group.point, group.units)) {
      const rally = defensiveRallyPoint(snapshot, owner);
      // @@@neutral-claim-recovery - A creep claim is a commitment, but once the committed squad is badly wounded the correct continuation is recovery, not more camp orders.
      const stale = group.units.filter((unit) => distance(unit, rally) > 220);
      return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y }, options) : undefined;
    }
    if (!localEnemyControlNearObjective(snapshot, owner, group.point, group.units, options) && !enemyControlsObjectiveRoute(snapshot, owner, averagePoint(group.units), group.point, group.units, options)) continue;
    for (const unit of group.units) delete options.memory.unitClaims[unit.id];
    // @@@objective-claim-release - Long creep claims are useful until the route changes; then they must be actively broken or the squad keeps walking into the bad path.
    const rally = defensiveRallyPoint(snapshot, owner);
    const stale = group.units.filter((unit) => distance(unit, rally) > 220);
    return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y }, options) : undefined;
  }
  return undefined;
}

function neutralClaimNeedsRecovery(snapshot: GameSnapshot, owner: PlayerId, point: Point, units: Unit[]) {
  const guards = neutralUnitsNear(snapshot, point, 360);
  if (guards.length === 0) return false;
  const averageHpRatio = units.reduce((total, unit) => total + unit.hp / unit.maxHp, 0) / units.length;
  const main = mainBase(snapshot, owner);
  const hasHealingAtHome = buildings(snapshot, owner).some((building) => building.kind === "moonWell" && building.complete && distance(building, main) <= BUILDING_DEFS.moonWell.attackRange);
  // @@@no-well-creep-recovery - Without a healing well, moderate creep wounds do not recover at home; only break the claim when the squad is actually near donation range.
  return averageHpRatio <= (hasHealingAtHome ? 0.68 : 0.6);
}

function objectiveReadyUnit(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return true;
  if (activeUnitClaim(snapshot, owner, unit, options)) return false;
  if (unit.hp >= unit.maxHp * 0.36) return true;
  if (unit.order.type !== "move") return false;
  const main = mainBase(snapshot, owner);
  return distance(unit.order, main) >= distance(unit, main);
}

function armyCommittedToEnemyObjective(snapshot: GameSnapshot, owner: PlayerId, army: Unit[], minimumArmy: number, options: PresetAiPolicyOptions) {
  const committed = army.filter((unit) => unit.order.type === "attackMove" && attackMoveTargetsEnemyObjective(snapshot, owner, unit.order, options));
  return committed.length >= minimumArmy;
}

function attackMoveTargetsEnemyObjective(snapshot: GameSnapshot, owner: PlayerId, point: Point, options: PresetAiPolicyOptions) {
  return enemyBuildingsNear(snapshot, owner, point, 360, options.teams).some(
    (building) =>
      (building.kind !== "townHall" || !isMainBaseForOwner(snapshot, building.owner, building) || !building.complete),
  );
}

function objectiveControlMinimumArmy(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version === "v2" && !hasEstablishedExpansion(snapshot, owner) && combatUnits(snapshot, owner).length >= 4) return 4;
  return 5;
}

function guardedFirstNaturalObjective(snapshot: GameSnapshot, owner: PlayerId, army: Unit[], anchor: Point, maxDistance: number, requiredPowerRatio: number, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || !firstNaturalNeedsClearing(snapshot, owner)) return undefined;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return undefined;
  const guards = neutralGuardsNear(snapshot, mine, 280);
  if (guards.length === 0) return undefined;
  const point = averagePoint(guards);
  if (distance(point, anchor) > maxDistance) return undefined;
  if (armyPower(army) < armyPower(guards) * requiredPowerRatio) return undefined;
  if (localEnemyControlNearObjective(snapshot, owner, point, army, options)) return undefined;
  if (enemyControlsObjectiveRoute(snapshot, owner, anchor, point, army, options)) return undefined;
  return { point };
}

function opponentIsReducedToBuildings(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (!opponents.some((opponent) => buildings(snapshot, opponent).length > 0)) return false;
  return !opponents.some((opponent) => units(snapshot, opponent).length > 0);
}

function mainBaseNeedsObjectivePause(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const main = mainBase(snapshot, owner);
  if (options.version === "v2" && mainWorkerLineThreat(snapshot, owner, options)) return true;
  const threatRange = options.version === "v2" ? MAIN_APPROACH_THREAT_RANGE : 1_050;
  const enemies = enemyCombatUnitsNear(snapshot, owner, main, threatRange, options.teams);
  if (enemies.length < 3) return false;
  const nearbyDefenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, main) <= 900);
  if (options.version === "v2" && nearbyDefenders.length < enemies.length) return true;
  return armyPower(enemies) >= armyPower(nearbyDefenders) * 0.55;
}

function mainWorkerLineThreat(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const main = mainBase(snapshot, owner);
  const workers = units(snapshot, owner).filter((unit) => unit.kind === "worker" && distance(unit, main) <= 620);
  if (workers.length === 0) return false;
  const enemies = enemyCombatUnitsNear(snapshot, owner, main, 720, options.teams);
  return enemies.some((enemy) => workers.some((worker) => distance(enemy, worker) <= 300));
}

function ownedBaseNeedsObjectivePause(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  const main = mainBase(snapshot, owner);
  for (const base of buildings(snapshot, owner).filter((building) => building.kind === "townHall" && !building.complete && distance(building, main) > 500)) {
    const enemies = enemyCombatUnitsNear(snapshot, owner, base, 760, options.teams);
    if (enemies.length < 2) continue;
    const defenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, base) <= 820);
    // @@@unfinished-expansion-pause - In 1v2, an unfinished outer hall is a live liability; do not send the field army to creeps while enemies control that pocket.
    if (armyPower(enemies) >= armyPower(defenders) * 0.35) return true;
  }
  for (const base of completeBuildings(snapshot, owner, "townHall")) {
    if (base.id === (main as Partial<Building>).id) continue;
    const enemies = enemyCombatUnitsNear(snapshot, owner, base, 700, options.teams);
    if (enemies.length < 2) continue;
    const defenders = combatUnits(snapshot, owner).filter((unit) => distance(unit, base) <= 720);
    if (armyPower(enemies) >= armyPower(defenders) * 0.35) return true;
  }
  for (const base of fragileMiningExpansions(snapshot, owner)) {
    const approaching = enemyCombatUnitsNear(snapshot, owner, base, 1_500, options.teams);
    if (approaching.length >= 2 && armyPower(approaching) >= 1.8) return true;
  }
  return false;
}

function fragileMiningExpansions(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  return completeBuildings(snapshot, owner, "townHall").filter((base) => {
    if (base.id === (main as Partial<Building>).id) return false;
    const mine = nearestResource(activeResources(snapshot), base);
    if (!mine || distance(mine, base) > 260) return false;
    const miners = units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === mine.id);
    const hasTower = buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, base) <= 430);
    return miners.length < 3 || !hasTower;
  });
}

function neutralCampObjective(snapshot: GameSnapshot, owner: PlayerId, army: Unit[], anchor: Point, maxDistance: number, requiredPowerRatio: number, options: PresetAiPolicyOptions) {
  const visited = new Set<string>();
  const itemByCarrier = new Map(items(snapshot).flatMap((item) => (item.carrierId ? [[item.carrierId, item]] as const : [])));
  const camps = [];
  for (const neutral of neutralUnitsNear(snapshot, anchor, maxDistance)) {
    if (visited.has(neutral.id)) continue;
    const guards = neutralCampCluster(snapshot, neutral, visited);
    const point = averagePoint(guards);
    const itemBonus = guards.reduce((total, guard) => total + neutralCampItemBonus(itemByCarrier.get(guard.id)), 0);
    if (distance(point, anchor) > maxDistance) continue;
    if (armyPower(army) < armyPower(guards) * requiredPowerRatio) continue;
    if (localEnemyControlNearObjective(snapshot, owner, point, army, options)) continue;
    if (enemyControlsObjectiveRoute(snapshot, owner, anchor, point, army, options)) continue;
    const bounty = guards.reduce((total, guard) => total + (UNIT_DEFS[guard.kind].goldBounty ?? 0), 0);
    const score = 50 + itemBonus + bounty * 0.65 + armyPower(guards) * 5 - distance(point, anchor) / 12;
    camps.push({ point, score });
  }
  return camps.sort((a, b) => b.score - a.score)[0];
}

function localEnemyControlNearObjective(snapshot: GameSnapshot, owner: PlayerId, point: Point, army: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const localEnemies = enemyCombatUnitsNear(snapshot, owner, point, 560, options.teams);
  if (localEnemies.length < 2) return false;
  // @@@local-objective-control - Global disadvantage can be acceptable; local enemy control of the objective itself makes a creep route bad.
  return armyPower(localEnemies) >= armyPower(army) * 0.75;
}

function enemyControlsObjectiveRoute(snapshot: GameSnapshot, owner: PlayerId, from: Point, point: Point, army: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const routeEnemies = enemyCombatUnits(snapshot, owner, options.teams).filter((enemy) => distance(enemy, point) > 560 && pointToSegmentDistance(enemy, from, point) <= 700);
  // @@@objective-route-control - A neutral objective is not free if reaching it walks beside the real enemy army.
  return routeEnemies.length >= 3 && armyPower(routeEnemies) >= armyPower(army) * 0.75;
}

function neutralCampCluster(snapshot: GameSnapshot, seed: Unit, visited: Set<string>) {
  const guards: Unit[] = [];
  const pending = [seed];
  visited.add(seed.id);
  while (pending.length > 0) {
    const current = pending.pop()!;
    guards.push(current);
    for (const candidate of neutralUnitsNear(snapshot, current, NEUTRAL_ASSIST_PLANNING_RANGE).filter((unit) => !visited.has(unit.id))) {
      visited.add(candidate.id);
      pending.push(candidate);
    }
  }
  return guards;
}

function neutralCampItemBonus(item: GameSnapshot["items"][number] | undefined) {
  if (!item) return 0;
  if (item.kind === "experienceBook") return 80;
  if (item.kind === "flameCloak" || item.kind === "lightningRod" || item.kind === "stormStaff" || item.kind === "breachCharge") return 95;
  return 55;
}

function planExpansionDenial(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const soldiers = combatUnits(snapshot, owner).filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove");
  if (soldiers.length < 5) return undefined;
  const ownMain = mainBase(snapshot, owner);
  if (nearestOpponentThreat(snapshot, owner, ownMain, 850, options)) return undefined;
  if (ownGuardedNaturalNeedsClearing(snapshot, owner, options)) return undefined;
  if (ownClearNaturalNeedsClaiming(snapshot, owner, options)) return undefined;
  const target = exposedEnemyExpansion(snapshot, owner, soldiers, options);
  if (!target) return undefined;
  if (expansionDenialRouteCovered(snapshot, owner, soldiers, target, options)) return undefined;
  const stale = staleAttackMovers(soldiers, target);
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: target.x, y: target.y }, options) : undefined;
}

function ownClearNaturalNeedsClaiming(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (hasEstablishedExpansion(snapshot, owner)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return false;
  return neutralUnitsNear(snapshot, mine, 280).length === 0 && !enemyPressure(snapshot, owner, mine, 360, options);
}

function ownGuardedNaturalNeedsClearing(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (hasEstablishedExpansion(snapshot, owner)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  return Boolean(mine && neutralUnitsNear(snapshot, mine, 280).length > 0);
}

function expansionDenialRouteCovered(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], target: Point, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  const start = averagePoint(soldiers);
  const enemyArmy = enemyCombatUnits(snapshot, owner, options.teams);
  const routeEnemies = enemyArmy.filter(
    (unit) =>
      distance(unit, target) > 520 &&
      pointToSegmentDistance(unit, start, target) <= 360,
  );
  const pocketEnemies = enemyArmy.filter((unit) => distance(unit, target) <= 900);
  // @@@expansion-denial-pocket - A greedy hall is not exposed if the two enemy armies already control the pocket around it.
  const coveredEnemies = new Map([...routeEnemies, ...pocketEnemies].map((unit) => [unit.id, unit]));
  return armyPower([...coveredEnemies.values()]) > armyPower(soldiers) * 1.15;
}

function exposedEnemyExpansion(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], options: PresetAiPolicyOptions): Building | undefined {
  const soldierCenter = averagePoint(soldiers);
  const ownPower = armyPower(soldiers);
  return enemyBuildings(snapshot, owner, options.teams)
    .filter((building) => building.kind === "townHall")
    .filter((building) => !isMainBaseForOwner(snapshot, building.owner, building))
    .map((building) => {
      const defenders = enemyCombatUnitsNear(snapshot, owner, building, 520, options.teams);
      const workers = units(snapshot, building.owner).filter((unit) => unit.kind === "worker" && distance(unit, building) <= 460);
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
  return neutralUnitsNear(snapshot, point, range);
}

function objectiveCampScore(camp: MercenaryCamp, guards: Unit[], anchor: Point) {
  return 80 + camp.stock * 14 + mercenaryRoleObjectiveBonus(camp.hireKind) + armyPower(guards) * 4 - distance(camp, anchor) / 12;
}

function mercenaryRoleObjectiveBonus(kind: MercenaryUnitKind) {
  if (kind === "contractArcher") return 34;
  if (kind === "fieldMedic") return 28;
  return 18;
}

function planExpansionRegroup(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (behaviorDisabled(options, "expansionRegroup")) {
    recordBehavior(options, "expansionRegroup", "disabledSkips");
    return undefined;
  }

  const townHalls = completeBuildings(snapshot, owner, "townHall");
  if (townHalls.length < 2) return undefined;

  const ownCombat = combatUnits(snapshot, owner);
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
  const main = mainBase(snapshot, owner);
  for (const mine of ownedMiningLocations(snapshot, owner, townHalls)) {
    const nearestMineTownHall = nearestEntity(townHalls, mine);
    if (nearestMineTownHall?.id === (main as Partial<Building>).id) continue;
    const anchor = nearestEntity(ownCombat.filter((unit) => distance(unit, mine) <= 620), mine);
    if (!anchor) continue;
    const allies = ownCombat.filter((unit) => distance(unit, anchor) <= 520);
    if (allies.length < 2) continue;
    const localEnemies = enemies.filter((unit) => distance(unit, anchor) <= 560);
    if (localEnemies.length < 2) continue;
    if (armyPower(localEnemies) <= armyPower(allies) * 1.35) continue;
    const regroupBase = nearestEntity(townHalls.filter((building) => building.id !== nearestMineTownHall?.id), mine);
    if (!regroupBase) continue;
    recordBehavior(options, "expansionRegroup", "attempts");
    recordBehavior(options, "expansionRegroup", "expansionRegroupRetreats");
    return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: allies.map((unit) => unit.id), x: regroupBase.x, y: regroupBase.y }, options);
  }
  return undefined;
}

function planWorkerPressure(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (options.version !== "v2" || opponents.length < 2) return undefined;
  return workerPressureCommand(snapshot, owner, options);
}

function planWorkerPressureCloseout(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (options.version !== "v2" || opponents.length !== 1) return undefined;
  if (hasCoreProduction(snapshot, opponents[0]!)) return undefined;
  return workerPressureCommand(snapshot, owner, options);
}

function workerPressureCommand(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (behaviorDisabled(options, "workerHarassment")) {
    recordBehavior(options, "workerHarassment", "disabledSkips");
    return undefined;
  }
  const soldiers = combatUnits(snapshot, owner).filter(
    (unit) => (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack") && harassmentReadyUnit(snapshot, owner, unit, options),
  );
  if (soldiers.length < 3) return undefined;
  if (workerPressureShouldYieldToMainThreat(snapshot, owner, soldiers, options)) return undefined;
  const target = workerPressureTarget(snapshot, owner, soldiers, options);
  if (!target) return undefined;
  const pressureUnits = workerPressureUnits(snapshot, owner, soldiers, target, options);
  if (pressureUnits.length < 3) return undefined;
  if (workerPressureAnsweredByLocalArmy(snapshot, owner, pressureUnits, target, options)) return undefined;
  if (workerPressureRouteCoveredByOtherArmy(snapshot, owner, pressureUnits, target, options)) {
    const rally = defensiveRallyPoint(snapshot, owner);
    return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: pressureUnits.map((unit) => unit.id), x: rally.x, y: rally.y }, options);
  }
  if (opponentPlayerIds(snapshot, owner, options).length === 1) {
    const enemyArmy = enemyCombatUnits(snapshot, owner, options.teams);
    if (pressureUnits.some((unit) => unit.hp < unit.maxHp * 0.36 && enemyArmy.some((enemy) => distance(enemy, unit) <= 380))) return undefined;
  }
  if (options.memory && target.owner !== "neutral") {
    const focusTargetOwner = target.owner;
    options.memory.strategicPlan = {
      ...options.memory.strategicPlan,
      focusTargetOwner,
      focusTargetSinceTick: options.memory.strategicPlan?.focusTargetOwner === focusTargetOwner ? (options.memory.strategicPlan.focusTargetSinceTick ?? snapshot.tick) : snapshot.tick,
      focusTargetUpdatedTick: snapshot.tick,
    };
  }

  // @@@worker-pressure-job - Worker raids are a detachment job; 1v2 must not drain the first army before economy and wave integrity exist.
  return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: pressureUnits.map((unit) => unit.id), targetId: target.id }, options);
}

function workerPressureUnits(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], target: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return soldiers;
  const center = averagePoint(soldiers);
  if (distance(center, target) <= 900) return soldiers;
  if (activeMiningBaseCount(snapshot, owner) < 2) return [];
  if (soldiers.length < 6) return [];
  return nearestEntities(soldiers, target).slice(0, 3);
}

function workerPressureShouldYieldToMainThreat(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], options: PresetAiPolicyOptions) {
  if (opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (!mainBaseNeedsObjectivePause(snapshot, owner, options)) return false;
  // @@@cross-main-harass-yield - Only a far harassment group should abandon worker pressure because the other opponent is hitting home; a local group can still fight through the same command lane.
  return distance(averagePoint(soldiers), mainBase(snapshot, owner)) > 360;
}

function workerPressureAnsweredByLocalArmy(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], target: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  const center = averagePoint(soldiers);
  const answer = enemyCombatUnits(snapshot, owner, options.teams).filter((enemy) => enemy.owner === target.owner && distance(enemy, center) <= 1_050);
  // @@@worker-pressure-answer - A 1v2 worker raid is useful only until that same opponent's army catches the raid group.
  return answer.length >= Math.max(3, soldiers.length - 1) && armyPower(answer) >= armyPower(soldiers) * 0.65;
}

function workerPressureRouteCoveredByOtherArmy(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], target: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  const center = averagePoint(soldiers);
  if (distance(center, mainBase(snapshot, owner)) <= 700) return false;
  const targetBase = nearestEntity(buildings(snapshot, target.owner).filter((building) => building.kind === "townHall" && building.complete), target);
  if (targetBase && distance(target, targetBase) <= 620) return false;
  const blockers = enemyCombatUnits(snapshot, owner, options.teams).filter(
    (enemy) =>
      enemy.owner !== target.owner &&
      distance(enemy, center) <= 2_200 &&
      (pointToSegmentDistance(enemy, center, target) <= 900 || distance(enemy, target) <= 900),
  );
  // @@@worker-pressure-route-cover - In 1v2, the other opponent's army can make a worker pickoff path unwinnable even when the target owner's base looks open.
  return blockers.length >= 3 && armyPower(blockers) >= armyPower(soldiers) * 0.55;
}

function workerPressureTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], options: PresetAiPolicyOptions): Unit | undefined {
  const center = averagePoint(soldiers);
  const rememberedOwner = options.memory?.strategicPlan?.focusTargetOwner;
  const hasHarassClaim = options.memory ? Object.values(options.memory.unitClaims).some((claim) => claim.kind === "harass" && claim.expiresTick >= snapshot.tick) : false;
  if (hasHarassClaim && rememberedOwner && isOpponentOwner(snapshot, owner, rememberedOwner, options)) {
    const rememberedWorker = nearestEntities(units(snapshot, rememberedOwner).filter((unit) => unit.kind === "worker"), center)[0];
    if (rememberedWorker) return rememberedWorker;
  }

  const candidates = opponentPlayerIds(snapshot, owner, options)
    .map((opponentOwner) => {
      const base = nearestEntity(buildings(snapshot, opponentOwner).filter((building) => building.kind === "townHall"), center);
      const army = combatUnits(snapshot, opponentOwner);
      return { owner: opponentOwner, baseDistance: base ? distance(base, center) : Number.POSITIVE_INFINITY, armyPower: armyPower(army) };
    })
    .filter((candidate) => Number.isFinite(candidate.baseDistance))
    .sort((a, b) => a.baseDistance - b.baseDistance);

  let targetOwner = candidates[0]?.owner;
  const second = candidates[1];
  if (candidates[0] && second && Math.abs(candidates[0].baseDistance - second.baseDistance) <= 30 && Math.abs(candidates[0].armyPower - second.armyPower) <= 0.7) {
    targetOwner = candidates[0].armyPower >= second.armyPower ? candidates[0].owner : second.owner;
  }

  const preferredWorker = targetOwner ? nearestEntities(units(snapshot, targetOwner).filter((unit) => unit.kind === "worker"), center)[0] : undefined;
  if (preferredWorker) return preferredWorker;
  return nearestEntities(enemyWorkerUnits(snapshot, owner, options.teams), center)[0];
}

function planEarlyHarassment(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (behaviorDisabled(options, "workerHarassment")) {
    recordBehavior(options, "workerHarassment", "disabledSkips");
    return undefined;
  }
  if (behaviorDisabled(options, "earlyHarassment")) {
    recordBehavior(options, "earlyHarassment", "disabledSkips");
    return undefined;
  }
  if (options.version === "v2" && completeBuildings(snapshot, owner, "townHall").length !== 1) return undefined;

  const ownBase = mainBase(snapshot, owner);
  const enemyBase = nearestEnemyBase(snapshot, owner, ownBase, options, focusedOpponentOwner(snapshot, owner, options));
  if (!enemyBase) return undefined;
  const enemyWorkers = enemyWorkerUnits(snapshot, owner, options.teams).filter((unit) => distance(unit, enemyBase) <= 560);
  if (enemyWorkers.length === 0) return undefined;

  const soldiers = combatUnits(snapshot, owner).filter(
    (unit) => (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack") && harassmentReadyUnit(snapshot, owner, unit, options),
  );
  if (options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2 && soldiers.length < 3) return undefined;
  if (soldiers.length < 2 || soldiers.length > 4) return undefined;
  const harassers = nearestEntities(soldiers, enemyBase).slice(0, Math.min(2, soldiers.length));
  const harassCenter = averagePoint(harassers);
  const exposedWorker = nearestEntity(enemyWorkers, harassCenter);
  if (!exposedWorker) return undefined;
  if (options.version === "v2" && distance(harassCenter, exposedWorker) > 780) return undefined;
  const enemyDefenders = enemyCombatUnits(snapshot, owner, options.teams).filter(
    (unit) =>
      (distance(unit, exposedWorker) <= 600 || distance(unit, harassCenter) <= 420),
  );

  // @@@v2-harass-semantics - Small raids hunt workers only while local defenders are weaker; otherwise they preserve the group.
  if (enemyDefenders.length > harassers.length + 1) {
    recordBehavior(options, "earlyHarassment", "attempts");
    recordBehavior(options, "earlyHarassment", "retreatCommands");
    return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: harassers.map((unit) => unit.id), x: ownBase.x, y: ownBase.y }, options);
  }
  if (enemyDefenders.length <= harassers.length) {
    recordBehavior(options, "earlyHarassment", "attempts");
    recordBehavior(options, "earlyHarassment", "workerRaidCommands");
    return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: harassers.map((unit) => unit.id), targetId: exposedWorker.id }, options);
  }
  return undefined;
}

function harassmentReadyUnit(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return true;
  const claim = activeUnitClaim(snapshot, owner, unit, options);
  return !claim || claim.kind === "harass";
}

function planDesperateWorkerFight(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const main = mainBase(snapshot, owner);
  const closeEnemies = enemyCombatUnitsNear(snapshot, owner, main, 540, options.teams);
  const closeCombat = combatUnits(snapshot, owner).filter((unit) => distance(unit, main) <= 760);
  const mainTower = buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, main) <= 520);
  if (options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2 && !mainTower && closeCombat.length <= 2 && closeEnemies.length >= 2 && armyPower(closeEnemies) >= armyPower(closeCombat)) {
    const workers = units(snapshot, owner)
      .filter((unit) => unit.kind === "worker" && distance(unit, main) <= 520)
      .slice(0, 3);
    const target = nearestEntity(closeEnemies, main);
    // @@@desperate-worker-fight - A towerless close 1v2 base hit needs a few workers in the fight before the hall is already dying.
    if (workers.length >= 2 && target) return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: workers.map((unit) => unit.id), targetId: target.id }, options);
  }
  return undefined;
}

function planWorkerDefense(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const main = mainBase(snapshot, owner);
  const vulnerableBuildings = buildings(snapshot, owner).filter((building) => building.complete && building.kind !== "farm" && distance(building, main) <= 560);
  const enemies = enemyCombatUnits(snapshot, owner, options.teams).filter((unit) => vulnerableBuildings.some((building) => distance(unit, building) <= 520));
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
    return target ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: workers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
  }
  if (mainWorkerEvacuationThreat(snapshot, owner, options)) {
    const preservedMinerIds = saturatedMineWorkerIds(snapshot, owner, options);
    const evacuatingWorkers = workers.filter((worker) => !preservedMinerIds.has(worker.id));
    if (evacuatingWorkers.length < 2) return undefined;
    const point = workerEvacuationPoint(snapshot, main, averagePoint(enemies));
    return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: evacuatingWorkers.map((unit) => unit.id), x: point.x, y: point.y }, options);
  }
  const target = enemies.sort((a, b) => mainDefenseTargetScore(b, main, snapshot, owner) - mainDefenseTargetScore(a, main, snapshot, owner))[0];
  return target ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: workers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
}

function saturatedMineWorkerIds(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return new Set<string>();
  const ownedMiningResourceIds = new Set(
    completeBuildings(snapshot, owner, "townHall")
      .map((townHall) => nearestResource(activeResources(snapshot), townHall))
      .filter((mine): mine is ResourceNode => Boolean(mine && completeBuildings(snapshot, owner, "townHall").some((townHall) => distance(townHall, mine) < 260)))
      .map((mine) => mine.id),
  );
  const minersByResource = new Map<string, Unit[]>();
  for (const worker of units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "mine" && ownedMiningResourceIds.has(unit.order.resourceId))) {
    const resourceId = worker.order.type === "mine" ? worker.order.resourceId : "";
    minersByResource.set(resourceId, [...(minersByResource.get(resourceId) ?? []), worker]);
  }
  const payingMine = [...minersByResource.entries()].filter(([, miners]) => miners.length > 0);
  const preserved = new Set<string>();
  for (const [resourceId, miners] of payingMine) {
    const mine = aiSnapshotQuery(snapshot).resourceById(resourceId);
    if (!mine) continue;
    // @@@mine-saturation-preserve - A mine only pays up to five workers; keep those miners working instead of evacuating the income base.
    for (const worker of nearestEntities(miners, mine).slice(0, 5)) preserved.add(worker.id);
  }
  return preserved;
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
  const enemies = enemyCombatUnits(snapshot, owner, options.teams).filter((unit) => vulnerableBuildings.some((building) => distance(unit, building) <= 520));
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
  const enemyArmy = enemyCombatUnits(snapshot, owner, options.teams);
  const movable = soldiers.filter((unit) => (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove") && attackWaveReadyUnit(snapshot, owner, unit, options));

  if (options.policyMode === "combat") return planCombatAttackWave(snapshot, owner, movable, enemyArmy, options);

  const mainBreakIn = mainBuildingBreakInCommand(snapshot, owner, soldiers, enemyArmy, options);
  if (mainBreakIn) return mainBreakIn;
  const focus = mainDefenseFocusCommand(snapshot, owner, soldiers, enemyArmy, options);
  if (focus) return focus;
  const workerLineFocus = miningWorkerLineDefenseCommand(snapshot, owner, soldiers, enemyArmy, options);
  if (workerLineFocus) return workerLineFocus;

  const minimumWaveSize = 5;
  if (options.version !== "v2") {
    const closeout = closeoutAttackWaveTarget(snapshot, owner, soldiers, movable, enemyArmy, options, focusedOpponentOwner(snapshot, owner, options));
    if (closeout) {
      const stale = staleAttackMovers(movable, closeout);
      if (stale.length > 0) return resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: closeout.x, y: closeout.y }, options);
    }
  }

  const pressuredBuilding = mostPressuredAlliedBuilding(snapshot, owner, options);
  if (pressuredBuilding && soldiers.length >= 3) {
    const localEnemies = enemyCombatUnitsNear(snapshot, owner, pressuredBuilding, 620, options.teams);
    const isMainPressure = pressuredBuilding.owner === owner && distance(pressuredBuilding, mainBase(snapshot, owner)) <= 500;
    const localUnitFight = activeBaseUnitFight(soldiers, localEnemies);
    if (options.version === "v2" && !isMainPressure && !localUnitFight && armyPower(localEnemies) > armyPower(soldiers) * 1.25) {
      const rally = defensiveRallyPoint(snapshot, owner);
      const stale = soldiers.filter((unit) => distance(unit, rally) > 220);
      return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y }, options) : undefined;
    }
    if (options.version === "v2" && isMainPressure && !localUnitFight && armyPower(localEnemies) > armyPower(soldiers) * 1.15) {
      const rally = defensiveRallyPoint(snapshot, owner);
      const nearest = nearestEntity(localEnemies, rally);
      if (nearest && distance(nearest, rally) > AUTO_ACQUIRE_RANGE + 30) {
        const stale = soldiers.filter((unit) => distance(unit, rally) > 220);
        if (stale.length > 0) return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y }, options);
        return undefined;
      }
    }
    const counterPush = lateBaseStandoffCounterPush(snapshot, owner, pressuredBuilding, soldiers, localEnemies, options);
    if (counterPush) return counterPush;
    const stale = staleAttackMovers(soldiers, pressuredBuilding);
    return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: pressuredBuilding.x, y: pressuredBuilding.y }, options) : undefined;
  }

  const mainHold = mainDefenseHold(snapshot, owner, soldiers, enemyArmy, options);
  if (mainHold) {
    return mainHold.stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: mainHold.stale.map((unit) => unit.id), x: mainHold.rally.x, y: mainHold.rally.y }, options) : undefined;
  }

  if (options.version === "v2" && movable.length < minimumWaveSize && enemyArmy.length > 2) return undefined;

  if (movable.length === 0) return undefined;
  const outnumberedV2 = options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2;

  const currentCommittedOwner = committedAttackWaveOwner(snapshot, owner, movable, options);
  const focusedOwner = currentCommittedOwner ?? focusedOpponentOwner(snapshot, owner, options);
  const noWorkerLastFight = noWorkerLastArmyTarget(snapshot, owner, soldiers, movable, enemyArmy, options);
  if (noWorkerLastFight) {
    if (noWorkerLastFight.kind === "worker" || noWorkerLastFight.kind in BUILDING_DEFS) return { type: "attack", unitIds: movable.map((unit) => unit.id), targetId: noWorkerLastFight.id };
    return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: movable.map((unit) => unit.id), targetId: noWorkerLastFight.id }, options);
  }
  const deadEconomyArmyTarget = deadEconomyResidualArmyTarget(snapshot, owner, soldiers, enemyArmy, options);
  if (deadEconomyArmyTarget) return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: movable.map((unit) => unit.id), targetId: deadEconomyArmyTarget.id }, options);
  const closeout = closeoutAttackWaveTarget(snapshot, owner, soldiers, movable, enemyArmy, options, focusedOwner);
  if (closeout) {
    if (shouldDelayEarlyOneOnOneBasePressure(snapshot, owner, soldiers, closeout, options)) return undefined;
    const workerCleanup = closeoutWorkerCleanupTarget(snapshot, owner, movable, closeout, enemyArmy, options);
    if (workerCleanup) return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: movable.map((unit) => unit.id), targetId: workerCleanup.id }, options);
    const stale = staleAttackMovers(movable, closeout);
    if (stale.length > 0) {
      if (shouldHoldSingleUnitWorkerAliveCloseout(snapshot, closeout, stale, options)) return undefined;
      const unitIds = closeoutAttackMoveUnitIds(soldiers, closeout, stale, options);
      return resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds, x: closeout.x, y: closeout.y }, options);
    }
  }

  const expansionMine = desiredExpansionMine(snapshot, owner);
  const committedToExpansionClear =
    expansionMine !== undefined &&
    soldiers.some((unit) => unit.order.type === "attackMove" && distance(unit.order, expansionMine) <= 260);
  const needsExpansionClear =
    expansionMine &&
    (!outnumberedV2 || committedToExpansionClear) &&
    completeBuildings(snapshot, owner, "townHall").length < 2 &&
    neutralUnitsNear(snapshot, expansionMine, 280).length > 0;
  if (needsExpansionClear) {
    const stale = staleAttackMovers(movable, expansionMine);
    return soldiers.length >= 4 && stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: expansionMine.x, y: expansionMine.y }, options) : undefined;
  }

  if (options.version !== "v2" && resources(snapshot).length > activePlayerIds(snapshot).length && !hasEstablishedExpansion(snapshot, owner)) return undefined;
  if (outnumberedV2 && localNeutralEngagement(snapshot, movable, enemyArmy)) return undefined;

  // @@@wave-integrity - V2 pressure is an army job; keep V1's old poke behavior but stop V2 from feeding one unit at a time.
  const smallPressureAllowed = options.version !== "v2" && !outnumberedV2 && soldiers.length > 0 && enemyArmy.length <= 2;
  if (soldiers.length < minimumWaveSize && !smallPressureAllowed) return undefined;
  const localPickoff = outnumberedV2 && !currentCommittedOwner && movable.length >= minimumWaveSize ? isolatedOpponentDetachmentTarget(snapshot, owner, soldiers, enemyArmy, options) : undefined;
  if (localPickoff) return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: movable.map((unit) => unit.id), targetId: localPickoff.id }, options);
  if (options.version === "v2" && !currentCommittedOwner && deadEconomyCloseoutReady(snapshot, owner, options, soldiers) && strongerEnemyArmyStopline(snapshot, owner, soldiers, enemyArmy, options)) {
    return attackWaveStoplineRecall(snapshot, owner, movable, options);
  }
  const localBaseCommit = outnumberedV2 && !currentCommittedOwner && movable.length >= minimumWaveSize ? locallyBeatableOpponentBaseTarget(snapshot, owner, soldiers, enemyArmy, options) : undefined;
  if (localBaseCommit) return resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: movable.map((unit) => unit.id), x: localBaseCommit.x, y: localBaseCommit.y }, options);
  const committedRecall = currentCommittedOwner ? committedAttackWaveRecall(snapshot, owner, soldiers, movable, enemyArmy, currentCommittedOwner, options) : undefined;
  if (committedRecall) return committedRecall;
  if (options.version === "v2" && !currentCommittedOwner && strongerEnemyArmyStopline(snapshot, owner, soldiers, enemyArmy, options)) return undefined;

  const armyTarget = options.version === "v2" ? significantOpponentArmyTarget(snapshot, owner, averagePoint(soldiers), soldiers, options) : undefined;
  if (armyTarget) return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: movable.map((unit) => unit.id), targetId: armyTarget.id }, options);

  const objective = nearestOpponentObjective(snapshot, owner, averagePoint(soldiers), options, focusedOwner);
  if (shouldDelayEarlyOneOnOneBasePressure(snapshot, owner, soldiers, objective, options)) return undefined;
  const point = shouldCloseOutObjective(snapshot, owner, objective, options) ? objective : wavePointFor(snapshot, owner, soldiers, objective);
  const stale = staleAttackMovers(movable, point);
  if (outnumberedV2 && stale.length < minimumWaveSize) return undefined;
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: point.x, y: point.y }, options) : undefined;
}

function shouldDelayEarlyOneOnOneBasePressure(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], target: Point, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (opponentPlayerIds(snapshot, owner, options).length !== 1) return false;
  if (hasEstablishedExpansion(snapshot, owner)) return false;
  const targetBuilding = nearestEntity(enemyBuildingsNear(snapshot, owner, target, 8, options.teams), target);
  if (!targetBuilding) return false;
  if (targetBuilding.hp < targetBuilding.maxHp * 0.55) return false;
  const isBaseTarget = targetBuilding.kind === "townHall" || targetBuilding.kind === "defenseTower" || isCoreProductionBuilding(targetBuilding);
  if (!isBaseTarget) return false;
  const localDefenders = enemyCombatUnitsNear(snapshot, owner, targetBuilding, 760, options.teams);
  const nearbyTowers = enemyBuildingsNear(snapshot, owner, targetBuilding, 560, options.teams).filter((building) => building.kind === "defenseTower" && building.complete);
  const ownPower = armyPower(soldiers);
  const defensivePower = armyPower(localDefenders) + nearbyTowers.length * 2.4;
  // @@@first-wave-base-discipline - A one-base V2 can skirmish, but its first 1v1 army should not become a blind base-dive trade.
  if (soldiers.length >= 8 && defensivePower <= ownPower * 0.62) return false;
  return nearbyTowers.length > 0 || defensivePower >= ownPower * 0.72;
}

function strongerEnemyArmyStopline(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  const ratio = strongerEnemyArmyStoplineRatio(snapshot, owner, soldiers, options);
  // @@@stronger-army-stopline - Without a local pickoff or closeout, attack-wave movement into a stronger merc/army ball is feeding, even in one-on-one.
  return enemyArmy.length >= 5 && armyPower(enemyArmy) > armyPower(soldiers) * ratio;
}

function strongerEnemyArmyStoplineRatio(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], options: PresetAiPolicyOptions) {
  const opponents = opponentPlayerIds(snapshot, owner, options);
  return deadEconomyCloseoutReady(snapshot, owner, options, soldiers)
    ? opponents.length >= 2
      ? 1.12
      : 1.25
    : opponents.length >= 2
      ? 1.55
      : 1.38;
}

function committedAttackWaveRecall(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], movable: Unit[], enemyArmy: Unit[], committedOwner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const from = averagePoint(movable);
  const objective = nearestOwnedOpponentObjective(snapshot, owner, from, options, committedOwner);
  if (!objective) return undefined;
  if (!committedAttackWaveRouteCovered(snapshot, owner, from, objective, soldiers, enemyArmy, options)) return undefined;
  const rally = defensiveRallyPoint(snapshot, owner);
  const stale = movable.filter((unit) => distance(unit, rally) > 220);
  // @@@committed-wave-abort - Attack-wave commitment is useful only while the route remains playable; once a 1v2 route is covered, the job must actively become recovery.
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y }, options) : undefined;
}

function attackWaveStoplineRecall(snapshot: GameSnapshot, owner: PlayerId, movable: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  const rally = defensiveRallyPoint(snapshot, owner);
  const stale = movable.filter((unit) => distance(unit, rally) > 220 || unit.order.type !== "move" || distance(unit.order, rally) > 90);
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stale.map((unit) => unit.id), x: rally.x, y: rally.y }, options) : undefined;
}

function committedAttackWaveRouteCovered(snapshot: GameSnapshot, owner: PlayerId, from: Point, objective: Point, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  if (!strongerEnemyArmyStopline(snapshot, owner, soldiers, enemyArmy, options)) return false;
  const ownPower = armyPower(soldiers);
  const routeEnemies = enemyArmy.filter((enemy) => distance(enemy, objective) > 560 && pointToSegmentDistance(enemy, from, objective) <= 430);
  if (routeEnemies.length >= 3 && armyPower(routeEnemies) >= ownPower * 0.95) return true;
  const localEnemies = enemyCombatUnitsNear(snapshot, owner, objective, 620, options.teams);
  return localEnemies.length >= 3 && armyPower(localEnemies) >= ownPower * 1.08;
}

function planCombatAttackWave(snapshot: GameSnapshot, owner: PlayerId, movable: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (movable.length === 0 || enemyArmy.length === 0) return undefined;
  const point = averagePoint(enemyArmy);
  const stale = staleAttackMovers(movable, point);
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: point.x, y: point.y }, options) : undefined;
}

function attackWaveReadyUnit(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return true;
  const claim = activeUnitClaim(snapshot, owner, unit, options);
  if (claim && claim.kind !== "attack" && !safeStoppedRetreatClaimCanRejoin(snapshot, owner, unit, claim, options) && !deadEconomyRetreatClaimCanRejoin(snapshot, owner, unit, claim, options)) return false;
  if (unit.hp < unit.maxHp * 0.36) return false;
  if (unit.order.type !== "move" || unit.hp >= unit.maxHp * 0.58) return true;
  const main = mainBase(snapshot, owner);
  return distance(unit.order, main) >= distance(unit, main);
}

function shouldHoldSingleUnitWorkerAliveCloseout(snapshot: GameSnapshot, closeout: Building, stale: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || stale.length !== 1) return false;
  // @@@closeout-worker-gate - Base pressure is valid, but one fresh unit should not walk across the map while the target economy still has workers to clean up.
  return units(snapshot, closeout.owner).some((unit) => unit.kind === "worker");
}

function closeoutWorkerCleanupTarget(snapshot: GameSnapshot, owner: PlayerId, movable: Unit[], closeout: Building, enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || enemyArmy.length > 0 || movable.length < 5) return undefined;
  const targetBuildings = buildings(snapshot, closeout.owner);
  if (targetBuildings.length > 2) return undefined;
  const center = averagePoint(movable);
  const workers = units(snapshot, closeout.owner).filter((unit) => unit.kind === "worker");
  if (workers.length === 0 || workers.length > 2) return undefined;
  // @@@closeout-worker-cleanup - A won fight should not end with a stranded worker beside the last base because the army tunneled the final building first.
  return nearestEntities(workers, center).find((worker) => distance(worker, center) <= 900 && isEnemyOwner(snapshot, owner, worker.owner, options));
}

function closeoutAttackMoveUnitIds(soldiers: Unit[], closeout: Building, stale: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || stale.length >= 2) return stale.map((unit) => unit.id);
  const ids = new Set(stale.map((unit) => unit.id));
  for (const unit of soldiers) {
    if (ids.has(unit.id) || distance(unit, closeout) > 760) continue;
    if (unit.order.type !== "attack" && unit.order.type !== "attackMove") continue;
    ids.add(unit.id);
  }
  // @@@closeout-group-shape - The policy may only need to redirect one stale unit, but the command should still describe the local closeout group.
  return [...ids];
}

function safeStoppedRetreatClaimCanRejoin(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, claim: { kind: string; x: number; y: number }, options: PresetAiPolicyOptions) {
  if (claim.kind !== "retreat") return false;
  const stoppedAtSafePoint = unit.order.type === "idle" || (unit.order.type === "move" && distance(unit, claim) <= 110);
  if (!stoppedAtSafePoint) return false;
  // @@@retreat-memory-release - A retreat claim protects units during the pullback; once they are stopped in safety, army memory may recruit them again.
  return enemyCombatUnitsNear(snapshot, owner, unit, 420, options.teams).length === 0 && neutralUnitsNear(snapshot, unit, 420).length === 0;
}

function deadEconomyRetreatClaimCanRejoin(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, claim: { kind: string }, options: PresetAiPolicyOptions) {
  if (claim.kind !== "retreat" || unit.hp < unit.maxHp * 0.58) return false;
  if (enemyCombatUnitsNear(snapshot, owner, unit, 520, options.teams).length > 0 || neutralUnitsNear(snapshot, unit, 420).length > 0) return false;
  // @@@dead-economy-retreat-release - Once enemy workers are gone, healthy safe retreaters should rejoin the final army before the exact rally point.
  return deadEconomyCloseoutReady(snapshot, owner, options, combatUnits(snapshot, owner));
}

function committedAttackWaveOwner(snapshot: GameSnapshot, owner: PlayerId, movable: Unit[], options: PresetAiPolicyOptions): PlayerId | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2 || movable.length < 5) return undefined;
  const counts = new Map<PlayerId, number>();
  for (const unit of movable) {
    if (unit.order.type !== "attackMove") continue;
    const orderPoint = { x: unit.order.x, y: unit.order.y };
    const target = nearestEntity(enemyBuildingsNear(snapshot, owner, orderPoint, 520, options.teams), orderPoint);
    if (target) counts.set(target.owner, (counts.get(target.owner) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < Math.ceil(movable.length * 0.55)) return undefined;
  return buildings(snapshot, best[0]).length > 0 && isOpponentOwner(snapshot, owner, best[0], options) ? best[0] : undefined;
}

function focusedOpponentOwner(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): PlayerId | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const remembered = options.memory?.strategicPlan?.focusTargetOwner;
  if (remembered && opponentHasPresence(snapshot, owner, remembered, options)) return remembered;
  const selected = selectFocusedOpponentOwner(snapshot, owner, options);
  if (!selected || !options.memory) return selected;
  const previousSince = options.memory.strategicPlan?.focusTargetOwner === selected ? options.memory.strategicPlan.focusTargetSinceTick : undefined;
  options.memory.strategicPlan = {
    ...options.memory.strategicPlan,
    focusTargetOwner: selected,
    focusTargetSinceTick: previousSince ?? snapshot.tick,
    focusTargetUpdatedTick: snapshot.tick,
  };
  return selected;
}

function selectFocusedOpponentOwner(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): PlayerId | undefined {
  const main = mainBase(snapshot, owner);
  return opponentPlayerIds(snapshot, owner, options)
    .map((opponent) => {
      const base = nearestEntity(completeBuildings(snapshot, opponent, "townHall"), main);
      const opponentCombat = combatUnits(snapshot, opponent);
      const opponentWorkers = units(snapshot, opponent).filter((unit) => unit.kind === "worker");
      const opponentBuildings = buildings(snapshot, opponent);
      const distanceScore = base ? distance(base, main) / 28 : 400;
      return {
        opponent,
        score: distanceScore + opponentCombat.length * 34 + opponentWorkers.length * 3 + Math.max(0, opponentBuildings.length - 1) * 8,
      };
    })
    .sort((a, b) => a.score - b.score)[0]?.opponent;
}

function opponentHasPresence(snapshot: GameSnapshot, owner: PlayerId, opponent: PlayerId, options: PresetAiPolicyOptions) {
  return isOpponentOwner(snapshot, owner, opponent, options) && (buildings(snapshot, opponent).length > 0 || units(snapshot, opponent).length > 0);
}

function mostPressuredAlliedBuilding(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): Building | undefined {
  const candidates = alliedBuildings(snapshot, owner, options).filter((building) => building.complete);
  if (candidates.length === 0) return undefined;
  const pressures = new Map<string, number>();
  const pressureRangeSq = 620 * 620;
  for (const unit of enemyUnits(snapshot, owner, options.teams)) {
    for (const building of candidates) {
      if (distanceSquared(unit, building) < pressureRangeSq) pressures.set(building.id, (pressures.get(building.id) ?? 0) + 1);
      // @@@targeted-building-pressure - Ranged sieges can kill tech before five bodies stand near the building; an active target is pressure too.
      if (unitTargetsBuilding(unit, building) && distance(unit, building) <= unit.attackRange + 180) pressures.set(building.id, (pressures.get(building.id) ?? 0) + 2);
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

function mainDefenseHold(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): { rally: Point; stale: Unit[] } | undefined {
  if (options.version !== "v2" || soldiers.length < 3) return undefined;
  const main = mainBase(snapshot, owner);
  const rally = defensiveRallyPoint(snapshot, owner);
  const approaching = enemyArmy.filter((unit) => distance(unit, main) <= MAIN_APPROACH_THREAT_RANGE);
  if (approaching.length < 4) return undefined;
  const localDefenders = soldiers.filter((unit) => distance(unit, main) <= 900);
  // @@@main-approach-recall - Home defense depends on local bodies near the base; far objective squads do not count as already defending.
  if (localDefenders.length >= approaching.length && armyPower(approaching) <= armyPower(localDefenders) * 1.15) return undefined;
  if (activeBaseUnitFight(localDefenders, approaching)) return undefined;
  if (nearestEntity(approaching, rally) && distance(nearestEntity(approaching, rally)!, rally) <= AUTO_ACQUIRE_RANGE + 30) return undefined;
  const stale = soldiers.filter((unit) => distance(unit, rally) > 220);
  return { rally, stale };
}

function activeBaseUnitFight(defenders: Unit[], enemies: Unit[]) {
  if (defenders.length < 3 || enemies.length < 3) return false;
  const defenderIds = new Set(defenders.map((unit) => unit.id));
  const enemyIds = new Set(enemies.map((unit) => unit.id));
  const engagedDefenders = defenders.filter(
    (unit) =>
      ((unit.order.type === "attack" || unit.order.type === "attackMove") && unit.order.targetId !== undefined && enemyIds.has(unit.order.targetId)),
  );
  const engagedEnemies = enemies.filter(
    (unit) =>
      ((unit.order.type === "attack" || unit.order.type === "attackMove") && unit.order.targetId !== undefined && defenderIds.has(unit.order.targetId)),
  );
  if (engagedDefenders.length < 3 || engagedEnemies.length < 3) return false;
  // @@@base-fight-hold - Once the base defense is already a unit fight, a rally move splits non-focused bodies out of the fight.
  return true;
}

function lateBaseStandoffCounterPush(snapshot: GameSnapshot, owner: PlayerId, pressuredBuilding: Building, soldiers: Unit[], localEnemies: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  if (opponentPlayerIds(snapshot, owner, options).length !== 1) return undefined;
  if (pressuredBuilding.owner !== owner || pressuredBuilding.kind !== "townHall") return undefined;
  const standoffEnemies = enemyCombatUnitsNear(snapshot, owner, pressuredBuilding, 760, options.teams);
  if (soldiers.length < 24 || localEnemies.length < 5 || standoffEnemies.length < 8) return undefined;
  const nearestEnemy = nearestEntity(standoffEnemies, pressuredBuilding);
  if (!nearestEnemy || distance(nearestEnemy, pressuredBuilding) <= AUTO_ACQUIRE_RANGE + 30) return undefined;
  const attackers = soldiers.filter(
    (unit) =>
      unit.hp >= unit.maxHp * 0.36 &&
      distance(unit, pressuredBuilding) <= 860 &&
      (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack"),
  );
  if (attackers.length < 20) return undefined;
  if (armyPower(standoffEnemies) > armyPower(attackers) * 1.18) return undefined;
  const target = averagePoint(standoffEnemies);
  const stale = staleAttackMovers(attackers, target);
  // @@@late-base-standoff - At maxed 1v1 pressure, holding a town-hall point can freeze both armies just outside acquisition range; a non-outmatched base army must step into the local enemy ball.
  return stale.length >= 5 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: target.x, y: target.y }, options) : undefined;
}

function mainDefenseFocusCommand(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || soldiers.length < 3) return undefined;
  const rally = defensiveRallyPoint(snapshot, owner);
  const defenders = soldiers.filter((unit) => distance(unit, rally) <= 520 && (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack"));
  if (defenders.length < 3) return undefined;
  // @@@pressured-building-focus - Main defense may hold cover, but ranged units still fire at building targeters reachable from that cover.
  const targets = enemyArmy.filter((unit) => distance(unit, rally) <= 360 || (distance(unit, rally) <= 660 && targetPressuresAlliedBuilding(snapshot, owner, unit, options)));
  if (targets.length === 0) return undefined;
  const target = targets.sort((a, b) => mainDefenseTargetScore(b, rally, snapshot, owner) - mainDefenseTargetScore(a, rally, snapshot, owner))[0];
  if (!target) return undefined;
  const attackers = defenders.filter((unit) => canJoinMainDefenseFocus(snapshot, owner, unit, target, options));
  return attackers.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: attackers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
}

function mainBuildingBreakInCommand(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  if (opponentPlayerIds(snapshot, owner, options).length !== 1) return undefined;
  const main = mainBase(snapshot, owner);
  const pressuredBuilding = mostPressuredAlliedBuilding(snapshot, owner, options);
  if (!pressuredBuilding || pressuredBuilding.owner !== owner || distance(pressuredBuilding, main) > 620) return undefined;
  if (pressuredBuilding.kind !== "farm") return undefined;
  const targeters = enemyArmy.filter((unit) => targetPressuresAlliedBuilding(snapshot, owner, unit, options) && distance(unit, pressuredBuilding) <= unit.attackRange + 220);
  if (targeters.length < 2) return undefined;
  const localSoldiers = soldiers.filter(
    (unit) =>
      distance(unit, main) <= 780 &&
      unit.hp >= unit.maxHp * 0.36 &&
      (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack"),
  );
  if (localSoldiers.length < 5) return undefined;
  const localEnemies = enemyCombatUnitsNear(snapshot, owner, pressuredBuilding, 720, options.teams);
  if (localEnemies.length < 3) return undefined;
  if (armyPower(localEnemies) > armyPower(localSoldiers) * 1.15) return undefined;
  // @@@main-building-break-in - In 1v1, staying under tower while ranged units delete main buildings loses the base; commit the covered squad to the break-in point.
  const stale = staleAttackMovers(localSoldiers, pressuredBuilding);
  return stale.length > 0 ? resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: stale.map((unit) => unit.id), x: pressuredBuilding.x, y: pressuredBuilding.y }, options) : undefined;
}

function miningWorkerLineDefenseCommand(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || soldiers.length < 3) return undefined;
  if (opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  const miningWorkers = units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "mine");
  if (miningWorkers.length === 0) return undefined;
  const targets = enemyArmy.filter((enemy) => miningWorkers.some((worker) => distance(enemy, worker) <= 320));
  if (targets.length === 0) return undefined;
  const target = targets.sort((a, b) => miningWorkerLineThreatScore(b, miningWorkers, snapshot, owner) - miningWorkerLineThreatScore(a, miningWorkers, snapshot, owner))[0];
  if (!target) return undefined;
  const attackers = soldiers.filter(
    (unit) =>
      (unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "attack") &&
      distance(unit, target) <= 900 &&
      unit.hp >= unit.maxHp * 0.36,
  );
  // @@@worker-line-defense - Mining workers are the economy surface; defend the line itself even when the attackers are outside the main rally bubble.
  return attackers.length >= 3 ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: attackers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
}

function miningWorkerLineThreatScore(unit: Unit, workers: Unit[], snapshot: GameSnapshot, owner: PlayerId) {
  const nearestWorker = nearestEntity(workers, unit);
  const workerPressure = nearestWorker ? Math.max(0, 340 - distance(unit, nearestWorker)) : 0;
  return mainDefenseTargetScore(unit, unit, snapshot, owner) + workerPressure * 1.2;
}

function mainDefenseTargetScore(unit: Unit, rally: Point, snapshot: GameSnapshot, owner: PlayerId) {
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 4 + (unit.attackRange > 100 ? 35 : 0);
  const vulnerableBuilding = nearestEntity(buildings(snapshot, owner).filter((building) => building.kind !== "farm"), unit);
  const buildingPressure = vulnerableBuilding ? Math.max(0, 520 - distance(unit, vulnerableBuilding)) * 0.65 : 0;
  return missingHp * 2 + threat + buildingPressure - distance(unit, rally) * 0.2;
}

function canJoinMainDefenseFocus(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, target: Unit, options: PresetAiPolicyOptions) {
  const distanceToTarget = distance(unit, target);
  const closeLeash = unit.attackRange > 100 ? 80 : 35;
  if (distanceToTarget <= unit.attackRange + closeLeash) return true;
  if (unit.attackRange > 100) return false;
  if (mainDefenseTowerCovers(snapshot, owner, unit)) {
    // @@@tower-cover-chase - A covered melee unit only leaves the tower line when an attacker has already crossed past that cover into a building kill window.
    if (!targetPressuresAlliedBuilding(snapshot, owner, target, options) || mainDefenseTowerCovers(snapshot, owner, target)) return false;
  }
  return distanceToTarget <= unit.attackRange + 245;
}

function mainDefenseTowerCovers(snapshot: GameSnapshot, owner: PlayerId, point: Point) {
  const main = mainBase(snapshot, owner);
  return buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && building.complete && distance(building, main) <= 520 && distance(building, point) <= 260);
}

function targetPressuresAlliedBuilding(snapshot: GameSnapshot, owner: PlayerId, target: Unit, options: PresetAiPolicyOptions) {
  return alliedBuildings(snapshot, owner, options).some((building) => unitTargetsBuilding(target, building));
}

function unitTargetsBuilding(unit: Unit, building: Building) {
  const targetId = unit.order.type === "attack" ? unit.order.targetId : unit.order.type === "attackMove" ? unit.order.targetId : undefined;
  return targetId === building.id;
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
  return allBuildings(snapshot).filter((building) => teamFor(snapshot, building.owner, options) === ownTeam);
}

function staleAttackMovers(units: Unit[], point: Point) {
  return units.filter((unit) => unit.order.type !== "attackMove" || distance(unit.order, point) > ATTACK_MOVE_REDIRECT_DISTANCE);
}

function localNeutralEngagement(snapshot: GameSnapshot, movable: Unit[], enemyArmy: Unit[]) {
  if (movable.length === 0) return false;
  const center = averagePoint(movable);
  const nearbyNeutrals = neutralUnitsNear(snapshot, center, 360);
  if (nearbyNeutrals.length < 2) return false;
  if (enemyArmy.some((unit) => distance(unit, center) <= 900)) return false;
  return movable.filter((unit) => unit.order.type === "attackMove" && distance(unit.order, center) <= 520).length >= Math.ceil(movable.length * 0.6);
}

function catchUpExpansionCommand(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const mine = desiredForwardExpansionMine(snapshot, owner, options) ?? desiredCatchUpExpansionMine(snapshot, owner);
  if (options.version === "v2" && combatUnits(snapshot, owner).length < catchUpExpansionMinimumCombat(snapshot, owner, options)) return undefined;
  if (!mine || playerState(snapshot, owner).gold < BUILDING_DEFS.townHall.cost || enemyPressure(snapshot, owner, mine, 360, options)) return undefined;
  const builder = availableBuilder(snapshot, owner, mine, options);
  if (!builder) return undefined;
  const offset = expansionOffset(snapshot, owner);
  const point = legalBuildPointNear(snapshot, "townHall", { x: mine.x + offset.x, y: mine.y + offset.y });
  recordBehavior(options, "economicCatchUp", "attempts");
  recordBehavior(options, "economicCatchUp", "catchUpExpansions");
  return resolveAiCommandIntent(snapshot, owner, { type: "build", unitId: builder.id, buildingKind: "townHall", x: point.x, y: point.y }, options);
}

function catchUpExpansionMinimumCombat(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (completeBuildings(snapshot, owner, "townHall").length >= 2) return activeMiningBaseCount(snapshot, owner) >= 2 ? 5 : 0;
  return opponentPlayerIds(snapshot, owner, options).length >= 2 ? 4 : 5;
}

function nearestOpponentObjective(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, preferredOwner?: PlayerId): Point {
  const preferred = preferredOwner ? nearestOwnedOpponentObjective(snapshot, owner, from, options, preferredOwner) : undefined;
  if (preferred) return preferred;
  const nonBase = enemyBuildings(snapshot, owner, options.teams).filter((building) => building.kind !== "townHall");
  const nearestNonBase = nearestEntity(nonBase, from);
  if (nearestNonBase) return nearestNonBase;
  const base = nearestEntity(enemyBuildings(snapshot, owner, options.teams).filter((building) => building.kind === "townHall"), from);
  if (base) return base;
  const army = enemyCombatUnits(snapshot, owner, options.teams);
  return army.length > 0 ? averagePoint(army) : currentBasePoint(snapshot, owner);
}

function nearestOwnedOpponentObjective(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, preferredOwner: PlayerId): Point | undefined {
  const nonBase = nearestEntity(buildings(snapshot, preferredOwner).filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind !== "townHall"), from);
  if (nonBase) return nonBase;
  const base = nearestEntity(buildings(snapshot, preferredOwner).filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind === "townHall"), from);
  if (base) return base;
  const army = combatUnits(snapshot, preferredOwner).filter((unit) => isEnemyOwner(snapshot, owner, unit.owner, options));
  return army.length > 0 ? averagePoint(army) : undefined;
}

function significantOpponentArmyTarget(snapshot: GameSnapshot, owner: PlayerId, from: Point, soldiers: Unit[], options: PresetAiPolicyOptions): Unit | undefined {
  const army = enemyCombatUnits(snapshot, owner, options.teams);
  if (army.length <= 4) return undefined;
  const ownPower = armyPower(soldiers);
  return army
    // @@@local-significant-target - Direct attack is for local army contact; distant isolated units near a base belong to objective movement, not chase orders.
    .filter((unit) => distance(unit, from) <= 1_450)
    .filter((unit) => armyPower(army.filter((candidate) => distance(candidate, unit) <= 520)) <= ownPower * 0.95)
    .filter((unit) => !routeArmyCoversOpponentTarget(army, from, unit, ownPower))
    .sort((a, b) => strategicArmyTargetScore(b, from) - strategicArmyTargetScore(a, from))[0];
}

function routeArmyCoversOpponentTarget(enemies: Unit[], from: Point, target: Unit, ownPower: number) {
  const routeEnemies = enemies.filter((candidate) => candidate.id !== target.id && distance(candidate, target) > 520 && pointToSegmentDistance(candidate, from, target) <= 600);
  // @@@route-covered-pickoff - A caster can be locally isolated while the chase path runs beside the real army; direct attack would drag the wave through that army.
  return routeEnemies.length >= 3 && armyPower(routeEnemies) > ownPower * 0.78;
}

function isolatedOpponentDetachmentTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemies: Unit[], options: PresetAiPolicyOptions): Unit | undefined {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2 || soldiers.length < 5) return undefined;
  const center = averagePoint(soldiers);
  const ownPower = armyPower(soldiers);
  const candidates = enemies
    .filter((enemy) => distance(enemy, center) <= 1_650)
    .map((enemy) => {
      const localEnemies = enemies.filter((candidate) => distance(candidate, enemy) <= 420);
      const localIds = new Set(localEnemies.map((candidate) => candidate.id));
      const nearbyReinforcements = enemies.filter((candidate) => !localIds.has(candidate.id) && distance(candidate, enemy) <= 920);
      const localPower = armyPower(localEnemies);
      const reinforcementPower = armyPower(nearbyReinforcements);
      const target = localEnemies.sort((a, b) => strategicArmyTargetScore(b, center) - strategicArmyTargetScore(a, center))[0] ?? enemy;
      return { target, localEnemies, localPower, reinforcementPower, score: localPower * 18 - reinforcementPower * 20 - distance(enemy, center) / 20 };
    })
    .filter(({ localEnemies, localPower, reinforcementPower }) => localEnemies.length <= 5 && localPower <= ownPower * 0.82 && reinforcementPower <= Math.max(1.5, localPower * 0.85));
  return candidates.sort((a, b) => b.score - a.score)[0]?.target;
}

function noWorkerLastArmyTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], movable: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || movable.length < 2 || movable.length > 4) return undefined;
  if (opponentPlayerIds(snapshot, owner, options).length !== 1) return undefined;
  if (units(snapshot, owner).some((unit) => unit.kind === "worker")) return undefined;
  const center = averagePoint(movable);
  if (enemyArmy.length === 0) {
    const worker = enemyWorkerUnits(snapshot, owner, options.teams).sort((a, b) => distance(a, center) - distance(b, center))[0];
    if (worker) return worker;
    return enemyBuildings(snapshot, owner, options.teams).sort((a, b) => {
      if (a.kind === "townHall" && b.kind !== "townHall") return -1;
      if (b.kind === "townHall" && a.kind !== "townHall") return 1;
      return distance(a, center) - distance(b, center);
    })[0];
  }
  if (enemyArmy.length > 3) return undefined;
  const ownPower = armyPower(soldiers);
  if (armyPower(enemyArmy) > ownPower * 0.82) return undefined;
  // @@@no-worker-last-army - With no workers left, waiting for the normal five-unit wave is impossible; the last squad must finish weak enemy combat.
  return enemyArmy.sort((a, b) => strategicArmyTargetScore(b, center) - strategicArmyTargetScore(a, center))[0];
}

function locallyBeatableOpponentBaseTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemies: Unit[], options: PresetAiPolicyOptions): Building | undefined {
  if (options.version !== "v2" || soldiers.length < 6) return undefined;
  const center = averagePoint(soldiers);
  const ownPower = armyPower(soldiers);
  return opponentPlayerIds(snapshot, owner, options)
    .flatMap((opponent) => {
      const opponentBuildings = buildings(snapshot, opponent);
      const target =
        nearestEntity(opponentBuildings.filter((building) => isCoreProductionBuilding(building) && distance(building, center) <= 1_900), center) ??
        nearestEntity(opponentBuildings.filter((building) => building.kind === "townHall" && distance(building, center) <= 1_900), center);
      if (!target) return [];
      const localDefenders = enemies.filter((unit) => unit.owner === opponent && distance(unit, target) <= 680);
      const localPower = armyPower(localDefenders);
      const routeReinforcements = enemies.filter((unit) => unit.owner !== opponent && pointToSegmentDistance(unit, center, target) <= 430 && distance(unit, target) > 620);
      const routePower = armyPower(routeReinforcements);
      if (localDefenders.length > 7 || localPower > ownPower * 1.08 || routePower > ownPower * 0.72) return [];
      const productionBonus = isCoreProductionBuilding(target) ? 110 : 0;
      return [{ target, score: productionBonus - localPower * 20 - routePower * 24 - distance(target, center) / 18 }];
    })
    .sort((a, b) => b.score - a.score)[0]?.target;
}

function strategicArmyTargetScore(unit: Unit, from: Point) {
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 4 + (unit.attackRange > 100 ? 35 : 0);
  return missingHp * 1.5 + threat - distance(unit, from) * 0.12;
}

function shouldCloseOutObjective(snapshot: GameSnapshot, owner: PlayerId, objective: Point, options: PresetAiPolicyOptions) {
  const building = nearestEntity(enemyBuildingsNear(snapshot, owner, objective, 4, options.teams), objective);
  if (!building) return false;
  const targetTeam = teamFor(snapshot, building.owner, options);
  const defenders = activePlayerIds(snapshot)
    .filter((candidate) => teamFor(snapshot, candidate, options) === targetTeam)
    .flatMap((candidate) => combatUnits(snapshot, candidate));
  return defenders.length <= 4;
}

function closeoutAttackWaveTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], movable: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions, preferredOwner?: PlayerId) {
  if (movable.length === 0) return undefined;
  if (options.version !== "v2" && resources(snapshot).length > activePlayerIds(snapshot).length && !hasEstablishedExpansion(snapshot, owner)) return undefined;
  const outnumberedV2 = options.version === "v2" && opponentPlayerIds(snapshot, owner, options).length >= 2;
  const minimumWaveSize = outnumberedV2 ? 7 : 5;
  if (options.version === "v2" && deadEconomyCloseoutReady(snapshot, owner, options, soldiers) && armyPower(enemyArmy) > armyPower(soldiers) * strongerEnemyArmyStoplineRatio(snapshot, owner, soldiers, options)) return undefined;
  const deadEconomyCleanup = options.version === "v2" ? deadEconomyCloseoutBuilding(snapshot, owner, averagePoint(movable), options, movable, preferredOwner) : undefined;
  const requiredWaveSize = deadEconomyCleanup ? 5 : minimumWaveSize;
  if (soldiers.length < requiredWaveSize) return undefined;
  if (outnumberedV2 && movable.length < requiredWaveSize) return undefined;
  if (deadEconomyCleanup) return deadEconomyCleanup;
  const crippledCleanup = options.version === "v2" ? crippledOpponentCloseoutBuilding(snapshot, owner, averagePoint(movable), options, movable, preferredOwner) : undefined;
  if (crippledCleanup) return crippledCleanup;
  if (outnumberedV2 && armyPower(enemyArmy) > armyPower(soldiers) * 1.25) return undefined;
  return weakOpponentCloseoutBuilding(snapshot, owner, averagePoint(movable), options, movable, preferredOwner);
}

function deadEconomyResidualArmyTarget(snapshot: GameSnapshot, owner: PlayerId, soldiers: Unit[], enemyArmy: Unit[], options: PresetAiPolicyOptions) {
  if (!deadEconomyCloseoutReady(snapshot, owner, options, soldiers)) return undefined;
  if (enemyArmy.length < Math.max(4, soldiers.length - 1)) return undefined;
  const center = averagePoint(soldiers);
  if (distance(averagePoint(enemyArmy), center) > 1_800) return undefined;
  // @@@dead-economy-residuals - A no-worker opponent can still have the army that decides the game; kill a nearby equal residual before racing buildings.
  return enemyArmy.sort((a, b) => strategicArmyTargetScore(b, center) - strategicArmyTargetScore(a, center))[0];
}

function deadEconomyCloseoutBuilding(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, soldiers: Unit[], preferredOwner?: PlayerId) {
  if (!deadEconomyCloseoutReady(snapshot, owner, options, soldiers)) return undefined;
  // @@@dead-economy-closeout - Once both 1v2 economies are dead, five healthy units should trade bases instead of waiting for a seven-unit wave.
  const cleanable = enemyBuildings(snapshot, owner, options.teams).filter((building) => deadEconomyBuildingIsCleanable(snapshot, owner, building, from, soldiers, options));
  const preferred = preferredOwner ? cleanable.filter((building) => building.owner === preferredOwner) : [];
  const candidates = preferred.length > 0 ? preferred : cleanable;
  return candidates.sort((a, b) => closeoutBuildingScore(b, from) - closeoutBuildingScore(a, from))[0];
}

function deadEconomyCloseoutReady(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, soldiers: Unit[]) {
  if (options.version !== "v2" || soldiers.length < 5) return false;
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (opponents.length < 1) return false;
  if (completeBuildings(snapshot, owner, "townHall").length < 2) return false;
  return !opponents.some((opponent) => units(snapshot, opponent).some((unit) => unit.kind === "worker"));
}

function deadEconomyBuildingIsCleanable(snapshot: GameSnapshot, owner: PlayerId, building: Building, from: Point, soldiers: Unit[], options: PresetAiPolicyOptions) {
  const soldierPower = armyPower(soldiers);
  const localDefenders = enemyCombatUnitsNear(snapshot, owner, building, 620, options.teams);
  if (armyPower(localDefenders) > soldierPower * 0.65) return false;
  const routeDefenders = enemyCombatUnits(snapshot, owner, options.teams).filter(
    (unit) =>
      distance(unit, building) > 620 &&
      pointToSegmentDistance(unit, from, building) <= 360,
  );
  return armyPower(routeDefenders) <= soldierPower * 1.1;
}

function weakOpponentCloseoutBuilding(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, soldiers: Unit[] = [], preferredOwner?: PlayerId) {
  const candidates = preferredAttackBuildings(enemyBuildings(snapshot, owner, options.teams), preferredOwner);
  const disabledTarget = options.version === "v2" ? crippledOpponentCloseoutBuilding(snapshot, owner, from, options, soldiers, preferredOwner) : undefined;
  if (disabledTarget) return disabledTarget;
  const weakTargets = candidates.filter((building) => {
    const targetTeam = teamFor(snapshot, building.owner, options);
    const defenders = activePlayerIds(snapshot)
      .filter((candidate) => teamFor(snapshot, candidate, options) === targetTeam)
      .flatMap((candidate) => combatUnits(snapshot, candidate));
    return defenders.length <= 4;
  });
  return weakTargets.sort((a, b) => closeoutBuildingScore(b, from) - closeoutBuildingScore(a, from))[0];
}

function crippledOpponentCloseoutBuilding(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, soldiers: Unit[], preferredOwner?: PlayerId) {
  return preferredAttackBuildings(allBuildings(snapshot), preferredOwner)
    .filter((building) => isEnemyOwner(snapshot, owner, building.owner, options))
    .filter((building) => crippledOpponentBuildingIsCleanable(snapshot, owner, building, from, soldiers, options))
    .sort((a, b) => crippledOpponentCleanupScore(b, from) - crippledOpponentCleanupScore(a, from))[0];
}

function preferredAttackBuildings(candidates: Building[], preferredOwner: PlayerId | undefined) {
  if (!preferredOwner) return candidates;
  const preferred = candidates.filter((building) => building.owner === preferredOwner);
  return preferred.length > 0 ? preferred : candidates;
}

function crippledOpponentBuildingIsCleanable(snapshot: GameSnapshot, owner: PlayerId, building: Building, from: Point, soldiers: Unit[], options: PresetAiPolicyOptions) {
  if (soldiers.length < 5) return false;
  const targetWorkers = units(snapshot, building.owner).filter((unit) => unit.kind === "worker").length;
  const targetCombat = combatUnits(snapshot, building.owner);
  if (targetWorkers > 0 || targetCombat.length > 1) return false;
  const soldierPower = armyPower(soldiers);
  const localDefenders = enemyCombatUnitsNear(snapshot, owner, building, 620, options.teams);
  if (armyPower(localDefenders) > soldierPower * 0.5) return false;
  const routeDefenders = enemyCombatUnits(snapshot, owner, options.teams).filter(
    (unit) =>
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

function nearestEnemyBase(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions, preferredOwner?: PlayerId) {
  const preferred = preferredOwner
    ? nearestEntity(buildings(snapshot, preferredOwner).filter((building) => isEnemyOwner(snapshot, owner, building.owner, options) && building.kind === "townHall" && building.complete), from)
    : undefined;
  return preferred ?? nearestEntity(enemyBuildings(snapshot, owner, options.teams).filter((building) => building.kind === "townHall" && building.complete), from);
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
