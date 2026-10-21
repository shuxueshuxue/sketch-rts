import type { GoalActionDeclaration, GoalAlternative, GoalFact, GoalFactObservation, GoalEntityReference } from './goal-planner-types';

export type GoalSearchStep = { action: GoalActionDeclaration; startTick: number; finishTick: number; dependsOn: string[] };
export type GoalSearchPath = { steps: GoalSearchStep[]; bindings: Readonly<Record<string, GoalEntityReference>>; cost: number; probability: number };
/** Serializable search state contains declarations and observed facts, never
 * query closures, world snapshots, executable tasks or invented world IDs. */
export type GoalSearchMemory = {
  version: 1; phase: 'regress' | 'compose' | 'done';
  requests: { fact: GoalFact; depth: number }[]; regressed: string[]; observed: GoalFactObservation[];
  candidates: GoalActionDeclaration[]; alternatives: GoalAlternative[];
  frontier: GoalSearchPath[]; active: { path: GoalSearchPath; next: number } | null; solutions: GoalSearchPath[];
  visited: string[]; expansions: number; depth: number; limitReason: string | null;
};
