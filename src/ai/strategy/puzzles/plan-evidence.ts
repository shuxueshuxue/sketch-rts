import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { GameSnapshot } from '../../../shared/types';
import type { GoalPlannerInput, GoalPlannerOutput } from '../goal-planner-types';
import type { PublicPuzzleCase } from './scenes';

/** Serialize inside the physical scope. No live input, query, provider or
 * terrain lease leaves it; the outside writer receives ordinary bytes only. */
export function serializeScopedPlan(input: GoalPlannerInput, output: GoalPlannerOutput | undefined) {
  if (!process.env.SKETCH_PUZZLE_PLAN_EVIDENCE) return undefined;
  const workAtPlan = structuredClone(input.work.receipt);
  // Reporting probes run after search/verdict, in the same physical scope.
  // They read the actual grounding port, never replace the search result,
  // grant extra allowance or run a second planning pass.
  const hallGrounding: { factId: string; result?: unknown; error?: string }[] = [];
  for (const fact of input.goals.flatMap(goal => goal.effects)) {
    const p = fact.predicate;
    if (p.kind !== 'hall-complete') continue;
    try { hallGrounding.push({ factId: fact.id,
      result: input.context.grounding?.buildSites('townHall', { ...p.at, entityId: p.mineId }) ?? null }); }
    catch (error) { hallGrounding.push({ factId: fact.id, error: String(error) }); }
  }
  return JSON.stringify({ context: { tick: input.context.tick, owner: input.context.owner,
    version: input.context.version, situation: input.context.situation },
  goals: input.goals, initialBalances: input.initialBalances, limits: input.limits,
  declarationRevision: input.declarationRevision, providerIds: input.providers.map(provider => provider.id),
  work: workAtPlan, output: output ?? null,
  ports: { combatOptions: typeof input.context.grounding?.combatOptions === 'function',
    futureProjection: typeof input.context.readProjectedFact === 'function' },
  afterPlanHallGrounding: hallGrounding });
}

export function writePuzzlePlanEvidence(puzzle: PublicPuzzleCase, snapshot: GameSnapshot, scoped: string | undefined,
  calls: number, snapshotUntouched: boolean, error: unknown) {
  const directory = process.env.SKETCH_PUZZLE_PLAN_EVIDENCE;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const failure = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack }
    : error === undefined ? null : { message: String(error) };
  const record = { puzzle: `${puzzle.key}/${puzzle.variant}`, snapshot,
    phase: !scoped ? 'assembly' : 'plan-verdict', calls, snapshotUntouched,
    passed: !failure && calls === 1 && snapshotUntouched, error: failure,
    observed: scoped ? JSON.parse(scoped) as unknown : null };
  writeFileSync(resolve(directory, `${puzzle.key}-${puzzle.variant}.json.gz`), gzipSync(JSON.stringify(record)));
}
