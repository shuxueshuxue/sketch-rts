import { BUILDING_DEFS } from "./catalog";
import type { Building, BuildingKind, GameSnapshot } from "./types";

export const BUILDING_PLACEMENT_GAP = 4;

export function buildingPlacementBlocker(snapshot: Pick<GameSnapshot, "buildings">, kind: BuildingKind, point: { x: number; y: number }): Building | undefined {
  const radius = BUILDING_DEFS[kind].radius;
  return snapshot.buildings.find((building) => distance(point, building) < radius + building.radius + BUILDING_PLACEMENT_GAP);
}

export function isBuildPlacementClear(snapshot: Pick<GameSnapshot, "buildings">, kind: BuildingKind, point: { x: number; y: number }) {
  return !buildingPlacementBlocker(snapshot, kind, point);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
