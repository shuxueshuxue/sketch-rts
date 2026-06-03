import { describe, expect, it } from "vitest";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import type { NetTransport } from "../net/transport";
import { ServerDeploymentRuntime } from "./server-runtime";

describe("server deployment runtime", () => {
  it("uses existing room API paths for room setup", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const runtime = new ServerDeploymentRuntime({
      fetchJson: async (path, body) => {
        calls.push({ path, body });
        return { id: "room-1", slots: [] };
      },
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => new FakeTransport(),
    });

    await runtime.listRooms("user-1");
    await runtime.createRoom({ id: "room-1", host: { id: "user-1", name: "User" } });
    await runtime.updateRoomMap("room-1", "bareDuel");

    expect(calls.map((call) => call.path)).toEqual(["/api/rooms?userId=user-1", "/api/rooms", "/api/rooms/room-1/map"]);
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
