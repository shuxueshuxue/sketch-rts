import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "../ai/runtime";
import { setScratchCanvasFactory } from "../client/art/scratch-canvas";
import { PAPER_BASE } from "../client/atlas-art";
import { createI18n, type Locale } from "../client/i18n";
import { UnitFacingTracker } from "../client/unit-facing";
import { UnitMotionSmoother } from "../client/unit-motion";
import { drawWorld, trackUnitFacing, worldLabelsFor } from "../client/world-renderer";
import { snapshotGame } from "../shared/sim";
import { CommandFrameRuntime } from "../shared/sim/command-frame-runtime";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, WorldEffect } from "../shared/types";
import { RecorderCamera } from "./camera";
import type { CameraSpec, RecordingScene } from "./scene";

export type RecordOptions = {
  seconds: number;
  fps: number;
  width: number;
  height: number;
  camera: CameraSpec;
  locale?: Locale;
  /** Drop the click feedback (move rings, attack-target marks) that orders leave on the ground. */
  hideOrderMarkers?: boolean;
  onProgress?: (frame: number, totalFrames: number) => void;
};

export type RecordedFrame = {
  index: number;
  tick: number;
  width: number;
  height: number;
  canvas: Canvas;
  /** The frame's pixels, straight (not premultiplied) RGBA. */
  rgba: Uint8ClampedArray;
};

export type FrameSink = {
  write: (frame: RecordedFrame) => void | Promise<void>;
  finish: () => void | Promise<void>;
};

export type RecordingSummary = {
  frames: number;
  firstTick: number;
  lastTick: number;
  /** Set when the match was decided before the requested length ran out; the recording stops there. */
  endedAtTick?: number;
};

export const ORDER_MARKER_EFFECTS: ReadonlySet<WorldEffect["type"]> = new Set([
  "move",
  "queuedMove",
  "mine",
  "queuedMine",
  "queuedRepair",
  "attack",
  "queuedAttack",
  "attackTarget",
  "queuedAttackTarget",
]);

/** Lets the client's painters cache sprites without a document. */
export function installHeadlessCanvas() {
  setScratchCanvasFactory((width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement);
}

/**
 * Runs the scene's match tick by tick and films it: frame `i` shows the match as it stands at `i / fps` seconds,
 * drawn by the client's own world renderer, and every sink receives every frame in order.
 */
export async function recordScene(scene: RecordingScene, options: RecordOptions, sinks: FrameSink[]): Promise<RecordingSummary> {
  installHeadlessCanvas();
  const game = scene.createGame();
  const runtime = new CommandFrameRuntime({
    game,
    roomId: `recording-${scene.name}`,
    rejectionLabel: `Recording ${scene.name}: command rejected`,
    ...(scene.ai ? { aiPlanner: createPresetAiRuntimeFramePlanner(game, createAiRuntime(scene.ai.players, scene.ai.version ? { version: scene.ai.version } : {})) } : {}),
  });
  const facing = new UnitFacingTracker();
  trackUnitFacing(facing, game);
  // Charging riders glide between ticks by the frame clock, as in the client (see unit-motion).
  const motion = new UnitMotionSmoother();
  const canvas = createCanvas(options.width, options.height);
  const ctx = canvas.getContext("2d");
  const camera = new RecorderCamera(options.camera, options);
  const labels = worldLabelsFor(createI18n(options.locale ?? "en"));
  const totalFrames = Math.max(1, Math.round(options.seconds * options.fps));
  const firstTick = game.tick;
  let frames = 0;
  let endedAtTick: number | undefined;

  for (let index = 0; index < totalFrames; index += 1) {
    const wantedTick = firstTick + Math.floor((index * SIM_TICKS_PER_SECOND) / options.fps);
    // The client turns units by watching every tick, so the recorder does too, not only the ticks it draws.
    while (game.tick < wantedTick && !game.match.winner) {
      runtime.tick(scene.commands?.(game) ?? []);
      trackUnitFacing(facing, game);
    }
    if (game.tick < wantedTick) {
      endedAtTick = game.tick;
      break;
    }
    const snapshot = visibleSnapshot(snapshotGame(game), options);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // At a fractional zoom the paper tiles' edges blend with whatever lies beneath them; paper colour hides the joins.
    ctx.fillStyle = PAPER_BASE;
    ctx.fillRect(0, 0, options.width, options.height);
    drawWorld({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      snapshot,
      view: camera.view(snapshot, index === 0 ? 0 : 1 / options.fps),
      now: (index * 1000) / options.fps,
      facing,
      labels,
      motion,
    });
    const frame: RecordedFrame = {
      index,
      tick: game.tick,
      width: options.width,
      height: options.height,
      canvas,
      rgba: ctx.getImageData(0, 0, options.width, options.height).data,
    };
    for (const sink of sinks) await sink.write(frame);
    frames += 1;
    options.onProgress?.(frames, totalFrames);
  }
  for (const sink of sinks) await sink.finish();
  return { frames, firstTick, lastTick: game.tick, ...(endedAtTick !== undefined ? { endedAtTick } : {}) };
}

function visibleSnapshot(snapshot: GameSnapshot, options: RecordOptions): GameSnapshot {
  if (!options.hideOrderMarkers) return snapshot;
  return { ...snapshot, effects: snapshot.effects.filter((effect) => !ORDER_MARKER_EFFECTS.has(effect.type)) };
}
