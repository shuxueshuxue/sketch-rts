import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap, unitMover } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId, ResourceNode, TrainableUnitKind, Unit } from "../../shared/types";
import type { AiPolicyMemory } from "../memory";
import { activeUnitClaim } from "./claims";
import { buildings, completeBuildings, units } from "./snapshot";
import { distance, nearestEntity, type Point } from "./spatial";

type AvailableBuilderOptions = {
  memory?: AiPolicyMemory;
};

export function availableBuilder(snapshot: GameSnapshot, owner: PlayerId, point: Point, options: AvailableBuilderOptions = {}) {
  if (units(snapshot, owner).some(unit => unit.order.type === "build")) return undefined;
  return units(snapshot, owner)
    .filter((unit) => unit.kind === "worker" && !unit.deck)
    .filter((unit) => !activeUnitClaim(snapshot, owner, unit, options))
    .filter((unit) => !isReservedBuilder(snapshot, owner, unit))
    .sort((a, b) => distance(a, point) - distance(b, point))[0];
}

// A worker building one of its owner's sites: a site goes up with the work of the workers whose order is to repair it
// (see the sim's updateConstruction).
export function isReservedBuilder(snapshot: GameSnapshot, owner: PlayerId, worker: Unit) {
  const order = worker.order;
  return order.type === "build" || order.type === "repair" && buildings(snapshot, owner).some((building) => building.id === order.buildingId && !building.complete);
}

export function hasAssignedBuilder(snapshot: GameSnapshot, owner: PlayerId, building: Building) {
  return units(snapshot, owner).some((unit) => unit.order.type === "repair" && unit.order.buildingId === building.id);
}

export function mainBase(snapshot: GameSnapshot, owner: PlayerId) {
  return completeBuildings(snapshot, owner, "townHall")[0] ?? currentBasePoint(snapshot, owner);
}

export function currentBasePoint(snapshot: GameSnapshot, owner: PlayerId): Point {
  const start = units(snapshot, owner)[0] ?? buildings(snapshot, owner)[0];
  if (start) return { x: start.x, y: start.y };
  return { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
}

export function expansionOffset(snapshot: GameSnapshot, owner: PlayerId): Point {
  const direction = ownerDirection(snapshot, owner);
  return { x: -direction * 90, y: direction > 0 ? -70 : 70 };
}

export function ownerDirection(snapshot: GameSnapshot, owner: PlayerId) {
  return mainBaseX(snapshot, owner) < snapshot.map.width / 2 ? 1 : -1;
}

export function mainBaseX(snapshot: GameSnapshot, owner: PlayerId) {
  const base = completeBuildings(snapshot, owner, "townHall")[0] ?? buildings(snapshot, owner)[0] ?? units(snapshot, owner)[0];
  return base?.x ?? snapshot.map.width / 2;
}

export function canSupply(snapshot: GameSnapshot, owner: PlayerId, unitKind: keyof typeof UNIT_DEFS) {
  return projectedSupplyUsed(snapshot, owner) + UNIT_DEFS[unitKind].supplyUsed <= playerState(snapshot, owner).supplyCap;
}

// @@@gold-in-soldiers - A bank the AI waits for is written in basic soldiers (a footman's price), not in gold, so it follows
// the price list: make every unit a fifth dearer and every bank grows with it. Rounded, so a whole bank stays whole.
export function soldiersWorth(count: number) {
  return Math.round(count * UNIT_DEFS.footman.cost);
}

// @@@ai-unit-tiers - Advanced and elite units wait for the supply cap to reach their tier's bar (TIER_SUPPLY_CAP).
export function tierUnlocked(snapshot: GameSnapshot, owner: PlayerId, unitKind: keyof typeof UNIT_DEFS) {
  return playerState(snapshot, owner).supplyCap >= requiredSupplyCap(unitKind);
}

// The lowest tier bar a finished production building of the owner is waiting on (a sanctum before 42), if any: the farms
// that lift the cap to it are what the building's units cost first.
export function tierBarWaitedOn(snapshot: GameSnapshot, owner: PlayerId): number | undefined {
  const cap = playerState(snapshot, owner).supplyCap;
  const bars = buildings(snapshot, owner)
    .filter((building) => building.complete)
    .flatMap((building) => BUILDING_DEFS[building.kind].trains)
    .map(requiredSupplyCap)
    .filter((bar) => bar > cap);
  return bars.length > 0 ? Math.min(...bars) : undefined;
}

export function playerState(snapshot: GameSnapshot, owner: PlayerId) {
  const player = snapshot.players[owner];
  if (!player) throw new Error(`Unknown player ${owner}`);
  return player;
}

export function projectedSupplyUsed(snapshot: GameSnapshot, owner: PlayerId) {
  const queued = buildings(snapshot, owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  // Passengers aboard a transport count too (see @@@transport), as the sim counts them.
  const supply = (unit: Unit): number => UNIT_DEFS[unit.kind].supplyUsed + (unit.cargo ?? []).reduce((total, passenger) => total + supply(passenger), 0);
  return units(snapshot, owner).reduce((total, unit) => total + supply(unit), 0) + queued;
}

export function queuedUnitCount(snapshot: GameSnapshot, owner: PlayerId, unitKind: TrainableUnitKind) {
  return buildings(snapshot, owner)
    .flatMap((building) => building.queue)
    .filter((job) => job.unitKind === unitKind).length;
}

export function mineAssignmentCounts(workers: Unit[]) {
  const counts = new Map<string, number>();
  for (const worker of workers) {
    if (worker.order.type !== "mine") continue;
    counts.set(worker.order.resourceId, (counts.get(worker.order.resourceId) ?? 0) + 1);
  }
  return counts;
}

export function isCoreProductionBuilding(building: Building) {
  // Land economy gates need a real land-army producer. A dock cannot
  // supply the first soldiers, even though it is not a farm or a tower.
  return BUILDING_DEFS[building.kind].trains.some(kind => kind !== 'worker' && unitMover(kind) === 'land');
}

export function hasCoreProduction(snapshot: GameSnapshot, owner: PlayerId) {
  return buildings(snapshot, owner).some((building) => isCoreProductionBuilding(building));
}

export function nearestResource(resources: ResourceNode[], from: Point) {
  return nearestEntity(resources, from);
}
