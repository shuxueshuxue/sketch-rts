import { UNIT_DEFS } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId, ResourceNode, TrainableUnitKind, Unit } from "../../shared/types";
import { buildings, completeBuildings, units } from "./snapshot";
import { distance, nearestEntity, type Point } from "./spatial";

const BUILD_RANGE = 46;

export function availableBuilder(snapshot: GameSnapshot, owner: PlayerId, point: Point) {
  return units(snapshot, owner)
    .filter((unit) => unit.kind === "worker")
    .filter((unit) => !isReservedBuilder(snapshot, owner, unit))
    .sort((a, b) => distance(a, point) - distance(b, point))[0];
}

export function isReservedBuilder(snapshot: GameSnapshot, owner: PlayerId, worker: Unit) {
  if (worker.order.type !== "move") return false;
  return buildings(snapshot, owner).some((building) => !building.complete && distance(worker.order as Point, building) <= BUILD_RANGE + 40);
}

export function hasAssignedBuilder(snapshot: GameSnapshot, owner: PlayerId, building: Building) {
  return units(snapshot, owner).some(
    (unit) =>
      unit.kind === "worker" &&
      (distance(unit, building) <= BUILD_RANGE + 20 || (unit.order.type === "move" && distance(unit.order, building) <= BUILD_RANGE + 40)),
  );
}

export function nearOwnIncompleteBuilding(snapshot: GameSnapshot, owner: PlayerId, worker: Unit) {
  return buildings(snapshot, owner).some((building) => !building.complete && distance(worker, building) <= BUILD_RANGE + 35);
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

export function playerState(snapshot: GameSnapshot, owner: PlayerId) {
  const player = snapshot.players[owner];
  if (!player) throw new Error(`Unknown player ${owner}`);
  return player;
}

export function projectedSupplyUsed(snapshot: GameSnapshot, owner: PlayerId) {
  const queued = buildings(snapshot, owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  return units(snapshot, owner).reduce((total, unit) => total + UNIT_DEFS[unit.kind].supplyUsed, 0) + queued;
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
  return building.kind !== "townHall" && building.kind !== "farm" && building.kind !== "defenseTower" && building.kind !== "moonWell";
}

export function hasCoreProduction(snapshot: GameSnapshot, owner: PlayerId) {
  return buildings(snapshot, owner).some((building) => isCoreProductionBuilding(building));
}

export function nearestResource(resources: ResourceNode[], from: Point) {
  return nearestEntity(resources, from);
}
