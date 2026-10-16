import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import type { GameSnapshot, GameCommand } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { recoveryArrivalFilter } from './recovery-arrival';
import { THINK_TICKS } from './mounted-micro';

// Actual saved rules2 windows: summoner1079 at7905, archer-route footman1072
// at10425 and horseArcher4294 at16245. These test the native accidental-pursuit
// predicate, not damage safety, successful healing or full-match acceptance.
it.each([['7905', false], ['10425', true], ['16245', true]] as const)(
  'classifies actual %s arrival without changing full world/id/3policy inputs', (tick, allowed) => {
    const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/recovery-native-arrival-${tick}.json.gz`, import.meta.url))).toString()) as {
      snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>;
      patientId: string; queryGoal: Extract<GameCommand, { type: 'move' }>;
    };
    const game = createGame('bareDuel', { aiPlayers: [] });
    restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
    expect(JSON.parse(JSON.stringify(snapshotGame(game)))).toEqual(saved.snapshot);
    const snapshot = snapshotGame(game), patient = snapshot.units.find(unit => unit.id === saved.patientId)!;
    const before = JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId, memories: saved.memories });
    const accepts = recoveryArrivalFilter(snapshot, patient, THINK_TICKS);
    expect(accepts(saved.queryGoal)).toBe(allowed);
    expect(accepts(saved.queryGoal)).toBe(allowed);
    expect(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId, memories: saved.memories })).toBe(before);
  });
