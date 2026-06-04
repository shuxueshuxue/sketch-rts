import type { CommandFrame } from "./types";

export class CommandFrameBuffer {
  private frames = new Map<number, CommandFrame>();

  push(frame: CommandFrame): void {
    if (this.frames.has(frame.tick)) throw new Error(`CommandFrameBuffer already has frame for tick ${frame.tick}`);
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
}
