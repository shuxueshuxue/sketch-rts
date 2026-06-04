import { describe, expect, it } from "vitest";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import { createRoom, updateRoomSlot } from "../../shared/rooms";
import type { NetTransport } from "../net/transport";
import { ServerDeploymentRuntime } from "./server-runtime";

describe("server deployment runtime", () => {
  it("uses existing room API paths for room setup", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const runtime = new ServerDeploymentRuntime({
      fetchJson: async <T>(path: string, body?: unknown) => {
        calls.push({ path, body });
        return { id: "room-1", slots: [] } as T;
      },
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => new FakeTransport(),
    });

    await runtime.listRooms("user-1");
    await runtime.createRoom({ id: "room-1", host: { id: "user-1", name: "User" } });
    await runtime.updateRoomMap("room-1", "bareDuel");

    expect(calls.map((call) => call.path)).toEqual(["/api/rooms?userId=user-1", "/api/rooms", "/api/rooms/room-1/map"]);
  });

  it("starts as the slot owned by the current user", async () => {
    const host = { id: "host", name: "Host" };
    const guest = { id: "guest", name: "Guest" };
    const open = createRoom({ id: "room-2", host, humanCount: 2, aiCount: 1 });
    const joined = updateRoomSlot(open, "slot-2", { controller: "human", userId: guest.id, name: guest.name, ready: true });
    const startedRoom = { ...joined, status: "inMatch" as const };
    const transport = new FakeTransport();
    const runtime = new ServerDeploymentRuntime({
      fetchJson: async <T>() => startedRoom as T,
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => transport,
    });

    const started = await runtime.startRoom(startedRoom.id, guest);

    expect(started.playerId).toBe("enemy");
  });
});

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  sent: string[] = [];

  addEventListener(): void {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}
}

class FakeTransport implements NetTransport {
  send(_message: ClientNetMessage): void {}
  onMessage(_handler: (message: ServerNetMessage) => void): void {}
  close(): void {}
}
