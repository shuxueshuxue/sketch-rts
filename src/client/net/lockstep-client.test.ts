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
      { type: "requestCheckpoint", roomId: "room-1" },
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

    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 12, snapshot: checkpointGame, nextId: 1234 } });

    expect(game.tick).toBe(12);
    expect(game.nextId).toBe(1234);
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
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
