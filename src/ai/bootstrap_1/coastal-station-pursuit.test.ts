import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { installedWeapons } from '../../shared/ship-equipment';
import { canReach } from '../../shared/naval';
import { shoreFiringStation } from '../../shared/shore-fire';
import type { GameSnapshot } from '../../shared/types';

function stalledBattery() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/battery-stalled-worker.json.gz', import.meta.url))).toString()) as { snapshot: GameSnapshot; nextId: number };
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return game;
}

it('resumes real coastal fire from the complete stalled 176400 world under an ordinary attack-move', () => {
  const game = stalledBattery(), shipId = 'unit-p0-bombardShip-26580';
  const ship = game.units.find(unit => unit.id === shipId)!, worker = game.units.find(unit => unit.id === 'unit-p1-worker-1019')!;
  const enemyHp = () => [...game.units, ...game.buildings].filter(entity => entity.owner === 'p1').reduce((sum, entity) => sum + entity.hp, 0);
  const initial = enemyHp();
  issuePlayerCommand(game, 'p0', { type: 'attackMove', unitIds: [shipId], x: worker.x, y: worker.y });
  let fired = false, restored: ReturnType<typeof createGame> | undefined;
  for (let i = 0; i < 1800; i++) {
    stepGame(game);
    fired ||= installedWeapons(game, ship).some(item => (item.cooldownRemaining ?? 0) > 0);
    if (i === 719) {
      const saved = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId }));
      restored = createGame('bareDuel');
      restoreSnapshotIntoGame(restored, saved.snapshot, saved.nextId);
    } else if (restored && i <= 899) {
      stepGame(restored);
      if (i === 899) {
        expect(JSON.parse(JSON.stringify(snapshotGame(restored)))).toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
        expect(restored.nextId).toBe(game.nextId);
        restored = undefined;
      }
    }
  }
  expect(fired).toBe(true);
  expect(enemyHp()).toBeLessThan(initial);
  expect(ship.hp).toBeGreaterThanOrEqual(276.1);
}, 120_000);


it('keeps the real inland town hall outside this battery’s current firing reach', () => {
  const game = stalledBattery(), ship = game.units.find(unit => unit.id === 'unit-p0-bombardShip-26580')!;
  const hall = game.buildings.find(building => building.id === 'building-p1-townhall')!;
  expect(canReach(game.map, ship, hall, game.units)).toBe(false);
  expect(shoreFiringStation(game, ship, hall)).toBeUndefined();
  issuePlayerCommand(game, 'p0', { type: 'attack', unitIds: [ship.id], targetId: hall.id });
  for (let i = 0; i < 20; i++) stepGame(game);
  expect(hall.hp).toBe(900);
  expect(installedWeapons(game, ship).every(item => (item.cooldownRemaining ?? 0) === 0)).toBe(true);
});
