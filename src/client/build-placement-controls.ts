import { commandValidationError } from "../shared/sim/command-validation";
import type { BuildingKind, GameCommand, GameSnapshot } from "../shared/types";

export type BuildPlacement = {
  workerId: string;
  buildingKind: BuildingKind;
};

export type BuildPlacementResult = { command: Extract<GameCommand, { type: "build" }> } | { error: string };

export function buildPlacementCommand(snapshot: GameSnapshot, placement: BuildPlacement, point: { x: number; y: number }): BuildPlacementResult {
  const command = { type: "build" as const, unitId: placement.workerId, buildingKind: placement.buildingKind, x: point.x, y: point.y };
  const error = commandValidationError(snapshot, "player", command);
  return error ? { error } : { command };
}
