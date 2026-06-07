import { createPresetAiRuntimeFramePlanner, type AiRuntimeState, type AiRuntimeFramePlannerState } from "../../ai/runtime";
import type { CommandEnvelope } from "../../shared/net/types";
import { snapshotGame, type Game } from "../../shared/sim";
import { CommandFrameRuntime } from "../../shared/sim/command-frame-runtime";
import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../../shared/types";
import type { GameAdapter } from "../game-adapter";

export type LocalGameAdapterOptions = {
  now?: () => number;
  tickMs?: number;
  aiRuntime?: AiRuntimeState;
  room?: RoomState;
  finishRoom?: (snapshot: GameSnapshot) => RoomState;
  onRoomEnded?: (room: RoomState) => void;
};

export class LocalGameAdapter implements GameAdapter {
  private lastUpdate: number;
  private room: RoomState | undefined;
  private readonly frameRuntime: CommandFrameRuntime<AiRuntimeFramePlannerState>;

  constructor(
    private readonly game: Game,
    private readonly playerId: PlayerId,
    private readonly options: LocalGameAdapterOptions = {},
  ) {
    this.lastUpdate = this.now();
    this.room = options.room;
    this.frameRuntime = new CommandFrameRuntime({
      game,
      roomId: this.room?.id ?? "local",
      rejectionLabel: "Local command rejected",
      ...(options.aiRuntime ? { aiPlanner: createPresetAiRuntimeFramePlanner(this.game, options.aiRuntime) } : {}),
    });
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
    this.frameRuntime.tick(commands);
    if (this.room && this.game.match.winner) {
      if (!this.options.finishRoom) throw new Error(`Local room ${this.room.id} finished without a lifecycle finisher`);
      this.room = this.options.finishRoom(snapshotGame(this.game));
      this.options.onRoomEnded?.(this.room);
    }
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }
}
