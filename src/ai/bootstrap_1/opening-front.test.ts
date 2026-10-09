import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import { planBootstrapGeneral } from './mine-defense';
import { bootstrapPolicyContext } from './policy';

const cases = (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirrored =>
  [false, true].map(guarded => ({ race, mirrored, guarded }))));

describe('opening front at an uncleared natural', () => {
  it.each(cases)('keeps $race at home only while the camp stands (mirrored=$mirrored, guarded=$guarded)', ({ race, mirrored, guarded }) => {
    const at = (x: number, y: number) => ({ x: mirrored ? 4096 - x : x, y });
    const home = at(500, 500), natural = at(1450, 1100);
    const fighter = race === 'grove' ? 'lancer' : 'emberRavager';
    let scene = sketchScene('opening-front-around-cliff').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', home.x, home.y).goldMine('main', at(788, 500).x, 500, 10000)
      .goldMine('natural', natural.x, natural.y, 10000)
      .townHall('foe', at(3500, 2000).x, 2000)
      .unit('us', fighter, at(650, 500).x, 500, { id: 'opening-fighter' });
    for (let i = 0; i < 10; i++) {
      const point = at(3400 + i % 5 * 30, 2000 + Math.floor(i / 5) * 30);
      scene = scene.unit('foe', 'knight', point.x, point.y, { order: { type: 'hold', ...point } });
    }
    if (guarded) scene = scene.unit('neutral', 'ogreWarrior', natural.x, natural.y)
      .unit('neutral', 'ogreMage', at(1510, 1130).x, 1130);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 0 };
    // The route to the natural winds around a cliff; its safe far endpoint is not an opening rally.
    let cells = '';
    for (let row = 0; row < 128; row++) for (let col = 0; col < 128; col++) {
      cells += row >= 20 && row <= 25 && (mirrored ? 127 - col : col) < 64 ? '#' : '.';
    }
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells };
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        const options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
        for (const command of planBootstrapGeneral(snapshot, 'us', options)) issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    const unit = game.units.find(unit => unit.id === 'opening-fighter')!;
    expect(unit.hp).toBe(unit.maxHp);
    if (guarded) {
      expect(distance(unit, home)).toBeLessThan(GOLD_MINE_RULES.baseRange);
      expect(game.units.filter(unit => unit.owner === 'neutral')).toHaveLength(2);
      expect(game.units.filter(unit => unit.owner === 'neutral').every(unit => unit.hp === unit.maxHp)).toBe(true);
    } else {
      expect(distance(unit, home)).toBeGreaterThan(GOLD_MINE_RULES.baseRange);
      expect(distance(unit, natural)).toBeLessThan(GOLD_MINE_RULES.baseRange);
    }
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
