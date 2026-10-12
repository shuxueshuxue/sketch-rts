import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { BOOTS_SPEED, createShop } from '../../shared/shop';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';
import { mountedTasks } from './mounted-tasks';
import { bootstrapPolicyContext } from './policy';
import { shopping, shoppingGoals } from './shopping';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })));

it.each(cases)('$version equips a detached rider, returns and resumes clearing (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mounted-shopping-return').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500)
    .goldMine('camp-mine', x(2800), 2000, 6000)
    .unit('us', 'horseArcher', x(700), 700, { id: 'rider' });
  for (let i = 0; i < 3; i++) scene = scene.unit('neutral', 'ogreWarrior', x(2700 + i * 60), 2000, { id: `guard-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  game.shops = [createShop('shop', x(1600), 700)];
  const rider = game.units.find(unit => unit.id === 'rider')!;
  const original = game.units.filter(unit => unit.owner === 'us');
  let purchases = 0, returned = false, resumed = false, damage = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === rider.id) damage += taken; } };
  for (let tick = 0; tick < 6000 && game.units.some(unit => unit.id.startsWith('guard-')); tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [{
        id: 'v6Economy', phase: 'economy', run: (view, owner, options) => shoppingGoals(view, owner, options)
          .filter(goal => !goal.hold && view.players[owner]!.gold >= goal.cost).flatMap(goal => {
            const command = goal.issue();
            return command ? [command] : [];
          }),
      }, mountedTasks, shopping], context).map(entry => ({ ...entry, playerId: 'us' }));
      purchases += entries.filter(entry => entry.command.type === 'buy').length;
      issueCommandFrame(game, entries);
    }
    stepGame(game);
    returned ||= purchases > 0 && walkingDistance(game.map, rider, { x: x(500), y: 500 }, 'land')! <= V7_GATHERED_RANGE;
    resumed ||= returned && !memory.shopping && !!memory.mounted?.some(task => task.unitIds.includes(rider.id));
  }
  const diagnostic = JSON.stringify({ purchases, returned, resumed, damage, shopping: memory.shopping,
    mounted: memory.mounted, rider: { hp: rider.hp, speed: rider.speed, x: rider.x, y: rider.y }, items: game.items });
  expect(purchases, diagnostic).toBe(1);
  expect(returned, diagnostic).toBe(true);
  expect(resumed, diagnostic).toBe(true);
  expect(memory.shopping, diagnostic).toBeUndefined();
  expect(game.items.find(item => item.kind === 'speedBoots')?.carrierId, diagnostic).toBe(rider.id);
  expect(game.items.find(item => item.kind === 'speedBoots')?.slot, diagnostic).toBe('feet');
  expect(rider.speed, diagnostic).toBe(UNIT_DEFS.horseArcher.speed * BOOTS_SPEED);
  expect(game.units.filter(unit => unit.id.startsWith('guard-')), diagnostic).toHaveLength(0);
  expect(original.every(unit => game.units.includes(unit)), diagnostic).toBe(true);
  expect(damage, diagnostic).toBe(0);
  expect(game.match.stats.goldSpent.us, diagnostic).toBe(100);
  expect(game.players.us!.gold).toBe(500 + UNIT_DEFS.ogreWarrior.goldBounty! * 3 - 100);
});

it.each([false, true])('the full planner buys rider mobility from its ordinary income (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mounted-shopping-full-planner').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500).farms('us', 7, x(400), 1500)
    .goldMine('main', x(800), 500, 8000);
  for (let i = 0; i < 3; i++) scene = scene.worker('us', x(560 + i * 35), 600);
  for (let i = 0; i < 3; i++) scene = scene.unit('us', 'horseArcher', x(700 + i * 35), 700, { id: `rider-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  game.shops = [createShop('shop', x(3200), 2200)];
  let bought = 0, trained = 0;
  for (let tick = 0; tick < 6000; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_archer', memory }, { teams: game.teams });
      bought += entries.filter(entry => entry.command.type === 'buy' && entry.command.item === 'speedBoots').length;
      trained += entries.filter(entry => entry.command.type === 'train').length;
      issueCommandFrame(game, entries);
    }
    stepGame(game);
  }
  const boots = game.items.filter(item => item.kind === 'speedBoots' && item.slot === 'feet');
  const diagnostic = JSON.stringify({ bought, trained, boots, task: memory.shopping, gold: game.players.us!.gold });
  expect(bought, diagnostic).toBeGreaterThan(0);
  expect(trained, diagnostic).toBeGreaterThan(0);
  expect(boots.some(item => item.carrierId?.startsWith('rider-')), diagnostic).toBe(true);
  expect(game.units.filter(unit => unit.id.startsWith('rider-'))).toHaveLength(3);
  expect(game.match.stats.unitsLost.us).toBe(0);
  const mined = 8000 - game.resources[0]!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
});
