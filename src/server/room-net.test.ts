import { describe, expect, it } from "vitest";
import type { AiScript } from "../ai/policy";
import { decodeServerNetMessage, encodeNetMessage } from "../shared/net/codec";
import { createRoomHost } from "./room-host";
import { RoomNetHub, type RoomNetSocket } from "./room-net";
import type { ServerNetMessage } from "../shared/net/types";

const hostUser = { id: "host", name: "Host" };

function invalidTrainingAiScript(): AiScript {
  return {
    id: "invalid-room-net-ai-command",
    phase: "economy",
    run(snapshot, owner) {
      const townHall = snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall");
      expect(townHall).toBeDefined();
      return { type: "train", buildingId: townHall!.id, unitKind: "footman" };
    },
  };
}

describe("room net hub", () => {
  it("accepts client commands and broadcasts authoritative frames before ticking the room sim", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-net", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const before = roomHost.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const hub = new RoomNetHub({ roomHost, commandDelayTicks: 2 });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    socket.emit(encodeNetMessage({ type: "join", roomId: room.id, playerId: "player" }));
    socket.emit(encodeNetMessage({ type: "command", roomId: room.id, playerId: "player", clientSeq: 0, command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } }));
    hub.tickRoom(room.id);
    hub.tickRoom(room.id);
    hub.tickRoom(room.id);

    const messages = socket.sent.map((raw) => decodeServerNetMessage(raw));
    expect(messages[0]).toEqual({ type: "hello", roomId: room.id, playerId: "player", tick: 0 });
    const frames = messages.filter((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame").map((message) => message.frame);
    expect(frames.map((frame) => ({ tick: frame.tick, sequence: frame.sequence }))).toEqual([
      { tick: 0, sequence: 0 },
      { tick: 1, sequence: 1 },
      { tick: 2, sequence: 2 },
    ]);
    expect(frames[0]?.commands.some((entry) => entry.playerId === "enemy" && entry.command.type === "mine")).toBe(true);
    expect(frames[2]?.commands).toContainEqual({ playerId: "player", clientSeq: 0, command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } });
    const after = roomHost.snapshot(room.id);
    expect(after.tick).toBe(3);
    expect(after.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("broadcasts internal AI commands in the connected room frame", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-connected-ai", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    hub.tickRoom(room.id);

    const frame = socket.sent.map((raw) => decodeServerNetMessage(raw)).find((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame")?.frame;
    const after = roomHost.snapshot(room.id);
    const enemyWorker = after.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    expect(frame?.commands.some((entry) => entry.playerId === "enemy" && entry.command.type === "mine")).toBe(true);
    expect(enemyWorker?.order.type).not.toBe("idle");
  });

  it("publishes SDK command ticks through the connected room frame stream", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-sdk-frame-publication", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const before = roomHost.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    roomHost.commandTickRoom(room.id, [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } }], 1);

    const frames = socket.sent.map((raw) => decodeServerNetMessage(raw)).filter((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.frame.commands).toContainEqual({ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } });
    expect(frames[0]?.frame.commands.some((entry) => entry.playerId === "enemy" && entry.command.type === "mine")).toBe(true);
  });

  it("publishes single room commands as one connected room frame tick", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-command-frame-publication", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const before = roomHost.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    const after = roomHost.commandRoom(room.id, "player", { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y });

    const frames = socket.sent.map((raw) => decodeServerNetMessage(raw)).filter((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame");
    expect(after.tick).toBe(before.tick + 1);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.frame.tick).toBe(before.tick);
    expect(frames[0]?.frame.commands).toContainEqual({ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } });
  });

  it("fails hosted internal AI admission loudly instead of swallowing room frame faults", () => {
    const roomHost = createRoomHost({ autoTick: false, aiScripts: [invalidTrainingAiScript()] });
    const room = roomHost.createRoom({ id: "room-invalid-connected-ai", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);

    expect(() => hub.tickRoom(room.id)).toThrow(/Hosted command rejected: townHall cannot train footman/);
    expect(socket.sent.map((raw) => decodeServerNetMessage(raw)).filter((message) => message.type === "error")).toEqual([]);
  });

  it("reports invalid lockstep commands without crashing the room ticker", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-invalid-build", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const before = roomHost.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const townHall = before.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(townHall).toBeDefined();
    const hub = new RoomNetHub({ roomHost, commandDelayTicks: 0 });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    socket.emit(encodeNetMessage({ type: "join", roomId: room.id, playerId: "player" }));
    socket.emit(
      encodeNetMessage({
        type: "command",
        roomId: room.id,
        playerId: "player",
        clientSeq: 1,
        command: { type: "build", unitId: worker!.id, buildingKind: "farm", x: townHall!.x + 10, y: townHall!.y },
      }),
    );

    expect(() => hub.tickRoom(room.id)).not.toThrow();

    const messages = socket.sent.map((raw) => decodeServerNetMessage(raw));
    const serverError = messages.find((message) => message.type === "error");
    expect(serverError).toMatchObject({ type: "error", roomId: room.id, message: expect.stringMatching(/farm placement is too close to townHall/) });
    expect(roomHost.getRoom(room.id).status).toBe("inMatch");
  });

  it("drops sockets that fail during broadcast without stopping the room ticker", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-stale-socket", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const staleSocket = new ThrowingSocket();
    const liveSocket = new FakeSocket();

    hub.connect(room.id, staleSocket);
    hub.connect(room.id, liveSocket);

    expect(() => hub.tickRoom(room.id)).not.toThrow();
    expect(() => hub.tickRoom(room.id)).not.toThrow();

    const frames = liveSocket.sent.map((raw) => decodeServerNetMessage(raw)).filter((message) => message.type === "frame");
    expect(frames).toHaveLength(2);
    expect(staleSocket.sendAttempts).toBe(1);
  });

  it("records checksum messages through the coordinator and reports malformed client messages", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checksum", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    socket.emit(encodeNetMessage({ type: "join", roomId: room.id, playerId: "player" }));
    socket.emit(encodeNetMessage({ type: "checksum", roomId: room.id, playerId: "player", tick: 0, hash: "abcd" }));

    expect(hub.checksumsForTick(room.id, 0)).toEqual({ player: "abcd" });
    socket.emit(encodeNetMessage({ type: "command", roomId: "other-room", playerId: "player", command: { type: "move", unitIds: [], x: 0, y: 0 } }));
    socket.emit(JSON.stringify({ type: "chat", roomId: room.id, playerId: "player", senderName: "Ada", text: "" }));
    socket.emit(JSON.stringify({ type: "command", roomId: room.id, playerId: "player", command: { type: "move" } }));

    const errors = socket.sent.map((raw) => decodeServerNetMessage(raw)).filter((message): message is Extract<ServerNetMessage, { type: "error" }> => message.type === "error");
    expect(errors.map((message) => message.message)).toEqual([`Client message room other-room does not match socket room ${room.id}`, "Malformed client chat message", "Malformed client command message"]);
    expect(() => hub.tickRoom(room.id)).not.toThrow();
  });

  it("broadcasts desync and records a sync event when a client checksum differs from server truth", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checksum-mismatch", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const playerSocket = new FakeSocket();
    const observerSocket = new FakeSocket();

    hub.connect(room.id, playerSocket);
    hub.connect(room.id, observerSocket);
    hub.tickRoom(room.id);
    playerSocket.emit(encodeNetMessage({ type: "checksum", roomId: room.id, playerId: "player", tick: 1, hash: "wrong-hash" }));

    const playerMessages = playerSocket.sent.map((raw) => decodeServerNetMessage(raw));
    const observerMessages = observerSocket.sent.map((raw) => decodeServerNetMessage(raw));
    const desync = playerMessages.find((message): message is Extract<ServerNetMessage, { type: "desync" }> => message.type === "desync");
    expect(desync).toMatchObject({ type: "desync", roomId: room.id, tick: 1, checksums: { player: "wrong-hash" } });
    expect(desync?.checksums.server).toMatch(/^[0-9a-f]{8}$/);
    expect(observerMessages).toContainEqual(desync);
    expect(hub.syncEventsForRoom(room.id)).toContainEqual(
      expect.objectContaining({
        kind: "checksum-mismatch",
        roomId: room.id,
        playerId: "player",
        localTick: 1,
        serverTick: 1,
        checksums: expect.objectContaining({ player: "wrong-hash", server: expect.stringMatching(/^[0-9a-f]{8}$/) }),
      }),
    );
  });

  it("trims checksum comparison history to the retained frame horizon", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checksum-trim", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost, frameHistoryLimit: 2 });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    hub.tickRoom(room.id);
    hub.tickRoom(room.id);
    hub.tickRoom(room.id);
    socket.emit(encodeNetMessage({ type: "checksum", roomId: room.id, playerId: "player", tick: 1, hash: "old-wrong-hash" }));
    socket.emit(encodeNetMessage({ type: "checksum", roomId: room.id, playerId: "player", tick: 99, hash: "future-wrong-hash" }));
    socket.emit(encodeNetMessage({ type: "checksum", roomId: room.id, playerId: "player", tick: 3, hash: "new-wrong-hash" }));

    const desyncs = socket.sent.map((raw) => decodeServerNetMessage(raw)).filter((message): message is Extract<ServerNetMessage, { type: "desync" }> => message.type === "desync");
    expect(desyncs.map((message) => message.tick)).toEqual([3]);
    expect(hub.checksumsForTick(room.id, 1)).toEqual({});
    expect(hub.checksumsForTick(room.id, 99)).toEqual({});
    expect(hub.checksumsForTick(room.id, 3)).toEqual({ player: "new-wrong-hash" });
  });

  it("records bounded client sync diagnostic events", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-sync-events", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost, syncEventLimit: 2, now: () => 1500 });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    socket.emit(encodeNetMessage({ type: "syncEvent", roomId: room.id, event: { kind: "checkpoint-restore", roomId: room.id, playerId: "player", localTick: 2, serverTick: 2, message: "initial-sync" } }));
    socket.emit(encodeNetMessage({ type: "syncEvent", roomId: room.id, event: { kind: "frame-apply-error", roomId: room.id, playerId: "player", localTick: 3, message: "bad frame" } }));
    socket.emit(encodeNetMessage({ type: "syncEvent", roomId: room.id, event: { kind: "server-desync", roomId: room.id, playerId: "player", localTick: 4, serverTick: 4, message: "desync" } }));

    expect(hub.syncEventsForRoom(room.id)).toEqual([
      expect.objectContaining({ kind: "frame-apply-error", roomId: room.id, playerId: "player", localTick: 3, message: "bad frame", recordedAt: 1500 }),
      expect.objectContaining({ kind: "server-desync", roomId: room.id, playerId: "player", localTick: 4, message: "desync", recordedAt: 1500 }),
    ]);
  });

  it("broadcasts public chat without admitting it to command frames", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-chat", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost, now: () => 1200 });
    const sender = new FakeSocket();
    const receiver = new FakeSocket();

    hub.connect(room.id, sender);
    hub.connect(room.id, receiver);
    sender.emit(encodeNetMessage({ type: "chat", roomId: room.id, playerId: "player", senderName: "Ada", text: "push mid" }));

    const senderMessages = sender.sent.map((raw) => decodeServerNetMessage(raw));
    const receiverMessages = receiver.sent.map((raw) => decodeServerNetMessage(raw));
    expect(senderMessages).toContainEqual({ type: "chat", message: { id: "chat-room-chat-1", roomId: room.id, playerId: "player", senderName: "Ada", text: "push mid", sentAt: 1200 } });
    expect(receiverMessages).toContainEqual({ type: "chat", message: { id: "chat-room-chat-1", roomId: room.id, playerId: "player", senderName: "Ada", text: "push mid", sentAt: 1200 } });

    hub.tickRoom(room.id);
    const frames = sender.sent.map((raw) => decodeServerNetMessage(raw)).filter((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame");
    expect(frames[0]?.frame.commands.some((entry) => (entry.command as { type: string }).type === "chat")).toBe(false);
  });

  it("serves checkpoint requests from the live room state", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checkpoint", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    roomHost.tickRoom(room.id, 4);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();
    hub.connect(room.id, socket);

    socket.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id, playerId: "player", reason: "initial-sync", clientTick: 0, clientChecksum: "abcd1234" }));

    const checkpoint = socket.sent.map((raw) => decodeServerNetMessage(raw)).find((message) => message.type === "checkpoint");
    expect(checkpoint).toMatchObject({ type: "checkpoint", checkpoint: { roomId: room.id, tick: 4, snapshot: { tick: 4 }, reason: "initial-sync", checkpointClass: "initial" } });
    expect(hub.syncEventsForRoom(room.id)).toContainEqual(
      expect.objectContaining({
        kind: "checkpoint-request",
        roomId: room.id,
        playerId: "player",
        localTick: 0,
        serverTick: 4,
        reason: "initial-sync",
        checkpointClass: "initial",
        clientChecksum: "abcd1234",
      }),
    );
  });

  it("classifies checkpoint requests and counts recovery separately from normal sync", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checkpoint-class", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();
    hub.connect(room.id, socket);

    socket.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id, playerId: "player", reason: "initial-sync", clientTick: 0 }));
    socket.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id, playerId: "observer", tick: 0, clientTick: 4 }));
    socket.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id, playerId: "player", reason: "server-desync", clientTick: 6, clientChecksum: "badc0de" }));

    const requests = hub.syncEventsForRoom(room.id).filter((event) => event.kind === "checkpoint-request");
    expect(requests.map((event) => ({ playerId: event.playerId, reason: event.reason, checkpointClass: event.checkpointClass }))).toEqual([
      { playerId: "player", reason: "initial-sync", checkpointClass: "initial" },
      { playerId: "observer", reason: "late-catchup", checkpointClass: "catchup" },
      { playerId: "player", reason: "server-desync", checkpointClass: "recovery" },
    ]);
    expect(hub.syncSummaryForRoom(room.id).checkpointRequests).toEqual({ initial: 1, catchup: 1, manual: 0, recovery: 1 });
  });

  it("replays retained frames after a requested checkpoint for late observers", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-catchup", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost, frameHistoryLimit: 16 });
    const liveSocket = new FakeSocket();
    hub.connect(room.id, liveSocket);
    for (let i = 0; i < 5; i += 1) hub.tickRoom(room.id);
    const observer = new FakeSocket();
    hub.connect(room.id, observer);

    observer.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id, playerId: "observer", tick: 2, clientTick: 5, clientChecksum: "eeee1234" }));

    const messages = observer.sent.map((raw) => decodeServerNetMessage(raw));
    const checkpoint = messages.find((message) => message.type === "checkpoint");
    const frames = messages.filter((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame").map((message) => message.frame);
    expect(checkpoint).toMatchObject({ type: "checkpoint", checkpoint: { roomId: room.id, tick: 2, snapshot: { tick: 2 } } });
    expect(frames.map((frame) => frame.tick)).toEqual([2, 3, 4]);
  });

  it("ticks all connected rooms and returns their ids for ordinary ticker exclusion", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const connected = roomHost.createRoom({ id: "room-connected", host: hostUser, mapId: "bareDuel" });
    const unconnected = roomHost.createRoom({ id: "room-unconnected", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(connected.id);
    roomHost.startRoom(unconnected.id);
    const hub = new RoomNetHub({ roomHost });
    hub.connect(connected.id, new FakeSocket());

    const ticked = hub.tickConnectedRooms();

    expect(ticked).toEqual(new Set([connected.id]));
    expect(roomHost.snapshot(connected.id).tick).toBe(1);
    expect(roomHost.snapshot(unconnected.id).tick).toBe(0);
  });

  it("skips connected rooms after an external tick ends the match", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-externally-ended", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    roomHost.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
      scenario: {
        addUnits: Array.from({ length: 18 }, (_, index) => ({
          id: `external-siege-${index}`,
          owner: "player",
          kind: "golem",
          x: 3020 + index * 4,
          y: 3020 + index * 4,
        })),
      },
    });
    roomHost.commandRoom(room.id, "player", {
      type: "attack",
      unitIds: Array.from({ length: 18 }, (_, index) => `external-siege-${index}`),
      targetId: "building-enemy-townhall",
    });
    const hub = new RoomNetHub({ roomHost });
    hub.connect(room.id, new FakeSocket());

    const ended = roomHost.tickRoom(room.id, 800);

    expect(ended.room.status).toBe("ended");
    expect(() => hub.tickConnectedRooms()).not.toThrow();
    expect(hub.tickConnectedRooms()).toEqual(new Set());
  });

  it("drops stale connected-room state after the authoritative room is closed", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-closed-with-socket", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    hub.connect(room.id, new FakeSocket());

    const closed = roomHost.closeRoom(room.id, hostUser.id);

    expect(closed.status).toBe("closed");
    expect(() => hub.tickConnectedRooms()).not.toThrow();
    expect(hub.tickConnectedRooms()).toEqual(new Set());
  });

  it("can publish an externally changed room state to connected clients", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-publish-ended", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    roomHost.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
      scenario: {
        addUnits: Array.from({ length: 18 }, (_, index) => ({
          id: `publish-siege-${index}`,
          owner: "player",
          kind: "golem",
          x: 3020 + index * 4,
          y: 3020 + index * 4,
        })),
      },
    });
    roomHost.commandRoom(room.id, "player", {
      type: "attack",
      unitIds: Array.from({ length: 18 }, (_, index) => `publish-siege-${index}`),
      targetId: "building-enemy-townhall",
    });
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();
    hub.connect(room.id, socket);

    const ended = roomHost.tickRoom(room.id, 800);
    hub.publishRoom(room.id);

    expect(ended.room.status).toBe("ended");
    const messages = socket.sent.map((raw) => decodeServerNetMessage(raw));
    expect(messages).toContainEqual({ type: "room", room: ended.room });
  });
});

class FakeSocket implements RoomNetSocket {
  sent: string[] = [];
  private handlers: ((raw: string) => void)[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  on(event: "message" | "close", handler: ((raw: string) => void) | (() => void)): void {
    if (event === "message") this.handlers.push(handler as (raw: string) => void);
  }

  emit(raw: string): void {
    for (const handler of this.handlers) handler(raw);
  }
}

class ThrowingSocket extends FakeSocket {
  sendAttempts = 0;

  send(_data: string): void {
    this.sendAttempts += 1;
    throw new Error("socket is closed");
  }
}
