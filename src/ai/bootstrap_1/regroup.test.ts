import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6General } from '../policy/v6/general';
import { readV6Intel } from '../policy/v6/intel';
import { v9FrontPoint } from '../policy/v9/front';
import { bootstrapPolicyContext } from './policy';

describe('bootstrap_1 regrouping', () => {
  it.each(['grove', 'ember'] as const)('brings the %s shooting line home instead of fighting towers on its return order', race => {
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
    let scene = sketchScene('regroup-past-towers').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 1000).townHall('foe', 3500, 3000)
      .tower('foe', 2500, 1000).tower('foe', 2550, 1100).tower('foe', 2550, 900);
    for (let index = 0; index < 6; index++) scene = scene.unit('us', shooter, 2280, 925 + index * 30);
    for (let index = 0; index < 18; index++) scene = scene.unit('foe', 'knight', 3400 + index % 3 * 35, 2900 + Math.floor(index / 3) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory(); memory.v6 = { phase: 3 };
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    const options = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams });
    const post = v9FrontPoint(snapshotGame(game), 'us', readV6Intel(snapshotGame(game), 'us', options()));
    issuePlayerCommand(game, 'us', { type: 'attackMove', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), ...post });
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 15 === 0) for (const command of planV6General(snapshotGame(game), 'us', options())) issuePlayerCommand(game, 'us', command);
      stepGame(game);
    }
    const line = game.units.filter(unit => unit.owner === 'us');
    // The line starts inside three towers: return most of it rather than spending it on their fire.
    expect(line.length).toBeGreaterThan(3);
    expect(Math.max(...line.map(unit => Math.hypot(unit.x - post.x, unit.y - post.y)))).toBeLessThan(650);
    expect(game.buildings.filter(building => building.owner === 'foe' && building.kind === 'defenseTower')).toHaveLength(3);
  });
});
