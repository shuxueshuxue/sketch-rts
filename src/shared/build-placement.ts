import { BUILDING_DEFS } from "./catalog";
import { isFootprintBuildable, isShoreFootprint } from "./terrain";
import type { Building, BuildingKind, GameMap, GameSnapshot, Obstacle } from "./types";

export const BUILDING_PLACEMENT_GAP = 4;

// A building keeps its gap from every building and every rock pile or gate still standing (see @@@obstacle).
export function buildingPlacementBlocker(snapshot: Pick<GameSnapshot, "buildings" | "obstacles">, kind: BuildingKind, point: { x: number; y: number }): Building | Obstacle | undefined {
  const radius = BUILDING_DEFS[kind].radius;
  const near = (body: Building | Obstacle) => distance(point, body) < radius + body.radius + BUILDING_PLACEMENT_GAP;
  return snapshot.buildings.find(near) ?? snapshot.obstacles?.find(near);
}

// A building stands on walkable ground only (see @@@terrain): no part of it in a forest, on rock, in deep water or on a
// ramp; a shipyard stands on the shore (see @@@shore-footprint).
export function terrainBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }) {
  if (map === undefined) return false;
  const { radius, shore } = BUILDING_DEFS[kind];
  return shore ? !isShoreFootprint(map, point.x, point.y, radius) : !isFootprintBuildable(map, point.x, point.y, radius);
}

export function isBuildPlacementClear(snapshot: Pick<GameSnapshot, "buildings" | "obstacles"> & { map?: Pick<GameMap, "terrain"> }, kind: BuildingKind, point: { x: number; y: number }) {
  return !terrainBlocksPlacement(snapshot.map, kind, point) && !buildingPlacementBlocker(snapshot, kind, point);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
