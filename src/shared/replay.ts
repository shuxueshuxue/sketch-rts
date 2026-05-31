import { restoreGameFromSave, type SaveGameRecord } from "./savegame";
import { issuePlayerCommand, snapshotGame, stepGame, type Game } from "./sim";
import type { GameCommand, GameSnapshot, PlayerId } from "./types";

export const DEBUG_REPLAY_SCHEMA_VERSION = 1;

export type ReplayCommandSource = "browser" | "sdk-agent" | "internal-ai" | "test-harness";

export type ReplayCommandEnvelope = {
  playerId: PlayerId;
  command: GameCommand;
};

export type ReplayCommandBatch = {
  sequence: number;
  tick: number;
  source: ReplayCommandSource;
  commands: ReplayCommandEnvelope[];
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
  batches: ReplayCommandBatch[];
  checkpoints: DebugReplayCheckpoint[];
};

export function createDebugReplayTrace(input: { id: string; label?: string; initialSave: SaveGameRecord }): DebugReplayTrace {
  return {
    schemaVersion: DEBUG_REPLAY_SCHEMA_VERSION,
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    initialSave: clone(input.initialSave),
    batches: [],
    checkpoints: [],
  };
}

export function recordReplayBatch(trace: DebugReplayTrace, input: { tick: number; source: ReplayCommandSource; commands: ReplayCommandEnvelope[] }) {
  if (input.commands.length === 0) return;
  trace.batches.push({
    sequence: trace.batches.length,
    tick: input.tick,
    source: input.source,
    commands: clone(input.commands),
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
  const batches = [...trace.batches].sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
  let batchIndex = batches.findIndex((batch) => batch.tick >= game.tick);
  if (batchIndex < 0) batchIndex = batches.length;

  while (game.tick < targetTick) {
    while (batchIndex < batches.length && batches[batchIndex]!.tick === game.tick) {
      applyReplayBatch(game, batches[batchIndex]!);
      batchIndex += 1;
    }
    stepGame(game);
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

function applyReplayBatch(game: Game, batch: ReplayCommandBatch) {
  if (batch.tick < game.tick) throw new Error(`Replay batch ${batch.sequence} is behind current tick ${game.tick}`);
  if (batch.tick > game.tick) throw new Error(`Replay batch ${batch.sequence} skipped tick ${game.tick}`);
  for (const entry of batch.commands) issuePlayerCommand(game, entry.playerId, entry.command);
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
