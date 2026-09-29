import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { V8_FORBIDDEN_UNIT_KINDS } from "../policy/versions";
import type { AiMeleeControlMatchDetailsResult } from "./control";
import {
  createSubjectGauntletInput,
  runSubjectGauntletDetailsParallel,
  runSubjectGauntletParallel,
  runSubjectGauntletSeedsParallel,
  summarizeSubjectGauntlet,
  type SubjectGauntlet,
  type SubjectGauntletInput,
  type SubjectGauntletOptions,
  type SubjectGauntletPool,
  type SubjectGauntletResult,
} from "./subject-gauntlet";

// @@@v9-gauntlet - V9 alone against V8, V5 and V7 together in every game (1v3, four players on the map), blind to which
// is which (see subject-gauntlet for the procedure). V9 may field any unit; the report counts the games in which it
// fielded a shooter or a summoner (V8's forbidden kinds), to show the style it plays. The report is the subject
// gauntlet's own.

export type AiV9GauntletBenchmarkOptions = SubjectGauntletOptions;
export type AiV9GauntletBenchmarkInput = SubjectGauntletInput;
export type AiV9GauntletBenchmarkResult = SubjectGauntletResult;

export const V9_RIVALS = [["v8", "v5", "v7"]] as const;

export const V9_GAUNTLET: SubjectGauntlet = {
  subject: "v9",
  groups: V9_RIVALS,
  doctrineTracker: "v9Doctrine",
  watchedKinds: V8_FORBIDDEN_UNIT_KINDS,
  name: "AI V9 vs V5, V7 and V8 Benchmark",
  evaluationName: "v9 1v3 vs v5+v7+v8",
};

export function createAiV9GauntletBenchmarkInput(options: AiV9GauntletBenchmarkOptions = {}): AiV9GauntletBenchmarkInput {
  return createSubjectGauntletInput(V9_GAUNTLET, options);
}

export function runAiV9GauntletBenchmarkParallel(options: AiV9GauntletBenchmarkOptions = {}): Promise<AiV9GauntletBenchmarkResult> {
  return runSubjectGauntletParallel(V9_GAUNTLET, options);
}

// Several seeds in one worker pool (see @@@gauntlet-seed-pool): each seed's result as its own run reports it, and the pool.
export function runAiV9GauntletBenchmarkSeedsParallel(options: AiV9GauntletBenchmarkOptions, seeds: readonly string[]): Promise<{ results: AiV9GauntletBenchmarkResult[]; pool: SubjectGauntletPool }> {
  return runSubjectGauntletSeedsParallel(V9_GAUNTLET, options, seeds);
}

export function runAiV9GauntletBenchmarkDetailsParallel(options: AiV9GauntletBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  return runSubjectGauntletDetailsParallel(V9_GAUNTLET, options, filter);
}

export function summarizeAiV9GauntletBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV9GauntletBenchmarkResult {
  return summarizeSubjectGauntlet(V9_GAUNTLET, input);
}
