import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiPolicyContext } from '../policy/types';
import { bootstrapEconomy } from './economy';
import { miningWorkforce } from './workforce';
import { researchPrerequisites } from './policy';

const cases = (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirrored =>
  (['weaponTraining', 'rangeTraining', 'speedTraining', 'leadership'] as const).map(upgrade => ({ race, mirrored, upgrade }))));
it.each(cases)('constructs and funds the requested $race/$upgrade lab (mirror=$mirrored)', ({ race, mirrored, upgrade }) => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('research-lab-dependency').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000).townHall('foe', x(3500), 3500);
  for (let i = 0; i < 3; i++) scene = scene.worker('us', x(540), 530 + i * 20,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  const requested = { upgrade, level: 2, priority: 65 };
  const context: AiPolicyContext = { version: 'v2', requestedVersion: 'v9', memory, teams: game.teams,
    armyWants: [], doctrines: [{ id: 'research', race, weight: 1, raids: [], standIn: race === 'grove' ? 'footman' : 'emberRavager',
      phases: [{ wants: [requested, ...researchPrerequisites([requested], game.players.us!)], advanceShare: 1, advanceSupply: 1000 }] }] };
  const labs: string[] = [], research: string[] = [];
  for (let tick = 0; tick < 10000 && game.players.us!.upgrades[upgrade] < 2; tick++) {
    if (tick % 15 === 0) {
      const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
        [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy], context);
      for (const entry of entries) {
        if (entry.command.type === 'build') labs.push(entry.command.buildingKind);
        if (entry.command.type === 'research') research.push(entry.command.upgradeKind);
      }
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
    }
    stepGame(game);
  }
  expect(game.match.winner).toBeNull();
  expect(game.players.us!.upgrades[upgrade]).toBe(2);
  expect(research).toEqual([upgrade, upgrade]);
  const lab = game.buildings.find(building => building.owner === 'us'
    && UPGRADE_DEFS[upgrade].researchBuildingKinds.includes(building.kind))!;
  expect(lab.complete).toBe(true);
  expect(labs.filter(kind => kind === lab.kind)).toHaveLength(1);
  const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carrying + game.match.stats.goldSpent.us!).toBe(500 + 10000 - game.resources[0]!.amount);
});
