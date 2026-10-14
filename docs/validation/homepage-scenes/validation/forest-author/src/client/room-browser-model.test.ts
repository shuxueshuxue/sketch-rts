import { describe, expect, it } from "vitest";
import { createRoom } from "../shared/rooms";
import type { LocalUserProfile, RoomState } from "../shared/types";
import { roomBrowserEntries } from "./room-browser-model";

const host: LocalUserProfile = { id: "host", name: "Host" };
const viewer: LocalUserProfile = { id: "viewer", name: "Viewer" };

describe("room browser model", () => {
  it("shows public live matches as watchable spectator entries", () => {
    const openRoom = createRoom({ id: "open-room", host, visibility: "public" });
    const liveRoom = live(createRoom({ id: "live-room", host, visibility: "public" }));
    const privateLiveRoom = live(createRoom({ id: "private-live-room", host, visibility: "private" }));
    const ownedLiveRoom = live(createRoom({ id: "owned-live-room", host: viewer, visibility: "private" }));

    expect(roomBrowserEntries([openRoom, liveRoom, privateLiveRoom, ownedLiveRoom], viewer.id)).toEqual([
      { room: openRoom, action: "join" },
      { room: liveRoom, action: "watch" },
      { room: ownedLiveRoom, action: "rejoin" },
    ]);
  });
});

function live(room: RoomState): RoomState {
  return { ...room, status: "inMatch" };
}
