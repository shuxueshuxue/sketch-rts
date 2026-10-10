import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { planBootstrapEconomy } from './economy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(spare => ({ race, spare }))))(
  'builds $race tech with a free worker instead of draining a five-worker mine (spare=$spare)', ({ race, spare }) => {
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    const factory = UNIT_DEFS[heavy].trainedAt!;
    let scene = sketchScene('construction-keeps-mining-lanes').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 500).goldMine('main', 500 + GOLD_MINE_RULES.mainDistance, 500, 10000)
      .townHall('us', 2000, 500).goldMine('natural', 2000 + GOLD_MINE_RULES.mainDistance, 500, 10000)
      .townHall('foe', 3500, 3500).farms('us', 8, 400, 1700);
    for (let index = 0; index < 10; index++) scene = scene.worker('us', index < 5 ? 540 : 2040, 550 + index % 5 * 20,
      { id: `miner-${index}`, order: { type: 'mine', resourceId: index < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
    scene = scene.worker('us', 1900, 700, { id: 'free-builder',
      order: spare ? { type: 'mine', resourceId: 'natural', phase: 'toMine', timer: 0 } : { type: 'idle' } });
    if (spare) scene = scene.worker('us', 3500, 700, { id: 'unreachable-idle', order: { type: 'idle' } });
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128,
      cells: Array.from({ length: 128 * 128 }, (_, index) => spare && index % 128 === 96 ? '~' : '.').join('') };
    const options: AiPolicyContext = { version: 'v2', requestedVersion: 'v9', memory: createAiPolicyMemory(), armyWants: [],
      doctrines: [{ id: 'first-heavy-factory', race, weight: 1, standIn: race === 'grove' ? 'lancer' : 'emberRavager', raids: [],
        phases: [{ advanceShare: 1, advanceSupply: 1000, wants: [{ building: factory, count: 1, priority: 99 }] }] }] };
    const commands = planBootstrapEconomy(snapshotGame(game), 'us', options);
    const build = commands.find(command => command.type === 'build' && command.buildingKind === factory);
    expect(build).toMatchObject({ type: 'build', unitId: 'free-builder' });
    for (const command of commands) issuePlayerCommand(game, 'us', command);
    options.doctrines![0]!.phases[0]!.wants.push({ building: 'workshop', count: 1, priority: 98 });
    const parallel = planBootstrapEconomy(snapshotGame(game), 'us', options)
      .find(command => command.type === 'build' && command.buildingKind === 'workshop');
    expect(parallel).toBeDefined();
    expect(parallel).not.toMatchObject({ unitId: 'free-builder' });
    for (let tick = 0; tick < 1200; tick++) stepGame(game);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === factory && building.complete)).toBe(true);
    for (const mine of ['main', 'natural']) expect(game.units.filter(unit => unit.id.startsWith('miner-')
      && unit.order.type === 'mine' && unit.order.resourceId === mine)).toHaveLength(GOLD_MINE_RULES.workstations);
    expect(game.units.find(unit => unit.id === 'free-builder')!.order.type).toBe('idle');
    if (spare) expect(game.units.find(unit => unit.id === 'unreachable-idle')!.order.type).toBe('idle');
    // Construction can leave a fractional HP remainder for one ordinary repair coin.
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(BUILDING_DEFS[factory].cost);
    expect(game.match.stats.goldSpent.us).toBeLessThanOrEqual(BUILDING_DEFS[factory].cost + 1);
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carrying + game.match.stats.goldSpent.us!).toBe(500 + 20000
      - game.resources.reduce((sum, mine) => sum + mine.amount, 0));
  });
