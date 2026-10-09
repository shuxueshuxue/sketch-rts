import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UNIT_DEFS, BUILDING_DEFS, requiredSupplyCap } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { bootstrapPolicyContext } from './policy';
import { miningWorkforce } from './workforce';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  'unlocks $race home tech while its mirrored=$mirrored colony builder is still walking', ({ race, mirrored }) => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
  const basic = race === 'grove' ? 'lancer' : 'emberRavager';
  const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
  let scene = sketchScene('concurrent-colony-and-tech').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000).townHall('foe', x(3500), 500)
    .townHall('us', x(500), 1500).goldMine('natural', x(788), 1500, 10000)
    .goldMine('colony-mine', x(3800), 3512, 10000)
    .building('us', UNIT_DEFS[basic].trainedAt!, x(700), 800)
    .building('us', UNIT_DEFS[heavy].trainedAt!, x(950), 800)
    .building('us', UNIT_DEFS[healer].trainedAt!, x(1200), 800)
    .worker('us', x(500), 650, { id: 'colonist' });
  for (let i = 0; i < 6; i++) scene = scene.building('us', 'farm', x(400 + i * 64), 2400);
  for (let i = 0; i < 10; i++) scene = scene.worker('us', x(540), (i < 5 ? 520 : 1520) + i % 5 * 25,
    { order: { type: 'mine', resourceId: i < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
  for (let i = 0; i < 6; i++) scene = scene.unit('us', basic, x(1400 + i * 35), 1200);
  for (let i = 0; i < 3; i++) scene = scene.unit('us', heavy, x(1400 + i * 35), 1400);
  for (let i = 0; i < 2; i++) scene = scene.unit('us', healer, x(1400 + i * 35), 1600);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  memory.v6 = { phase: 1 };
  expect(game.players.us!.supplyCap).toBeLessThan(requiredSupplyCap(heavy));
  issuePlayerCommand(game, 'us', { type: 'build', unitId: 'colonist', buildingKind: 'townHall', x: x(3800), y: 3800 });
  let techWhileWalking = false;
  for (let tick = 0; tick < 1200; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game);
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us',
        [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy],
        bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams }))
        .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
    }
    stepGame(game);
    const colonist = game.units.find(unit => unit.id === 'colonist')!;
    if (colonist.order.type === 'build' && game.players.us!.supplyCap >= requiredSupplyCap(heavy)) techWhileWalking = true;
    for (const kind of ['townHall', 'farm'] as const) expect(game.units.filter(unit => unit.owner === 'us'
      && unit.order.type === 'build' && unit.order.buildingKind === kind).length).toBeLessThanOrEqual(1);
  }
  expect(techWhileWalking).toBe(true);
  expect(game.units.find(unit => unit.id === 'colonist')!.order.type).toBe('build');
  expect(game.players.us!.supplyCap).toBeGreaterThanOrEqual(requiredSupplyCap(heavy));
  expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall')).toHaveLength(2);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(2 * BUILDING_DEFS.farm.cost);
  const mined = 30000 - game.resources.reduce((total, mine) => total + mine.amount, 0);
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  expect(game.players.us!.gold).toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
});
