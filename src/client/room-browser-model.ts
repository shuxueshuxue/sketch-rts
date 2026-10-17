import type { RoomState } from "../shared/types";

export type RoomBrowserAction = "join" | "rejoin" | "watch" | "full";

export type RoomBrowserEntry = {
  room: RoomState;
  action: RoomBrowserAction;
  /** A game under way: listed apart, to watch (or to rejoin one's own seat). */
  playing: boolean;
};

// @@@room-list - What the room list offers: rooms one can still sit down in, or is seated in, and full ones shown as
// such; games under way to watch. A room played only in this browser (a solo game) is not listed: the play entry opens
// it again. The server leaves out an open room whose host has left (see @@@room-presence).
export function roomBrowserEntries(rooms: RoomState[], viewerUserId: string, local: (roomId: string) => boolean = () => false): RoomBrowserEntry[] {
  return rooms.flatMap((room): RoomBrowserEntry[] => {
    if (room.status === "ended" || room.status === "closed" || local(room.id)) return [];
    const owned = room.slots.some((slot) => slot.userId === viewerUserId);
    if (room.status === "inMatch") return owned || room.visibility === "public" ? [{ room, action: owned ? "rejoin" : "watch", playing: true }] : [];
    return [{ room, action: owned ? "rejoin" : room.slots.some((slot) => slot.controller === "open") ? "join" : "full", playing: false }];
  });
}

export type RoomEntry = { kind: "enter" } | { kind: "askToWatch" } | { kind: "refused"; reason: "closed" | "full" | "private" };

// @@@room-entry - What opening a room comes to, decided from the room itself rather than from the error a refused join
// would give: a room that is gone or closed, full, or a private game under way is refused with its reason; a game under
// way opened from a link asks first whether to watch it (one picked from the room list was already chosen to watch).
export function roomEntry(room: RoomState | undefined, viewerUserId: string, fromLink: boolean): RoomEntry {
  if (!room || room.status === "closed" || room.status === "ended" && !room.result) return { kind: "refused", reason: "closed" };
  if (room.status === "ended" || room.slots.some((slot) => slot.userId === viewerUserId)) return { kind: "enter" };
  if (room.status === "inMatch") return room.visibility !== "public" ? { kind: "refused", reason: "private" } : fromLink ? { kind: "askToWatch" } : { kind: "enter" };
  return room.slots.some((slot) => slot.controller === "open") ? { kind: "enter" } : { kind: "refused", reason: "full" };
}
