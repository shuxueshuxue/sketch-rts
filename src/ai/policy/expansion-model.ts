import { GOLD_MINE_RULES } from "../../shared/mining";
import { miningHallSite } from "../../shared/mining-site";
import { strikeGap } from "../../shared/combat-geometry";
import { segmentWalkable, walkDestination, walkRoute } from "../../shared/terrain";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId, ResourceNode, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { isEnemyOwner, opponentPlayerIds } from "./ownership";
import { missingCombatProductionKind } from "./production-model";
import { activePlayerIds, activeResources, allBuildings, buildings, combatUnits, completeBuildings, enemyBuildingsNear, neutralUnitsNear, resources, units } from "./snapshot";
import { averagePoint, distance, pointToSegmentDistance, type Point } from "./spatial";
import { enemyPressure } from "./threats";
import { availableBuilder, expansionOffset, hasCoreProduction, isCoreProductionBuilding, mainBase, nearestResource, playerState } from "./world-model";
import type { PresetAiPolicyOptions } from "./types";
import { isV5HybridPolicy } from "./versions";
import { onHomeGround } from "./ground";

export function desiredExpansionMine(snapshot: GameSnapshot, owner: PlayerId) {
  const townHalls = completeBuildings(snapshot, owner, "townHall");
  const base = mainBase(snapshot, owner);
  return activeResources(snapshot)
    .filter((resource) => unoccupiedExpansionMine(snapshot, owner, resource, townHalls))
    .sort((a, b) => distance(a, base) - distance(b, base))[0];
}

// A mine the owner's workers can walk to (see @@@ai-home-ground) with no hall by it.
function unoccupiedExpansionMine(snapshot: GameSnapshot, owner: PlayerId, resource: ResourceNode, ownTownHalls = completeBuildings(snapshot, owner, "townHall")) {
  return onHomeGround(snapshot, owner, resource) && ownTownHalls.every((townHall) => distance(resource, townHall) > 520) && allBuildings(snapshot).every((building) => building.kind !== "townHall" || distance(resource, building) > 340);
}

export function desiredCatchUpExpansionMine(snapshot: GameSnapshot, owner: PlayerId) {
  return desiredExpansionMine(snapshot, owner);
}

export function desiredForwardExpansionMine(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return undefined;
  if (!hasCoreProduction(snapshot, owner)) return undefined;
  const army = combatUnits(snapshot, owner);
  if (army.length < 6) return undefined;
  const main = mainBase(snapshot, owner);
  const center = averagePoint(army);
  if (distance(center, main) < 1_200) return undefined;
  const ordinary = desiredExpansionMine(snapshot, owner);
  return activeResources(snapshot)
    .filter((resource) => unoccupiedExpansionMine(snapshot, owner, resource))
    .filter((resource) => neutralUnitsNear(snapshot, resource, 280).length === 0)
    .filter((resource) => distance(resource, center) <= 950)
    .filter((resource) => !ordinary || distance(resource, center) + 500 < distance(ordinary, center))
    .filter((resource) => !enemyPressure(snapshot, owner, resource, 420, options))
    .sort((a, b) => distance(a, center) - distance(b, center))[0];
}

// A hall mines when a mine with gold left is within 260 of it. (This read the nearest such mine, from a sorted copy of the
// list made per hall, and tested its distance: the same as asking whether any is that near.)
export function activeMiningBaseCount(snapshot: GameSnapshot, owner: PlayerId) {
  const mines = activeResources(snapshot);
  return completeBuildings(snapshot, owner, "townHall").filter((townHall) => mines.some((mine) => distance(mine, townHall) < GOLD_MINE_RULES.baseRange)).length;
}

export function expansionBaseTarget(options: PresetAiPolicyOptions) {
  return options.version === "v2" ? 5 : 2;
}

type ReplacementSite = { point: Point | undefined; reachable: WeakMap<Unit, boolean>; routes: WeakMap<Unit, Point[]> };
const replacementSites = new WeakMap<GameSnapshot, Map<string, ReplacementSite>>();

/** Replace exhausted mining bases rather than spending every remote haul on
 * another isolated soldier. This is a working economy's next legal foundation,
 * not a reserve for an unclaimed or contested speculative mine. */
