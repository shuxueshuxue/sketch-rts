import type { RoomState } from "../shared/types";

export type RoomSetupViewAction = "empty" | "setup" | "enterMatch" | "results";

export function roomSetupViewAction(room: RoomState | undefined): RoomSetupViewAction {
  if (!room) return "empty";
  if (room.status === "ended" && room.result) return "results";
  if (room.status === "inMatch") return "enterMatch";
  return "setup";
}
