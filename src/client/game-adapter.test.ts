import { describe, expect, it } from "vitest";
import { createGame } from "../shared/sim";
import { SimulationEngine } from "../shared/sim/engine";
import type { GameCommand, GameSnapshot } from "../shared/types";
import { LockstepClient } from "./net/lockstep-client";
import type { ClientNetMessage, ServerNetMessage } from "../shared/net/types";
import type { NetTransport } from "./net/transport";
import { LockstepRoomGameAdapter, SessionSocketGameAdapter } from "./game-adapter";

const moveCommand: GameCommand = { type: "move", unitIds: ["worker"], x: 10, y: 20 };

describe("game adapters", () => {
  it("sends session commands through the global session socket boundary", () => {
    const socket = new FakeSocket();
    const adapter = new SessionSocketGameAdapter(socket, () => ({ tick: 12 } as GameSnapshot));

    adapter.sendCommand(moveCommand);

    expect(socket.sent).toEqual([JSON.stringify(moveCommand)]);
    expect(adapter.currentSnapshot()).toMatchObject({ tick: 12 });
    expect(adapter.updateToRenderTime()).toBe(false);
  });

  it("fails session commands loudly when the socket is not open", () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const adapter = new SessionSocketGameAdapter(socket, () => undefined);

    expect(() => adapter.sendCommand(moveCommand)).toThrow("socket is not open");
  });

  it("keeps room spectators from issuing lockstep commands", () => {
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "spectator-viewer", engine: new SimulationEngine(createGame("bareDuel", { aiPlayers: [] })), transport });
    const adapter = new LockstepRoomGameAdapter(client, { spectating: true });

    expect(() => adapter.sendCommand(moveCommand)).toThrow("Spectators cannot issue commands");
    expect(transport.sent).toEqual([]);
  });

  it("reports room checkpoint state replacement through the adapter at the same tick", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.tick = 12;
    const transport = new FakeTransport();
    const client = new LockstepClient({ roomId: "room-1", playerId: "player", engine: new SimulationEngine(game), transport });
    const adapter = new LockstepRoomGameAdapter(client);
    const checkpointGame = createGame("bareDuel", { aiPlayers: [] });
    checkpointGame.tick = 12;
    checkpointGame.players.player.gold = 8744;
    checkpointGame.units = checkpointGame.units.filter((unit) => unit.owner !== "player");

    transport.emit({ type: "checkpoint", checkpoint: { roomId: "room-1", tick: 12, snapshot: checkpointGame, nextId: checkpointGame.nextId } });

    expect(adapter.updateToRenderTime()).toBe(true);
    expect(adapter.currentSnapshot().players.player.gold).toBe(8744);
    expect(adapter.currentSnapshot().units.some((unit) => unit.owner === "player")).toBe(false);
    expect(adapter.updateToRenderTime()).toBe(false);
  });
});

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
}

class FakeTransport implements NetTransport {
  sent: ClientNetMessage[] = [];
  private handler?: (message: ServerNetMessage) => void;

  send(message: ClientNetMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: ServerNetMessage) => void): void {
    this.handler = handler;
  }

  close(): void {}

  emit(message: ServerNetMessage): void {
    this.handler?.(message);
  }
}
