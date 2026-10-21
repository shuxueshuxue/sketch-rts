import { describe, expect, it } from 'vitest';
import { snapshotGame } from '../../../shared/sim';
import { isFootprintBuildable, isWalkable, sameGround } from '../../../shared/terrain';
import { BUILDING_DEFS, UNIT_DEFS } from '../../../shared/catalog';
import { boardingBerth } from '../../../shared/naval';
import { neutralCampExposure } from '../../situation/neutral-camp-exposure';
import { checkCommandLegality } from '../../../shared/sim/command-validation';
import { legalBuildingSite } from './world';
import { checkPuzzlePlan } from './planner-checks';
import { publicPuzzlePlanner } from './planner-binding';
import { PUBLIC_PUZZLES, type PuzzleKey } from './scenes';
import { runPublicPuzzle } from './run';

const mainPassingRegressions = new Set(['ship-away/near', 'supply-tier/footmen', 'guarded-shore/weak']);

export function registerPublicPuzzleTests(key: PuzzleKey) {
  for (const puzzle of PUBLIC_PUZZLES.filter(p => p.key === key)) describe(`public planner puzzle: ${puzzle.key}/${puzzle.variant}${mainPassingRegressions.has(`${puzzle.key}/${puzzle.variant}`) ? " [main-passing overaction regression]" : ""}`, () => {
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
    it('exposes the intended prerequisite through native geometry, camp grouping and command admission', () => {
      const world = puzzle.create(), frame = snapshotGame(world.game);
      const camps = neutralCampExposure(frame).camps;
      for (const group of [world.guards, world.beachGuards, world.localGuards].filter(g => g.length)) {
        expect(camps.some(c => [...c.memberIds].sort().join('|') === group.map(u => u.id).sort().join('|')),
          'the authored members must be one real native camp, not a synthetic fact').toBe(true);
      }
      if (world.transport) {
        const passenger = world.islandWorkers[0] ?? world.army[0]!;
        expect(boardingBerth(world.game.map, passenger, world.transport), 'real water/land rendezvous').toBeDefined();
      }
      if (key === 'supply-tier') {
        const stable = world.game.buildings.find(b => b.kind === 'stables')!;
        expect(checkCommandLegality(frame, world.owner, { type: 'train', buildingId: stable.id, unitKind: 'knight' })?.reason).toBe('tier');
        if (puzzle.variant === 'footmen') {
          const barracks = world.game.buildings.find(b => b.kind === 'barracks')!;
          expect(checkCommandLegality(frame, world.owner, { type: 'train', buildingId: barracks.id, unitKind: 'footman' })).toBeUndefined();
          expect(2 * UNIT_DEFS.footman.trainTime).toBeLessThan(BUILDING_DEFS.farm.buildTime + UNIT_DEFS.knight.trainTime);
        }
      }
      if (key === 'navy-zero') {
        const at = legalBuildingSite(world.game, 'shipyard', { x: 1536, y: 1280 });
        expect(checkCommandLegality(frame, world.owner, { type: 'build', unitId: world.workers[0]!.id, buildingKind: 'shipyard', ...at })).toBeUndefined();
      }
      if (key === 'guarded-shore') {
        expect(isWalkable(world.game.map, 2256, 1200), 'no third cheap beach through the cliff ring').toBe(false);
        expect(isWalkable(world.game.map, 2368, 768)).toBe(true);
        expect(isWalkable(world.game.map, 2368, 2944)).toBe(true);
      }
    });
    const required = process.env.SKETCH_REQUIRE_GOAL_PLANNER === '1';
    const coldReady = publicPuzzlePlanner.planGoals && publicPuzzlePlanner.createInput
      && (key !== 'navy-zero' || publicPuzzlePlanner.allocation);
    const executionReady = publicPuzzlePlanner.planGoals && publicPuzzlePlanner.createInput && publicPuzzlePlanner.createExecution;
    const missing = publicPuzzlePlanner.unavailable.join('; ');
    it.skipIf(!coldReady && !required)(`cold-frame dependency graph: real planGoals entry [${coldReady ? 'ready' : missing}]`, () => {
      expect(coldReady, missing).toBeTruthy();
      const world = puzzle.create(), snapshot = snapshotGame(world.game), before = JSON.stringify(snapshot);
      const input = publicPuzzlePlanner.createInput!(snapshot, world.owner);
      const output = publicPuzzlePlanner.planGoals!(input);
      checkPuzzlePlan(puzzle, world, { input, output, allocation: publicPuzzlePlanner.allocation?.(input, output) ?? null });
      expect(JSON.stringify(snapshot), 'real planning cannot change the cold frame').toBe(before);
    });
    it.skipIf(!executionReady && !required)(`goal-planner execution through the real runtime [${executionReady ? 'ready' : missing}]`, () => {
      expect(executionReady, missing).toBeTruthy();
      const session = publicPuzzlePlanner.createExecution!();
      const result = runPublicPuzzle(puzzle, 'v9_knight', { planner: session.commandPlanner });
      expect(session.observations().some(frame => frame.output.plans.length > 0), 'real goal-planner traces, never incumbent fallback').toBe(true);
      expect(result.execution.checks).not.toEqual({});
      expect(result.execution.passed, JSON.stringify(result.execution)).toBe(true);
    }, 180_000);
    it.skipIf(process.env.SKETCH_PUZZLE_WITNESS !== '1')('authored legal witness proves the physical scene is solvable (not an AI verdict)', () => {
      const result = runPublicPuzzle(puzzle, 'witness');
      expect(result.execution.passed, JSON.stringify(result.execution)).toBe(true);
    }, 180_000);
  });
}
