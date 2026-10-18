import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';

// A small version of ladder-16 ember at tick 15787: a stretched column's front
// already counts the approaching soldiers that stand outside its centroid's 900.
it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(detour => ({ version, detour }))))(
  '$version neither double-counts its front nor adds near-centroid enemies across water (detour=$detour)', ({ version, detour }) => {
    let scene = sketchScene('incoming-already-facing').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 1000).goldMine('home', 788, 1000, 10000)
      .townHall('us', 1500, 1000).goldMine('natural', 1788, 1000, 10000)
      .townHall('foe', 3500, 3500).townHall('foe', 3100, 1000, { id: 'target' })
      .unit('us', 'footman', 500, 3500, { id: 'rear' });
    for (let i = 0; i < 4; i++) scene = scene
      .unit('us', 'footman', 2150 - i * 8, 1000, { id: `front-${i}` });
    for (let i = 0; i < (detour ? 8 : 4); i++) scene = scene
      .unit('foe', 'footman', (detour ? 2100 : 2800) + i * 8, detour ? 1650 : 1000, { id: `foe-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    // The water has reachable ends, but every front-to-enemy road exceeds 900.
    const cells = Array.from({ length: 128 * 128 }, (_, i) => {
      const x = i % 128 * 32 + 16, y = Math.floor(i / 128) * 32 + 16;
      return detour && x > 1000 && x < 3500 && y > 1400 && y < 1530 ? '~' : '.';
    }).join('');
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells };
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { phase: 1, general: { mode: 'attack', targetHallId: 'target',
      target: { x: 3100, y: 1000 }, group: game.units.filter(u => u.owner === 'us').map(u => u.id),
      groupStart: 5, enemyCenters: { foe: { x: detour ? 2300 : 2912, y: detour ? 1650 : 1000 } } } };
    const snapshot = snapshotGame(game);
    planBootstrapGeneral(snapshot, 'us', bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
    expect(memory.v6.general).toMatchObject({ mode: 'attack', targetHallId: 'target' });
    expect(memory.v6.retreatedAt).toBeUndefined();
  });
