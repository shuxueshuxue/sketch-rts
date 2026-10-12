import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { trainingBuildingFor, UNIT_DEFS } from '../../shared/catalog';
import type { TrainableUnitKind } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext, BOOTSTRAP_DOCTRINES } from './policy';
import { bootstrapEconomy } from './economy';
import { miningWorkforce } from './workforce';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { medicalRecovery } from './medical-recovery';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('funds recovery for an unlocked small $version army without a healer producer ($race, mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const healer = 'priest';
  const strategy = BOOTSTRAP_DOCTRINES[version].find(strategy => strategy.race === race)!;
  const basic = race === 'grove' ? 'footman' : 'emberRavager';
  const army: TrainableUnitKind[] = version === 'v9_archer' ? [basic, basic, ...Array.from({ length: 4 }, () => strategy.standIn)] : Array.from({ length: 6 }, () => strategy.standIn);
  let scene = sketchScene('small-army-medical-prerequisite').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('income', x(716), 500, 6000).townHall('foe', x(3500), 3500)
    .building('us', trainingBuildingFor(race, basic)!, x(750), 850)
    .farms('us', 7, x(400), 2200).worker('us', x(650), 700, { order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } })
    .worker('us', x(680), 700, { order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } }).worker('us', x(710), 700, { order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } });
  for (const [index, kind] of army.entries()) scene = scene.unit('us', kind, x(1350 + index * 40), 1200,
    { id: `soldier-${index}`, ...(index < 2 ? { hpRatio: .25 } : {}) });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  // Isolate the purchase decision from the official map's asymmetric camp and forest layout.
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const patients = game.units.filter(unit => unit.id === 'soldier-0' || unit.id === 'soldier-1');
  const startingHp = patients.map(unit => unit.hp);
  expect(game.buildings.some(building => building.owner === 'us' && building.kind === trainingBuildingFor(race, healer))).toBe(false);
  for (let tick = 0; tick < 2400; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us',
        [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy, medicalRecovery], options)
        .map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  expect(game.units.some(unit => unit.owner === 'us' && unit.kind === healer)).toBe(true);
  expect(patients.every((patient, index) => patient.hp > startingHp[index]!)).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(UNIT_DEFS[healer].cost);
  const mined = 6000 - game.resources.find(mine => mine.id === 'income')!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
  expect(game.players.us!.gold + game.match.stats.goldSpent.us! + carried).toBe(500 + mined);
});
