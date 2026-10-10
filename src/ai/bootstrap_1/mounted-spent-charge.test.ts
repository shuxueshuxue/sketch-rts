import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { ABILITY_DEFS, type AbilityDef } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { mountedMicro } from './mounted-micro';

it.each([false, true])('escapes the inner window of a knight that has actually spent its charge (mirror=%s)', mirrored => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('spent-charge-escape').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000).townHall('foe', x(3500), 3500)
    .unit('us', 'horseArcher', x(2000), 2000, { id: 'rider' })
    .unit('foe', 'knight', x(2250), 2000, { id: 'knight' });
  for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 470 + i * 25,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const rider = game.units.find(unit => unit.id === 'rider')!, knight = game.units.find(unit => unit.id === 'knight')!;
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['rider'] });
  issuePlayerCommand(game, 'foe', { type: 'cast', unitId: 'knight', ability: 'charge', targetId: 'rider' });
  while (rider.hp === rider.maxHp) stepGame(game);
  expect(abilityCooldown(knight, 'charge')).toBeGreaterThan(200);
  const charge = ABILITY_DEFS.charge as Extract<AbilityDef, { behavior: 'charge' }>;
  let escaped = false, damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
  for (let tick = 0; tick < 200 && game.units.includes(rider); tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks',
      command: mountedMicro(snapshotGame(game), rider, knight, [knight], { kind: 'raid', station: rider }) }]);
    stepGame(game);
    escaped ||= Math.hypot(rider.x - knight.x, rider.y - knight.y) > charge.minRange;
  }
  expect(game.units).toContain(rider);
  expect(escaped).toBe(true);
  expect(damage).toBe(0);
  expect(game.match.winner).toBeNull();
  expect(game.match.stats.goldSpent.us).toBe(0);
  const mined = 10000 - game.resources[0]!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried).toBe(500 + mined);
});
