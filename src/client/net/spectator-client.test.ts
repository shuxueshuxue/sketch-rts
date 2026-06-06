import { describe, expect, it } from "vitest";
import { createGame } from "../../shared/sim";
import { SimulationEngine } from "../../shared/sim/engine";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import type { NetTransport } from "./transport";
import { SpectatorClient } from "./spectator-client";

describe("spectator client", () => {
  it("joins as an observer and requests a checkpoint without exposing command send", () => {
    const transport = new FakeTransport();
    const client = new SpectatorClient({ roomId: "room-1", spectatorId: "viewer-1", engine: new SimulationEngine(createGame("bareDuel", { aiPlayers: [] })), transport });

    client.join();

    expect(transport.sent).toEqual([
      { type: "join", roomId: "room-1", playerId: "viewer-1" },
      { type: "requestCheckpoint", roomId: "room-1", playerId: "viewer-1", reason: "initial-sync", clientTick: 0, clientChecksum: "305cb7f9" },
    ]);
    expect(client.currentSnapshot().tick).toBe(0);
  });
});

class FakeTransport implements NetTransport {
  sent: ClientNetMessage[] = [];

  send(message: ClientNetMessage): void {
    this.sent.push(message);
  }

  onMessage(_handler: (message: ServerNetMessage) => void): void {}

  close(): void {}
}
