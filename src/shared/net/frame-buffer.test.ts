import { describe, expect, it } from "vitest";
import { CommandFrameBuffer } from "./frame-buffer";
import type { CommandFrame } from "./types";

describe("command frame buffer", () => {
  it("stores frames by tick and drains them in simulation order", () => {
    const buffer = new CommandFrameBuffer();
    const frame2 = frame(2);
    const frame1 = frame(1);

    buffer.push(frame2);
    buffer.push(frame1);

    expect(buffer.take(0)).toBeUndefined();
    expect(buffer.take(1)).toEqual(frame1);
    expect(buffer.take(2)).toEqual(frame2);
    expect(buffer.take(2)).toBeUndefined();
  });

  it("fails loudly when two frames target the same tick", () => {
    const buffer = new CommandFrameBuffer();
    buffer.push(frame(4));

    expect(() => buffer.push(frame(4))).toThrow(/already has frame for tick 4/);
  });

  it("discards frames older than a restored checkpoint tick", () => {
    const buffer = new CommandFrameBuffer();
    buffer.push(frame(2));
    buffer.push(frame(5));
    buffer.push(frame(8));

    buffer.discardBefore(5);

    expect(buffer.take(2)).toBeUndefined();
    expect(buffer.take(5)).toEqual(frame(5));
    expect(buffer.take(8)).toEqual(frame(8));
  });
});

function frame(tick: number): CommandFrame {
  return { roomId: "room-1", tick, sequence: tick, commands: [] };
}
