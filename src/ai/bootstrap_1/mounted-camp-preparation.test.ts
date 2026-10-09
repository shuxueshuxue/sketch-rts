import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { mountedTasks } from './mounted-tasks';

it.each([false, true])('prepares a camp rider for the actual staff range, then returns after ordinary research (mirrored=%s)', mirrored => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('mounted-staff-camp-preparation').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000).townHall('foe', x(3500), 3500)
    .building('us', 'workshop', x(700), 750, { id: 'research' }).farms('us', 6, x(400), 2400)
    .unit('us', 'horseArcher', x(1400), 1400, { id: 'rider' })
    .unit('neutral', 'footman', x(1720), 1400, { id: 'guard' }).goldMine('camp', x(1750), 1400, 6000)
    .item('staff', 'stormStaff', 0, 0, { carrierId: 'guard' });
  for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 480 + i * 25,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const rider = game.units.find(unit => unit.id === 'rider')!;
  let damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
  const think = () => issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [mountedTasks],
    { memory, teams: game.teams }).map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
  for (let tick = 0; tick < 300; tick++) { if (tick % 15 === 0) think(); stepGame(game); }
  expect(rider.hp).toBe(rider.maxHp);
  expect(Math.hypot(rider.x - x(500), rider.y - 500)).toBeLessThan(400);
  const guard = game.units.find(unit => unit.id === 'guard')!;
  expect(guard.hp).toBe(guard.maxHp);
  for (const [index, rules] of UPGRADE_DEFS.rangeTraining.levels.slice(0, 2).entries()) {
    issuePlayerCommand(game, 'us', { type: 'research', buildingId: 'research', upgradeKind: 'rangeTraining' });
    for (let tick = 0; tick <= rules.researchTime; tick++) {
      if (tick % 15 === 0) think();
      stepGame(game);
    }
    expect(game.players.us!.upgrades.rangeTraining).toBe(index + 1);
  }
  for (let tick = 0; tick < 12000 && game.units.some(unit => unit.id === 'guard'); tick++) {
    if (tick % 15 === 0) think();
    stepGame(game);
  }
  expect(game.players.us!.upgrades.rangeTraining).toBe(2);
  expect(game.units.some(unit => unit.id === 'guard')).toBe(false);
  expect(game.units.includes(rider)).toBe(true);
  expect(damage).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(UPGRADE_DEFS.rangeTraining.levels.slice(0, 2).reduce((cost, rules) => cost + rules.cost, 0));
  const mined = 10000 - game.resources.find(mine => mine.id === 'main')!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
});
