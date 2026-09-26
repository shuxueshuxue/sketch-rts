import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type gifenc from "gifenc";
import type { FrameSink, RecordedFrame } from "./record";

// gifenc ships CommonJS plus an ESM build with a different default export; require() gives the same object everywhere.
const { GIFEncoder, applyPalette, quantize } = createRequire(import.meta.url)("gifenc") as typeof gifenc;

/**
 * An animated GIF that loops forever. Each frame gets its own palette, and after the first only the pixels that changed
 * are stored; the rest are transparent over the frame before, so a still camera costs little. `width`/`height` scale
 * the GIF from the recorded size, which keeps long clips small enough to share.
 */
export function gifSink(path: string, options: { fps: number; width?: number; height?: number }): FrameSink {
  const gif = GIFEncoder();
  const delay = Math.round(1000 / options.fps);
  const resized = options.width !== undefined && options.height !== undefined ? createCanvas(options.width, options.height) : undefined;
  let previous: Uint8ClampedArray | undefined;
  return {
    write(frame) {
      const { rgba, width, height } = resized ? resize(frame, resized) : frame;
      if (!previous) {
        const palette = quantize(rgba, 256);
        gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
      } else {
        // One palette slot stays free for "unchanged".
        const palette = quantize(rgba, 255);
        const index = applyPalette(rgba, palette);
        const unchanged = palette.length;
        for (let pixel = 0, offset = 0; pixel < index.length; pixel += 1, offset += 4) {
          if (rgba[offset] === previous[offset] && rgba[offset + 1] === previous[offset + 1] && rgba[offset + 2] === previous[offset + 2]) index[pixel] = unchanged;
        }
        gif.writeFrame(index, width, height, { palette: [...palette, [0, 0, 0]], delay, transparent: true, transparentIndex: unchanged, dispose: 1 });
      }
      previous = rgba.slice();
    },
    finish() {
      gif.finish();
      writeOutput(path, gif.bytes());
    },
  };
}

function resize(frame: RecordedFrame, target: Canvas) {
  const ctx = target.getContext("2d");
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(frame.canvas, 0, 0, target.width, target.height);
  return { rgba: ctx.getImageData(0, 0, target.width, target.height).data, width: target.width, height: target.height };
}

export function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

/** An H.264 MP4 encoded by the ffmpeg on PATH, fed raw frames through a pipe. */
export function mp4Sink(path: string, options: { fps: number }): FrameSink {
  let encoder: ReturnType<typeof startFfmpeg> | undefined;
  return {
    async write(frame) {
      encoder ??= startFfmpeg(path, frame.width, frame.height, options.fps);
      const chunk = Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength);
      if (!encoder.child.stdin.write(chunk)) await Promise.race([once(encoder.child.stdin, "drain"), encoder.exit]);
    },
    async finish() {
      if (!encoder) throw new Error(`No frames were recorded for ${path}`);
      encoder.child.stdin.end();
      const code = await encoder.exit;
      if (code !== 0) throw new Error(`ffmpeg exited with ${code} writing ${path}:\n${encoder.stderr().slice(-2000)}`);
    },
  };
}

function startFfmpeg(path: string, width: number, height: number, fps: number) {
  mkdirSync(dirname(path), { recursive: true });
  const args = [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-",
    // yuv420p needs even sides; pad an odd size by one pixel instead of failing.
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    path,
  ];
  const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
  const exit = new Promise<number>((resolve, reject) => {
    child.on("error", (error) => reject(new Error(`Could not start ffmpeg for ${path}: ${error.message}`)));
    child.on("close", (code) => resolve(code ?? -1));
  });
  // A write after ffmpeg died surfaces as EPIPE; the exit code and stderr carry the real reason.
  child.stdin.on("error", () => undefined);
  return { child, exit, stderr: () => stderr };
}

/** Every frame as a numbered PNG, for stepping through a clip or picking a still. */
export function pngFramesSink(dir: string): FrameSink {
  mkdirSync(dir, { recursive: true });
  return {
    write(frame) {
      writeFileSync(join(dir, `frame-${String(frame.index).padStart(5, "0")}.png`), frame.canvas.toBuffer("image/png"));
    },
    finish() {},
  };
}

function writeOutput(path: string, bytes: Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
