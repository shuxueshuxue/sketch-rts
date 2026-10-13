import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { UNIT_DEFS, BUILDING_DEFS, trainingBuildingFor } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapEconomy } from './economy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
  (['busy', 'idle', 'first-healer'] as const).map(state => ({ race, mirror, state }))))) (
  '$race funds the requested factory from paid $state production (mirror=$mirror)', ({ race, mirror, state }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const producer = trainingBuildingFor(race, 'summoner')!;
    let scene = sketchScene('paid-queue-production-capital').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .building('us', producer, x(700), 850, { id: 'factory' }).farms('us', 12, x(400), 1500)
      .worker('us', x(995), 900, { id: 'builder' });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(900 + i * 30), 700);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', 'summoner', x(1300 + i * 40), 500);
    for (let i = 0; i < 6; i++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(1300 + i * 40), 700);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'factory', unitKind: 'summoner' });
    issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'farm', x: x(1000), y: 900 });
    for (let tick = 0; tick < 700 && !game.buildings.some(building => building.owner === 'us' && building.kind === 'farm' && building.x === x(1000) && building.complete); tick++) stepGame(game);
    expect(game.players.us!.gold).toBe(500 - UNIT_DEFS.summoner.cost - BUILDING_DEFS.farm.cost);
    if (state === 'idle') while (game.buildings.find(building => building.id === 'factory')!.queue.length) stepGame(game);
    else expect(game.buildings.find(building => building.id === 'factory')!.queue).toHaveLength(1);
    const context = { version: 'v2' as const, requestedVersion: 'v7' as const, memory, armyWants: [], teams: game.teams,
      doctrines: [{ id: 'existing-production-demand', race, weight: 1, standIn: 'summoner' as const, raids: [], phases: [{
        advanceShare: 1, advanceSupply: 1000, wants: [
          { building: producer, count: 2, priority: 80 }, { unit: 'summoner' as const, count: 6, priority: 60 },
          ...(state === 'first-healer' ? [{ unit: 'priest' as const, count: 1, priority: 65 }] : []),
        ],
      }] }],
    };
    const commands = planBootstrapEconomy(snapshotGame(game), 'us', context);
    if (state === 'busy') expect(commands.some(command => command.type === 'build' && command.buildingKind === producer)).toBe(true);
    else expect(commands.some(command => command.type === 'build' && command.buildingKind === producer)).toBe(false);
    if (state === 'idle') expect(commands.some(command => command.type === 'train' && command.unitKind === 'summoner')).toBe(true);
    for (const command of commands) issuePlayerCommand(game, 'us', command);
    if (state === 'first-healer') {
      for (let tick = 0; tick < UNIT_DEFS.summoner.trainTime; tick++) stepGame(game);
      const next = planBootstrapEconomy(snapshotGame(game), 'us', context);
      expect(next.some(command => command.type === 'train' && command.unitKind === 'priest')).toBe(true);
      expect(next.some(command => command.type === 'build' && command.buildingKind === producer)).toBe(false);
      for (const command of next) issuePlayerCommand(game, 'us', command);
    }
    for (let tick = 0; tick < 1800; tick++) stepGame(game);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === producer && building.complete)).toHaveLength(state === 'busy' ? 2 : 1);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'summoner')).toHaveLength(state === 'idle' ? 6 : 5);
    if (state === 'first-healer') expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'priest')).toHaveLength(1);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(500);
  }, 30000);
