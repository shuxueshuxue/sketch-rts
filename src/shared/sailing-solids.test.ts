import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issueCommandFrame } from '../sdk/commands/frame';
import { stepGame } from './sim';
import { hullFits } from './ship-navigation';

it.each([false, true])('sails around its shipyard instead of repeatedly turning into it (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('shipyard-departure').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' })
    .building('us', 'shipyard', x(1808), 1008, { id: 'yard' })
    .unit('us', 'warship', x(1663.2867517605555), 1113.034186117241, { id: 'boat' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) };
  const boat = game.units.find(unit => unit.id === 'boat')!;
  boat.sailing = { heading: mirror ? Math.PI - 2.6460410782813333 : 2.6460410782813333, speed: 0, load: 0, balance: 0 };
  const start = { x: boat.x, y: boat.y };
  issueCommandFrame(game, [{ playerId: 'us', scriptId: 'departure', command: { type: 'move', unitIds: [boat.id], x: x(700), y: 1700, avoidCombat: true } }]);
  for (let tick = 0; tick < 900; tick++) {
    stepGame(game);
    expect(hullFits(game.map, boat)).toBe(true);
  }
  expect(Math.hypot(boat.x - start.x, boat.y - start.y)).toBeGreaterThan(800);
  expect(boat.hp).toBe(boat.maxHp);
  expect(game.buildings.find(building => building.id === 'yard')!.hp).toBe(600);
});
