import { describe, expect, it } from "vitest";
import { createRoomLifecycleHost } from "./room-lifecycle";
import { createGame, snapshotGame } from "./sim";
import type { GameSnapshot, LocalUserProfile, RoomState } from "./types";

const hostUser: LocalUserProfile = { id: "user-host", name: "Host" };
const guestUser: LocalUserProfile = { id: "user-guest", name: "Guest" };

function finishedSnapshot(winner: string | null): GameSnapshot {
  const snapshot = snapshotGame(createGame("bareDuel"));
  return { ...snapshot, tick: 42, match: { ...snapshot.match, winner, endedAtTick: 42 } };
}

describe("room lifecycle host", () => {
  it("owns ordinary lobby state transitions before a deployment creates runtime objects", () => {
    const lifecycle = createRoomLifecycleHost();

    const created = lifecycle.createRoom({ id: "room-core", host: hostUser, humanCount: 2, aiCount: 1, mapId: "bareDuel" });
    lifecycle.updateSlot(created.id, "slot-3", { controller: "ai", team: "south", race: "ember" });
    const joined = lifecycle.joinRoom(created.id, guestUser);
    const ready = lifecycle.updateSlot(joined.id, "slot-2", { ready: true, team: "north" });
    const { room: started, setup } = lifecycle.startRoom(ready.id);

    expect(started.status).toBe("inMatch");
    expect(setup.mapId).toBe("bareDuel");
    expect(setup.options.players).toEqual(["player", "enemy", "enemy2"]);
    expect(setup.options.aiPlayers).toEqual(["enemy2"]);
    expect(lifecycle.listRooms(hostUser.id)[0]).toEqual(started);
  });

  it("finishes and closes rooms through the same registry transition", () => {
    const lifecycle = createRoomLifecycleHost();
    const room = lifecycle.createRoom({ id: "room-finish", host: hostUser, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    lifecycle.startRoom(room.id);

    const ended = lifecycle.finishRoom(room.id, finishedSnapshot("player"));
    const closed = lifecycle.closeRoom(room.id, hostUser.id);

    expect(ended.status).toBe("ended");
    expect(ended.result?.winner).toBe("player");
    expect(closed.status).toBe("closed");
    expect(lifecycle.hasRoom(room.id)).toBe(false);
    expect(() => lifecycle.getRoom(room.id)).toThrow(/Unknown room/);
  });

  it("keeps reset and adopted save rooms on the same lifecycle state owner", () => {
    const lifecycle = createRoomLifecycleHost({ defaultAutoTick: false });
    const created = lifecycle.createRoom({ id: "room-reset", host: hostUser, humanCount: 1, aiCount: 1 });
    lifecycle.startRoom(created.id);

    const reset = lifecycle.resetRoom(created.id, "wildMarches");
    const adoptedRoom: RoomState = { ...reset.room, id: "room-adopted", status: "inMatch", autoTick: true };
    const adopted = lifecycle.adoptRoom(adoptedRoom);

    expect(reset.room.status).toBe("inMatch");
    expect(reset.room.mapId).toBe("wildMarches");
    expect(reset.room.autoTick).toBe(false);
    expect(reset.setup.mapId).toBe("wildMarches");
    expect(adopted.autoTick).toBe(false);
    expect(lifecycle.getRoom("room-adopted")).toEqual(adopted);
  });
});
