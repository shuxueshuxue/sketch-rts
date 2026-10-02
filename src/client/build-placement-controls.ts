import { buildingPlacementBlocker, terrainBlocksPlacement } from "../shared/build-placement";
import { BUILDING_DEFS } from "../shared/catalog";
import { commandValidationError } from "../shared/sim/command-validation";
import type { BuildingKind, GameCommand, GameSnapshot, PlayerId } from "../shared/types";

export type BuildPlacement = {
  workerId: string;
  buildingKind: BuildingKind;
};

// Why a placement is refused, for the player to read in their language: the worker gone, another building, rock pile or
// gate in the way, ground that takes no building (a shipyard: no shore it can stand on), gold short; anything else, the
// command's own message.
export type PlacementRefusal =
  | { reason: "worker" }
  | { reason: "tooClose"; blocker: string }
  | { reason: "ground" }
  | { reason: "shore" }
  | { reason: "gold"; cost: number }
  | { reason: "other"; message: string };

export type BuildPlacementResult = { command: Extract<GameCommand, { type: "build" }> } | { refusal: PlacementRefusal };

/** `owner` is the local player: a seat other than the first plays as another player id. */
export function buildPlacementCommand(snapshot: GameSnapshot, placement: BuildPlacement, point: { x: number; y: number }, owner: PlayerId): BuildPlacementResult {
  const command = { type: "build" as const, unitId: placement.workerId, buildingKind: placement.buildingKind, x: point.x, y: point.y };
  const error = commandValidationError(snapshot, owner, command);
  return error ? { refusal: placementRefusal(snapshot, placement, point, owner, error) } : { command };
}

// The validation's own checks for a placement, asked in its order (see checkCommandLegality's build).
function placementRefusal(snapshot: GameSnapshot, placement: BuildPlacement, point: { x: number; y: number }, owner: PlayerId, message: string): PlacementRefusal {
  const kind = placement.buildingKind;
  if (!snapshot.units.some((unit) => unit.id === placement.workerId && unit.owner === owner && unit.kind === "worker")) return { reason: "worker" };
  const blocker = buildingPlacementBlocker(snapshot, kind, point);
  if (blocker) return { reason: "tooClose", blocker: blocker.kind };
  if (terrainBlocksPlacement(snapshot.map, kind, point)) return { reason: BUILDING_DEFS[kind].shore ? "shore" : "ground" };
  const cost = BUILDING_DEFS[kind].cost;
  if ((snapshot.players[owner]?.gold ?? 0) < cost) return { reason: "gold", cost };
  return { reason: "other", message };
}
