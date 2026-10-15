import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { installedWeapons, SHIP_WEAPONS, shipNeedsRepair, shipPartMax } from '../../shared/ship-equipment';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround } from '../../shared/terrain';
import { navalServices } from '../policy/naval-services';
import { bootstrapPolicyContext } from './policy';

const versions = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
function field() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-repair-berth.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, memory: saved.memory };
}

it.each(versions)('%s uses an idle depleted-harbor worker to finish actual fleet maintenance', version => {
  const { game, memory } = field();
  const ship = game.units.find(unit => unit.id === 'unit-p0-warship-1100')!;
  const worker = game.units.find(unit => unit.id === 'unit-p0-worker-1')!;
  const initialHp = ship.hp, initialGold = game.players.p0!.gold;
  expect(worker.deck).toBeUndefined();
  expect(worker.order.type).toBe('idle');
  expect(shipNeedsRepair(game, ship)).toBe(true);
  let boarded = false;
  for (let tick = 0; tick < 900 && shipNeedsRepair(game, ship); tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game);
      const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
      const services = navalServices(snapshot, 'p0', options);
      if (worker.deck?.shipId === ship.id) {
        // A service engineer finishes this hull before a nearby damaged
        // ferry can commandeer the worker at the former 75% threshold.
        expect(services.commands.some(command => command.type === 'board' && command.unitIds.includes(worker.id))).toBe(false);
      }
      for (const command of services.commands) issuePlayerCommand(game, 'p0', command);
    }
    stepGame(game);
    boarded ||= worker.deck?.shipId === ship.id;
  }
  expect(boarded).toBe(true);
  expect(ship.hp).toBe(ship.maxHp);
  expect(ship.hp).toBeGreaterThan(initialHp);
  expect(ship.shipParts).toEqual(shipPartMax(ship));
  expect(installedWeapons(game, ship)[0]!.durability).toBe(SHIP_WEAPONS.shipCannon.hp);
  expect(shipNeedsRepair(game, ship)).toBe(false);
  expect(initialGold - game.players.p0!.gold).toBe(59);
  // The same engineer becomes available to the next real repair task.
  const snapshot = snapshotGame(game);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
  expect(navalServices(snapshot, 'p0', options).commands).toContainEqual({
    type: 'board', unitIds: [worker.id], transportId: 'unit-p0-carrier-40005',
  });
}, 60000);

it.each(['mining-island', 'builder', 'other-order'] as const)('preserves the harbor worker assigned to %s', role => {
  const { game, memory } = field();
  const worker = game.units.find(unit => unit.id === 'unit-p0-worker-1')!;
  if (role === 'mining-island') {
    const mine = game.resources.find(mine => sameGround(game.map, worker, mine))!;
    mine.amount = 100;
  } else if (role === 'builder') memory.unitClaims[worker.id] = {
    kind: 'build', targetId: 'paid-project', x: worker.x, y: worker.y,
    sinceTick: game.tick, expiresTick: game.tick + 300,
  };
  else worker.order = { type: 'move', x: worker.x + 100, y: worker.y };
  const snapshot = snapshotGame(game);
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory, teams: game.teams });
  expect(navalServices(snapshot, 'p0', options).commands.some(command =>
    command.type === 'board' && command.unitIds.includes(worker.id))).toBe(false);
});
