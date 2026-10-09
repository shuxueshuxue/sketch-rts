import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { snapToFootprint } from '../../shared/terrain';
import { distance } from '../policy/spatial';
import { mountedMicro } from './mounted-micro';

it.each([false, true])('prepares a shot outside the pursuing witch’s range (mirror=%s)', mirrored => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('mounted-prepared-pursuit').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000).townHall('foe', x(3500), 3500)
    .building('us', 'workshop', x(700), 800, { id: 'research' }).farms('us', 6, x(400), 2600)
    .unit('us', 'horseArcher', x(1400), 1400, { id: 'rider' })
    .unit('foe', 'witch', x(1900), 1400, { id: 'pursuer' });
  for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 480 + i * 25,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(), rider = game.units.find(unit => unit.id === 'rider')!,
    pursuer = game.units.find(unit => unit.id === 'pursuer')!;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['rider'] });
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['pursuer'] });
  issuePlayerCommand(game, 'us', { type: 'research', buildingId: 'research', upgradeKind: 'rangeTraining' });
  for (let tick = 0; tick <= UPGRADE_DEFS.rangeTraining.levels[0]!.researchTime; tick++) stepGame(game);
  expect(game.players.us!.upgrades.rangeTraining).toBe(1);
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['pursuer'], targetId: 'rider' });
  let damage = 0, prepared = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
  for (let tick = 0; tick < 6000 && game.units.includes(rider) && game.units.includes(pursuer); tick++) {
    if (tick % 15 === 0) {
      const command = mountedMicro(snapshotGame(game), rider, pursuer, [pursuer], { kind: 'camp' });
      if (command.type === 'aim' && distance(rider, pursuer) > rider.attackRange) prepared++;
      issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks', command }]);
    }
    stepGame(game);
  }
  expect(game.units).toContain(rider);
  expect(game.units).not.toContain(pursuer);
  expect(prepared).toBeGreaterThan(0);
  expect(damage).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(UPGRADE_DEFS.rangeTraining.levels[0]!.cost);
});
