import type { PlayerId, RoomSlot } from "../shared/types";

/** Names come from the match roster; seat order and simulation ids are not display names. */
export function playerDisplayName(playerId: PlayerId, slots: readonly Pick<RoomSlot, "playerId" | "name">[], fallback: string) {
  return slots.find(slot => slot.playerId === playerId)?.name || fallback;
}
