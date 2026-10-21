import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { snapshotGame } from '../../../shared/sim';
import { createAiPolicyMemory } from '../../memory';
import { currentFactWork, STRATEGY_FACT_WORK_PER_THINK } from '../fact-work';
import { goalValueKey } from '../goal-facts';
import type { GoalPlannerOutput } from '../goal-planner-types';
import { checkPuzzlePlan } from './planner-checks';
import { publicPuzzlePlanner } from './planner-binding';
import { puzzleFailure, serializeScopedPlan, writePuzzlePlanEvidence, type PuzzleThinkEvidence } from './plan-evidence';
import type { PublicPuzzleCase } from './scenes';
import type { PuzzleWorld } from './world';

export const PUBLIC_PUZZLE_MAX_THINKS = 10;

/** Compare actual goals, selected graphs, alternatives, facts and schedules.
 * Search counters, cache cursors and explanatory publication metadata are not
 * plan choices. Their full values remain in the per-think evidence. */
function planHash(output: GoalPlannerOutput) {
  const plans = output.plans.map(({ search: _search, reasons: _reasons, observedTick: _tick, ...plan }) => ({
    ...plan,
    actions: plan.actions.map(({ reasons: _actionReasons, ...action }) => action),
    alternatives: plan.alternatives.map(({ reason: _reason, ...alternative }) => alternative),
    facts: plan.facts.map(({ observation, ...node }) => {
      const { observedTick: _observed, revision: _revision, reason: _reason, evidence: _evidence, ...semantic } = observation;
      const { requestedTick: _requested, ...fact } = semantic as typeof semantic & { requestedTick?: number };
      return { ...node, observation: fact };
    }),
  }));
  return createHash('sha256').update(goalValueKey({ plans,
    readyActions: output.readyActions.map(({ goalId, planId, action }) => ({ goalId, planId, actionId: action.id })) })).digest('hex');
}

/** The exact same snapshot object and owner memory cross native think
 * boundaries. No sim steps, tick edits, cache rewrites or extra work queues.
 * A failed verdict is retained while facts/search may progress next think. */
export function runFrozenPuzzlePlan(puzzle: PublicPuzzleCase, world: PuzzleWorld) {
  const snapshot = snapshotGame(world.game), before = JSON.stringify(snapshot), memory = createAiPolicyMemory();
  const previousWork = currentFactWork(), thinks: PuzzleThinkEvidence[] = [];
  let stable = false, finalFailure: unknown, fatal: unknown;
  try {
    for (let think = 1; think <= PUBLIC_PUZZLE_MAX_THINKS; think++) {
      let calls = 0, scoped: string | undefined, hash: string | null = null, failure: unknown;
      const record: PuzzleThinkEvidence = { think, calls: 0, snapshotUntouched: true,
        passed: false, error: null, planHash: null, work: null, memoryThinkSequence: null };
      thinks.push(record);
      try {
        publicPuzzlePlanner.withInput(snapshot, world.owner, memory, input => {
          calls++;
          expect(input.context.snapshot, 'every think uses the same frozen snapshot object').toBe(snapshot);
          expect(input.context.tick).toBe(world.game.tick);
          expect(currentFactWork()).toBe(input.work);
          let output: GoalPlannerOutput | undefined;
          try {
            output = publicPuzzlePlanner.planGoals(input);
            expect(memory.goalPlanning, 'native owner memory must retain the search continuation').toBeDefined();
            memory.goalPlanning!.cache = output.cache;
            hash = planHash(output);
            try {
              checkPuzzlePlan(puzzle, world, { input, output,
                allocation: publicPuzzlePlanner.allocation?.(input, output) ?? null });
            } catch (error) { failure = error; }
          } finally { scoped = serializeScopedPlan(input, output); }
        });
        expect(calls, 'one search and verdict per native owner-think scope').toBe(1);
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        record.calls = calls; record.planHash = hash; record.error = puzzleFailure(failure);
        record.snapshotUntouched = JSON.stringify(snapshot) === before;
        const observation = memory.strategy?.observation;
        record.memoryThinkSequence = observation?.thinkSequence ?? null;
        // An assembly failure can leave the previous think's receipt in
        // memory. It is not a completed receipt for this attempted think.
        record.work = observation?.factWork?.thinkSequence === think ? structuredClone(observation.factWork) : null;
        if (scoped !== undefined) record.scoped = scoped;
        if (process.env.SKETCH_PUZZLE_PLAN_EVIDENCE) record.memoryAfter = JSON.stringify(memory);
      }
      expect(currentFactWork(), 'each think releases its native work scope').toBe(previousWork);
      expect(record.snapshotUntouched, `think ${think} cannot change the frozen world`).toBe(true);
      expect(record.work?.limit, 'each native think has the ordinary work ceiling').toBe(STRATEGY_FACT_WORK_PER_THINK);
      expect(record.work!.tick, 'publication thinks cannot advance physical time').toBe(snapshot.tick);
      expect(record.work!.thinkSequence, 'each iteration is a new native owner think, not a repeated same-think allowance').toBe(think);
      expect(memory.strategy!.observation.thinkSequence).toBe(think);
      expect(Number.isSafeInteger(record.work!.used)).toBe(true);
      expect(record.work!.used).toBeGreaterThanOrEqual(0);
      expect(record.work!.used).toBeLessThanOrEqual(STRATEGY_FACT_WORK_PER_THINK);
      record.passed = failure === undefined;
      finalFailure = failure;
      const prior = thinks.at(-2);
      stable = hash !== null && prior?.planHash === hash;
      // Repeated blocked/pending graphs must not stop publication early.
      if (stable && record.passed && prior?.passed) break;
    }
    return { thinks, stable, finalFailure, passed: stable && !!thinks.at(-1)?.passed && !!thinks.at(-2)?.passed };
  } catch (error) { fatal = error; throw error; }
  finally { writePuzzlePlanEvidence(puzzle, snapshot, thinks, stable, fatal); }
}
