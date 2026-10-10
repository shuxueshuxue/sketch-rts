import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy, planBootstrapEconomy } from './economy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(critical => ({ race, critical }))))(
  'delivers the actual $race mining load before building (last income=$critical)', ({ race, critical }) => {
    const game = sketchScene('construction-after-real-delivery').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 500).goldMine('birth', 500 + GOLD_MINE_RULES.mainDistance, 500, critical ? 0 : 10000)
      .townHall('us', 2000, 500).goldMine('income', 2000 + GOLD_MINE_RULES.mainDistance, 500, 10000)
      .townHall('foe', 3500, 3500).farms('us', 8, 400, 1700)
      .worker('us', 2040, 550, { id: 'miner', order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } })
      .build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const initial = game.resources.reduce((total, mine) => total + mine.amount, 0);
    const miner = game.units.find(unit => unit.id === 'miner')!;
    for (let tick = 0; tick < 300 && miner.carryingGold === 0; tick++) stepGame(game);
    expect(miner.carryingGold).toBe(GOLD_MINE_RULES.goldPerTrip);
    const options: AiPolicyContext = { version: 'v2', requestedVersion: 'v9', memory: createAiPolicyMemory(), armyWants: [],
      doctrines: [{ id: 'workshop-with-mining-handoff', race, weight: 1, standIn: race === 'grove' ? 'lancer' : 'emberRavager', raids: [],
        phases: [{ advanceShare: 1, advanceSupply: 1000, wants: [{ building: 'workshop', count: 1, priority: 99 }] }] }] };
    const waiting = planBootstrapEconomy(snapshotGame(game), 'us', options);
    expect(waiting.some(command => command.type === 'build')).toBe(false);
    for (const command of waiting) issuePlayerCommand(game, 'us', command);
    let deliveredBeforeBuild = 0;
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const commands = runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
          [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy], options).map(entry => entry.command);
        if (commands.some(command => command.type === 'build' && command.buildingKind === 'workshop')) {
          const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
          deliveredBeforeBuild = initial - game.resources.reduce((total, mine) => total + mine.amount, 0) - carried;
        }
        for (const command of commands) issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    expect(deliveredBeforeBuild).toBeGreaterThanOrEqual(GOLD_MINE_RULES.goldPerTrip);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'workshop' && building.complete)).toBe(true);
    expect(game.units).toContain(miner);
    expect(game.match.winner).toBeNull();
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + initial
      - game.resources.reduce((total, mine) => total + mine.amount, 0));
  });
