import { restoreGameFromSave, type SaveGameRecord } from "./savegame";
import { snapshotGame, type Game } from "./sim";
import { advanceCommandFrameTick } from "./sim/command-frame-runtime";
import type { CommandEnvelope, CommandFrame } from "./net/types";
import type { GameCommand, GameSnapshot, PlayerId } from "./types";

export const DEBUG_REPLAY_SCHEMA_VERSION = 1;

export type ReplayCommandSource = "browser" | "sdk-agent" | "internal-ai" | "test-harness";

export type ReplayCommandEnvelope = CommandEnvelope;

export type ReplayCommandFrame = CommandFrame & {
  source: ReplayCommandSource;
};

export type DebugReplayCheckpoint = {
  tick: number;
  snapshot: GameSnapshot;
  nextId?: number;
};

export type DebugReplayTrace = {
  schemaVersion: typeof DEBUG_REPLAY_SCHEMA_VERSION;
  id: string;
  label?: string;
  initialSave: SaveGameRecord;
  frames: ReplayCommandFrame[];
  checkpoints: DebugReplayCheckpoint[];
};

export function createDebugReplayTrace(input: { id: string; label?: string; initialSave: SaveGameRecord }): DebugReplayTrace {
  return {
    schemaVersion: DEBUG_REPLAY_SCHEMA_VERSION,
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    initialSave: clone(input.initialSave),
    frames: [],
    checkpoints: [],
  };
}

export function recordReplayFrame(trace: DebugReplayTrace, input: { source: ReplayCommandSource; frame: CommandFrame }) {
  if (input.frame.commands.length === 0) return;
  trace.frames.push({
    ...clone(input.frame),
    source: input.source,
  });
}

export function recordReplayCheckpoint(trace: DebugReplayTrace, game: Game) {
  const checkpoint = { tick: game.tick, snapshot: snapshotGame(game), nextId: game.nextId };
  const existing = trace.checkpoints.findIndex((candidate) => candidate.tick === game.tick);
  if (existing >= 0) trace.checkpoints[existing] = checkpoint;
  else trace.checkpoints.push(checkpoint);
}

export function replayTraceToTick(trace: DebugReplayTrace, targetTick: number): Game {
  if (trace.schemaVersion !== DEBUG_REPLAY_SCHEMA_VERSION) throw new Error(`Unsupported debug replay schema ${trace.schemaVersion}`);
  if (!Number.isInteger(targetTick) || targetTick < trace.initialSave.snapshot.tick) throw new Error(`Invalid replay target tick ${targetTick}`);
  const checkpoint = nearestCheckpoint(trace, targetTick);
  const game = checkpoint ? restoreCheckpoint(trace, checkpoint) : restoreGameFromSave(trace.initialSave);
  const frames = [...trace.frames].sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
  let frameIndex = frames.findIndex((frame) => frame.tick >= game.tick);
  if (frameIndex < 0) frameIndex = frames.length;

  while (game.tick < targetTick) {
    const framesForTick: ReplayCommandFrame[] = [];
    while (frameIndex < frames.length && frames[frameIndex]!.tick === game.tick) {
      framesForTick.push(frames[frameIndex]!);
      frameIndex += 1;
    }
    advanceCommandFrameTick(game, framesForTick);
  }

  return game;
}

export function replaySnapshotToTick(trace: DebugReplayTrace, targetTick: number): GameSnapshot {
  return snapshotGame(replayTraceToTick(trace, targetTick));
}

export function extractReplayFrameSave(trace: DebugReplayTrace, targetTick: number, input: { id: string; label?: string }): SaveGameRecord {
  const game = replayTraceToTick(trace, targetTick);
  return {
    ...clone(trace.initialSave),
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    snapshot: snapshotGame(game),
    runtime: {
      ...clone(trace.initialSave.runtime),
      nextId: game.nextId,
    },
  };
}

function nearestCheckpoint(trace: DebugReplayTrace, targetTick: number) {
  return trace.checkpoints
    .filter((checkpoint) => checkpoint.tick <= targetTick && checkpoint.tick >= trace.initialSave.snapshot.tick)
    .sort((a, b) => b.tick - a.tick)[0];
}

function restoreCheckpoint(trace: DebugReplayTrace, checkpoint: DebugReplayCheckpoint) {
  return restoreGameFromSave({
    ...clone(trace.initialSave),
    snapshot: clone(checkpoint.snapshot),
    runtime: {
      ...clone(trace.initialSave.runtime),
      nextId: checkpoint.nextId ?? trace.initialSave.runtime.nextId,
    },
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
