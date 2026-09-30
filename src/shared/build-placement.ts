import { BUILDING_DEFS } from "./catalog";
import { isFootprintWalkable } from "./terrain";
import type { Building, BuildingKind, GameMap, GameSnapshot } from "./types";

export const BUILDING_PLACEMENT_GAP = 4;

export function buildingPlacementBlocker(snapshot: Pick<GameSnapshot, "buildings">, kind: BuildingKind, point: { x: number; y: number }): Building | undefined {
  const radius = BUILDING_DEFS[kind].radius;
  return snapshot.buildings.find((building) => distance(point, building) < radius + building.radius + BUILDING_PLACEMENT_GAP);
}

// A building stands on walkable ground only (see @@@terrain): no part of it in a forest, on rock or in deep water.
export function terrainBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }) {
  return map !== undefined && !isFootprintWalkable(map, point.x, point.y, BUILDING_DEFS[kind].radius);
}

export function isBuildPlacementClear(snapshot: Pick<GameSnapshot, "buildings"> & { map?: Pick<GameMap, "terrain"> }, kind: BuildingKind, point: { x: number; y: number }) {
  return !terrainBlocksPlacement(snapshot.map, kind, point) && !buildingPlacementBlocker(snapshot, kind, point);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
