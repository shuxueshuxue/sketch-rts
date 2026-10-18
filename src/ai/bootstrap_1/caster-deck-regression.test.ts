import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';

it.each(BOOTSTRAP_VERSIONS)('%s leaves the actual offshore priest to its naval owner without land escape planning', version => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/caster-deck-93870.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const caster = snapshot.units.find(unit => unit.id === 'unit-p0-priest-6018')!;
  expect(caster.deck?.shipId).toBe('unit-p0-bombardShip-6585');
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: frame.memories.p0 }, { teams: game.teams });
  expect(entries.some(entry => entry.scriptId === 'v6Backline' && 'unitIds' in entry.command && entry.command.unitIds.includes(caster.id))).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(before);
});
