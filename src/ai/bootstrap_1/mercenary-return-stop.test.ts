import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, issuePlayerCommand, stepGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';

it.each(BOOTSTRAP_VERSIONS)('%s preserves a hired medic return instead of stopping to provoke the neutral', version => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/mercenary-return-knight-2970.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const id = 'unit-p0-fieldMedic-1073';
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory: saved.memories.p0 }, { teams: game.teams });
  expect(entries.filter(e => e.command.type === 'stop' && e.command.unitIds.includes(id))).toEqual([]);
  for (const e of entries) issuePlayerCommand(game, 'p0', e.command);
  for (let i = 0; i < 45; i++) stepGame(game);
  const medic = game.units.find(u => u.id === id)!;
  expect(medic.hp).toBe(105);
  expect(medic.order.type).toBe('move');
  expect(game.units.find(u => u.id === 'creep-gen-2-1')!.hp).toBe(380);
});
