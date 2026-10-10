import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { miningWorkforce } from './workforce';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version recruits the missing $race island miners locally (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('island-mining-workforce').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500, { id: 'spent-hall' }).goldMine('spent', x(500 + GOLD_MINE_RULES.mainDistance), 500, 0)
    .townHall('us', x(500), 2300, { id: 'supplied-hall' }).goldMine('supplied', x(500 + GOLD_MINE_RULES.mainDistance), 2300, 6000)
    .townHall('us', x(2900), 2300, { id: 'island-hall' }).goldMine('island', x(2900 + GOLD_MINE_RULES.mainDistance), 2300, 6000)
    .townHall('foe', x(500), 3500).farms('us', 3, x(200), 2700);
  for (let index = 0; index < 9; index++) scene = scene.worker('us', x(600), 2100 + index * 25,
    index < 5 ? { id: `home-${index}`, order: { type: 'mine', resourceId: 'supplied', phase: 'toMine', timer: 0 } } : { id: `home-${index}` });
  for (let index = 0; index < 2; index++) scene = scene.worker('us', x(3000), 2200 + index * 25,
    { id: `island-${index}`, order: { type: 'mine', resourceId: 'island', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 31 || col >= 76 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const recruits = new Set<string>(), depositors = new Set<string>(), trainedAt: string[] = [];
  for (let tick = 0; tick < 1500; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [AI_SCRIPT_LIBRARY.economy, miningWorkforce], context);
      for (const { command } of entries) if (command.type === 'train' && command.unitKind === 'worker') trainedAt.push(command.buildingId);
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    for (const unit of game.units) if (unit.owner === 'us' && unit.kind === 'worker' && !unit.id.startsWith('home-') && !unit.id.startsWith('island-')) recruits.add(unit.id);
    const returning = game.units.filter(unit => recruits.has(unit.id) && unit.carryingGold > 0 && unit.order.type === 'mine' && unit.order.resourceId === 'island' && unit.order.phase === 'return');
    stepGame(game);
    for (const unit of returning) if (unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine') depositors.add(unit.id);
  }
  expect(trainedAt).toEqual(['island-hall', 'island-hall', 'island-hall']);
  const hall = game.buildings.find(building => building.id === 'island-hall')!;
  expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker' && sameGround(game.map, unit, hall))).toHaveLength(5);
  expect(depositors.size).toBe(3);
  expect(game.match.stats.goldSpent.us).toBe(3 * UNIT_DEFS.worker.cost);
  const extracted = 12000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + extracted);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
