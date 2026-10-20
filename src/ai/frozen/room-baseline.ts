import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandFrameEntry } from '../../sdk/commands/frame';
import type { BootstrapAiVersion, GameSnapshot, PlayerId } from '../../shared/types';
import manifestData from './room-baseline-646c/manifest.json';

export const ROOM_BASELINE_VERSION = 'room-baseline-646c';
export const ROOM_BASELINE_MANIFEST = manifestData;
export type RoomBaselineRequest = { playerId: PlayerId; version: BootstrapAiVersion; source?: string };
export type RoomBaselinePlanner = {
  plan(snapshot: GameSnapshot, request: RoomBaselineRequest): CommandFrameEntry[];
  /** An isolated copy for read-only diagnostics, not live policy memory. */
  memory(owner: PlayerId): unknown;
};
export type RoomBaselineModule = {
  sourceCommit: string;
  createRoomPlanner(initial?: Record<PlayerId, unknown>): RoomBaselinePlanner;
};

export function verifyBaselineBytes(bytes: Uint8Array, expected: { sha256: string; bytes: number }, label: string) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== expected.sha256 || bytes.length !== expected.bytes)
    throw new Error(`${label}: expected ${expected.sha256}/${expected.bytes} bytes, received ${hash}/${bytes.length}`);
}

/** Node/benchmark boundary only. A missing or corrupt artifact never falls back to live AI. */
export async function loadRoomBaseline(cache: string): Promise<RoomBaselineModule> {
  const artifact = ROOM_BASELINE_MANIFEST.artifact;
  const path = join(cache, artifact.sha256, 'planner.mjs');
  const bytes = await readFile(path);
  verifyBaselineBytes(bytes, artifact, path);
  // Import the verified bytes, not the path: replacing a cache file between check and import cannot execute other code.
  const executable = Buffer.concat([bytes, Buffer.from('\n//# sourceURL=room-baseline-646c.mjs\n')]);
  const module = await import(`data:text/javascript;base64,${executable.toString('base64')}`) as RoomBaselineModule;
  if (module.sourceCommit !== ROOM_BASELINE_MANIFEST.sourceCommit || typeof module.createRoomPlanner !== 'function')
    throw new Error('Frozen room planner has an incompatible interface or source commit');
  return module;
}
