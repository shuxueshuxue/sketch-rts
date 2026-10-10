import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { miningAssignments } from './mining-assignments';

it.each([false, true])('returns a displaced miner to the shorter road with equal lane loads (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('displaced-miner-road').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(1800 - GOLD_MINE_RULES.mainDistance), 1000).townHall('us', x(2400), 2400 + GOLD_MINE_RULES.mainDistance).townHall('foe', x(3500), 3500)
    .goldMine('near-across-wall', x(1800), 1000, 6000).goldMine('short-road', x(2400), 2400, 6000)
    .goldMine('lost-lane', x(2700), 1000, 6000)
    .worker('us', x(2400), 1000, { id: 'miner',
      order: { type: 'mine', resourceId: 'lost-lane', phase: 'toMine', timer: 0 } }).build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === (mirror ? 63 : 64) && Math.floor(index / 128) < 100 ? 'T' : '.').join('') };
  const miner = game.units.find(unit => unit.id === 'miner')!, near = game.resources.find(mine => mine.id === 'near-across-wall')!, local = game.resources.find(mine => mine.id === 'short-road')!;
  expect(Math.hypot(miner.x - near.x, miner.y - near.y)).toBeLessThan(Math.hypot(miner.x - local.x, miner.y - local.y));
  expect(walkingDistance(game.map, miner, near)!).toBeGreaterThan(2 * walkingDistance(game.map, miner, local)!);
  const initialGold = game.players.us!.gold, memory = createAiPolicyMemory();
  for (let tick = 0; tick < 900; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [miningAssignments], { memory, teams: game.teams })
      .map(entry => ({ ...entry, playerId: 'us' })));
    stepGame(game);
  }
  expect(game.resources.find(mine => mine.id === 'short-road')!.amount).toBeLessThan(6000);
  expect(game.resources.find(mine => mine.id === 'near-across-wall')!.amount).toBe(6000);
  expect(game.players.us!.gold).toBeGreaterThan(initialGold);
  expect(miner.order).toMatchObject({ type: 'mine', resourceId: 'short-road' });
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
