import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { canBoard } from '../../shared/decks';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { clearTransferLanes } from './transfer-lanes';

it('clears the occupied receiving floor before the real queued worker crosses', () => {
  // Actual loading-escort-only changed-code history at62400; complete input
  // belongs to e988bcc6/029b2eac evidence, rather than an ordinary0 checkpoint.
  const input = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/transfer-worker-blocked-62400.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, input.snapshot, input.nextId);
  const worker = game.units.find(unit => unit.id === 'unit-p0-worker-1851')!;
  const cutter = game.units.find(unit => unit.id === 'unit-p0-cutter-1139')!;
  const witch = game.units.find(unit => unit.id === 'unit-p0-witch-2089')!;
  expect(worker.order).toMatchObject({ type: 'follow', targetId: 'unit-p0-warship-1935' });
  expect(worker.orderQueue).toContainEqual({ type: 'board', transportId: cutter.id });
  expect(canBoard(cutter, worker, game.units)).toBe(false);

  for (let tick = 0; tick < 60; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
      const commands = clearTransferLanes(snapshot, 'p0');
      expect(JSON.stringify(snapshot)).toBe(before);
      for (const command of commands) issuePlayerCommand(game, 'p0', command);
    }
    stepGame(game);
  }
  expect(worker.deck?.shipId).toBe(cutter.id);
  expect(witch.deck?.shipId).toBe(cutter.id);
  expect(worker.hp).toBe(70);
  expect(witch.hp).toBe(133);
});
