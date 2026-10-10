import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'uses the same short road for $race summoner expansion and escort (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const caster = race === 'grove' ? 'summoner' : 'pyreCaller', fighter = race === 'grove' ? 'lancer' : 'ashWarden';
    let scene = sketchScene('common-expansion-road').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(2400), 500, { id: 'main-hall' }).townHall('foe', x(3500), 3500)
      .goldMine('main', x(2400 + GOLD_MINE_RULES.mainDistance), 500, 6000)
      .goldMine('across-wall', x(1800), 1000, 6000).goldMine('short-road', x(2400), 1600, 6000)
      .unit('neutral', 'ogreWarrior', x(1800), 1000, { id: 'guard' }).farms('us', 4, x(3400), 700);
    for (let index = 0; index < 3; index++) scene = scene.worker('us', x(2480), 450 + index * 30, { id: `worker-${index}` });
    for (let index = 0; index < 6; index++) scene = scene.unit('us', fighter, x(2320 + index % 3 * 45),
      1170 + Math.floor(index / 3) * 45, { id: `front-${index}` });
    for (let index = 0; index < 5; index++) scene = scene.unit('us', caster, x(2300 + index * 45), 1050);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
      index % 128 === (mirror ? 63 : 64) && Math.floor(index / 128) < 100 ? 'T' : '.').join('') };
    const hall = game.buildings.find(building => building.id === 'main-hall')!;
    const across = game.resources.find(mine => mine.id === 'across-wall')!, local = game.resources.find(mine => mine.id === 'short-road')!;
    expect(Math.hypot(hall.x - across.x, hall.y - across.y)).toBeLessThan(Math.hypot(hall.x - local.x, hall.y - local.y));
    expect(walkingDistance(game.map, hall, across)!).toBeGreaterThan(2 * walkingDistance(game.map, hall, local)!);
    const sites: { x: number; y: number }[] = [];
    for (let tick = 0; tick < 1500; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory }, { teams: game.teams });
        for (const { command } of entries) if (command.type === 'build' && command.buildingKind === 'townHall') sites.push(command);
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(point => Math.hypot(point.x - local.x, point.y - local.y) <= GOLD_MINE_RULES.baseRange)).toBe(true);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && building.complete
      && Math.hypot(building.x - local.x, building.y - local.y) <= GOLD_MINE_RULES.baseRange)).toBe(true);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(400);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
