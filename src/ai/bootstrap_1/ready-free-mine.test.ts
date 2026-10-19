import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';
import { bootstrapPolicyContext } from './policy';
import { miningWorkforce } from './workforce';
import { bootstrapExpansionMine } from './expansion-target';
import { readV6Intel, v9ExpansionMine } from '../policy/v6/intel';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version funds ready $race income before the closer guarded mine (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
  let scene = sketchScene('ready-free-mine-before-guarded' ).map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 10000)
    .townHall('us', x(1200), 1300).goldMine('natural', x(1200 + GOLD_MINE_RULES.mainDistance), 1300, 10000)
    .goldMine('guarded', x(500), 1900, 10000).unit('neutral', 'ogreLord', x(500), 1900)
    .goldMine('free', x(2300), 1800, 10000).townHall('foe', x(3500), 500)
    .farms('us', 8, x(500), 3000).worker('us', x(1200), 1500, { id: 'builder' });
  for (let index = 0; index < 10; index++) scene = scene.worker('us', x(index < 5 ? 650 : 1350), (index < 5 ? 500 : 1300) + index % 5 * 25,
    { order: { type: 'mine', resourceId: index < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
  for (let index = 0; index < 4; index++) scene = scene.unit('us', heavy, x(1400 + index % 2 * 45), 1300 + Math.floor(index / 2) * 45, { id: `screen-${index}` });
  for (let index = 0; index < 8; index++) scene = scene.unit('foe', 'knight', x(3300 + index % 4 * 40), 650 + Math.floor(index / 4) * 40, { id: `garrison-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  for (const owner of ['us', 'foe']) issuePlayerCommand(game, owner, { type: 'holdPosition', unitIds: game.units.filter(unit => unit.id.startsWith(owner === 'us' ? 'screen-' : 'garrison-')).map(unit => unit.id) });
  let returned = false, damage = 0;
  let incomeFoundationTick: number | undefined, coverFoundationTick: number | undefined;
  const loads = new Set<string>();
  game.observer = { hit(_source, target, taken) { if (target.owner === 'us') damage += taken; } };
  for (let tick = 0; tick < 3000 && !returned; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      context.doctrines = [{ id: 'safe-third-mine', race, weight: 1, raids: [], standIn: heavy,
        phases: [{ wants: [{ bases: 3, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
      context.armyWants = [];
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy, miningAssignments], context)
        .map(entry => ({ ...entry, playerId: 'us' })));
    }
    const gathering = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine' && unit.order.resourceId === 'free' && unit.order.phase === 'gather' && unit.carryingGold === 0);
    const carrying = game.units.filter(unit => loads.has(unit.id) && unit.order.type === 'mine' && unit.order.resourceId === 'free' && unit.order.phase === 'return' && unit.carryingGold > 0);
    stepGame(game);
    if (game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall'
      && Math.hypot(building.x - x(2300), building.y - 1800) <= GOLD_MINE_RULES.baseRange)) incomeFoundationTick ??= game.tick;
    if (game.buildings.some(building => building.owner === 'us' && building.kind === 'defenseTower'
      && Math.hypot(building.x - x(2300), building.y - 1800) <= building.attackRange)) coverFoundationTick ??= game.tick;
    for (const unit of gathering) if (unit.order.type === 'mine' && unit.order.resourceId === 'free' && unit.order.phase === 'return' && unit.carryingGold > 0) loads.add(unit.id);
    returned = carrying.some(unit => unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
  }
  expect(returned).toBe(true);
  expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
  expect(game.units.some(unit => unit.owner === 'neutral' && unit.kind === 'ogreLord')).toBe(true);
  // Clearing this mine never requires buying a tower first. After its hall is
  // paid and founded, the expansion's defensive handoff may add its own cover.
  expect(incomeFoundationTick).toBeDefined();
  if (coverFoundationTick !== undefined) expect(incomeFoundationTick!).toBeLessThan(coverFoundationTick);
  expect(game.units.filter(unit => unit.id.startsWith('screen-'))).toHaveLength(4);
  expect(damage).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us!).toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
  const mined = 40000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
}, 15000);

it.each((['tower', 'ally', 'busy'] as const).flatMap(reason => [false, true].map(mirror => ({ reason, mirror }))))(
  'keeps the guarded objective when the clear mine is unavailable through $reason (mirror=$mirror)', ({ reason, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('unready-clear-mine').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' }).player('ally', { team: 'a' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 500)
      .goldMine('guarded', x(1000), 1000, 10000).unit('neutral', 'ogreLord', x(1000), 1000)
      .goldMine('clear', x(2300), 1800, 10000).worker('us', x(600), 600, { id: 'builder' });
    if (reason === 'tower') scene = scene.tower('foe', x(2300), 1800);
    if (reason === 'ally') scene = scene.worker('ally', x(2300), 1800,
      { order: { type: 'mine', resourceId: 'clear', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    if (reason === 'busy') issuePlayerCommand(game, 'us', {
      type: 'build', unitId: 'builder', buildingKind: 'farm', x: x(800), y: 700,
    });
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
    expect(bootstrapExpansionMine(snapshot, 'us', readV6Intel(snapshot, 'us', options), options)?.id).toBe('guarded');
  });

it.each([false, true])('retains the stock commander road ranking (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('stock-v9-mine-choice').map('bareDuel').replaceDefaults()
    .player('us').player('foe').townHall('us', x(500), 500).townHall('foe', x(3500), 500)
    .goldMine('guarded', x(1000), 1000, 10000).unit('neutral', 'ogreLord', x(1000), 1000)
    .goldMine('clear', x(2300), 1800, 10000).worker('us', x(600), 600).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const snapshot = snapshotGame(game), options = { requestedVersion: 'v9' as const, memory: createAiPolicyMemory(), teams: game.teams };
  expect(v9ExpansionMine(snapshot, readV6Intel(snapshot, 'us', options))?.id).toBe('guarded');
});
