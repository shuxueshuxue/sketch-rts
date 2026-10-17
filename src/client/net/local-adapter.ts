import { createPresetAiRuntimeFramePlanner, type AiRuntimeState, type AiRuntimeFramePlannerState, type AiThinkExecutor, type AiThinkExecutorFactory } from "../../ai/runtime";
import type { CommandEnvelope } from "../../shared/net/types";
import { snapshotGame, type Game } from "../../shared/sim";
import { CommandFrameRuntime } from "../../shared/sim/command-frame-runtime";
import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../../shared/types";
import type { GameAdapter } from "../game-adapter";

export type LocalGameAdapterOptions = {
  now?: () => number;
  tickMs?: number;
  aiRuntime?: AiRuntimeState;
  // Where the AI thinks (see @@@think-thread); on this thread when absent.
  aiThinkExecutor?: AiThinkExecutorFactory;
  room?: RoomState;
  finishRoom?: (snapshot: GameSnapshot) => RoomState;
  onRoomEnded?: (room: RoomState) => void;
  onClose?: () => void;
};

export class LocalGameAdapter implements GameAdapter {
  private lastUpdate: number;
  private room: RoomState | undefined;
  private closed = false;
  private snapshot: GameSnapshot | undefined;
  private readonly frameRuntime: CommandFrameRuntime<AiRuntimeFramePlannerState>;
  private readonly thinkExecutor: AiThinkExecutor | undefined;
  private queued: CommandEnvelope[] = [];

  constructor(
    private readonly game: Game,
    private readonly playerId: PlayerId,
    private readonly options: LocalGameAdapterOptions = {},
  ) {
    this.lastUpdate = this.now();
    this.room = options.room;
    this.thinkExecutor = options.aiRuntime && options.aiThinkExecutor ? options.aiThinkExecutor(options.aiRuntime, game) : undefined;
    this.frameRuntime = new CommandFrameRuntime({
      game,
      roomId: this.room?.id ?? "local",
      rejectionLabel: "Local command rejected",
      ...(options.aiRuntime ? { aiPlanner: createPresetAiRuntimeFramePlanner(this.game, options.aiRuntime, this.thinkExecutor ? { executor: this.thinkExecutor } : {}) } : {}),
    });
  }

  // A player's command lands on the next tick, as a hosted room's lands on a later one; a rejection is reported now.
  sendCommand(command: GameCommand): void {
    if (this.closed) throw new Error('Local match is closed');
    const entry = { playerId: this.playerId, command };
    this.frameRuntime.admit([entry]);
    this.queued.push(entry);
  }

  currentSnapshot(): GameSnapshot {
    // This adapter owns simulation advances. Render frames between accepted
    // command frames share an immutable view instead of cloning the army again.
    return this.snapshot ??= snapshotGame(this.game);
  }

  updateToRenderTime(): boolean {
    if (this.closed) return false;
    const tickMs = this.options.tickMs ?? 50;
    const current = this.now();
    // A throttled/background tab is a pause, not a debt of thousands of ticks
    // to run synchronously before the mouse and the next paint can respond.
    this.lastUpdate = Math.max(this.lastUpdate, current - tickMs * 4);
    const started = performance.now();
    let changed = false;
    // A think still running on its thread never holds the match: it lands when it arrives (see @@@planner-schedule).
    while (!this.closed && current - this.lastUpdate >= tickMs && !this.game.match.winner) {
      this.applyAndStep(this.queued.splice(0));
      this.lastUpdate += tickMs;
      changed = true;
      if (performance.now() - started >= 8) break;
    }
    return changed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.thinkExecutor?.close?.();
    this.options.onClose?.();
  }

  private applyAndStep(commands: CommandEnvelope[]): void {
    this.snapshot = undefined;
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