export function depletedEconomyExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || activeMiningBaseCount(snapshot, owner) > 0) return undefined;
  const bases = completeBuildings(snapshot, owner, "townHall");
  if (!bases.length || buildings(snapshot, owner).some(building => building.kind === "townHall" && !building.complete)) return undefined;
  const main = mainBase(snapshot, owner);
  if (enemyPressure(snapshot, owner, main, 640, options)) return undefined;
  const ownWorkers = units(snapshot, owner).filter(unit => unit.hp > 0 && unit.kind === "worker" && !unit.deck && unit.order.type === "mine");
  const mine = activeResources(snapshot)
    .filter(resource => resource.amount + playerState(snapshot, owner).gold >= BUILDING_DEFS.townHall.cost)
    .filter(resource => unoccupiedExpansionMine(snapshot, owner, resource, bases))
    .filter(resource => ownWorkers.some(worker => worker.order.type === "mine" && worker.order.resourceId === resource.id))
    .filter(resource => neutralUnitsNear(snapshot, resource, 360).length === 0
      && !enemyPressure(snapshot, owner, resource, 640, options)
      && enemyBuildingsNear(snapshot, owner, resource, 720, options.teams).length === 0)
    .sort((a, b) => distance(a, main) - distance(b, main))[0];
  if (!mine) return undefined;
  const builder = availableBuilder(snapshot, owner, mine, options);
  if (!builder || builder.hp <= 0) return undefined;
  const offset = expansionOffset(snapshot, owner);
  // Scripts share an immutable snapshot, while their claims and gold budget
  // can change. Cache only that frame's foundation/path geometry; select the
  // still-available builder and affordable live mine above on every call.
  let sites = replacementSites.get(snapshot);
  if (!sites) { sites = new Map(); replacementSites.set(snapshot, sites); }
  const key = `${mine.id}:${offset.x}:${offset.y}`;
  let site = sites.get(key);
  if (!site) {
    site = { point: miningHallSite(snapshot, mine, { x: mine.x + offset.x, y: mine.y + offset.y }), reachable: new WeakMap(), routes: new WeakMap() };
    sites.set(key, site);
  }
  const point = site.point;
  if (!point) return undefined;
  let reachable = site.reachable.get(builder);
  if (reachable === undefined) {
    reachable = distance(walkDestination(snapshot.map, builder, point), point) <= 1e-6;
    site.reachable.set(builder, reachable);
  }
  if (!reachable) return undefined;
  const towers = allBuildings(snapshot).filter(building => building.hp > 0 && building.complete && building.attackDamage > 0
    && isEnemyOwner(snapshot, owner, building.owner, options));
  if (towers.length) {
    const foundation = { ...point, radius: BUILDING_DEFS.townHall.radius };
    if (towers.some(tower => strikeGap(tower, foundation) <= tower.attackRange)) return undefined;
    let route = site.routes.get(builder);
    if (!route) {
      route = segmentWalkable(snapshot.map, builder, point) ? [point] : walkRoute(snapshot.map, builder, point, 1);
      if (!route) return undefined;
      site.routes.set(builder, route);
    }
    // The mine's exclusion radius does not cover an offset foundation or a
    // builder approaching it from the far side of a hostile tower.
    let from: Point = builder;
    for (const to of route) {
      if (towers.some(tower => pointToSegmentDistance(tower, from, to) <= tower.attackRange + builder.radius)) return undefined;
      from = to;
    }
  }
  return { mine, builder, point: { ...point } };
}

export function canExpandBeforeFullProductionChain(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return false;
  if (canTakeSevereEconomyGapFollowupExpansion(snapshot, owner, options)) return true;
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (canTakeSevereEconomyGapFirstExpansion(snapshot, owner, options)) return true;
  if (buildings(snapshot, owner).filter((building) => building.complete && isCoreProductionBuilding(building)).length < 2) return false;
  if (opponentPlayerIds(snapshot, owner, options).length >= 2) return opponentEconomyAhead(snapshot, owner, options);
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine || enemyPressure(snapshot, owner, mine, 360, options)) return false;
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  return remainingNeutralPower <= 0 || expansionIsNearlyCleared(snapshot, owner, mine);
}

function canTakeSevereEconomyGapFirstExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (!isV5HybridPolicy(options)) return false;
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (opponents.length < 3) return false;
  const ownBases = completeBuildings(snapshot, owner, "townHall").length;
  const enemyBases = opponents.reduce((total, opponent) => total + completeBuildings(snapshot, opponent, "townHall").length, 0);
  if (enemyBases < ownBases + 2) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine) return false;
  if (neutralUnitsNear(snapshot, mine, 280).length > 0) return false;
  if (opponentBaseControlsExpansionMine(snapshot, opponents, mine)) return false;
  return !enemyPressure(snapshot, owner, mine, 360, options);
}

function canTakeSevereEconomyGapFollowupExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (!isV5HybridPolicy(options)) return false;
  if (opponentPlayerIds(snapshot, owner, options).length < 3) return false;
  if (activeMiningBaseCount(snapshot, owner) < 2) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  if (combatUnits(snapshot, owner).length < 5) return false;
  if (!shouldPrioritizeCatchUpExpansionBeforeMacro(snapshot, owner, options)) return false;
  const mine = desiredExpansionMine(snapshot, owner);
  if (!mine || neutralUnitsNear(snapshot, mine, 280).length > 0) return false;
  return !enemyPressure(snapshot, owner, mine, 360, options);
}

function opponentBaseControlsExpansionMine(snapshot: GameSnapshot, opponents: readonly PlayerId[], mine: ResourceNode) {
  return allBuildings(snapshot).some((building) => opponents.includes(building.owner) && building.kind === "townHall" && distance(building, mine) < 900);
}

export function shouldReserveForExpansion(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (resources(snapshot).length <= activePlayerIds(snapshot).length) return false;
  if (buildings(snapshot, owner).some((building) => building.kind === "townHall" && !building.complete)) return false;
  if (depletedEconomyExpansion(snapshot, owner, options)) return true;
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
  const guards = neutralUnitsNear(snapshot, mine, 280);
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  if (remainingNeutralPower <= 0) return true;
  if (remainingNeutralPower > 4.5) return false;
  const damagedGuard = guards.some((unit) => unit.hp < unit.maxHp * 0.55);
  if (remainingNeutralPower > 1 && !damagedGuard) return false;
  const nearbyArmy = combatUnits(snapshot, owner).filter((unit) => distance(unit, mine) <= 420);
  const requiredBodies = remainingNeutralPower <= 1 ? 3 : 4;
  const requiredPowerRatio = remainingNeutralPower <= 1 ? 4 : 1.55;
  return nearbyArmy.length >= requiredBodies && expansionClearPower(nearbyArmy) >= remainingNeutralPower * requiredPowerRatio;
}

export function activeGuardedFirstNatural(snapshot: GameSnapshot, owner: PlayerId, mine: ResourceNode, options: PresetAiPolicyOptions) {
  if (completeBuildings(snapshot, owner, "townHall").length !== 1) return false;
  if (!hasCoreProduction(snapshot, owner)) return false;
  if (enemyPressure(snapshot, owner, mine, 360, options)) return false;
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  if (remainingNeutralPower <= 0 || remainingNeutralPower > 6) return false;
  const guards = neutralUnitsNear(snapshot, mine, 280);
  if (remainingNeutralPower > 2 && !guards.some((unit) => unit.hp < unit.maxHp * 0.75)) return false;
  // @@@active-natural-bank - Once the first natural fight is already won operationally, routine macro spending must not reset the town-hall bank window.
  const committedArmy = combatUnits(snapshot, owner).filter((unit) => distance(unit, mine) <= 560 || (unit.order.type === "attackMove" && distance(unit.order, mine) <= 260));
  return committedArmy.length >= 4 && expansionClearPower(committedArmy) >= remainingNeutralPower;
}

export function canClearGuardedExpansion(snapshot: GameSnapshot, mine: ResourceNode, soldiers: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return true;
  const remainingNeutralPower = neutralGuardPower(snapshot, mine);
  // @@@guarded-natural-power - Four bodies are not enough if this exact squad is weaker than the natural guards.
  return remainingNeutralPower <= 0 || expansionClearPower(soldiers) >= remainingNeutralPower;
}

function expansionClearPower(units: Unit[]) {
  // @@@guarded-natural-wounds - Natural clearing is attrition-limited; badly wounded bodies cannot be valued as full strategic army power.
  return units.reduce((total, unit) => {
    const health = Math.max(0.2, unit.hp / Math.max(1, unit.maxHp));
    return total + health * (1 + unit.attackDamage / 18 + Math.min(unit.attackRange, 260) / 520);
  }, 0);
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
