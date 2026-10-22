import type { GoalActionDeclaration, GoalAlternative, GoalDeferredCandidate, GoalFact, GoalFactObservation, GoalEntityReference } from './goal-planner-types';

export type GoalSearchStep = { action: GoalActionDeclaration; startTick: number; finishTick: number; dependsOn: string[] };
export type GoalSearchPath = { steps: GoalSearchStep[]; bindings: Readonly<Record<string, GoalEntityReference>>; cost: number; probability: number };
/** Serializable search state contains declarations and observed facts, never
 * query closures, world snapshots, executable tasks or invented world IDs. */
export type GoalSearchMemory = {
  demandDriven?: true;
  regenerateDeferred?: true;
  version: 1; phase: 'regress' | 'compose' | 'done';
  requests: { fact: GoalFact; depth: number }[]; regressed: string[]; observed: GoalFactObservation[];
  candidates: GoalActionDeclaration[]; alternatives: GoalAlternative[];
  deferred?: (GoalDeferredCandidate & { factId: string })[];
  frontier: GoalSearchPath[]; active: { path: GoalSearchPath; next: number; candidateIds?: string[] } | null; solutions: GoalSearchPath[];
  visited: string[]; expansions: number; depth: number; limitReason: string | null;
  coarse?: { path: GoalSearchPath; root: number; stack: {
    fact: GoalFact; options?: string[]; next: number; selected?: string;
    checkpoint: GoalSearchPath; required?: GoalFact[]; prerequisite: number;
  }[] };
};
