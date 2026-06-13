import { BUILDING_DEFS } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId } from "../../shared/types";
import { activeMiningBaseCount } from "./expansion-model";
import { activePlayerIds, activeResources, buildings, combatUnits, completeBuildings, units } from "./snapshot";
import { opponentPlayerIds } from "./ownership";
import { aiPlaybook, type ProductionBuildingKind } from "./playbook";
import type { PresetAiPolicyOptions } from "./types";
import { isTowerMercPolicy, isV5HybridPolicy } from "./versions";
import { hasCoreProduction, isCoreProductionBuilding, playerState } from "./world-model";

export function nextProductionBuildingKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  const missing = productionBuildingNeedKind(snapshot, owner, options);
  if (!missing || playerState(snapshot, owner).gold < BUILDING_DEFS[missing].cost) return undefined;
  return missing;
}

export function productionBuildingNeedKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  return desiredMissingProductionKind(snapshot, owner, options) ?? duplicateCoreProductionKind(snapshot, owner, options);
}

export function desiredMissingProductionKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions = {}): ProductionBuildingKind | undefined {
  if (isTowerMercPolicy(options)) return undefined;
  const player = playerState(snapshot, owner);
  const plan = desiredProductionPlan(snapshot, owner, options);
  const army = combatUnits(snapshot, owner);
  const armyGates = desiredProductionArmyGates(snapshot, owner, options);
  const goldGates = [0, 420, 620, 820, 1040];
  const desired = plan.filter((_, index) => index === 0 || army.length >= armyGates[index]! || player.gold > goldGates[index]!);
  const blockingIncomplete = buildings(snapshot, owner).filter((building) => !building.complete && building.kind !== "farm" && building.kind !== "moonWell" && building.kind !== "emberShrine");
  if (blockingIncomplete.length > 0 && !canAddSevereEconomyFirstCoreDuringExpansion(snapshot, owner, options, desired, blockingIncomplete)) return undefined;

  return desired.find((kind) => !buildings(snapshot, owner).some((building) => building.kind === kind));
}

function desiredProductionArmyGates(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (isV5HybridPolicy(options) && playerState(snapshot, owner).race === "grove" && opponentPlayerIds(snapshot, owner, options).length >= 3 && isOneBaseNoExpansionPressure(snapshot, owner)) {
    // @@@v5-no-expansion-stables-gate - No-expansion 1v3+ cannot scale by town halls; Grove needs its third production shell before the seven-unit v2 timing.
    return [0, 3, 5, 8, 11];
  }
  return options.version === "v2" ? [0, 3, 7, 8, 11] : [0, 3, 6, 8, 11];
}

function canAddSevereEconomyFirstCoreDuringExpansion(
  snapshot: GameSnapshot,
  owner: PlayerId,
  options: PresetAiPolicyOptions,
  desired: readonly ProductionBuildingKind[],
  blockingIncomplete: readonly Building[],
) {
  if (!isV5HybridPolicy(options)) return false;
  if (opponentPlayerIds(snapshot, owner, options).length < 3) return false;
  if (hasCoreProduction(snapshot, owner)) return false;
  if (blockingIncomplete.some((building) => isCoreProductionBuilding(building))) return false;
  const firstCore = desired[0];
  return Boolean(firstCore && !buildings(snapshot, owner).some((building) => building.kind === firstCore));
}

function desiredProductionPlan(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind[] {
  const player = playerState(snapshot, owner);
  const plan = aiPlaybook(player.race).productionPlan;
  if (!isV5HybridPolicy(options) || player.race !== "grove" || opponentPlayerIds(snapshot, owner, options).length < 2 || activeMiningBaseCount(snapshot, owner) < 2) return plan;
  return [...plan, "workshop"];
}

export function missingCombatProductionKind(snapshot: GameSnapshot, owner: PlayerId): ProductionBuildingKind | undefined {
  const requiredCombatChain = aiPlaybook(playerState(snapshot, owner).race).productionPlan.slice(0, 3);
  return requiredCombatChain.find((kind) => !buildings(snapshot, owner).some((building) => building.kind === kind && building.complete));
}

export function needsDuplicateCoreProduction(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  return Boolean(duplicateCoreProductionKind(snapshot, owner, options));
}

export function duplicateCoreProductionKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  const candidate = duplicateCoreProductionReserveKind(snapshot, owner, options);
  if (!candidate || (!isOneBaseNoExpansionPressure(snapshot, owner) && playerState(snapshot, owner).gold < 260)) return undefined;
  return candidate;
}

export function duplicateCoreProductionReserveKind(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ProductionBuildingKind | undefined {
  if (options.version !== "v2") return undefined;
  const opponents = opponentPlayerIds(snapshot, owner, options);
  const player = playerState(snapshot, owner);
  const emberOneOnOneScale = player.race === "ember" && opponents.length === 1 && completeBuildings(snapshot, owner, "townHall").length >= 2;
  if (!emberOneOnOneScale && opponents.length < 2) return undefined;
  if (desiredMissingProductionKind(snapshot, owner, options)) return undefined;
  const noExpansionMap = isOneBaseNoExpansionPressure(snapshot, owner);
  if (!noExpansionMap && completeBuildings(snapshot, owner, "townHall").length < 2) return undefined;
  const minimumWorkers = emberOneOnOneScale ? 9 : noExpansionMap ? 5 : 9;
  const minimumCombat = emberOneOnOneScale ? 15 : noExpansionMap ? 2 : 6;
  if (units(snapshot, owner).filter((unit) => unit.kind === "worker").length < minimumWorkers || combatUnits(snapshot, owner).length < minimumCombat) return undefined;
  if (buildings(snapshot, owner).some((building) => !building.complete && isCoreProductionBuilding(building))) return undefined;
  const candidates = aiPlaybook(player.race).productionPlan.slice(0, emberOneOnOneScale ? 4 : 3);
  const counts = new Map(candidates.map((kind) => [kind, buildings(snapshot, owner).filter((building) => building.kind === kind).length]));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total >= (emberOneOnOneScale ? 4 : noExpansionMap ? 3 : 6)) return undefined;
  return candidates.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0];
}

export function shouldFinishCoreArmyBeforeMoreProduction(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
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

export function isNoExpansionMap(snapshot: GameSnapshot) {
  return activeResources(snapshot).length <= activePlayerIds(snapshot).length;
}

export function isOneBaseNoExpansionPressure(snapshot: GameSnapshot, owner: PlayerId) {
  return isNoExpansionMap(snapshot) && completeBuildings(snapshot, owner, "townHall").length <= 1;
}
