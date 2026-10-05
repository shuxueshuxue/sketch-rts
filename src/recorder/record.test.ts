import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recordScene, type FrameSink, type RecordOptions } from "./record";
import { cavalryFlank } from "./scenes/cavalry-flank";
import { infantryClash } from "./scenes/infantry-clash";
import { gifSink, hasFfmpeg, mp4Sink, pngFramesSink } from "./sinks";

const dir = mkdtempSync(join(tmpdir(), "sketch-rts-record-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SMALL: RecordOptions = { seconds: 1, fps: 10, width: 320, height: 180, camera: { type: "follow" } };

// The recorder reuses one canvas, so a sink that keeps frames must copy their pixels.
function collectFrames() {
  const frames: { index: number; tick: number; rgba: Uint8ClampedArray }[] = [];
  const sink: FrameSink = { write: (frame) => void frames.push({ index: frame.index, tick: frame.tick, rgba: frame.rgba.slice() }), finish() {} };
  return { frames, sink };
}

function distinctColours(rgba: Uint8ClampedArray) {
  const colours = new Set<number>();
  for (let offset = 0; offset < rgba.length; offset += 4) colours.add((rgba[offset]! << 16) | (rgba[offset + 1]! << 8) | rgba[offset + 2]!);
  return colours.size;
}

describe("headless recorder", () => {
  it("films a scene into a looping GIF, one frame per 1/fps of match time", async () => {
    const out = join(dir, "clash.gif");
    const { frames, sink } = collectFrames();
    const summary = await recordScene(infantryClash, SMALL, [gifSink(out, { fps: SMALL.fps }), sink]);

    expect(summary).toEqual({ frames: 10, firstTick: 0, lastTick: 18 });
    expect(frames.map((frame) => frame.tick)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    // A drawn battlefield, not a blank canvas, and the armies move between the first frame and the last.
    expect(distinctColours(frames[0]!.rgba)).toBeGreaterThan(200);
    expect(Buffer.from(frames[9]!.rgba).equals(Buffer.from(frames[0]!.rgba))).toBe(false);

    const gif = readFileSync(out);
    expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(gif.readUInt16LE(6)).toBe(320);
    expect(gif.readUInt16LE(8)).toBe(180);
    expect(gif.length).toBeGreaterThan(10_000);
  });

  it("films the same pixels every time: the match is deterministic and animation runs on match time", async () => {
    const first = collectFrames();
    const second = collectFrames();
    const options = { ...SMALL, seconds: 0.3 };
    await recordScene(cavalryFlank, options, [first.sink]);
    await recordScene(cavalryFlank, options, [second.sink]);
    expect(second.frames.map((frame) => Buffer.from(frame.rgba))).toEqual(first.frames.map((frame) => Buffer.from(frame.rgba)));
  });

  it("stores only what changed, so a still stretch of GIF costs next to nothing", async () => {
    // Far from the armies nothing moves: ten frames cost less than two whole ones (each later frame is little more
    // than its palette).
    const still = { ...SMALL, width: 640, height: 360, camera: { type: "fixed", x: 500, y: 500 } } as const;
    const one = join(dir, "still-1.gif");
    const ten = join(dir, "still-10.gif");
    await recordScene(infantryClash, { ...still, seconds: 0.1 }, [gifSink(one, { fps: SMALL.fps })]);
    await recordScene(infantryClash, still, [gifSink(ten, { fps: SMALL.fps })]);
    expect(readFileSync(ten).length).toBeLessThan(readFileSync(one).length * 2);
  });

  it("scales the GIF down and writes PNG frames on request", async () => {
    const out = join(dir, "small.gif");
    const framesDir = join(dir, "frames");
    await recordScene(infantryClash, { ...SMALL, seconds: 0.2 }, [gifSink(out, { fps: SMALL.fps, width: 160, height: 90 }), pngFramesSink(framesDir)]);

    const gif = readFileSync(out);
    expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([160, 90]);
    expect(readdirSync(framesDir).sort()).toEqual(["frame-00000.png", "frame-00001.png"]);
    expect(readFileSync(join(framesDir, "frame-00000.png")).subarray(1, 4).toString("latin1")).toBe("PNG");
  });

  it.skipIf(!hasFfmpeg())("encodes an MP4 through ffmpeg", async () => {
    const out = join(dir, "clash.mp4");
    await recordScene(infantryClash, { ...SMALL, seconds: 0.5 }, [mp4Sink(out, { fps: SMALL.fps })]);
    const mp4 = readFileSync(out);
    expect(mp4.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(mp4.length).toBeGreaterThan(1000);
  });

  it("fires a scene's scripted cue on its own tick only", () => {
    const game = cavalryFlank.createGame();
    game.tick = 59;
    expect(cavalryFlank.commands!(game)).toEqual([]);
    game.tick = 60;
    const cues = cavalryFlank.commands!(game);
    expect(cues).toHaveLength(8);
    expect(cues.every((cue) => cue.playerId === "north" && cue.command.type === "attack")).toBe(true);
  });
});
