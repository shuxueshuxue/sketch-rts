import { existsSync } from 'node:fs';
import type { SdkGameCommandPlanner } from '../../../sdk/game-runner';
import type { GameSnapshot, PlayerId } from '../../../shared/types';
import type { AiPolicyMemory } from '../../memory';
import type { GoalPlannerInput, GoalPlannerOutput } from '../goal-planner-types';
import { planGoals } from '../goal-planner';
import { createGoalFactReader } from '../goal-world-facts';
import { withGoalPlannerInput } from '../goal-planner-input';
import type { StrategyAllocationTrace } from '../allocation-types';
import type { PuzzlePlanObservation } from './planner-checks';
import { withInput } from './goal-planner-native';

export type PlanGoals = typeof planGoals;
/** Only a native owner-think assembly may implement this port. It must use
 * createGoalFactReader and the ordinary collectors/providers/FactWorkQueue,
 * never a scene key, expected landing, authored observation or witness. */
export type NativePuzzleInputScope = <T>(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  run: (input: GoalPlannerInput) => T) => T;
export type PuzzlePlannerExecution = {
  commandPlanner: SdkGameCommandPlanner;
  /** Actual same-think records from the goal-planner/allocator boundary. */
  observations(): readonly PuzzlePlanObservation[];
};
export type NativePuzzleModule = {
  withInput: NativePuzzleInputScope;
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

/** Cold planning uses the real shared Objective collector. Actual grants and
 * command execution remain separate capabilities; neither gets a fake grant
 * or incumbent/witness fallback. */
const [allocation, execution] = await Promise.all([
  optionalFunction<NativePuzzleModule['allocation']>('./goal-planner-native.ts', 'allocation'),
  optionalFunction<NativePuzzleModule['createExecution']>('./goal-planner-native.ts', 'createExecution'),
]);
export const publicPuzzlePlanner = {
  planGoals,
  createGoalFactReader,
  withGoalPlannerInput,
  withInput,
  allocation: allocation.value,
  createExecution: execution.value,
  unavailable: [allocation.unavailable, execution.unavailable]
    .filter((reason): reason is string => reason !== undefined),
};
