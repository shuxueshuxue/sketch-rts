import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { GameSnapshot } from '../../../shared/types';
import type { GoalPlannerInput, GoalPlannerOutput } from '../goal-planner-types';
import type { FactWorkReceipt } from '../fact-work';
import type { PublicPuzzleCase } from './scenes';

export type PuzzleThinkEvidence = {
  think: number; calls: number; snapshotUntouched: boolean; passed: boolean;
  error: ReturnType<typeof puzzleFailure>; planHash: string | null;
  work: FactWorkReceipt | null; memoryThinkSequence: number | null; scoped?: string; memoryAfter?: string;
};
export function puzzleFailure(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack }
    : error === undefined ? null : { name: 'ThrownValue', message: String(error) };
}

/** Serialize inside the physical scope. No live input, query, provider or
 * terrain lease leaves it; the outside writer receives ordinary bytes only. */
export function serializeScopedPlan(input: GoalPlannerInput, output: GoalPlannerOutput | undefined) {
  if (!process.env.SKETCH_PUZZLE_PLAN_EVIDENCE) return undefined;
  const workAtPlan = structuredClone(input.work.receipt);
  // Recording must not register diagnostic geometry jobs: their publication
  // could otherwise change a later think in this frozen-world run.
  return JSON.stringify({ context: { tick: input.context.tick, owner: input.context.owner,
    version: input.context.version, situation: input.context.situation },
  goals: input.goals, initialBalances: input.initialBalances, limits: input.limits,
  declarationRevision: input.declarationRevision, providerIds: input.providers.map(provider => provider.id),
  work: workAtPlan, output: output ?? null,
  ports: { combatOptions: typeof input.context.grounding?.combatOptions === 'function',
    futureProjection: typeof input.context.readProjectedFact === 'function' } });
}

export function writePuzzlePlanEvidence(puzzle: PublicPuzzleCase, snapshot: GameSnapshot,
  thinks: readonly PuzzleThinkEvidence[], stable: boolean, error: unknown) {
  const directory = process.env.SKETCH_PUZZLE_PLAN_EVIDENCE;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const failure = puzzleFailure(error), final = thinks.at(-1);
  const record = { puzzle: `${puzzle.key}/${puzzle.variant}`, snapshot,
    maxThinks: 10, firstThink: thinks[0]?.think ?? null, finalThink: final?.think ?? null,
    stable, passed: !failure && !!final?.passed && !!thinks.at(-2)?.passed && stable, error: failure,
    thinks: thinks.map(({ scoped, memoryAfter, ...think }) => ({ ...think,
      phase: !scoped ? 'assembly' : 'plan-verdict',
      observed: scoped ? JSON.parse(scoped) as unknown : null,
      memoryAfter: memoryAfter ? JSON.parse(memoryAfter) as unknown : null })) };
  writeFileSync(resolve(directory, `${puzzle.key}-${puzzle.variant}.json.gz`), gzipSync(JSON.stringify(record)));
}
