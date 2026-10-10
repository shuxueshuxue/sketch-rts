import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { createShop } from '../../shared/shop';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapPolicyContext } from './policy';
import { shopping, shoppingGoals } from './shopping';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version completes a long-road $race shop errand and returns (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('global-road-shop').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500).farms('us', 7, x(400), 1500);
  for (let index = 0; index < 3; index++) scene = scene.worker('us', x(560 + index * 35), 600);
  for (let index = 0; index < 6; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'ashWarden', x(700 + index * 25), 700);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  game.shops = [createShop('far-shop', x(3200), 700)];
  const wall = Math.floor(x(1280) / 32);
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === wall && Math.floor(index / 128) < 110 ? 'T' : '.').join('') };
  const army = game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker');
  expect(walkingDistance(game.map, army[0]!, game.shops[0]!, 'land')! / army[0]!.speed * 20).toBeGreaterThan(1200);
  let bought = 0;
  const shoppers = new Set<string>();
  for (let tick = 0; tick < 4800; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = [];
      for (const goal of shoppingGoals(snapshot, 'us', options)) {
        if (game.players.us!.gold < goal.cost || goal.hold) continue;
        const command = goal.issue();
        if (command) { entries.push({ playerId: 'us', scriptId: 'v6Economy', command }); bought++; }
      }
      const commands = shopping.run(snapshot, 'us', options);
      for (const command of Array.isArray(commands) ? commands : commands ? [commands] : []) entries.push({ playerId: 'us', scriptId: 'shopping', command });
      if (memory.shopping) shoppers.add(memory.shopping.unitId);
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
  }
  expect(bought).toBe(1);
  expect(shoppers.size).toBe(1);
  const shopper = game.units.find(unit => shoppers.has(unit.id))!;
  expect(game.items.find(item => item.kind === 'guardianScroll')?.carrierId).toBe(shopper.id);
  expect(walkingDistance(game.map, shopper, { x: x(500), y: 500 }, 'land')).toBeLessThanOrEqual(180);
  expect(memory.shopping).toBeUndefined();
  expect(game.players.us!.gold).toBe(300);
  expect(army.every(unit => game.units.includes(unit))).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
});


it('the full planner pays for a distant guardian scroll while running its normal economy', () => {
  let scene = sketchScene('global-shop-full-planner').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', 500, 500).townHall('peer', 3500, 3500).farms('us', 7, 400, 1500)
    .goldMine('home-mine', 800, 500, 8000);
  for (let index = 0; index < 3; index++) scene = scene.worker('us', 560 + index * 35, 600);
  for (let index = 0; index < 6; index++) scene = scene.unit('us', 'footman', 700 + index * 25, 700);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  game.shops = [createShop('far-shop', 3200, 2200)];
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  let bought = 0, trained = 0;
  const shoppers = new Set<string>();
  for (let tick = 0; tick < 6000; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_archer', memory }, { teams: game.teams });
      bought += entries.filter(entry => entry.command.type === 'buy').length;
      trained += entries.filter(entry => entry.command.type === 'train').length;
      if (memory.shopping) shoppers.add(memory.shopping.unitId);
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ bought, trained, task: memory.shopping, gold: game.players.us!.gold, kinds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.kind) });
  expect(bought, diagnostic).toBeGreaterThanOrEqual(1);
  expect(trained, diagnostic).toBeGreaterThan(0);
  expect(shoppers.size, diagnostic).toBe(1);
  const shopper = game.units.find(unit => shoppers.has(unit.id))!;
  expect(game.items.some(item => item.kind === 'guardianScroll' && item.carrierId === shopper.id), diagnostic).toBe(true);
  expect(memory.shopping, diagnostic).toBeUndefined();
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(200);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
