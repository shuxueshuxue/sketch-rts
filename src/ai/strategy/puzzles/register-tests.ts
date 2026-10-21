import { describe, expect, it } from 'vitest';
import { snapshotGame } from '../../../shared/sim';
import { isFootprintBuildable, sameGround } from '../../../shared/terrain';
import { BUILDING_DEFS, UNIT_DEFS } from '../../../shared/catalog';
import { checkPuzzlePlan } from './planner-checks';
import { publicPuzzlePlanner } from './planner-binding';
import { PUBLIC_PUZZLES, type PuzzleKey } from './scenes';
import { runPublicPuzzle } from './run';

export function registerPublicPuzzleTests(key: PuzzleKey) {
  for (const puzzle of PUBLIC_PUZZLES.filter(p => p.key === key)) describe(`public planner puzzle: ${puzzle.key}/${puzzle.variant}`, () => {
    it('constructs a deterministic cold frame using native entities, catalogue prices and connected terrain', () => {
      const a = puzzle.create(), b = puzzle.create(), frame = snapshotGame(a.game);
      expect(frame).toEqual(snapshotGame(b.game));
      expect(new Set(a.game.units.map(u => u.id)).size).toBe(a.game.units.length);
      expect(a.home.complete).toBe(true);
      expect(a.workers.length).toBeGreaterThan(0);
      expect(a.mine.amount).toBeGreaterThan(0);
      expect(sameGround(a.game.map, a.home, a.mine)).toBe(key === 'supply-tier');
      for (const building of a.game.buildings) expect(isFootprintBuildable(a.game.map, building.x, building.y, building.radius)).toBe(true);
      if (key === 'navy-zero') {
        expect(a.transport).toBeUndefined();
        expect(a.game.buildings.some(b => b.kind === 'shipyard')).toBe(false);
        expect(a.game.players[a.owner]!.gold).toBe(BUILDING_DEFS.shipyard.cost + UNIT_DEFS.transport.cost + BUILDING_DEFS.townHall.cost);
      }
    });
    it.skipIf(!publicPuzzlePlanner)('cold-frame dependency graph: required actions, causal order and forbidden choices', () => {
      const world = puzzle.create();
      checkPuzzlePlan(puzzle, world, publicPuzzlePlanner!.cold(world));
    });
    it.skipIf(!publicPuzzlePlanner)('goal-planner execution reaches the objective under real simulation rules', () => {
      const result = runPublicPuzzle(puzzle, 'v9_knight', { planner: publicPuzzlePlanner!.commands });
      expect(result.execution.checks).not.toEqual({});
      expect(result.execution.passed, JSON.stringify(result.execution)).toBe(true);
    }, 180_000);
    it.skipIf(process.env.SKETCH_PUZZLE_WITNESS !== '1')('authored legal witness proves the physical scene is solvable (not an AI verdict)', () => {
      const result = runPublicPuzzle(puzzle, 'witness');
      expect(result.execution.passed, JSON.stringify(result.execution)).toBe(true);
    }, 180_000);
  });
}
