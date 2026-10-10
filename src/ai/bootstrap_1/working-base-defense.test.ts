import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ version, race, mirrored }))));

it.each(cases)('regroups $version at the working hall when the birth mine is spent ($race, mirror=$mirrored)', ({ version, race, mirrored }) => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
  const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
  let scene = sketchScene('defend-income-after-birth-mine-empty').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500, { id: 'birth-hall' }).goldMine('spent', x(788), 500, 0)
    .townHall('us', x(500), 2500, { id: 'income-hall' }).goldMine('income', x(788), 2500, 10000)
    .townHall('foe', x(3500), 3500);
  for (let index = 0; index < 5; index++) {
    scene = scene.worker('us', x(600), 2480 + index * 25, { id: `miner-${index}`,
      order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } });
  }
  for (let index = 0; index < 3; index++) scene = scene.unit('us', heavy, x(900 + index * 35), 800, { id: `fighter-${index}` });
  for (let index = 0; index < 2; index++) scene = scene.unit('us', healer, x(780 + index * 35), 850, { id: `medic-${index}` });
  for (let index = 0; index < 16; index++) {
    scene = scene.unit('foe', 'knight', x(1250 + index % 4 * 40), 460 + Math.floor(index / 4) * 35, { id: `raider-${index}` });
  }
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'foe', { type: 'attack',
    unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id), targetId: 'birth-hall' });
  let damage = 0;
  game.observer = { hit(_source, target, taken) {
    if (target.owner === 'us' && 'order' in target && target.kind !== 'worker') damage += taken;
  } };
  for (let tick = 0; tick < 1500; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams }));
    stepGame(game);
  }
  expect(game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker')).toHaveLength(5);
  expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker')).toHaveLength(5);
  expect(game.buildings.some(building => building.id === 'income-hall')).toBe(true);
  expect(game.buildings.some(building => building.id === 'birth-hall')).toBe(false);
  expect(damage).toBe(0);
  expect(game.match.winner).toBeNull();
  expect(game.match.stats.goldSpent.us).toBe(0);
  const mined = 10000 - game.resources.find(mine => mine.id === 'income')!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
  expect(mined).toBeGreaterThan(0);
  expect(game.players.us!.gold + carried).toBe(500 + mined);
});
