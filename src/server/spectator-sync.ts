import type { CheckpointFrame, CommandFrame } from "../shared/net/types";

export const DEFAULT_SPECTATOR_FRAME_HISTORY_LIMIT = 240;

export type SpectatorSyncLogOptions = {
  frameHistoryLimit?: number;
};

export class SpectatorSyncLog {
  private frames: CommandFrame[] = [];
  private checkpoints: CheckpointFrame[] = [];
  private readonly frameHistoryLimit: number;

  constructor(options: SpectatorSyncLogOptions = {}) {
    this.frameHistoryLimit = options.frameHistoryLimit ?? DEFAULT_SPECTATOR_FRAME_HISTORY_LIMIT;
  }

  recordCheckpoint(checkpoint: CheckpointFrame): void {
    if (!this.checkpoints.some((candidate) => candidate.tick === checkpoint.tick)) this.checkpoints.push(checkpoint);
    this.trim();
  }

  recordFrame(frame: CommandFrame): void {
    this.frames.push(frame);
    this.trim();
  }

  checkpointAtOrBefore(tick: number): CheckpointFrame | undefined {
    return this.checkpoints.filter((checkpoint) => checkpoint.tick <= tick).sort((left, right) => right.tick - left.tick)[0];
  }

  framesFrom(tick: number): CommandFrame[] {
    return this.frames.filter((frame) => frame.tick >= tick);
  }

  private trim(): void {
    if (this.frames.length > this.frameHistoryLimit) this.frames.splice(0, this.frames.length - this.frameHistoryLimit);
    const oldestFrameTick = this.frames[0]?.tick ?? Infinity;
    this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.tick >= oldestFrameTick);
  }
}
