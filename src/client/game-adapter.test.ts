import { describe, expect, it } from "vitest";
import { createGame } from "../shared/sim";
import { SimulationEngine } from "../shared/sim/engine";
import type { GameCommand } from "../shared/types";
import { LockstepClient } from "./net/lockstep-client";
import type { ClientNetMessage, ServerNetMessage } from "../shared/net/types";
import type { NetTransport } from "./net/transport";
import { EmptyGameAdapter, LockstepRoomGameAdapter } from "./game-adapter";

const moveCommand: GameCommand = { type: "move", unitIds: ["worker"], x: 10, y: 20 };

describe("game adapters", () => {
  it("keeps gameplay unavailable until a real match adapter is installed", () => {
    const adapter = new EmptyGameAdapter();

    expect(adapter.currentSnapshot()).toBeUndefined();
    expect(adapter.updateToRenderTime()).toBe(false);
    expect(() => adapter.sendCommand(moveCommand)).toThrow("No active match");
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
