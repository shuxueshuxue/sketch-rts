import { describe, expect, it } from "vitest";
import { createRoom, updateRoomSlot } from "../shared/rooms";
import type { LocalUserProfile, RoomState } from "../shared/types";
import { roomBrowserEntries, roomEntry } from "./room-browser-model";

const host: LocalUserProfile = { id: "host", name: "Host" };
const viewer: LocalUserProfile = { id: "viewer", name: "Viewer" };

describe("room browser model", () => {
  it("offers open seats to join, marks full rooms, and lists games under way apart to watch", () => {
    const openRoom = createRoom({ id: "open-room", host, visibility: "public", humanCount: 2, aiCount: 0 });
    const fullRoom = updateRoomSlot(openRoom, "slot-2", { controller: "ai" });
    const liveRoom = live(createRoom({ id: "live-room", host, visibility: "public" }));
    const privateLiveRoom = live(createRoom({ id: "private-live-room", host, visibility: "private" }));
    const ownedLiveRoom = live(createRoom({ id: "owned-live-room", host: viewer, visibility: "public" }));

    expect(roomBrowserEntries([openRoom, { ...fullRoom, id: "full-room" }, liveRoom, privateLiveRoom, ownedLiveRoom], viewer.id)).toEqual([
      { room: openRoom, action: "join", playing: false },
      { room: { ...fullRoom, id: "full-room" }, action: "full", playing: false },
      { room: liveRoom, action: "watch", playing: true },
      { room: ownedLiveRoom, action: "rejoin", playing: true },
    ]);
  });

  it("leaves out a game played only in this browser", () => {
    const solo = createRoom({ id: "solo", host: viewer, visibility: "private" });
    expect(roomBrowserEntries([solo, live({ ...solo, id: "solo-playing" })], viewer.id, (id) => id.startsWith("solo"))).toEqual([]);
  });
});

describe("opening a room", () => {
  const open = createRoom({ id: "open", host, visibility: "public", humanCount: 2, aiCount: 0 });
  it("enters a room with a seat, refuses a full or gone one with its reason", () => {
    expect(roomEntry(open, viewer.id, true)).toEqual({ kind: "enter" });
    expect(roomEntry(updateRoomSlot(open, "slot-2", { controller: "ai" }), viewer.id, true)).toEqual({ kind: "refused", reason: "full" });
    expect(roomEntry(undefined, viewer.id, true)).toEqual({ kind: "refused", reason: "closed" });
    expect(roomEntry({ ...open, status: "closed" }, viewer.id, false)).toEqual({ kind: "refused", reason: "closed" });
  });
  it("asks before watching a game under way opened from a link, not one picked to watch", () => {
    expect(roomEntry(live(open), viewer.id, true)).toEqual({ kind: "askToWatch" });
    expect(roomEntry(live(open), viewer.id, false)).toEqual({ kind: "enter" });
    expect(roomEntry(live({ ...open, visibility: "private" }), viewer.id, true)).toEqual({ kind: "refused", reason: "private" });
    expect(roomEntry(live(open), host.id, true)).toEqual({ kind: "enter" });
  });
});

function live(room: RoomState): RoomState {
  return { ...room, status: "inMatch" };
}
