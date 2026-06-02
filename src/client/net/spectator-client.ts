import type { GameSnapshot, PlayerId } from "../../shared/types";
import type { SimulationEngine } from "../../shared/sim/engine";
import { LockstepClient } from "./lockstep-client";
import type { NetTransport } from "./transport";

export type SpectatorClientOptions = {
  roomId: string;
  spectatorId: PlayerId;
  engine: SimulationEngine;
  transport: NetTransport;
};

export class SpectatorClient {
  private readonly client: LockstepClient;

  constructor(options: SpectatorClientOptions) {
    this.client = new LockstepClient({ roomId: options.roomId, playerId: options.spectatorId, engine: options.engine, transport: options.transport });
  }

  join(): void {
    this.client.join();
    this.client.requestCheckpoint();
  }

  currentSnapshot(): GameSnapshot {
    return this.client.currentSnapshot();
  }

  updateToRenderTime(): boolean {
    return this.client.updateToRenderTime();
  }

  close(): void {
    this.client.close();
  }
}
