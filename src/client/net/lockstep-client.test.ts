import { describe, expect, it } from "vitest";
import { createGame } from "../../shared/sim";
import { SimulationEngine } from "../../shared/sim/engine";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import type { NetTransport } from "./transport";
import { LockstepClient } from "./lockstep-client";

describe("lockstep client", () => {
  it("sends commands over transport and applies only server-authored frames", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const command = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 100, y: worker!.y };

    client.sendCommand(command);

    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toEqual({ type: "idle" });
    expect(transport.sent).toEqual([{ type: "command", roomId: "room-1", playerId: "player", clientSeq: 0, command }]);

    client.receiveFrame({ roomId: "room-1", tick: 0, sequence: 0, commands: [{ playerId: "player", clientSeq: 0, command }] });
    client.updateToRenderTime();

    expect(game.tick).toBe(1);
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("joins, requests checkpoints, exposes snapshots, and closes transport", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });

    client.join();
    client.requestCheckpoint();
    client.close();

    expect(transport.sent).toEqual([
      { type: "join", roomId: "room-1", playerId: "player" },
      { type: "requestCheckpoint", roomId: "room-1", playerId: "player", reason: "manual", clientTick: 0, clientChecksum: client.currentChecksum() },
    ]);
    expect(client.currentSnapshot().tick).toBe(0);
    expect(transport.closed).toBe(true);
  });

  it("reports whether frame updates changed the engine snapshot", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });

    expect(client.updateToRenderTime()).toBe(false);
    client.receiveFrame({ roomId: "room-1", tick: 0, sequence: 0, commands: [] });

    expect(client.updateToRenderTime()).toBe(true);
    expect(client.currentSnapshot().tick).toBe(1);
  });

  it("emits deterministic checksums after applied frames on the configured cadence", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport, checksumEveryTicks: 1 });

    client.receiveFrame({ roomId: "room-1", tick: 0, sequence: 0, commands: [] });
    client.updateToRenderTime();

    expect(transport.sent).toContainEqual({ type: "checksum", roomId: "room-1", playerId: "player", tick: 1, hash: client.currentChecksum() });
  });

  it("accepts repeated delivery of the same future frame without throwing through the page", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const frame = { roomId: "room-1", tick: 1, sequence: 10, commands: [] };

    client.receiveFrame(frame);

    expect(() => client.receiveFrame(frame)).not.toThrow();
  });

  it("reports server command errors from room transport", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const errors: string[] = [];
    new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport, onError: (message) => errors.push(message) });

    transport.emit({ type: "error", roomId: "room-1", message: "farm placement is too close to townHall" });

    expect(errors).toEqual(["farm placement is too close to townHall"]);
  });

  it("applies stale command-frame unit ids without forcing a checkpoint", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const errors: string[] = [];
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport, onError: (message) => errors.push(message) });

    client.receiveFrame({
      roomId: "room-1",
      tick: 0,
      sequence: 0,
      commands: [{ playerId: "enemy", command: { type: "move", unitIds: ["unit-enemy-footman-2954"], x: 10, y: 10 } }],
    });

    expect(() => client.updateToRenderTime()).not.toThrow();
    expect(errors).toEqual([]);
    expect(transport.sent).not.toContainEqual({ type: "requestCheckpoint", roomId: "room-1" });
    expect(game.tick).toBe(1);
  });

  it("reports local invalid frame command errors and asks for an authoritative checkpoint", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(townHall).toBeDefined();
    const transport = new FakeTransport();
    const errors: string[] = [];
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport, onError: (message) => errors.push(message) });

    client.receiveFrame({
      roomId: "room-1",
      tick: 0,
      sequence: 0,
      commands: [{ playerId: "player", command: { type: "train", buildingId: townHall!.id, unitKind: "footman" } }],
    });

    expect(() => client.updateToRenderTime()).not.toThrow();
    expect(errors).toEqual(["townHall cannot train footman"]);
    expect(transport.sent).toContainEqual({
      type: "syncEvent",
      roomId: "room-1",
      event: {
        kind: "frame-apply-error",
        roomId: "room-1",
        playerId: "player",
        localTick: 0,
        message: "townHall cannot train footman",
        frameTick: 0,
        frameSequence: 0,
      },
    });
    expect(transport.sent).toContainEqual({ type: "requestCheckpoint", roomId: "room-1", playerId: "player", reason: "frame-apply-error", clientTick: 0, clientChecksum: client.currentChecksum() });
    expect(game.tick).toBe(0);
  });

  it("reports desync messages and asks for an authoritative checkpoint instead of throwing through the page", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const errors: string[] = [];
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport, onError: (message) => errors.push(message) });

    expect(() => transport.emit({ type: "desync", roomId: "room-1", tick: 42, checksums: { player: "local", enemy: "remote" } })).not.toThrow();
    expect(errors).toEqual(["Lockstep desync at tick 42"]);
    expect(transport.sent).toContainEqual({
      type: "syncEvent",
      roomId: "room-1",
      event: {
        kind: "server-desync",
        roomId: "room-1",
        playerId: "player",
        localTick: 0,
        serverTick: 42,
        message: "Lockstep desync at tick 42",
        checksums: { player: "local", enemy: "remote" },
      },
    });
    expect(transport.sent).toContainEqual({ type: "requestCheckpoint", roomId: "room-1", playerId: "player", reason: "server-desync", clientTick: 0, clientChecksum: client.currentChecksum() });
  });

  it("reports server message handling errors instead of throwing through the page", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const errors: string[] = [];
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport, onError: (message) => errors.push(message) });

    expect(() => transport.emit({ type: "frame", frame: { roomId: "other-room", tick: 0, sequence: 1, commands: [] } })).not.toThrow();
    expect(errors).toEqual(["Received frame for other-room while joined to room-1"]);
    expect(transport.sent).toContainEqual({
      type: "syncEvent",
      roomId: "room-1",
      event: { kind: "message-error", roomId: "room-1", playerId: "player", localTick: 0, message: "Received frame for other-room while joined to room-1" },
    });
    expect(transport.sent).toContainEqual({ type: "requestCheckpoint", roomId: "room-1", playerId: "player", reason: "message-error", clientTick: 0, clientChecksum: client.currentChecksum() });
  });

  it("restores the local engine from checkpoint messages", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const checkpointGame = createGame("bareDuel", { aiPlayers: [] });
    const worker = checkpointGame.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    worker!.order = { type: "move", x: worker!.x + 50, y: worker!.y };
    checkpointGame.tick = 12;
    checkpointGame.nextId = 1234;
    checkpointGame.projectiles.push({
      id: "projectile-checkpoint-sync",
      owner: "enemy",
      attackerId: "unit-enemy-archer",
      targetId: worker!.id,
      fromX: worker!.x + 100,
      fromY: worker!.y,
      toX: worker!.x,
      toY: worker!.y,
      damage: 13,
      remaining: 11,
      duration: 24,
    });

    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 12, snapshot: checkpointGame, nextId: 1234 } });

    expect(game.tick).toBe(12);
    expect(game.nextId).toBe(1234);
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
    expect(game.projectiles).toEqual(checkpointGame.projectiles);
  });

  it("classifies checkpoint restore events by server-provided checkpoint metadata", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const checkpointGame = createGame("bareDuel", { aiPlayers: [] });
    checkpointGame.tick = 8;

    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 8, snapshot: checkpointGame, nextId: checkpointGame.nextId, reason: "server-desync", checkpointClass: "recovery" } });

    expect(transport.sent).toContainEqual({
      type: "syncEvent",
      roomId: "room-1",
      event: {
        kind: "checkpoint-restore",
        roomId: "room-1",
        playerId: "player",
        localTick: 8,
        serverTick: 8,
        reason: "server-desync",
        checkpointClass: "recovery",
      },
    });
  });

  it("restores same-tick checkpoints without owning render invalidation state", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.tick = 12;
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const checkpointGame = createGame("bareDuel", { aiPlayers: [] });
    checkpointGame.tick = 12;
    checkpointGame.players.player.gold = 8744;
    checkpointGame.units = checkpointGame.units.filter((unit) => unit.owner !== "player");

    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 12, snapshot: checkpointGame, nextId: checkpointGame.nextId } });

    expect(client.updateToRenderTime()).toBe(false);
    expect(client.currentSnapshot().players.player.gold).toBe(8744);
    expect(client.currentSnapshot().units.some((unit) => unit.owner === "player")).toBe(false);
    expect(client.updateToRenderTime()).toBe(false);
  });

  it("drops buffered frames older than a restored checkpoint", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const checkpointGame = createGame("bareDuel", { aiPlayers: [] });
    checkpointGame.tick = 12;

    client.receiveFrame({ roomId: "room-1", tick: 4, sequence: 4, commands: [] });
    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 12, snapshot: checkpointGame, nextId: checkpointGame.nextId } });

    expect(() => client.receiveFrame({ roomId: "room-1", tick: 4, sequence: 14, commands: [] })).not.toThrow();
  });

  it("clears buffered future frames when a checkpoint starts a replacement epoch", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const oldEpochUnit = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(oldEpochUnit).toBeDefined();
    client.receiveFrame({ roomId: "room-1", tick: 1, sequence: 1, commands: [{ playerId: "player", command: { type: "move", unitIds: [oldEpochUnit!.id], x: oldEpochUnit!.x + 100, y: oldEpochUnit!.y } }] });
    const checkpointGame = createGame("wildMarches", { aiPlayers: [] });
    checkpointGame.tick = 0;

    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 0, snapshot: checkpointGame, nextId: checkpointGame.nextId } });
    client.receiveFrame({ roomId: "room-1", tick: 0, sequence: 0, commands: [] });
    client.updateToRenderTime();
    client.updateToRenderTime();

    expect(client.currentSnapshot().tick).toBe(1);
    expect(client.currentSnapshot().map.id).toBe("wildMarches");
    expect(client.currentSnapshot().units.find((unit) => unit.id === oldEpochUnit!.id)?.order).toEqual({ type: "idle" });
  });
});

class FakeTransport implements NetTransport {
  sent: ClientNetMessage[] = [];
  closed = false;
  private handler?: (message: ServerNetMessage) => void;

  send(message: ClientNetMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: ServerNetMessage) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.closed = true;
  }

  emit(message: ServerNetMessage): void {
    this.handler?.(message);
  }
}
