import { BUILDING_DEFS } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId } from "../../shared/types";
import { armyPower } from "./combat-math";
import { opponentPlayerIds } from "./ownership";
import { missingCombatProductionKind } from "./production-model";
import { activeResources, buildings, combatUnits, completeBuildings, enemyCombatUnitsNear, units } from "./snapshot";
import { distance, type Point } from "./spatial";
import { availableBuilder, hasCoreProduction, mainBase, nearestResource, playerState } from "./world-model";
import type { PresetAiPolicyOptions } from "./types";

export function shouldReserveForCoreProductionRecovery(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, spendCost: number) {
  if (options.version !== "v2" || hasCoreProduction(snapshot, owner)) return false;
  const missing = missingCombatProductionKind(snapshot, owner);
  if (!missing) return false;
  const main = completeBuildings(snapshot, owner, "townHall")[0];
  if (!main || !availableBuilder(snapshot, owner, main)) return false;
  // @@@core-production-recovery - With no barracks/range/stables left, cheap defensive spending can silently starve the rebuild.
  return playerState(snapshot, owner).gold < BUILDING_DEFS[missing].cost + spendCost;
}

export function shouldGuardFreshMiningExpansion(snapshot: GameSnapshot, owner: PlayerId, base: Building, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  if (distance(base, mainBase(snapshot, owner)) <= 500) return false;
  const mine = nearestResource(activeResources(snapshot), base);
  if (!mine || distance(mine, base) > 260) return false;
  return units(snapshot, owner).some((unit) => unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === mine.id);
}

export function shouldReserveForEmergencyTower(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return false;
  const enemies = enemyCombatUnitsNear(snapshot, owner, main, 1_200, options.teams);
  if (enemies.length < 3) return false;
  return armyPower(enemies) > armyPower(combatUnits(snapshot, owner)) * 1.05;
}

export function needsMainGuardTower(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (!hasCoreProduction(snapshot, owner) || combatUnits(snapshot, owner).length < 2) return false;
  const main = mainBase(snapshot, owner);
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && distance(building, main) < 430)) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete)) return false;
  const enemies = enemyCombatUnitsNear(snapshot, owner, main, 1_850, options.teams);
  return enemies.length >= 2 && armyPower(enemies) >= 1.8;
}

export function shouldReserveForHealingWell(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
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

export function healingWellPressure(snapshot: GameSnapshot, owner: PlayerId, main: Point, options: PresetAiPolicyOptions) {
  return enemyCombatUnitsNear(snapshot, owner, main, 1_650, options.teams).length > 0;
}
