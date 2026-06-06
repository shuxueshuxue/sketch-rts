import type { GameCommand, GameSnapshot } from "../shared/types";
import type { LockstepClient } from "./net/lockstep-client";

export type GameAdapter = {
  sendCommand(command: GameCommand): void;
  currentSnapshot(): GameSnapshot | undefined;
  updateToRenderTime(): boolean;
  close(): void;
};

export class EmptyGameAdapter implements GameAdapter {
  sendCommand(_command: GameCommand): void {
    throw new Error("No active match.");
  }

  currentSnapshot(): undefined {
    return undefined;
  }

  updateToRenderTime(): boolean {
    return false;
  }

  close(): void {}
}

export class LockstepRoomGameAdapter implements GameAdapter {
  constructor(
    private readonly client: LockstepClient,
    private readonly options: { spectating?: boolean } = {},
  ) {}

  sendCommand(command: GameCommand): void {
    if (this.options.spectating) throw new Error("Spectators cannot issue commands.");
    this.client.sendCommand(command);
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
