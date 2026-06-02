import { describe, expect, it } from "vitest";
import { decodeServerNetMessage, encodeNetMessage } from "../shared/net/codec";
import { createRoomHost } from "./room-host";
import { RoomNetHub, type RoomNetSocket } from "./room-net";
import type { ServerNetMessage } from "../shared/net/types";

const hostUser = { id: "host", name: "Host" };

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
    expect(messages.filter((message): message is Extract<ServerNetMessage, { type: "frame" }> => message.type === "frame").map((message) => message.frame)).toEqual([
      { roomId: room.id, tick: 0, sequence: 0, commands: [] },
      { roomId: room.id, tick: 1, sequence: 1, commands: [] },
      { roomId: room.id, tick: 2, sequence: 2, commands: [{ playerId: "player", clientSeq: 0, command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } }] },
    ]);
    const after = roomHost.snapshot(room.id);
    expect(after.tick).toBe(3);
    expect(after.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("records checksum messages through the coordinator and fails malformed room ids loudly", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checksum", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();

    hub.connect(room.id, socket);
    socket.emit(encodeNetMessage({ type: "join", roomId: room.id, playerId: "player" }));
    socket.emit(encodeNetMessage({ type: "checksum", roomId: room.id, playerId: "player", tick: 0, hash: "abcd" }));

    expect(hub.checksumsForTick(room.id, 0)).toEqual({ player: "abcd" });
    expect(() => socket.emit(encodeNetMessage({ type: "command", roomId: "other-room", playerId: "player", command: { type: "move", unitIds: [], x: 0, y: 0 } }))).toThrow(/does not match socket room/);
  });

  it("serves checkpoint requests from the live room state", () => {
    const roomHost = createRoomHost({ autoTick: false });
    const room = roomHost.createRoom({ id: "room-checkpoint", host: hostUser, mapId: "bareDuel" });
    roomHost.startRoom(room.id);
    roomHost.tickRoom(room.id, 4);
    const hub = new RoomNetHub({ roomHost });
    const socket = new FakeSocket();
    hub.connect(room.id, socket);

    socket.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id }));

    const checkpoint = socket.sent.map((raw) => decodeServerNetMessage(raw)).find((message) => message.type === "checkpoint");
    expect(checkpoint).toMatchObject({ type: "checkpoint", checkpoint: { roomId: room.id, tick: 4, snapshot: { tick: 4 } } });
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

    observer.emit(encodeNetMessage({ type: "requestCheckpoint", roomId: room.id, tick: 2 }));

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
