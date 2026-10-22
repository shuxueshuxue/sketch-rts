import { describe, expect, it } from 'vitest';
import { snapshotGame } from '../../../../shared/sim';
import { isFootprintBuildable, isShoreFootprint, sameGround } from '../../../../shared/terrain';
import { BUILDING_DEFS } from '../../../../shared/catalog';
import { DISRUPTION_CASES } from './scenes';

for (const puzzle of DISRUPTION_CASES) describe(`disruption scene ${puzzle.key}/${puzzle.variant}`, () => {
  it('constructs the same native cold frame with real opponents and connected targets', () => {
    const w = puzzle.create(), again = puzzle.create();
    expect(snapshotGame(w.game)).toEqual(snapshotGame(again.game));
    expect(w.game.units.filter(u => w.interceptors.includes(u.id))).toHaveLength(puzzle.variant === 'large' ? 10 : puzzle.key === 'worker-ambush' ? 2 : 1);
    if (puzzle.variant === 'fast-hit-run') {
      expect(w.game.units.filter(u => w.interceptors.includes(u.id)).map(u => [u.kind, u.speed])).toEqual([['raider', 82], ['raider', 82]]);
      expect(w.army.every(u => u.speed < 82)).toBe(true);
      expect(w.game.buildings.some(b => b.owner === w.owner && b.kind === 'stables')).toBe(false);
    }
    for (const id of w.interceptors) expect(w.game.units.find(u => u.id === id)?.owner).toBe(w.opponent);
    expect(sameGround(w.game.map, w.home, w.mine)).toBe(puzzle.key === 'worker-ambush');
    expect(new Set(w.game.units.map(u => u.id)).size).toBe(w.game.units.length);
    for (const b of w.game.buildings) expect(BUILDING_DEFS[b.kind].shore ? isShoreFootprint(w.game.map, b.x, b.y, b.radius)
      : isFootprintBuildable(w.game.map, b.x, b.y, b.radius)).toBe(true);
  });
});
