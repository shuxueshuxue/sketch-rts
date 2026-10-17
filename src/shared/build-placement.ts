import { BUILDING_DEFS } from "./catalog";
import { GOLD_MINE_RULES } from "./mining";
import { footprintCells, footprintHalf, isFootprintBuildable, isShoreFootprint, snapToFootprint } from "./terrain";
import { siteBodies, type StructureBody } from "./structure-bodies";
import type { Building, BuildingKind, GameMap, GameSnapshot, Obstacle } from "./types";

export const BUILDING_PLACEMENT_GAP = 4;

// A building keeps clear of every body standing on the map (see @@@structure-body): the buildings, the rock piles and
// gates still standing (see @@@obstacle), the mines, shops and camps. On a map with terrain its footprint, where it is
// laid (see snapToFootprint), shares no cell with theirs, so two may stand wall to wall as in Warcraft III (see
// @@@building-footprint); on a map without, it keeps its gap from their round bodies. A town hall also keeps its
// distance from every mine (see GOLD_MINE_RULES.townHallDistance), so its workers have a lane to haul along.
type PlacementSnapshot = Pick<GameSnapshot, "buildings" | "obstacles"> & Partial<Pick<GameSnapshot, "resources" | "shops" | "mercenaryCamps">> & { map?: Pick<GameMap, "terrain"> };

export function buildingPlacementBlocker(snapshot: PlacementSnapshot, kind: BuildingKind, point: { x: number; y: number }, radius = BUILDING_DEFS[kind].radius): Building | Obstacle | StructureBody | undefined {
  const blocker = snapshot.buildings.find(body => footprintsMeet(snapshot.map, radius, point, body)) ?? snapshot.obstacles?.find(body => footprintsMeet(snapshot.map, radius, point, body));
  if (blocker) return blocker;
  return siteBodies(snapshot).find(body => body.kind === "goldMine" ? resourceBlocksPlacement(snapshot.map, kind, point, body, radius) : footprintsMeet(snapshot.map, radius, point, body));
}

// A mine keeps an apron no building stands on (see GOLD_MINE_RULES.apron): open ground round its body that its workers
// walk to its entrance across. Laid flush against a mine (as its two-cell body alone allows), a tower walled off the face
// toward the hall and the workers stood at its corner.
export function resourceBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }, mine: { x: number; y: number }, radius = BUILDING_DEFS[kind].radius) {
  const at = map ? snapToFootprint(map, radius, point) : point;
  if (kind === "townHall" && distance(at, mine) < GOLD_MINE_RULES.townHallDistance) return true;
  const half = map?.terrain ? footprintHalf(radius, map.terrain.cell) : radius;
  return Math.hypot(Math.max(0, Math.abs(mine.x - at.x) - half), Math.max(0, Math.abs(mine.y - at.y) - half)) < GOLD_MINE_RULES.apron;
}

function footprintsMeet(map: Pick<GameMap, "terrain"> | undefined, radius: number, point: { x: number; y: number }, body: { x: number; y: number; radius: number }) {
  if (!map?.terrain) return distance(point, body) < radius + body.radius + BUILDING_PLACEMENT_GAP;
  const cell = map.terrain.cell;
  const at = snapToFootprint(map, radius, point);
  const own = footprintCells(cell, at.x, at.y, radius);
  const other = footprintCells(cell, body.x, body.y, body.radius);
  return own.left <= other.right && other.left <= own.right && own.top <= other.bottom && other.top <= own.bottom;
}

// A building stands on dry ground only (see @@@terrain): no part of it in a forest, on rock, in water or on a
// ramp; a shipyard stands on the shore (see @@@shore-footprint).
export function terrainBlocksPlacement(map: Pick<GameMap, "terrain"> | undefined, kind: BuildingKind, point: { x: number; y: number }, radius = BUILDING_DEFS[kind].radius) {
  if (map === undefined) return false;
  const { shore } = BUILDING_DEFS[kind];
  const at = snapToFootprint(map, radius, point);
  return shore ? !isShoreFootprint(map, at.x, at.y, radius) : !isFootprintBuildable(map, at.x, at.y, radius);
}

export function isBuildPlacementClear(snapshot: PlacementSnapshot, kind: BuildingKind, point: { x: number; y: number }) {
  return !terrainBlocksPlacement(snapshot.map, kind, point) && !buildingPlacementBlocker(snapshot, kind, point);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
