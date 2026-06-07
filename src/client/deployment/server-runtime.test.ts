import { describe, expect, it } from "vitest";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import { createRoom, updateRoomSlot } from "../../shared/rooms";
import type { NetTransport } from "../net/transport";
import { ServerDeploymentRuntime } from "./server-runtime";

describe("server deployment runtime", () => {
  it("boots server deployment without opening a global session gameplay socket", () => {
    const runtime = new ServerDeploymentRuntime({
      createRoomTransport: () => new FakeTransport(),
    });

    const adapter = runtime.initialAdapter();

    expect(adapter.currentSnapshot()).toBeUndefined();
    expect(() => adapter.sendCommand({ type: "move", unitIds: ["worker"], x: 10, y: 20 })).toThrow("No active match");
  });

  it("uses existing room API paths for room setup", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const runtime = new ServerDeploymentRuntime({
      fetchJson: async <T>(path: string, body?: unknown) => {
        calls.push({ path, body });
        return { id: "room-1", slots: [] } as T;
      },
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
      createRoomTransport: () => new FakeTransport(),
    });

    const started = runtime.connectRoom(startedRoom, "player", false, () => {});

    expect(started.snapshot.players.enemy?.race).toBe("grove");
    expect(started.snapshot.players.enemy2?.race).toBe("grove");
  });

  it("connects spectators through the same room lockstep adapter without command authority", () => {
    const host = { id: "host", name: "Host" };
    const open = createRoom({ id: "room-spectator", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const startedRoom = { ...open, status: "inMatch" as const };
    const transport = new FakeTransport();
    const runtime = new ServerDeploymentRuntime({
      createRoomTransport: () => transport,
    });

    const started = runtime.connectRoom(startedRoom, "spectator-viewer", true, () => {});

    expect(transport.sent).toEqual([
      { type: "join", roomId: startedRoom.id, playerId: "spectator-viewer" },
      expect.objectContaining({ type: "requestCheckpoint", roomId: startedRoom.id, playerId: "spectator-viewer", reason: "initial-sync", clientTick: 0, epoch: 0 }),
    ]);
    expect(() => started.adapter.sendCommand({ type: "move", unitIds: ["worker"], x: 10, y: 20 })).toThrow("Spectators cannot issue commands");
  });

  it("surfaces lockstep room command errors through the runtime error callback", () => {
    const host = { id: "host", name: "Host" };
    const open = createRoom({ id: "room-errors", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const startedRoom = { ...open, status: "inMatch" as const };
    const transport = new FakeTransport();
    const errors: string[] = [];
    const runtime = new ServerDeploymentRuntime({
      createRoomTransport: () => transport,
      onRuntimeError: (message) => errors.push(message),
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
    expect(transport.sent).toContainEqual({ type: "command", roomId: startedRoom.id, playerId: "player", clientSeq: 0, command, epoch: 0 });
  });

  it("routes public chat through the room transport without using match commands", () => {
    const host = { id: "host", name: "Host" };
    const open = createRoom({ id: "room-chat", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
    const startedRoom = { ...open, status: "inMatch" as const };
    const transport = new FakeTransport();
    const runtime = new ServerDeploymentRuntime({
      createRoomTransport: () => transport,
    });
    const started = runtime.connectRoom(startedRoom, "player", false, () => {});
    const received: string[] = [];
    started.chat.onMessage((message) => received.push(`${message.senderName}: ${message.text}`));

    started.chat.send(" push mid ", "Ada");
    transport.emit({ type: "chat", message: { id: "chat-room-chat-1", roomId: startedRoom.id, playerId: "player", senderName: "Ada", text: "push mid", sentAt: 1200 } });

    expect(transport.sent).toContainEqual({ type: "chat", roomId: startedRoom.id, playerId: "player", senderName: "Ada", text: "push mid" });
    expect(transport.sent.some((message) => message.type === "command")).toBe(false);
    expect(received).toEqual(["Ada: push mid"]);
  });
});

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
