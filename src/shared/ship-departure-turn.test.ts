import { expect, it } from 'vitest';
import { SdkCommandFrameRuntime } from '../sdk/commands/frame';
import { createGame, stepGame } from './sim';
import { hullFits } from './ship-navigation';
import { distanceToHull } from './ship-geometry';
import { BOARDING_GAP } from './naval';
import { UNIT_DEFS } from './catalog';
import { seconds } from './time';
import { setBuildingBodies } from './terrain';
import { poolMap } from './map-pool';

it.each([false, true])('a transport turns before translating into its coastal boarding berth (mirror=%s)', mirror => {
  const players = Array.from({ length: poolMap('sapphireArchipelago')!.players }, (_, index) => `p${index}`);
  const game = createGame('sapphireArchipelago', { players, aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.scriptedVictory = true;
  // Reproduce the ordinary generated weather at the saved world's elapsed time.
  for (let tick = 0; tick < 18000; tick++) stepGame(game);
  const width = game.map.width, terrain = game.map.terrain!;
  if (mirror) {
    terrain.cells = Array.from({ length: terrain.rows }, (_, row) =>
      terrain.cells.slice(row * terrain.cols, (row + 1) * terrain.cols).split('').reverse().join('')).join('');
    game.map.wind!.direction = Math.PI - game.map.wind!.direction;
    game.map.wind!.fromDirection = Math.PI - game.map.wind!.fromDirection!;
  }
  setBuildingBodies(game.map, []);
  const x = (value: number) => mirror ? width - value : value;
  const boat = game.spawnUnit('p0', 'transport', x(6128), 2672);
  boat.sailing!.heading = mirror ? Math.PI + Math.PI / 180 : -Math.PI / 180;
  const shore = { x: x(6096), y: 2960 };
  const sdk = new SdkCommandFrameRuntime(game);
  sdk.issue([{ playerId: 'p0', scriptId: 'boarding-approach',
    command: { type: 'move', unitIds: [boat.id], ...shore, avoidCombat: true } }], {}, { checksum: false });
  const initialGap = distanceToHull(boat, shore);
  expect(initialGap).toBeGreaterThan(200);
  let fits = true;
  for (let tick = 0; tick < seconds(60); tick++) {
    stepGame(game);
    fits &&= hullFits(game.map, boat);
  }
  expect(distanceToHull(boat, shore), JSON.stringify({ x: boat.x, y: boat.y, order: boat.order })).toBeLessThanOrEqual(UNIT_DEFS.worker.radius + BOARDING_GAP);
  expect(boat.order.type).toBe('idle');
  expect(fits).toBe(true);
  expect(game.match.stats.unitsLost.p0).toBe(0);
});
