import { BUILDING_DEFS } from "../../shared/catalog";
import type { GameSnapshot, PlayerId } from "../../shared/types";
import { activePlayerIds, activeResources, buildings, combatUnits, completeBuildings, units } from "./snapshot";
import { opponentPlayerIds } from "./ownership";
import { aiPlaybook, type ProductionBuildingKind } from "./playbook";
import type { PresetAiPolicyOptions } from "./types";
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
  const player = playerState(snapshot, owner);
  const plan = aiPlaybook(player.race).productionPlan;
  const army = combatUnits(snapshot, owner);
  const armyGates = options.version === "v2" ? [0, 3, 7, 8, 11] : [0, 3, 6, 8, 11];
  const goldGates = [0, 420, 620, 820, 1040];
  const desired = plan.filter((kind, index) => index === 0 || army.length >= productionPlanArmyGate(plan, kind, index, armyGates[index]!, options) || player.gold > goldGates[index]!);
  if (buildings(snapshot, owner).some((building) => !building.complete && building.kind !== "farm" && building.kind !== "moonWell" && building.kind !== "emberShrine")) return undefined;

  return firstMissingProductionPlanKind(desired, buildings(snapshot, owner).map((building) => building.kind));
}

function productionPlanArmyGate(plan: ProductionBuildingKind[], kind: ProductionBuildingKind, index: number, baseGate: number, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return baseGate;
  if (!plan.slice(0, index).includes(kind)) return baseGate;
  return Math.max(baseGate, 10);
}

function firstMissingProductionPlanKind(desired: ProductionBuildingKind[], existingKinds: string[]): ProductionBuildingKind | undefined {
  const existingCounts = new Map<ProductionBuildingKind, number>();
  for (const kind of desired) existingCounts.set(kind, existingKinds.filter((existing) => existing === kind).length);

  const requiredCounts = new Map<ProductionBuildingKind, number>();
  for (const kind of desired) {
    const required = (requiredCounts.get(kind) ?? 0) + 1;
    requiredCounts.set(kind, required);
    if ((existingCounts.get(kind) ?? 0) < required) return kind;
  }
  return undefined;
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
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  if (desiredMissingProductionKind(snapshot, owner, options)) return undefined;
  const noExpansionMap = isOneBaseNoExpansionPressure(snapshot, owner);
  if (!noExpansionMap && completeBuildings(snapshot, owner, "townHall").length < 2) return undefined;
  const minimumWorkers = noExpansionMap ? 5 : 9;
  const minimumCombat = noExpansionMap ? 2 : 6;
  if (units(snapshot, owner).filter((unit) => unit.kind === "worker").length < minimumWorkers || combatUnits(snapshot, owner).length < minimumCombat) return undefined;
  if (buildings(snapshot, owner).some((building) => !building.complete && isCoreProductionBuilding(building))) return undefined;
  const candidates = aiPlaybook(playerState(snapshot, owner).race).productionPlan.slice(0, 3);
  const counts = new Map(candidates.map((kind) => [kind, buildings(snapshot, owner).filter((building) => building.kind === kind).length]));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total >= (noExpansionMap ? 3 : 6)) return undefined;
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
