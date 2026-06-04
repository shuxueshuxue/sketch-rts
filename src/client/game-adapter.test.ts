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

  send(message: ClientNetMessage): void {
    this.sent.push(message);
  }

  onMessage(_handler: (message: ServerNetMessage) => void): void {}

  close(): void {}
}
