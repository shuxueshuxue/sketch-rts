import { expect, it } from 'vitest';
import { canReach } from './naval';
import { installedWeapons } from './ship-equipment';
import { shipCanAttackCoastTarget } from './ship-attack-station';
import { checksumGame } from './sim/checksum';
import { createGame, refreshUnitStats } from './sim';

function coast() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.resources = [];
  game.map = { ...game.map, width: 4000, height: 4000,
    terrain: { cell: 40, cols: 100, rows: 100, cells: ('.'.repeat(25) + '~'.repeat(75)).repeat(100) } };
  const ship = game.spawnUnit('player', 'warship', 1320, 1200);
  ship.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
  const target = game.spawnUnit('neutral', 'deepSnapper', 725, 1200);
  return { game, ship, target };
}
it('rejects a point-reachable inland target without changing saved state or navigation admission', () => {
  const { game, ship, target } = coast();
  ship.sailing!.planningRequestedAtTick = 19;
  ship.sailing!.planningLastRequestedAtTick = 23;
  expect(canReach(game.map, ship, target, game.units)).toBe(true);
  const before = checksumGame(game), motion = JSON.stringify(ship.sailing);
  for (let count = 0; count < 5; count++) expect(shipCanAttackCoastTarget(game, ship, target)).toBe(false);
  expect(checksumGame(game)).toBe(before);
  expect(JSON.stringify(ship.sailing)).toBe(motion);
});
it('rechecks target movement and the working fitted weapon instead of caching one verdict per target or hull', () => {
  const { game, ship, target } = coast();
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(false);
  target.x = 950;
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(true);
  target.x = 725;
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(false);
  const gun = installedWeapons(game, ship)[0]!;
  gun.kind = 'shipMortar'; refreshUnitStats(game, ship);
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(true);
  gun.kind = 'shipCannon'; refreshUnitStats(game, ship);
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(false);
});
it('invalidates terrain answers after the coastline changes and leaves sea targets to ordinary pursuit', () => {
  const { game, ship, target } = coast();
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(false);
  game.map.terrain!.cells = '~'.repeat(10000);
  expect(shipCanAttackCoastTarget(game, ship, target)).toBe(true);
  const enemy = game.spawnUnit('enemy', 'transport', 1600, 1200);
  expect(shipCanAttackCoastTarget(game, ship, enemy)).toBe(true);
});
