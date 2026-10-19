import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planBootstrapNaval } from './expedition-recovery';
import { bootstrapPolicyContext } from './policy';

const owner = 'enemy', boatId = 'unit-enemy-carrier-4436', riderId = 'unit-enemy-horseArcher-4852';

function crossing(second: 900 | 1291) {
  const saved: { snapshot: GameSnapshot; memory: AiPolicyMemory } = JSON.parse(readFileSync(
    new URL(`./fixtures/gull-ferry-guard-${second}.json`, import.meta.url), 'utf8'));
  const game = createGame('bareDuel', { aiPlayers: [] });
  restoreSnapshotIntoGame(game, saved.snapshot, 2_000_000);
  const commands = () => {
    const snapshot = snapshotGame(game);
    return planBootstrapNaval(snapshot, owner, bootstrapPolicyContext(snapshot, owner, 'v9_archer', {
      memory: saved.memory, teams: game.teams,
    }));
  };
  return { game, commands };
}

it('keeps the rider home while the 15:00 mirrored Gull Island snapshot still lacks enough defenders', () => {
  // The report's replays/gull-archer-side2/900.json: 34.6384 - 1.5 < 36.1804. Do not weaken this gate.
  const { game, commands } = crossing(900);
  expect(game.tick).toBe(18_000);
  expect(commands().some(command => command.type === 'board' && command.transportId === boatId)).toBe(false);
});

it('boards only the selected rider once the real home force can cover the threat', () => {
  // Continued from the same 15:00 snapshot with the SDK's real phases and 3-tick command delay. At 1291 seconds,
  // the report's sufficient-guard example is reproduced: 43.0465 - 1.5 >= 38.1029; main still counts only the rider.
  const { game, commands } = crossing(1291);
  expect(game.tick).toBe(25_820);
  const first = commands();
  expect(first.filter(command => command.type === 'board' && command.transportId === boatId)).toEqual([
    { type: 'board', unitIds: [riderId], transportId: boatId },
  ]);
  issueCommandFrame(game, first.map(command => ({ playerId: owner, scriptId: 'naval', command })));
  const rider = game.units.find(unit => unit.id === riderId)!;
  for (let tick = 0; tick < 200 && rider.deck?.shipId !== boatId; tick++) {
    stepGame(game);
    if (tick % 15 === 14) issueCommandFrame(game, commands().map(command => ({ playerId: owner, scriptId: 'naval', command })));
  }
  expect(rider.deck?.shipId).toBe(boatId);
  expect(game.units.filter(unit => unit.deck?.shipId === boatId).map(unit => unit.id)).toEqual([riderId]);
});
