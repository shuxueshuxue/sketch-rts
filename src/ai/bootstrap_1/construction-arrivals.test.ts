import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { routeTravelTicks } from '../../shared/route-selection';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version chooses the $race builder who arrives first around the wall (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('construction-arrival-road').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(1200), 1000).townHall('foe', x(3500), 3500)
    .goldMine('main', x(984), 1000, 10000).farms('us', 6, x(500), 2700)
    .worker('us', x(1500), 950, { id: 'near-across-wall' })
    .worker('us', x(900), 1700, { id: 'road-builder' })
    .worker('us', x(1100), 1100, { id: 'miner', order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === (mirror ? 83 : 44) && Math.floor(index / 128) < 110 ? 'T' : '.').join('') };
  const memory = createAiPolicyMemory();
  let firstBuilder: string | undefined;
  for (let tick = 0; tick < 1500; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      options.doctrines = [{ id: 'construction-arrival', race, weight: 1, standIn: race === 'grove' ? 'footman' : 'emberRavager', raids: [],
        phases: [{ advanceShare: 1, advanceSupply: 1000, wants: [{ building: 'workshop', count: 1, priority: 99 }] }] }];
      options.armyWants = [];
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy], options);
      for (const { command } of entries) if (command.type === 'build' && command.buildingKind === 'workshop' && firstBuilder === undefined) {
        firstBuilder = command.unitId;
        const near = snapshot.units.find(unit => unit.id === 'near-across-wall')!, road = snapshot.units.find(unit => unit.id === 'road-builder')!;
        expect(Math.hypot(near.x - command.x, near.y - command.y)).toBeLessThan(Math.hypot(road.x - command.x, road.y - command.y));
        expect(routeTravelTicks(snapshot.map, near, command, 'land', near.speed)!).toBeGreaterThan(1500);
        expect(routeTravelTicks(snapshot.map, road, command, 'land', road.speed)!).toBeLessThan(1500 - BUILDING_DEFS.workshop.buildTime);
      }
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  expect(firstBuilder).toBe('road-builder');
  expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'workshop' && building.complete)).toBe(true);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(BUILDING_DEFS.workshop.cost);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
