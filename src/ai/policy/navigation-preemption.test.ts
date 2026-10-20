import { expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import type { AiScript } from './types';
import { runAiCommandEntriesFromScripts } from './script-runner';
import { withNavigationIntent } from './navigation-intent';

it('lets an actual defense order interrupt only an executor that declares it, while ordinary attacks cannot steal that force', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  const unit = game.units.find(unit => unit.owner === 'player')!;
  const snapshot = snapshotGame(game);
  const original = { type: 'move' as const, unitIds: [unit.id], x: unit.x + 200, y: unit.y };
  const recalled = { type: 'move' as const, unitIds: [unit.id], x: unit.x - 200, y: unit.y };
  const run = (interruptible: boolean, defense: boolean) => {
    const scripts: AiScript[] = [
      { id: 'independent-prerequisite', phase: 'tactics', ...(interruptible ? { interruptibleBy: ['defense' as const] } : {}),
        claimsUnits: () => new Set([unit.id]), run: () => original },
      { id: 'other-plan', phase: 'tactics', run: () => defense
        ? withNavigationIntent({ ...recalled }, { arrivalRange: 0, station: false, purpose: 'defense' }) : { ...recalled } },
    ];
    return runAiCommandEntriesFromScripts(snapshot, 'player', scripts);
  };
  expect(run(true, true).at(-1)?.command).toEqual(recalled);
  expect(run(true, false)).toEqual([{ scriptId: 'independent-prerequisite', command: original }]);
  expect(run(false, true)).toEqual([{ scriptId: 'independent-prerequisite', command: original }]);
});
