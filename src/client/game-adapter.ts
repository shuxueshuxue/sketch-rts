import type { GameCommand, GameSnapshot } from "../shared/types";
import type { LockstepClient } from "./net/lockstep-client";

export type GameAdapter = {
  sendCommand(command: GameCommand): void;
  currentSnapshot(): GameSnapshot | undefined;
  updateToRenderTime(): boolean;
  close(): void;
};

export type SessionCommandSocket = {
  OPEN: number;
  readyState: number;
  send(data: string): void;
};

export class SessionSocketGameAdapter implements GameAdapter {
  constructor(
    private readonly socket: SessionCommandSocket,
    private readonly snapshot: () => GameSnapshot | undefined,
  ) {}

  sendCommand(command: GameCommand): void {
    if (this.socket.readyState !== this.socket.OPEN) throw new Error("Command failed: socket is not open.");
    this.socket.send(JSON.stringify(command));
  }

  currentSnapshot(): GameSnapshot | undefined {
    return this.snapshot();
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
