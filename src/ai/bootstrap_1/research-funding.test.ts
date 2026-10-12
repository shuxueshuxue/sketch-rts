import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { UPGRADE_DEFS, UNIT_DEFS, trainingBuildingFor } from '../../shared/catalog';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(busy => ({ version, race, mirror, busy })))))) (
  '$version funds its higher priority $race weapon research while recruitment intent remains (mirror=$mirror, busy=$busy)', ({ version, race, mirror, busy }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const troop = race === 'grove' ? 'footman' : 'emberRavager';
    const initial = UPGRADE_DEFS.weaponTraining.levels[0]!.cost + UNIT_DEFS[troop].cost;
    const game = sketchScene('one-budget-for-aged-tech-and-paid-queue').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).playerState('us', { gold: initial }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .building('us', trainingBuildingFor(race, troop)!, x(700), 700, { id: 'producer' })
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    if (busy) issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'producer', unitKind: troop });
    const memory = createAiPolicyMemory();
    let issued = -1;
    for (let tick = 0; tick <= UPGRADE_DEFS.weaponTraining.levels[0]!.researchTime; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        options.doctrines = [{ id: 'funded-workshop-and-waiting-recruits', race, weight: 1, standIn: troop, raids: [],
          phases: [{ wants: [{ upgrade: 'weaponTraining', level: 1, priority: 70 }, { unit: troop, count: 6, priority: 66 }],
            advanceShare: 1, advanceSupply: 1000 }] }];
        options.armyWants = [];
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [bootstrapEconomy], options)
          .map(entry => ({ ...entry, playerId: 'us' }));
        if (entries.some(entry => entry.command.type === 'research' && entry.command.upgradeKind === 'weaponTraining') && issued < 0) issued = game.tick;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(issued).toBe(0);
    expect(game.players.us!.upgrades.weaponTraining).toBe(1);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === troop)).toHaveLength(1);
    expect(memory.v6!.goalAges![`unit:${troop}`]).toBeDefined();
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(initial);
    expect(game.match.stats.goldSpent.us).toBe(initial);
  });
