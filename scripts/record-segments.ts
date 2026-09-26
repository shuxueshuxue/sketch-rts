// Films a long story in pieces, side by side, and joins them without re-encoding. The story is deterministic, so each
// piece starts by running the story (undrawn) up to its own start (see the recorder's --from) and films exactly what a
// single long recording would have filmed there; ffmpeg's concat demuxer then joins the MP4s.
//
//   npx tsx scripts/record-segments.ts --scene ashen-march --segments 8 --out recordings/ashen-march.mp4 [--fps 30]
//     [--size 1280x720] [--locale zh]
//
// The story is first played through undrawn to learn where it ends.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { RECORDING_SCENES } from "../src/recorder/scenes";
import { SIM_TICKS_PER_SECOND } from "../src/shared/time";

const { values } = parseArgs({
  options: {
    scene: { type: "string" },
    segments: { type: "string" },
    out: { type: "string" },
    fps: { type: "string" },
    size: { type: "string" },
    locale: { type: "string" },
  },
});
const scene = RECORDING_SCENES[values.scene ?? ""];
if (!scene?.story) throw new Error(`--scene must name a story scene (one of ${Object.values(RECORDING_SCENES).filter((candidate) => candidate.story).map((candidate) => candidate.name).join(", ")})`);
const segments = Number(values.segments ?? 8);
const fps = Number(values.fps ?? 30);
const out = resolve(values.out ?? `recordings/${scene.name}.mp4`);
const parts = join(dirname(out), `${scene.name}-parts`);
mkdirSync(parts, { recursive: true });

const started = Date.now();
const driver = scene.story();
while (!driver.finished) driver.advance();
const length = driver.game.tick / SIM_TICKS_PER_SECOND;
// Whole seconds per piece, so every piece starts on a frame of the single long recording.
const piece = Math.ceil(length / segments);
console.log(`${scene.name} ends at ${length.toFixed(1)}s of match time; ${segments} pieces of ${piece}s (measured in ${((Date.now() - started) / 1000).toFixed(1)}s)`);

const files: string[] = [];
const runs = Array.from({ length: segments }, (_, index) => {
  const from = index * piece;
  const file = join(parts, `part-${String(index).padStart(2, "0")}.mp4`);
  files.push(file);
  const args = ["tsx", "src/recorder/cli.ts", "--scene", scene.name, "--from", String(from), "--seconds", String(index === segments - 1 ? piece + 60 : piece), "--fps", String(fps), "--hide-orders", "--locale", values.locale ?? "zh", "--out", file, ...(values.size ? ["--size", values.size] : [])];
  return new Promise<void>((done, fail) => {
    const child = spawn("npx", args, { stdio: ["ignore", "pipe", "inherit"] });
    let last = "";
    child.stdout.on("data", (data: Buffer) => {
      last = data.toString().trim().split("\n").pop() ?? last;
      if (/frame \d+0{3}\//.test(last)) console.log(`  piece ${index}: ${last.trim()}`);
    });
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`piece ${index} failed (${code}): ${last}`))));
  });
});
await Promise.all(runs);

const list = join(parts, "list.txt");
writeFileSync(list, files.map((file) => `file '${file}'`).join("\n"));
const joined = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
if (joined.status !== 0) throw new Error(`ffmpeg could not join the pieces (${joined.status})`);
console.log(`Recorded ${out} in ${((Date.now() - started) / 60000).toFixed(1)} min`);
