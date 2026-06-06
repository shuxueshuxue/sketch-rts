import { planPresetAiRuntimeCommands, type AiRuntimeState } from "../../ai/runtime";
import type { CommandEnvelope } from "../../shared/net/types";
import { finishRoom } from "../../shared/rooms";
import { snapshotGame, stepGame, type Game } from "../../shared/sim";
import { commandValidationError } from "../../shared/sim/command-validation";
import { applyCommandFrame, commandWithCurrentIssuers } from "../../shared/sim/frame";
import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../../shared/types";
import type { GameAdapter } from "../game-adapter";

export type LocalGameAdapterOptions = {
  now?: () => number;
  tickMs?: number;
  aiRuntime?: AiRuntimeState;
  room?: RoomState;
  onRoomEnded?: (room: RoomState) => void;
};

export class LocalGameAdapter implements GameAdapter {
  private sequence = 0;
  private lastUpdate: number;
  private room: RoomState | undefined;

  constructor(
    private readonly game: Game,
    private readonly playerId: PlayerId,
    private readonly options: LocalGameAdapterOptions = {},
  ) {
    this.lastUpdate = this.now();
    this.room = options.room;
  }

  sendCommand(command: GameCommand): void {
    this.applyAndStep([{ playerId: this.playerId, command }]);
  }

  currentSnapshot(): GameSnapshot {
    return snapshotGame(this.game);
  }

  updateToRenderTime(): boolean {
    const tickMs = this.options.tickMs ?? 50;
    const current = this.now();
    let changed = false;
    while (current - this.lastUpdate >= tickMs && !this.game.match.winner) {
      this.applyAndStep([]);
      this.lastUpdate += tickMs;
      changed = true;
    }
    return changed;
  }

  close(): void {}

  private applyAndStep(commands: CommandEnvelope[]): void {
    const snapshot = snapshotGame(this.game);
    this.validateFrameEntries(snapshot, commands);
    const runtimeLastThink = this.options.aiRuntime ? { ...this.options.aiRuntime.lastThink } : undefined;
    let aiCommands: CommandEnvelope[] = [];
    try {
      aiCommands = this.options.aiRuntime ? planPresetAiRuntimeCommands(this.game, this.options.aiRuntime).commands.map((entry) => ({ playerId: entry.playerId, command: entry.command })) : [];
      this.validateFrameEntries(snapshot, aiCommands);
    } catch (error) {
      if (this.options.aiRuntime && runtimeLastThink) this.options.aiRuntime.lastThink = runtimeLastThink;
      throw error;
    }
    applyCommandFrame(this.game, {
      roomId: this.room?.id ?? "local",
      tick: this.game.tick,
      sequence: this.sequence,
      commands: [...commands, ...aiCommands],
    });
    this.sequence += 1;
    stepGame(this.game);
    if (this.room && this.game.match.winner) {
      this.room = finishRoom(this.room, snapshotGame(this.game));
      this.options.onRoomEnded?.(this.room);
    }
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private validateFrameEntries(snapshot: GameSnapshot, entries: CommandEnvelope[]): void {
    for (const entry of entries) {
      const currentCommand = commandWithCurrentIssuers(this.game, entry.playerId, entry.command);
      if (!currentCommand) continue;
      const error = commandValidationError(snapshot, entry.playerId, currentCommand);
      if (error) throw new Error(`Local command rejected: ${error}`);
    }
  }
}
