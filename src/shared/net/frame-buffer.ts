import type { CommandFrame } from "./types";

export class CommandFrameBuffer {
  private frames = new Map<number, CommandFrame>();

  push(frame: CommandFrame): void {
    const existing = this.frames.get(frame.tick);
    if (existing) {
      if (sameFrame(existing, frame)) return;
      throw new Error(`CommandFrameBuffer already has frame for tick ${frame.tick}`);
    }
    this.frames.set(frame.tick, frame);
  }

  take(tick: number): CommandFrame | undefined {
    const frame = this.frames.get(tick);
    if (!frame) return undefined;
    this.frames.delete(tick);
    return frame;
  }

  has(tick: number): boolean {
    return this.frames.has(tick);
  }

  discardBefore(tick: number): void {
    for (const frameTick of this.frames.keys()) {
      if (frameTick < tick) this.frames.delete(frameTick);
    }
  }

  clear(): void {
    this.frames.clear();
  }
}

function sameFrame(left: CommandFrame, right: CommandFrame) {
  return JSON.stringify(left) === JSON.stringify(right);
}
