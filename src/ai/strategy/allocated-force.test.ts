import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { neutralCamps, creepForce } from '../policy/v7/creep';
import { strengthOf } from '../policy/v6/strength';
import { assessAllocatedForce } from './allocated-force';

describe('allocated cohort force', () => {
  it('quotes the real sapphire landed party and its four proposed reinforcements as whole groups', () => {
    const data = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()) as {
      frames: Record<string, { snapshot: GameSnapshot; owner: PlayerId }>;
    };
    const { snapshot, owner } = data.frames['Ne-sapphireArchipelago-player-4-17991']!;
    const mine = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
    const camp = neutralCamps(snapshot).sort((a, b) => Math.hypot(a.center.x - mine.x, a.center.y - mine.y)
      - Math.hypot(b.center.x - mine.x, b.center.y - mine.y))[0]!;
    const landed = snapshot.units.find(unit => unit.id === 'unit-player-4-emberRavager-3661')!;
    const reinforcements = snapshot.units.filter(unit => ['5287', '5642', '5789', '5909']
      .some(id => unit.id === `unit-player-4-emberRavager-${id}`));
    expect(reinforcements).toHaveLength(4);
    const alone = assessAllocatedForce(owner, [landed], { metric: 'camp-force', camp });
    const together = assessAllocatedForce(owner, [landed, ...reinforcements], { metric: 'camp-force', camp });
    expect(alone.force).toBeCloseTo(0.9461, 3);
    expect(alone.requiredForce).toBeCloseTo(4.1127, 3);
    expect(alone.sufficient).toBe(false);
    expect(together.force).toBeCloseTo(4.7307, 3);
    expect(together.sufficient).toBe(true);
    expect(together.unitIds).toHaveLength(5);
  });

  it('recomputes free volleys when the allocator adds or removes a shooter', () => {
    const game = sketchScene('allocated-camp-cohort').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .unit('us', 'archer', 1000, 1000).unit('us', 'archer', 1050, 1000)
      .unit('neutral', 'ogreWarrior', 1500, 1500).unit('neutral', 'ogreMage', 1550, 1500).build().createGame();
    const snapshot = snapshotGame(game), camp = neutralCamps(snapshot)[0]!;
    const group = snapshot.units.filter(unit => unit.owner === 'us');
    const total = assessAllocatedForce('us', group, { metric: 'camp-force', camp });
    const singletonSum = group.reduce((sum, unit) => sum + assessAllocatedForce('us', [unit], { metric: 'camp-force', camp }).force, 0);
    expect(total.force).toBe(creepForce(group, camp));
    expect(total.force).toBeGreaterThan(singletonSum);
    expect(assessAllocatedForce('us', group.slice(0, 1), { metric: 'camp-force', camp }).force).toBeLessThan(total.force);
    const before = JSON.stringify(snapshot);
    expect(assessAllocatedForce('us', [...group].reverse(), { metric: 'camp-force', camp })).toEqual(total);
    const foe = { ...group[0]!, id: 'foe', owner: 'foe' }, dead = { ...group[0]!, id: 'dead', hp: 0 };
    expect(assessAllocatedForce('us', [...group, ...group, foe, dead], { metric: 'camp-force', camp })).toEqual(total);
    expect(assessAllocatedForce('us', group, { metric: 'field-strength', requiredForce: 1 }).force).toBe(strengthOf(group));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
