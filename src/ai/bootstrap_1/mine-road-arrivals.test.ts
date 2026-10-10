import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mineDefense } from './mine-defense';

it.each([false, true])('brings reachable mine defenders before the closer group across a forest wall (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mine-road-arrivals').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(3500), 3500).townHall('foe', x(500), 3500)
    .townHall('us', x(2400), 1100, { id: 'mine-hall' })
    .goldMine('income', x(2400 + GOLD_MINE_RULES.mainDistance), 1100, 4000)
    .unit('foe', 'footman', x(2400), 1700, { id: 'raider', order: { type: 'attackMove', x: x(2400), y: 1100 } });
  for (let index = 0; index < 3; index++) scene = scene
    .unit('us', 'knight', x(1900), 1060 + index * 50, { id: `across-${index}` })
    .unit('us', 'knight', x(3050), 660 + index * 50, { id: `reachable-${index}` });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', 'knight', x(3450 + index % 2 * 50),
    2800 + Math.floor(index / 2) * 50, { id: `main-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === (mirror ? 63 : 64) && Math.floor(index / 128) < 75 ? 'T' : '.').join('') };
  const hall = game.buildings.find(building => building.id === 'mine-hall')!;
  const across = game.units.find(unit => unit.id === 'across-0')!, local = game.units.find(unit => unit.id === 'reachable-0')!;
  expect(Math.hypot(across.x - hall.x, across.y - hall.y)).toBeLessThan(Math.hypot(local.x - hall.x, local.y - hall.y));
  expect(walkingDistance(game.map, across, hall)!).toBeGreaterThan(1300);
  expect(walkingDistance(game.map, local, hall)!).toBeLessThan(1300);
  const options = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_knight', { memory, teams: game.teams });
  const selected = mineDefense.claimsUnits!(snapshotGame(game), 'us', options());
  for (let tick = 0; tick < 450; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [mineDefense], options())
      .map(entry => ({ ...entry, playerId: 'us' })));
    stepGame(game);
  }
  expect(game.units.filter(unit => unit.id.startsWith('reachable-') && Math.hypot(unit.x - hall.x, unit.y - hall.y) < 350)).toHaveLength(3);
  expect([...selected]).toEqual(['reachable-2', 'reachable-1', 'reachable-0']);
  expect(game.buildings).toContain(hall);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});

it.each([false, true])('brings faster raiders before the nearer footmen on the same road (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mine-speed-arrivals').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(3500), 3500).townHall('foe', x(500), 3500)
    .townHall('us', x(1600), 1200, { id: 'mine-hall' })
    .goldMine('income', x(1600 + GOLD_MINE_RULES.mainDistance), 1200, 4000)
    .unit('foe', 'footman', x(1600), 1750, { id: 'raider', order: { type: 'attackMove', x: x(1600), y: 1200 } });
  for (let index = 0; index < 3; index++) scene = scene
    .unit('us', 'footman', x(1960 + index * 45), 600, { id: `slow-${index}` })
    .unit('us', 'raider', x(1990 + index * 45), 500, { id: `fast-${index}` });
  for (let index = 0; index < 8; index++) scene = scene.unit('us', 'knight', x(3450 + index % 2 * 50),
    2800 + Math.floor(index / 2) * 50, { id: `main-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const hall = game.buildings.find(building => building.id === 'mine-hall')!;
  const options = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams });
  const selected = mineDefense.claimsUnits!(snapshotGame(game), 'us', options());
  for (let tick = 0; tick < 420; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [mineDefense], options())
      .map(entry => ({ ...entry, playerId: 'us' })));
    stepGame(game);
  }
  expect(game.units.filter(unit => unit.id.startsWith('fast-') && Math.hypot(unit.x - hall.x, unit.y - hall.y) < 350)).toHaveLength(3);
  expect([...selected]).toEqual(['fast-0', 'fast-1', 'fast-2']);
  expect(game.buildings).toContain(hall);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
