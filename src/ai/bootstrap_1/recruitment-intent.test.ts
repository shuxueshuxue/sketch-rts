import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { BUILDING_DEFS, UNIT_DEFS, trainingBuildingFor } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { planBootstrapEconomy, rankBootstrapGoals } from './economy';
import { planV6Economy } from '../policy/v6/economy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
  [false, true].map(idleProducer => ({ race, mirror, idleProducer }))))) (
  'retains $race recruitment intent and allocates a producer after ranking (mirror=$mirror, idle=$idleProducer)',
  ({ race, mirror, idleProducer }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const main = race === 'grove' ? 'knight' : 'cinderRevenant';
    const support = race === 'grove' ? 'horseArcher' : 'ashChieftain';
    const producer = trainingBuildingFor(race, main)!;
    let scene = sketchScene('recruitment-intent-shared-queue').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
      .townHall('us', x(1500), 500).goldMine('natural', x(1788), 500, 10000)
      .townHall('foe', x(3500), 3500).worker('foe', x(3400), 3500)
      .building('us', producer, x(1000), 1000, { id: 'busy' }).farms('us', 9, x(500), 1800);
    if (idleProducer) scene = scene.building('us', producer, x(1500), 1000, { id: 'idle' });
    for (let index = 0; index < 11; index++) scene = scene.worker('us', x(index < 5 ? 550 : 1550), 550 + index % 5 * 20,
      { order: { type: 'mine', resourceId: index < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const context: AiPolicyContext = { version: 'v2', requestedVersion: 'v9', memory, teams: game.teams, armyWants: [],
      doctrines: [{ id: 'production-intents', race, weight: 1, standIn: race === 'grove' ? 'footman' : 'emberRavager', raids: [],
        phases: [{ wants: [{ unit: main, count: idleProducer ? 1 : 12, priority: 65 }, { unit: support, count: 1, priority: 56 }],
          advanceShare: 1, advanceSupply: 1000 }] }] };
    issueCommandFrame(game, [{ playerId: 'us', scriptId: 'v6Economy', command: { type: 'train', buildingId: 'busy', unitKind: main } }]);
    let mainBeforeSupport = 0, supportProducer = '';
    for (let tick = 0; tick < 4000 && !game.units.some(unit => unit.owner === 'us' && unit.kind === support); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), goals = rankBootstrapGoals(snapshot, 'us', context);
        if (tick === (idleProducer ? 0 : 300)) {
          const intent = goals.find(goal => goal.id === `unit:${support}`)!;
          expect(intent).toBeDefined();
          expect(intent.save).toBe(idleProducer);
          expect(memory.v6!.goalAges![`unit:${support}`]!.since).toBe(0);
          if (idleProducer) expect(intent.issue(new Set())).toMatchObject({ type: 'train', buildingId: 'idle', unitKind: support });
          else expect(intent.issue(new Set())).toBeUndefined();
        }
        const commands = planBootstrapEconomy(snapshot, 'us', context);
        const training = commands.filter(command => command.type === 'train');
        expect(new Set(training.map(command => command.buildingId)).size).toBe(training.length);
        const recruit = training.find(command => command.unitKind === support);
        if (recruit) {
          mainBeforeSupport = game.units.filter(unit => unit.owner === 'us' && unit.kind === main).length;
          supportProducer = recruit.buildingId;
        }
        issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6Economy', command })));
      }
      stepGame(game);
    }
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === support)).toHaveLength(1);
    if (idleProducer) expect(supportProducer).toBe('idle');
    else expect(mainBeforeSupport).toBeLessThan(12);
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us! + carrying)
      .toBe(500 + 20000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0));
  });

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
  [false, true].map(bootstrap => ({ race, mirror, bootstrap }))))) (
  'an already booked $race producer cannot lock the remaining construction budget (mirror=$mirror, bootstrap=$bootstrap)',
  ({ race, mirror, bootstrap }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const main = race === 'grove' ? 'knight' : 'cinderRevenant';
    const support = race === 'grove' ? 'horseArcher' : 'ashChieftain';
    let scene = sketchScene('booked-producer-budget').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).playerState('us', { gold: 335 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
      .townHall('us', x(1500), 500).goldMine('natural', x(1788), 500, 10000)
      .townHall('foe', x(3500), 3500).worker('foe', x(3400), 3500)
      .building('us', trainingBuildingFor(race, main)!, x(1000), 1000).farms('us', 9, x(500), 1800);
    for (let index = 0; index < 11; index++) scene = scene.worker('us', x(index < 5 ? 550 : 1550), 550 + index % 5 * 20);
    const game = scene.build().createGame(), context: AiPolicyContext = {
      version: 'v2', requestedVersion: 'v9', memory: createAiPolicyMemory(), teams: game.teams, armyWants: [],
      doctrines: [{ id: 'booked-production-budget', race, weight: 1, standIn: race === 'grove' ? 'footman' : 'emberRavager', raids: [],
        phases: [{ wants: [{ unit: main, count: 1, priority: 65 }, { unit: support, count: 1, priority: 64 },
          { building: 'farm', count: 10, priority: 50 }], advanceShare: 1, advanceSupply: 1000 }] }],
    };
    const commands = (bootstrap ? planBootstrapEconomy : planV6Economy)(snapshotGame(game), 'us', context);
    expect(commands.filter(command => command.type === 'train').map(command => command.unitKind)).toEqual([main]);
    expect(commands.filter(command => command.type === 'build').map(command => command.buildingKind)).toEqual(['farm']);
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6Economy', command })));
    expect(game.players.us!.gold).toBe(335 - UNIT_DEFS[main].cost);
    for (let tick = 0; tick < 600 && game.buildings.filter(building => building.owner === 'us' && building.kind === 'farm' && building.complete).length < 10; tick++) stepGame(game);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'farm' && building.complete)).toHaveLength(10);
    expect(game.players.us!.gold).toBe(335 - UNIT_DEFS[main].cost - BUILDING_DEFS.farm.cost);
    expect(game.match.stats.goldSpent.us).toBe(UNIT_DEFS[main].cost + BUILDING_DEFS.farm.cost);
  });
