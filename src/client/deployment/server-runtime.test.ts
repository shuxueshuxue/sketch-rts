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

  it("creates the lockstep client game from the room setup teams and races", () => {
    const host = { id: "host", name: "Host" };
    const open = createRoom({ id: "room-teams", host, mapId: "bareDuel", humanCount: 1, aiCount: 2 });
    const northAlly = updateRoomSlot(open, "slot-2", { team: "north", race: "grove" });
    const southEnemy = updateRoomSlot(northAlly, "slot-3", { team: "south", race: "grove" });
    const startedRoom = { ...southEnemy, status: "inMatch" as const };
    const runtime = new ServerDeploymentRuntime({
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => new FakeTransport(),
    });

    const started = runtime.connectRoom(startedRoom, "player", false, () => {});

    expect(started.snapshot.players.enemy?.race).toBe("grove");
    expect(started.snapshot.players.enemy2?.race).toBe("grove");
  });

  it("surfaces lockstep room command errors through the runtime error callback", () => {
    const host = { id: "host", name: "Host" };
    const open = createRoom({ id: "room-errors", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const startedRoom = { ...open, status: "inMatch" as const };
    const transport = new FakeTransport();
    const errors: string[] = [];
    const runtime = new ServerDeploymentRuntime({
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => transport,
      onSessionError: (message) => errors.push(message),
    });

    runtime.connectRoom(startedRoom, "player", false, () => {});
    transport.emit({ type: "error", roomId: startedRoom.id, message: "farm placement is too close to townHall" });

    expect(errors).toEqual(["farm placement is too close to townHall"]);
  });

  it("sends match commands through the room lockstep transport without local sim mutation", () => {
    const host = { id: "host", name: "Host" };
    const open = createRoom({ id: "room-lockstep-command", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const startedRoom = { ...open, status: "inMatch" as const };
    const transport = new FakeTransport();
    const runtime = new ServerDeploymentRuntime({
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => transport,
    });
    const started = runtime.connectRoom(startedRoom, "player", false, () => {});
    const worker = started.snapshot.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();

    const command = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 120, y: worker!.y };
    started.adapter.sendCommand(command);

    const localSnapshot = started.adapter.currentSnapshot();
    expect(localSnapshot).toBeDefined();
    expect(localSnapshot?.tick).toBe(0);
    expect(localSnapshot?.units.find((unit) => unit.id === worker!.id)?.order).toEqual({ type: "idle" });
    expect(transport.sent).toContainEqual({ type: "command", roomId: startedRoom.id, playerId: "player", clientSeq: 0, command });
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
  sent: ClientNetMessage[] = [];
  private handlers: ((message: ServerNetMessage) => void)[] = [];

  send(message: ClientNetMessage): void {
    this.sent.push(message);
  }
  onMessage(handler: (message: ServerNetMessage) => void): void {
    this.handlers.push(handler);
  }
  close(): void {}
  emit(message: ServerNetMessage): void {
    for (const handler of this.handlers) handler(message);
  }
}
