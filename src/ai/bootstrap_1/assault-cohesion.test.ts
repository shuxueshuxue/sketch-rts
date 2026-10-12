import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { routeWithinDistance } from '../../shared/route-selection';
import { JOIN_RANGE } from '../policy/v6/general';
import { routeAssaultCampCommands } from './assault-camp-roads';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'assembles the $race column before its first strike, without fighting a camp beside the ally rendezvous (mirror=$mirror)',
  ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('assault-column-rendezvous').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3100), 1000, { id: 'target' })
      .worker('foe', x(3500), 3400)
      .unit('us', 'mercenary', x(650), 1000, { id: 'reinforcement' })
      .unit('neutral', 'graniteGolem', x(1600), 1000, { id: 'camp' });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', race === 'grove' ? 'knight' : 'ashChieftain',
      x(2050 + index * 24), 1000 + index % 2 * 30, { id: `front-${index}` });
    const game = scene.build().createGame(), group = game.units.filter(unit => unit.owner === 'us').map(unit => unit.id);
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const target = game.buildings.find(building => building.id === 'target')!;
    let initialWait = false, arrived = false;
    for (let tick = 0; tick < 2200 && target.hp === target.maxHp; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), commands = routeAssaultCampCommands(snapshot,
          [{ type: 'attackMove', unitIds: group, x: target.x, y: target.y }], group, target,
          snapshot.units.filter(unit => unit.owner !== 'us'));
        if (tick === 0) initialWait = commands.some(command => command.type === 'holdPosition'
          && command.unitIds.some(id => id.startsWith('front-')));
        issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
      }
      stepGame(game);
      const reinforcement = game.units.find(unit => unit.id === 'reinforcement')!;
      arrived ||= game.units.some(unit => unit.id.startsWith('front-')
        && routeWithinDistance(game.map, reinforcement, unit, 'land', JOIN_RANGE));
    }
    expect(initialWait).toBe(true);
    expect(arrived).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(game.units.filter(unit => group.includes(unit.id))).toHaveLength(5);
    expect(game.units.filter(unit => group.includes(unit.id)).every(unit => unit.hp === unit.maxHp)).toBe(true);
    const camp = game.units.find(unit => unit.id === 'camp')!;
    expect(camp.hp).toBe(camp.maxHp);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'keeps the $race engaged front fighting while a distant reinforcement approaches (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('engaged-column-keeps-fighting').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3100), 1000, { id: 'target' })
      .unit('us', 'mercenary', x(650), 1000, { id: 'reinforcement' })
      .unit('foe', 'archer', x(2390), 1000, { id: 'shooter' });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', race === 'grove' ? 'knight' : 'ashChieftain',
      x(2050 + index * 24), 1000 + index % 2 * 30, { id: `front-${index}` });
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const snapshot = snapshotGame(game), group = snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id);
    const target = snapshot.buildings.find(building => building.id === 'target')!;
    const commands = routeAssaultCampCommands(snapshot, [{ type: 'attackMove', unitIds: group, x: target.x, y: target.y }],
      group, target, snapshot.units.filter(unit => unit.owner !== 'us'));
    expect(commands.some(command => command.type === 'holdPosition' && command.unitIds.some(id => id.startsWith('front-')))).toBe(false);
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
    for (let tick = 0; tick < 180; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.id.startsWith('front-'))).toHaveLength(4);
    expect(game.units.filter(unit => unit.id.startsWith('front-')).every(unit => Math.abs(unit.x - x(2050)) > 150)).toBe(true);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
