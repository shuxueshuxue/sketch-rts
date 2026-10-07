import { BUILDING_DEFS } from "./catalog";
import { GOLD_MINE_RULES } from "./mining";
import { footprintCells, footprintHalf, isFootprintBuildable, isShoreFootprint, snapToFootprint } from "./terrain";
import type { Building, BuildingKind, GameMap, GameSnapshot, Obstacle, ResourceNode } from "./types";

export const BUILDING_PLACEMENT_GAP = 4;

// A building keeps clear of every building and every rock pile or gate still standing (see @@@obstacle): on a map with
// terrain its footprint, where it is laid (see snapToFootprint), shares no cell with theirs, so two may stand wall to wall
// as in Warcraft III (see @@@building-footprint); on a map without, it keeps its gap from their round bodies.
type PlacementSnapshot = Pick<GameSnapshot, "buildings" | "obstacles"> & Partial<Pick<GameSnapshot, "resources">> & { map?: Pick<GameMap, "terrain"> };

export function buildingPlacementBlocker(snapshot: PlacementSnapshot, kind: BuildingKind, point: { x: number; y: number }): Building | Obstacle | ResourceNode | undefined {
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
  const blocker = snapshot.buildings.find(near) ?? snapshot.obstacles?.find(near);
  if (blocker) return blocker;
  return snapshot.resources?.find(resource => resourceBlocksPlacement(map, kind, point, resource));
}

export function resourceBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }, resource: { x: number; y: number }) {
  const radius = BUILDING_DEFS[kind].radius;
  const at = map ? snapToFootprint(map, radius, point) : point;
  const half = map?.terrain ? footprintHalf(radius, map.terrain.cell) : radius;
  const gap = kind === "townHall" ? GOLD_MINE_RULES.townHallGap : BUILDING_PLACEMENT_GAP;
  const dx = Math.max(0, Math.abs(resource.x - at.x) - half);
  const dy = Math.max(0, Math.abs(resource.y - at.y) - half);
  return Math.hypot(dx, dy) < GOLD_MINE_RULES.radius + gap;
}

// A building stands on dry ground only (see @@@terrain): no part of it in a forest, on rock, in water or on a
// ramp; a shipyard stands on the shore (see @@@shore-footprint).
export function terrainBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }) {
  if (map === undefined) return false;
  const { radius, shore } = BUILDING_DEFS[kind];
  const at = snapToFootprint(map, radius, point);
  return shore ? !isShoreFootprint(map, at.x, at.y, radius) : !isFootprintBuildable(map, at.x, at.y, radius);
}

export function isBuildPlacementClear(snapshot: PlacementSnapshot, kind: BuildingKind, point: { x: number; y: number }) {
  return !terrainBlocksPlacement(snapshot.map, kind, point) && !buildingPlacementBlocker(snapshot, kind, point);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
