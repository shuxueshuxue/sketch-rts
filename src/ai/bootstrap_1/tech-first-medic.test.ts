import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap, trainableUnitsAt, trainingBuildingFor } from '../../shared/catalog';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror })))) (
  'keeps the first $race medic funded before workshop construction (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const troop = race === 'grove' ? 'footman' : 'emberRavager', maker = trainingBuildingFor(race, 'priest')!;
    const waiting = trainableUnitsAt(race, maker).find(kind => kind !== 'priest' && requiredSupplyCap(kind) <= 80)!;
    expect(waiting).toBeDefined();
    const initial = BUILDING_DEFS.workshop.cost + UNIT_DEFS[waiting].cost;
    const game = sketchScene('retained-first-medic-reservation').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).playerState('us', { gold: initial }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .building('us', maker, x(700), 700, { id: 'producer' }).farms('us', 8, x(400), 2600)
      .unit('us', troop, x(800), 500, { hp: 25 })
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'producer', unitKind: waiting });
    const memory = createAiPolicyMemory(); let medics = 0, workshops = 0;
    for (let tick = 0; tick < 1000 && !game.units.some(unit => unit.owner === 'us' && unit.kind === 'priest'); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
        options.doctrines = [{ id: 'first-medic-before-higher-priority-tech', race, weight: 1, standIn: troop, raids: [],
          phases: [{ wants: [{ building: 'workshop', count: 1, priority: 70 }, { unit: troop, count: 1, priority: 66 }],
            advanceShare: 1, advanceSupply: 1000 }] }];
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [bootstrapEconomy], options).map(entry => ({ ...entry, playerId: 'us' }));
        medics += entries.filter(entry => entry.command.type === 'train' && entry.command.unitKind === 'priest').length;
        workshops += entries.filter(entry => entry.command.type === 'build' && entry.command.buildingKind === 'workshop').length;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(medics).toBe(1); expect(workshops).toBe(0);
    expect(game.units.some(unit => unit.owner === 'us' && unit.kind === 'priest')).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(initial);
  });
