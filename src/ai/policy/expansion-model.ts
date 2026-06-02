import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId, ResourceNode, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { opponentPlayerIds } from "./ownership";
import { missingCombatProductionKind } from "./production-model";
import { activePlayerIds, activeResources, allBuildings, buildings, combatUnits, completeBuildings, neutralUnitsNear, resources, units } from "./snapshot";
import { distance } from "./spatial";
import { enemyPressure } from "./threats";
import { hasCoreProduction, isCoreProductionBuilding, mainBase, nearestResource, playerState } from "./world-model";
import type { PresetAiPolicyOptions } from "./types";

export function desiredExpansionMine(snapshot: GameSnapshot, owner: PlayerId) {
  const townHalls = completeBuildings(snapshot, owner, "townHall");
  const base = mainBase(snapshot, owner);
  return activeResources(snapshot)
    .filter((resource) => townHalls.every((townHall) => distance(resource, townHall) > 520))
    .filter((resource) => allBuildings(snapshot).every((building) => building.kind !== "townHall" || distance(resource, building) > 340))
    .sort((a, b) => distance(a, base) - distance(b, base))[0];
}

export function desiredCatchUpExpansionMine(snapshot: GameSnapshot, owner: PlayerId) {
  return desiredExpansionMine(snapshot, owner);
}

export function activeMiningBaseCount(snapshot: GameSnapshot, owner: PlayerId) {
  return completeBuildings(snapshot, owner, "townHall").filter((townHall) => {
    const mine = nearestResource(activeResources(snapshot), townHall);
    return Boolean(mine && distance(mine, townHall) < 260);
  }).length;
}

export function expansionBaseTarget(options: PresetAiPolicyOptions) {
  return options.version === "v2" ? 5 : 2;
}

export function canExpandBeforeFullProductionChain(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (buildings(snapshot, owner).filter((building) => building.complete && isCoreProductionBuilding(building)).length < 2) return false;
  if (opponentPlayerIds(snapshot, owner, options).length >= 2) return opponentEconomyAhead(snapshot, owner, options);
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine || enemyPressure(snapshot, owner, mine, 360, options)) return false;
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  return remainingNeutralPower <= 0 || expansionIsNearlyCleared(snapshot, owner, mine);
}

export function shouldReserveForExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (resources(snapshot).length <= activePlayerIds(snapshot).length) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  const ownCombatCount = combatUnits(snapshot, owner).length;
  const minimumReserveArmy = 4;
  if (ownCombatCount < minimumReserveArmy && !shouldReserveForClearedExpansion(snapshot, owner, options)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return false;
  if (neutralUnitsNear(snapshot, mine, 280).length > 0) return options.version === "v2" && (expansionIsNearlyCleared(snapshot, owner, mine) || activeGuardedFirstNatural(snapshot, owner, mine, options));
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  if (completeBuildings(snapshot, owner, "townHall").length >= 2) return shouldPrioritizeCatchUpExpansionBeforeMacro(snapshot, owner, options);
  const missingProduction = missingCombatProductionKind(snapshot, owner);
  if (!missingProduction) return true;
  if (canExpandBeforeFullProductionChain(snapshot, owner, options)) return true;
  return options.version === "v2" && hasCoreProduction(snapshot, owner) && opponentEconomyAhead(snapshot, owner, options);
}

export function shouldReserveForClearedExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  if (combatUnits(snapshot, owner).length < 3) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return false;
  if (neutralUnitsNear(snapshot, mine, 280).length > 0) return false;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  return opponentEconomyAhead(snapshot, owner, options) || canExpandBeforeFullProductionChain(snapshot, owner, options);
}

export function expansionIsNearlyCleared(snapshot: GameSnapshot, owner: PlayerId, mine: ResourceNode) {
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  if (remainingNeutralPower <= 0 || remainingNeutralPower > 1) return false;
  const nearbyArmy = combatUnits(snapshot, owner).filter((unit) => distance(unit, mine) <= 420);
  return nearbyArmy.length >= 3 && armyPower(nearbyArmy) >= remainingNeutralPower * 4;
}

