import { BUILDING_DEFS } from "./catalog";
import { footprintCells, isFootprintBuildable, isShoreFootprint, snapToFootprint } from "./terrain";
import type { Building, BuildingKind, GameMap, GameSnapshot, Obstacle } from "./types";

export const BUILDING_PLACEMENT_GAP = 4;

// A building keeps clear of every building and every rock pile or gate still standing (see @@@obstacle): on a map with
// terrain its footprint, where it is laid (see snapToFootprint), shares no cell with theirs, so two may stand wall to wall
// as in Warcraft III (see @@@building-footprint); on a map without, it keeps its gap from their round bodies.
export function buildingPlacementBlocker(snapshot: Pick<GameSnapshot, "buildings" | "obstacles"> & { map?: Pick<GameMap, "terrain"> }, kind: BuildingKind, point: { x: number; y: number }): Building | Obstacle | undefined {
  const radius = BUILDING_DEFS[kind].radius;
  const map = snapshot.map;
  let near = (body: Building | Obstacle) => distance(point, body) < radius + body.radius + BUILDING_PLACEMENT_GAP;
  if (map?.terrain) {
    const cell = map.terrain.cell;
    const at = snapToFootprint(map, radius, point);
    const own = footprintCells(cell, at.x, at.y, radius);
    near = (body) => {
      const other = footprintCells(cell, body.x, body.y, body.radius);
      return own.left <= other.right && other.left <= own.right && own.top <= other.bottom && other.top <= own.bottom;
    };
  }
  return snapshot.buildings.find(near) ?? snapshot.obstacles?.find(near);
}

// A building stands on walkable ground only (see @@@terrain): no part of it in a forest, on rock, in deep water or on a
// ramp; a shipyard stands on the shore (see @@@shore-footprint).
export function terrainBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }) {
  if (map === undefined) return false;
  const { radius, shore } = BUILDING_DEFS[kind];
  const at = snapToFootprint(map, radius, point);
  return shore ? !isShoreFootprint(map, at.x, at.y, radius) : !isFootprintBuildable(map, at.x, at.y, radius);
}

export function isBuildPlacementClear(snapshot: Pick<GameSnapshot, "buildings" | "obstacles"> & { map?: Pick<GameMap, "terrain"> }, kind: BuildingKind, point: { x: number; y: number }) {
  return !terrainBlocksPlacement(snapshot.map, kind, point) && !buildingPlacementBlocker(snapshot, kind, point);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
