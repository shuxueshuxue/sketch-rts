import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { miningWorkforce } from './workforce';
import { longHaulInvestment } from './long-haul-investment';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(race: 'grove' | 'ember', mirror: boolean, condition: 'open' | 'tower' | 'ally' | 'capital' | 'depleted' = 'open') {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('remote-labor-capital-payback').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).playerState('us', { gold: condition === 'capital' ? BUILDING_DEFS.townHall.cost : 105 })
    .player('foe', { team: 'b' }).player('ally', { team: 'a' })
    .townHall('us', x(500), 500).goldMine('spent', x(788), 500, 0)
    .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400)
    .townHall('ally', x(3500), 500).worker('ally', x(3500), 400)
    .goldMine('remote', x(2300), 1200, condition === 'depleted' ? 100 : 6000)
    .farms('us', 2, x(400), 2000);
  for (let index = 0; index < 2; index++) scene = scene.worker('us', x(2300), 1180 + index * 20,
    { id: `hauler-${index}`, order: { type: 'mine', resourceId: 'remote', phase: 'toMine', timer: 0 } });
  if (condition === 'tower') scene = scene.tower('foe', x(2300), 1300);
  if (condition === 'ally') scene = scene.worker('ally', x(2300), 1200,
    { order: { type: 'mine', resourceId: 'remote', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  return game;
}

it.each(cases)('$version invests its depleted $race economy in paid remote labor (mirror=$mirror)', ({ version, race, mirror }) => {
  const game = field(race, mirror), memory = createAiPolicyMemory();
  const options = () => bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory, teams: game.teams });
  let recruited = false, delivered = false;
  for (let tick = 0; tick < 2400 && !delivered; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
      [AI_SCRIPT_LIBRARY.economy, miningWorkforce], options()).map(entry => ({ ...entry, playerId: 'us' })));
    const newWorker = game.units.find(unit => unit.owner === 'us' && unit.kind === 'worker' && !unit.id.startsWith('hauler-'));
    if (newWorker) recruited = true;
    const carrying = newWorker !== undefined && newWorker.carryingGold > 0;
    stepGame(game);
    if (carrying && newWorker!.carryingGold === 0) delivered = true;
  }
  expect(recruited).toBe(true);
  expect(delivered).toBe(true);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(UNIT_DEFS.worker.cost);
  expect(game.match.stats.unitsLost.us).toBe(0);
  const mined = 6000 - game.resources.find(mine => mine.id === 'remote')!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBeCloseTo(105 + mined, 6);
});

it.each(cases.flatMap(item => (['tower', 'ally', 'capital', 'depleted'] as const).map(condition => ({ ...item, condition })))) (
  '$version preserves $race capital instead of buying a worker for $condition (mirror=$mirror)', ({ version, race, mirror, condition }) => {
    const game = field(race, mirror, condition), snapshot = snapshotGame(game);
    const commands = longHaulInvestment(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version,
      { memory: createAiPolicyMemory(), teams: game.teams }), 1);
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'miningWorkforce', command })));
    stepGame(game);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!.queue).toEqual([]);
  });
