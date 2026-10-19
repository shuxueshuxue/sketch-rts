import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(counterarmy => ({ version, race, mirror, counterarmy }))))) )(
  '$version chooses the closest eligible $race expansion even when a farther base is cheaper (mirror=$mirror, counter=$counterarmy)',
  ({ version, race, mirror, counterarmy }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('attack-target-eligibility').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).playerState('us', { gold: 0 })
      .player('far', { team: 'b' }).player('near', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('home', x(788), 500, 10000)
      .townHall('us', x(500), 1400).goldMine('natural', x(788), 1400, 10000)
      .townHall('far', x(3200), 3500).worker('far', x(3200), 3400)
      .townHall('far', x(3400), 500, { id: 'cheap-far' }).goldMine('far-mine', x(3688), 500, 10000)
      .townHall('near', x(3600), 3500).worker('near', x(3600), 3400)
      .townHall('near', x(1600), 800, { id: 'eligible-near' }).tower('near', x(1720), 1050);
    for (let index = 0; index < 3; index++) scene = scene.tower('far', x(3050 + index * 100), 3300)
      .tower('near', x(3450 + index * 100), 3300);
    for (let index = 0; counterarmy && index < 20; index++) scene = scene.unit('far', 'knight',
      x(2380 + index % 5 * 45), 2020 + Math.floor(index / 5) * 45);
    for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'knight' : 'ashChieftain',
      x(1000 + index % 2 * 40), 1000 + Math.floor(index / 2) * 40, { id: `fighter-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { phase: 1, general: { mode: 'hold', target: { x: x(1000), y: 1000 }, holdingSince: 0 } };
    const targetId = 'eligible-near';
    const snapshot = snapshotGame(game), commands = planBootstrapGeneral(snapshot, 'us',
      bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    expect(memory.v6.general!.mode).toBe('attack');
    expect(memory.v6.general!.targetHallId).toBe(targetId);
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
    const target = game.buildings.find(building => building.id === targetId)!;
    for (let tick = 0; tick < 1800 && target.hp === target.maxHp; tick++) stepGame(game);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(game.units.filter(unit => unit.id.startsWith('fighter-'))).toHaveLength(8);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