export function activeGuardedFirstNatural(snapshot: GameSnapshot, owner: PlayerId, mine: ResourceNode, options: PresetAiPolicyOptions) {
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  if (!opponentEconomyAhead(snapshot, owner, options)) return false;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  if (playerState(snapshot, owner).gold < BUILDING_DEFS.townHall.cost - 80) return false;
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  if (remainingNeutralPower <= 0 || remainingNeutralPower > 2) return false;
  // @@@guarded-natural-reserve - Do not starve army production while a full guarded natural still needs real clearing.
  const committedArmy = combatUnits(snapshot, owner).filter((unit) => distance(unit, mine) <= 560 || (unit.order.type === "attackMove" && distance(unit.order, mine) <= 260));
  return committedArmy.length >= 4 && armyPower(committedArmy) >= remainingNeutralPower * 1.2;
}

export function canClearGuardedExpansion(snapshot: GameSnapshot, mine: ResourceNode, soldiers: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return true;
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  // @@@guarded-natural-power - Four bodies are not enough if this exact squad is weaker than the natural guards.
  return remainingNeutralPower <= 0 || armyPower(soldiers) >= remainingNeutralPower;
}

export function neutralGuardPower(snapshot: GameSnapshot, mine: ResourceNode) {
  return neutralUnitsNear(snapshot, mine, 280).reduce((total, unit) => total + (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) * (unit.hp / Math.max(1, unit.maxHp)), 0);
}

export function shouldPrioritizeCatchUpExpansionBeforeMacro(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (activeMiningBaseCount(snapshot, owner) >= 4) return false;
  const ownBases = completeBuildings(snapshot, owner, "townHall").length;
  if (ownBases < 2 && combatUnits(snapshot, owner).length < 6) return false;
  const opponents = opponentPlayerIds(snapshot, owner, options);
  const enemyBases = opponents.reduce((total, candidate) => total + completeBuildings(snapshot, candidate, "townHall").length, 0);
  const requiredLead = opponents.length >= 2 ? 2 : 1;
  return enemyBases >= ownBases + requiredLead;
}

export function unguardedExpansion(snapshot: GameSnapshot, owner: PlayerId) {
  const bases = completeBuildings(snapshot, owner, "townHall");
  const main = mainBase(snapshot, owner);
  const towers = buildings(snapshot, owner).filter((building) => building.kind === "defenseTower");
  return bases
    .filter((base) => distance(base, main) > 500)
    .find((base) => !towers.some((tower) => distance(tower, base) < 430));
}

export function opponentEconomyAhead(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const ownBases = completeBuildings(snapshot, owner, "townHall").length;
  const enemyOwners = opponentPlayerIds(snapshot, owner, options);
  const enemyBases = enemyOwners.reduce((total, candidate) => total + completeBuildings(snapshot, candidate, "townHall").length, 0);
  if (enemyBases > ownBases) return true;
  const ownWorkers = units(snapshot, owner).filter((unit) => unit.kind === "worker").length;
  const enemyWorkers = enemyOwners.reduce((total, candidate) => total + units(snapshot, candidate).filter((unit) => unit.kind === "worker").length, 0);
  return enemyWorkers >= ownWorkers + 4;
}

export function hasEstablishedExpansion(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  return completeBuildings(snapshot, owner, "townHall").some((townHall) => distance(townHall, main) > 650);
}

export function ownedMiningLocations(snapshot: GameSnapshot, owner: PlayerId, townHalls: Building[]) {
  return activeResources(snapshot).filter((resource) => townHalls.some((townHall) => townHall.owner === owner && distance(resource, townHall) <= 620));
}

export function hasMiningExpansion(snapshot: GameSnapshot, owner: PlayerId) {
  const main = mainBase(snapshot, owner);
  const expansionTownHall = completeBuildings(snapshot, owner, "townHall").find((townHall) => distance(townHall, main) > 650);
  const expansionMine = expansionTownHall ? nearestResource(activeResources(snapshot), expansionTownHall) : undefined;
  return Boolean(
    expansionTownHall &&
      expansionMine &&
      distance(expansionMine, expansionTownHall) < 260 &&
      units(snapshot, owner).some((unit) => unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === expansionMine.id),
  );
}
