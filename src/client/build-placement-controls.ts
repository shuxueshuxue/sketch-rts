import type { CommandRefusal } from "../shared/command-refusal";
import { BUILDING_DEFS } from "../shared/catalog";
import { checkCommandLegality } from "../shared/sim/command-validation";
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
  const error = checkCommandLegality(snapshot, owner, command);
  return error ? { refusal: placementRefusal(snapshot, placement, error.refusal!, error.message) } : { command };
}

// Presentation of shared facts only: never re-run a placement rule in the client.
function placementRefusal(snapshot: GameSnapshot, placement: BuildPlacement, cause: CommandRefusal, message: string): PlacementRefusal {
  if (cause.reason === "ownership" || cause.reason === "unit-ineligible" && cause.detail.required === "worker" || cause.reason === "issuer-gone" || cause.reason === "condition-unmet" && cause.detail.category === "gone") return { reason: "worker" };
  if (cause.reason === "site-occupied") {
    const blocker = snapshot.buildings.find(building => building.id === cause.detail.blockerId) ?? snapshot.obstacles?.find(obstacle => obstacle.id === cause.detail.blockerId);
    if (blocker) return { reason: "tooClose", blocker: blocker.kind };
  }
  if (cause.reason === "site-terrain") return { reason: BUILDING_DEFS[placement.buildingKind].shore ? "shore" : "ground" };
  if (cause.reason === "gold") return { reason: "gold", cost: cause.detail.required };
  return { reason: "other", message };
}
