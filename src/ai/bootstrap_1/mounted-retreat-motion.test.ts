import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { mountedMicro, mountedTargetOrder, THINK_TICKS } from './mounted-micro';

it.each([false, true])('keeps an exposed rider moving out of a cliff corner (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('mounted-retreat-motion').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe')
    .townHall('us', x(500), 500).townHall('foe', x(500), 1500)
    .unit('us', 'horseArcher', x(1986), 1986, { id: 'rider' })
    .unit('neutral', 'redDragon', x(1786), 1986, { id: 'west' })
    .unit('neutral', 'redDragon', x(1986), 1786, { id: 'north' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 63 && Math.floor(i / 128) < 63 ? '.' : '#';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const rider = game.units.find(unit => unit.id === 'rider')!;
  let firstTravel = 0;
  for (let tick = 0; tick < 300 && game.units.includes(rider); tick++) {
    if (tick % THINK_TICKS === 0) {
      const foes = game.units.filter(unit => unit.owner === 'neutral').sort(mountedTargetOrder);
      const command = mountedMicro(snapshotGame(game), rider, foes[0]!, foes, { kind: 'camp' });
      if (tick === 0 && command.type === 'move') firstTravel = Math.hypot(command.x - rider.x, command.y - rider.y);
      issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mounted-retreat', command }]);
    }
    stepGame(game);
  }
  expect(firstTravel).toBeGreaterThan(5);
  expect(game.units).toContain(rider);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
