import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { routeAssaultCampCommands } from './assault-camp-roads';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'holds the $race assault when a sealed cliff has no admitted road (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('closed-assault-road').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3100), 1800, { id: 'target' })
      .worker('foe', x(3500), 3350)
      .unit('us', race === 'grove' ? 'knight' : 'ashChieftain', x(1000), 1800, { id: 'fighter' })
      .unit('neutral', 'graniteGolem', x(1700), 2700, { id: 'camp' }).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const col = mirror ? 127 - index % 128 : index % 128;
      return col >= 56 && col <= 60 ? '#' : '.';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const fighter = game.units.find(unit => unit.id === 'fighter')!, target = game.buildings.find(building => building.id === 'target')!;
    const initial = { x: fighter.x, y: fighter.y };
    for (let tick = 0; tick < 360; tick++) {
      if (tick % 15 === 0) {
        const commands = routeAssaultCampCommands(snapshotGame(game),
          [{ type: 'attackMove', unitIds: ['fighter'], x: target.x, y: target.y }], ['fighter'], target);
        expect(commands).toEqual([{ type: 'holdPosition', unitIds: ['fighter'] }]);
        issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
      }
      stepGame(game);
    }
    expect({ x: fighter.x, y: fighter.y }).toEqual(initial);
    expect(fighter.hp).toBe(fighter.maxHp);
    expect(game.units.some(unit => unit.id === 'fighter')).toBe(true);
    expect(target.hp).toBe(target.maxHp);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
