import { existsSync } from 'node:fs';
import type { SdkGameCommandPlanner } from '../../../sdk/game-runner';
import type { GameSnapshot, PlayerId } from '../../../shared/types';
import type { GoalPlannerInput, GoalPlannerOutput } from '../goal-planner-types';
import { planGoals } from '../goal-planner';
import { createGoalFactReader } from '../goal-world-facts';
import type { StrategyAllocationTrace } from '../allocation-types';
import type { PuzzlePlanObservation } from './planner-checks';

export type PlanGoals = typeof planGoals;
/** Only a native owner-think assembly may implement this port. It must use
 * createGoalFactReader and the ordinary collectors/providers/FactWorkQueue,
 * never a scene key, expected landing, authored observation or witness. */
export type NativePuzzleInput = (snapshot: GameSnapshot, owner: PlayerId) => GoalPlannerInput;
export type PuzzlePlannerExecution = {
  commandPlanner: SdkGameCommandPlanner;
  /** Actual same-think records from the goal-planner/allocator boundary. */
  observations(): readonly PuzzlePlanObservation[];
};
export type NativePuzzleModule = {
  createInput: NativePuzzleInput;
  allocation(input: GoalPlannerInput, output: GoalPlannerOutput): StrategyAllocationTrace | null;
  createExecution(): PuzzlePlannerExecution;
};

type Available<T> = { value: T; unavailable?: never } | { value?: never; unavailable: string };
/** Missing files/exports mean an explicitly unfinished capability. A defined
 * non-function is an integration error, never silently skipped. */
export async function optionalFunction<T extends (...args: never[]) => unknown>(relative: string, name: string): Promise<Available<T>> {
  const url = new URL(relative, import.meta.url);
  if (!existsSync(url)) return { unavailable: `${relative}: module not implemented` };
  const module: Record<string, unknown> = await import(/* @vite-ignore */ url.href);
  if (module[name] === undefined) return { unavailable: `${relative}: ${name} not exported yet` };
  if (typeof module[name] !== 'function') throw new Error(`${relative}: ${name} must be a function`);
  return { value: module[name] as T };
}

/** Search and current-world reader are the real shared exports. The native
 * adapter awaits the owner-think assembly; its absence cannot fall back to
 * the incumbent AI or witness. */
const [input, allocation, execution] = await Promise.all([
  optionalFunction<NativePuzzleModule['createInput']>('./goal-planner-native.ts', 'createInput'),
  optionalFunction<NativePuzzleModule['allocation']>('./goal-planner-native.ts', 'allocation'),
  optionalFunction<NativePuzzleModule['createExecution']>('./goal-planner-native.ts', 'createExecution'),
]);
export const publicPuzzlePlanner = {
  planGoals,
  createGoalFactReader,
  createInput: input.value,
  allocation: allocation.value,
  createExecution: execution.value,
  unavailable: [input.unavailable, allocation.unavailable, execution.unavailable]
    .filter((reason): reason is string => reason !== undefined),
};
