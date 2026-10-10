import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { TrainableUnitKind } from '../../shared/types';
import { routeTravelTicks } from '../../shared/route-selection';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { readV6Intel } from '../policy/v6/intel';
import { bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';
import { bootstrapExpansionMine } from './expansion-target';

function scene(race: 'grove' | 'ember', mirror: boolean, ranged: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  const body: TrainableUnitKind = race === 'grove' ? 'footman' : 'emberRavager';
  let draft = sketchScene('expansion-enemy-road').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .goldMine('main', x(716), 500, 6000).goldMine('free', x(1200), 1000, 6000)
    .goldMine('far', x(500), 3000, 6000).farms('us', 6, x(500), 2700);
  for (let index = 0; index < 3; index++) draft = draft.worker('us', x(610 + index * 25), 600);
  for (let index = 0; index < 6; index++) draft = draft.unit('us', body, x(1100 + index % 3 * 35), 1200 + Math.floor(index / 3) * 35);
  for (let index = 0; index < 8; index++) draft = draft.unit('foe', ranged ? 'archer' : 'footman', x(ranged ? 1460 : 1900), 940 + index * 15, { id: `foe-${index}` });
  const game = draft.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === (mirror ? 83 : 44) && Math.floor(index / 128) < 110 ? 'T' : '.').join('') };
  return { game, body };
}

it.each([false, true])('still rejects an expansion under direct ranged fire across the wall (mirror=%s)', mirror => {
  const { game } = scene('grove', mirror, true), snapshot = snapshotGame(game);
  const context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory: createAiPolicyMemory(), teams: game.teams });
  const intel = readV6Intel(snapshot, 'us', context);
  expect(bootstrapExpansionMine(snapshot, 'us', intel, context)?.id).toBe('far');
});

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version pays for the near $race free mine before wall-detouring melee can arrive (mirror=$mirror)', ({ version, race, mirror }) => {
  const { game, body } = scene(race, mirror, false), memory = createAiPolicyMemory();
  const free = game.resources.find(mine => mine.id === 'free')!;
  for (const foe of game.units.filter(unit => unit.owner === 'foe')) {
    expect(Math.hypot(foe.x - free.x, foe.y - free.y)).toBeLessThan(800);
    expect(walkingDistance(game.map, foe, free)!).toBeGreaterThan(800);
    expect(routeTravelTicks(game.map, foe, free, 'land', foe.speed)!).toBeGreaterThan(1500);
  }
  issuePlayerCommand(game, 'foe', { type: 'attackMove', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id), x: free.x, y: free.y });
  for (let tick = 0; tick < 1500; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      // Isolate the shared expansion contract from faction recruitment quotas.
      options.doctrines = [{ id: 'road-aware-expansion', race, weight: 1, standIn: body, raids: [],
        phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
      options.armyWants = [];
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy], options)
        .map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && building.complete
    && Math.hypot(building.x - free.x, building.y - free.y) <= GOLD_MINE_RULES.baseRange)).toBe(true);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(400);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
