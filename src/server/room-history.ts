import { createDebugReplayTrace, type DebugReplayTrace, type ReplayCommandFrame, type ReplayCommandSource } from "../shared/replay";
import type { SaveGameRecord } from "../shared/savegame";
import type { CheckpointFrame, CommandFrame } from "../shared/net/types";

export const DEFAULT_ROOM_FRAME_HISTORY_LIMIT = 240;

export type RoomHistoryLogOptions = {
  frameHistoryLimit?: number;
};

export class RoomHistoryLog {
  private frames: ReplayCommandFrame[] = [];
  private checkpoints: CheckpointFrame[] = [];
  private frameHistoryLimit: number;
  private retainFromTick?: number;

  constructor(options: RoomHistoryLogOptions = {}) {
    this.frameHistoryLimit = options.frameHistoryLimit ?? DEFAULT_ROOM_FRAME_HISTORY_LIMIT;
  }

  setFrameHistoryLimit(frameHistoryLimit: number) {
    this.frameHistoryLimit = frameHistoryLimit;
    this.trim();
  }

  retainFramesFrom(tick: number) {
    this.retainFromTick = this.retainFromTick === undefined ? tick : Math.min(this.retainFromTick, tick);
    this.trim();
  }

  recordCheckpoint(checkpoint: CheckpointFrame) {
    const stored = clone(checkpoint);
    const existing = this.checkpoints.findIndex((candidate) => candidate.tick === stored.tick);
    if (existing >= 0) this.checkpoints[existing] = stored;
    else this.checkpoints.push(stored);
    this.trim();
  }

  recordFrame(source: ReplayCommandSource, frame: CommandFrame) {
    this.frames.push({ ...clone(frame), source });
    this.trim();
  }

  checkpointAtOrBefore(tick: number): CheckpointFrame | undefined {
    const checkpoint = this.checkpoints.filter((candidate) => candidate.tick <= tick).sort((left, right) => right.tick - left.tick)[0];
    return checkpoint ? clone(checkpoint) : undefined;
  }

  framesFrom(tick: number): CommandFrame[] {
    return this.frames
      .filter((frame) => frame.tick >= tick)
      .map((frame) => {
        const { source: _source, ...commandFrame } = frame;
        return clone(commandFrame);
      });
  }

  debugReplayTrace(input: { id: string; label?: string; initialSave: SaveGameRecord }): DebugReplayTrace {
    const trace = createDebugReplayTrace(input);
    const initialTick = input.initialSave.snapshot.tick;
    trace.frames = this.frames.filter((frame) => frame.tick >= initialTick).map((frame) => clone(frame));
    trace.checkpoints = this.checkpoints
      .filter((checkpoint) => checkpoint.tick >= initialTick)
      .map((checkpoint) => ({ tick: checkpoint.tick, snapshot: clone(checkpoint.snapshot), nextId: checkpoint.nextId }));
    return trace;
  }

  private trim() {
    const retainedFloor = this.retainedFloor();
    if (retainedFloor !== undefined) this.frames = this.frames.filter((frame) => frame.tick >= retainedFloor);
    if (this.retainFromTick === undefined && this.frames.length > this.frameHistoryLimit) this.frames.splice(0, this.frames.length - this.frameHistoryLimit);
    const oldestFrameTick = this.frames[0]?.tick ?? Infinity;
    this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.tick >= oldestFrameTick || (this.retainFromTick !== undefined && checkpoint.tick >= this.retainFromTick));
  }

  private retainedFloor(): number | undefined {
    if (this.retainFromTick !== undefined) return this.retainFromTick;
    return undefined;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
