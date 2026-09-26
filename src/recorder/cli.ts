import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseFixedCamera, parseSize, parseUnitSelector, positive } from "./options";
import { recordScene, type FrameSink } from "./record";
import type { CameraSpec, RecordingScene } from "./scene";
import { RECORDING_SCENES } from "./scenes";
import { gifSink, hasFfmpeg, mp4Sink, pngFramesSink } from "./sinks";

const USAGE = `Record a scene headlessly with the game's own renderer.

  npm run record -- --scene <name|path> [options]

  --scene <name|path>   a built-in scene (see --list) or a module exporting a RecordingScene
  --seconds <n>         length of the clip (scene default, else 20)
  --fps <n>             frames per second (scene default, else 20; the match runs 20 ticks a second)
  --size <WxH>          frame size in pixels (scene default, else 1280x720)
  --camera <x,y[,zoom]> fixed camera: the world point at the centre of the frame
  --follow <filter>     follow the centre of some units: all | owner=north | kind=raider|knight | id=<id>
                        (filters combine with commas; quote a | in the shell: 'kind=raider|knight')
  --zoom <z>            zoom for either camera (2 = twice as close)
  --lag <seconds>       how far a following camera trails its units (default 0.6; 0 = locked on)
  --out <file>          .gif or .mp4 (repeatable); default recordings/<scene>.gif (+ .mp4 when ffmpeg is on PATH)
  --gif-size <WxH>      scale the GIF to this size (the MP4 keeps --size)
  --frames <dir>        also write every frame as a PNG
  --locale <en|zh>      language of the few words drawn on the map (default en)
  --hide-orders         leave out the move/attack click markers that orders put on the ground
  --list                list the built-in scenes
`;

async function main(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      scene: { type: "string" },
      seconds: { type: "string" },
      fps: { type: "string" },
      size: { type: "string" },
      camera: { type: "string" },
      follow: { type: "string" },
      zoom: { type: "string" },
      lag: { type: "string" },
      out: { type: "string", multiple: true },
      "gif-size": { type: "string" },
      frames: { type: "string" },
      locale: { type: "string" },
      "hide-orders": { type: "boolean" },
      list: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return void process.stdout.write(USAGE);
  if (values.list) {
    for (const scene of Object.values(RECORDING_SCENES)) console.log(`${scene.name.padEnd(18)} ${scene.description ?? ""}`);
    return;
  }
  if (!values.scene) throw new Error(`--scene is required.\n\n${USAGE}`);

  const scene = await loadScene(values.scene);
  const defaults = scene.defaults ?? {};
  const size = values.size ? parseSize(values.size) : { width: defaults.width ?? 1280, height: defaults.height ?? 720 };
  const fps = values.fps ? positive(Number(values.fps), "--fps") : (defaults.fps ?? 20);
  const seconds = values.seconds ? positive(Number(values.seconds), "--seconds") : (defaults.seconds ?? 20);
  const locale = values.locale ?? "en";
  if (locale !== "en" && locale !== "zh") throw new Error(`--locale must be en or zh, got "${locale}"`);
  const camera = cameraFrom(values, defaults.camera);

  const outputs = values.out ?? [`recordings/${scene.name}.gif`, ...(hasFfmpeg() ? [`recordings/${scene.name}.mp4`] : [])];
  const gifSize = values["gif-size"] ? parseSize(values["gif-size"]) : undefined;
  const sinks: FrameSink[] = outputs.map((out) => {
    const extension = extname(out).toLowerCase();
    if (extension === ".gif") return gifSink(out, { fps, ...gifSize });
    if (extension === ".mp4") return mp4Sink(out, { fps });
    throw new Error(`--out ${out}: only .gif and .mp4 are supported`);
  });
  if (values.frames) sinks.push(pngFramesSink(values.frames));

  const started = Date.now();
  console.log(`Recording ${scene.name}: ${seconds}s at ${fps} fps, ${size.width}x${size.height}, camera ${JSON.stringify(camera)}`);
  const summary = await recordScene(scene, {
    seconds,
    fps,
    ...size,
    camera,
    locale,
    hideOrderMarkers: values["hide-orders"] ?? false,
    onProgress: (frame, total) => {
      if (frame % Math.max(1, Math.round(fps)) === 0 || frame === total) console.log(`  frame ${frame}/${total}`);
    },
  }, sinks);
  if (summary.endedAtTick !== undefined) console.log(`  the match was decided at tick ${summary.endedAtTick}; the clip stops there`);
  console.log(`Recorded ${summary.frames} frames (ticks ${summary.firstTick}-${summary.lastTick}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const out of [...outputs, ...(values.frames ? [values.frames] : [])]) {
    const path = resolve(out);
    const megabytes = statSync(path).isFile() ? statSync(path).size / 1024 / 1024 : undefined;
    console.log(`  ${path}${megabytes !== undefined ? ` (${megabytes.toFixed(2)} MB)` : ""}`);
    if (megabytes !== undefined && megabytes > 10 && extname(out).toLowerCase() === ".gif") {
      console.log("    a large GIF: --gif-size 640x360 (or a fixed camera) shrinks it; the .mp4 is far smaller");
    }
  }
}

function cameraFrom(values: { camera?: string | undefined; follow?: string | undefined; zoom?: string | undefined; lag?: string | undefined }, sceneCamera: CameraSpec | undefined): CameraSpec {
  if (values.camera && values.follow) throw new Error("Use either --camera or --follow, not both");
  let camera: CameraSpec = values.camera ? parseFixedCamera(values.camera) : values.follow ? { type: "follow", select: parseUnitSelector(values.follow) } : (sceneCamera ?? { type: "follow" });
  if (values.zoom) camera = { ...camera, zoom: positive(Number(values.zoom), "--zoom") };
  if (values.lag) {
    if (camera.type !== "follow") throw new Error("--lag only applies to a following camera");
    const lagSeconds = Number(values.lag);
    if (!Number.isFinite(lagSeconds) || lagSeconds < 0) throw new Error(`--lag must be zero or more seconds, got ${values.lag}`);
    camera = { ...camera, lagSeconds };
  }
  return camera;
}

async function loadScene(nameOrPath: string): Promise<RecordingScene> {
  const builtIn = RECORDING_SCENES[nameOrPath];
  if (builtIn) return builtIn;
  const path = resolve(nameOrPath);
  if (!existsSync(path)) throw new Error(`No built-in scene "${nameOrPath}" and no file at ${path}. Built-in scenes: ${Object.keys(RECORDING_SCENES).join(", ")}`);
  const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const scene = [module.default, ...Object.values(module)].find(isRecordingScene);
  if (!scene) throw new Error(`${path} exports no RecordingScene (an object with name and createGame)`);
  return scene;
}

function isRecordingScene(value: unknown): value is RecordingScene {
  return typeof value === "object" && value !== null && typeof (value as RecordingScene).name === "string" && typeof (value as RecordingScene).createGame === "function";
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
