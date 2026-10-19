import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapPolicyContext } from './policy';
import { casterMeleeMicro } from './caster-screen';

function boardedCaster() {
  // v5-final-1, v9_knight/v9, ladder-52 ember, tick 37447. Kept only the transport, its own ashHexer and an enemy
  // ashWarden boarding the same deck, plus the two halls. Both passenger positions are valid deck coordinates.
  const saved: GameSnapshot = JSON.parse(readFileSync(new URL('./fixtures/deck-caster.snapshot.json', import.meta.url), 'utf8'));
  const game = createGame('bareDuel', { aiPlayers: [] });
  restoreSnapshotIntoGame(game, saved, 1_000_000);
  const snapshot = snapshotGame(game);
  const caster = snapshot.units.find(unit => unit.kind === 'ashHexer')!;
  const boarder = snapshot.units.find(unit => unit.kind === 'ashWarden')!;
  return { game, snapshot, caster, boarder };
}

describe('caster land micro movement domain', () => {
  it('leaves a deck caster with a melee boarder to ship control instead of searching for a land escape', () => {
    const { game, snapshot, caster, boarder } = boardedCaster();
    expect(snapshot.units).toHaveLength(3);
    expect(caster.deck?.shipId).toBe(boarder.deck?.shipId);
    const context = bootstrapPolicyContext(snapshot, caster.owner, 'v9_knight', { memory: createAiPolicyMemory(), teams: game.teams });
    // Main throws in mountedEscape when every land candidate is rejected over water.
    expect(casterMeleeMicro(snapshot, caster.owner, context)(caster, [boarder])).toBeUndefined();
  });

  it('plans a complete room AI think from the minimal live snapshot without throwing', () => {
    const { game, snapshot, caster } = boardedCaster();
    expect(() => planAiOwnerCommandEntries(snapshot, {
      playerId: caster.owner, version: 'v9_knight', memory: createAiPolicyMemory(),
    }, { teams: game.teams })).not.toThrow();
  });
});
