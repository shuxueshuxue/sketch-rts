import { describe, expect, it } from "vitest";
import { StaticSoloDeploymentRuntime } from "../client/deployment/static-runtime";
import type { LocalUserProfile, RoomState } from "../shared/types";
import { createRoomHost } from "./room-host";

const hostUser: LocalUserProfile = { id: "user-host", name: "Host" };
const guestUser: LocalUserProfile = { id: "user-guest", name: "Guest" };

function comparableRoom(room: RoomState) {
  return {
    id: room.id,
    hostUserId: room.hostUserId,
    visibility: room.visibility,
    mapId: room.mapId,
    status: room.status,
    autoTick: room.autoTick,
    slots: room.slots,
    result: room.result,
  };
}

describe("room lifecycle deployment equivalence", () => {
  it("keeps static and hosted create join edit start state equivalent", async () => {
    const runtime = new StaticSoloDeploymentRuntime({ tickMs: 1_000_000 });
    const host = createRoomHost({ autoTick: true });
    const input = { id: "room-equivalent", host: hostUser, name: "Equivalent", mapId: "bareDuel" as const, humanCount: 2, aiCount: 1 };

    await runtime.createRoom(input);
    host.createRoom(input);

    await runtime.enterRoom(input.id, guestUser);
    host.joinRoom(input.id, guestUser);
    await runtime.updateRoomSlot(input.id, "slot-2", { ready: true, team: "south" });
    host.updateSlot(input.id, "slot-2", { ready: true, team: "south" });
    await runtime.updateRoomSlot(input.id, "slot-3", { team: "south" });
    host.updateSlot(input.id, "slot-3", { team: "south" });

    const staticStarted = await runtime.startRoom(input.id, hostUser);
    const hostedStarted = host.startRoom(input.id);

    expect(comparableRoom(staticStarted.room)).toEqual(comparableRoom(hostedStarted));
    expect(staticStarted.snapshot.map.id).toBe(host.snapshot(input.id).map.id);
    expect(staticStarted.snapshot.players).toEqual(host.snapshot(input.id).players);
  });
});
