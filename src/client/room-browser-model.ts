import type { RoomState } from "../shared/types";

export type RoomBrowserAction = "join" | "rejoin" | "watch";

export type RoomBrowserEntry = {
  room: RoomState;
  action: RoomBrowserAction;
};

export function roomBrowserEntries(rooms: RoomState[], viewerUserId: string): RoomBrowserEntry[] {
  return rooms.flatMap((room): RoomBrowserEntry[] => {
    if (room.status === "ended" || room.status === "closed") return [];
    const ownedSlot = room.slots.find((slot) => slot.userId === viewerUserId);
    if (room.status === "inMatch") return ownedSlot || room.visibility === "public" ? [{ room, action: ownedSlot ? "rejoin" : "watch" }] : [];
    return [{ room, action: ownedSlot ? "rejoin" : "join" }];
  });
}
