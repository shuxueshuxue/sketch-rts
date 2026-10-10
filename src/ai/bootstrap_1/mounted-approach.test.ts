import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { mountedTasks } from './mounted-tasks';

it.each([['footman', false], ['footman', true], ['emberRavager', false], ['emberRavager', true]] as const)('crosses safe ground past an idle %s and completes the raid (mirror=%s)', (guardKind, mirrored) => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('mounted-safe-transit').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: guardKind === 'footman' ? 'grove' : 'ember', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
    .townHall('foe', x(2780), 2000).tower('foe', x(2780), 2250)
    .unit('us', 'horseArcher', x(1000), 2000, { id: 'rider' })
    .unit('foe', guardKind, x(1400), 2400, { id: 'guard' });
  for (let index = 0; index < 5; index++) {
    scene = scene.worker('us', x(600), 480 + index * 25,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
      .worker('foe', x(2470), 1900 + index * 25, { id: `target-${index}` });
  }
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
  let damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
  for (let tick = 0; tick < 2400 && game.units.some(unit => unit.id.startsWith('target-')); tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version: 'v9_archer', memory, scripts: [mountedTasks] }, { teams: game.teams }));
    stepGame(game);
  }
  planAiOwnerCommandEntries(snapshotGame(game),
    { playerId: 'us', version: 'v9_archer', memory, scripts: [mountedTasks] }, { teams: game.teams });
  expect(memory.mounted).toEqual([]);
  expect(game.units.some(unit => unit.id === 'rider')).toBe(true);
  expect(game.units.some(unit => unit.id === 'guard')).toBe(true);
  expect(game.units.filter(unit => unit.id.startsWith('target-'))).toHaveLength(0);
  expect(damage).toBe(0);
  expect(game.match.winner).toBeNull();
  expect(game.match.stats.goldSpent.us).toBe(0);
  const mined = 10000 - game.resources.find(mine => mine.id === 'main')!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried).toBe(500 + mined);
});
