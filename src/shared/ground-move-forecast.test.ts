import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issueCommandFrame } from '../sdk/commands/frame';
import { groundMoveForecast } from './route-selection';
import { setBuildingBodies } from './terrain';
import { stepGame } from './sim';

const cases = [false, true].flatMap(mirror => ['mixed', 'arrival'].map(profile => ({ mirror, profile })));
it.each(cases)('forecasts a real worker move including $profile terrain and arrival (mirror=$mirror)', ({ mirror, profile }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('ground-move-forecast').map('bareDuel').replaceDefaults()
    .player('us').player('foe').townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .worker('us', x(48), 800, { id: 'mover' }).build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return profile === 'mixed' ? col === 1 ? ',' : col === 2 ? 'm' : '.' : '.';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  const mover = game.units.find(unit => unit.id === 'mover')!, goal = { x: x(profile === 'mixed' ? 192 : 73), y: 800 };
  const forecast = groundMoveForecast(game.map, mover, goal, mover.speed, 15);
  issueCommandFrame(game, [{ playerId: 'us', scriptId: 'forecast-proof', command: { type: 'move', unitIds: [mover.id], ...goal } }]);
  for (let tick = 0; tick < 15; tick++) stepGame(game);
  const error = Math.hypot(mover.x - forecast.x, mover.y - forecast.y);
  console.log(JSON.stringify({ mirror, profile, forecast, actual: { x: mover.x, y: mover.y }, error }));
  expect(error).toBeLessThan(mover.speed / 20);
  expect(mover.hp).toBe(mover.maxHp);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  if (profile === 'arrival') expect(mover.order.type).toBe('idle');
});
