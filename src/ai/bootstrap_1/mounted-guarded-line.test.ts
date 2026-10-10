import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { mountedTasks } from './mounted-tasks';

it.each([false, true])('raids the exposed mining line instead of the closer line covered by ready knights (mirror=%s)', mirrored => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('mounted-army-cover').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
    .townHall('foe', x(3000), 1000, { id: 'covered' }).goldMine('covered-mine', x(3288), 1000, 10000)
    .townHall('foe', x(3000), 2800, { id: 'exposed' }).goldMine('exposed-mine', x(3288), 2800, 10000)
    .unit('us', 'horseArcher', x(2000), 1000, { id: 'rider' })
    .unit('foe', 'knight', x(3288), 1000, { id: 'guard', order: { type: 'hold', x: x(3288), y: 1000 } })
    .unit('foe', 'knight', x(2920), 1000, { id: 'hall-guard', order: { type: 'hold', x: x(2920), y: 1000 } });
  for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 470 + i * 25,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  for (const [label, y] of [['covered', 1000], ['exposed', 2800]] as const) {
    for (let i = 0; i < 5; i++) scene = scene.worker('foe', x(3150), y - 30 + i * 25,
      { id: `${label}-${i}`, order: { type: 'mine', resourceId: `${label}-mine`, phase: 'toMine', timer: 0 } });
  }
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  let damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
  for (let tick = 0; tick < 2000 && game.units.some(unit => unit.id.startsWith('exposed-')); tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version: 'v9_archer', memory, scripts: [mountedTasks] }, { teams: game.teams }));
    stepGame(game);
  }
  expect(game.units.some(unit => unit.id === 'rider')).toBe(true);
  expect(game.units.filter(unit => unit.id.startsWith('covered-'))).toHaveLength(5);
  expect(game.units.filter(unit => unit.id.startsWith('exposed-'))).toHaveLength(0);
  expect(damage).toBe(0);
  expect(game.match.winner).toBeNull();
  expect(game.match.stats.goldSpent.us).toBe(0);
  const mined = 10000 - game.resources.find(mine => mine.id === 'main')!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried).toBe(500 + mined);
});
