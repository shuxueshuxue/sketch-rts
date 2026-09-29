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
  type OpponentVersion,
} from "./subject-gauntlet";

// @@@v9-gauntlet - V9 alone against V8, V5 and V7 together in every game (1v3, four players on the map), blind to which
// is which (see subject-gauntlet for the procedure). V9 may field any unit; the report counts the games in which it
// fielded a shooter or a summoner (V8's forbidden kinds), to show the style it plays. The report is the subject
// gauntlet's own. Every game is played on a generated layout (see @@@generated-map): four players on the authored maps
// shared three contested mines and one natural, and one arrangement of starts stood for all fifty maps.

// `rivals` plays the same procedure and maps against another group (a duel against V8, a pair) while V9 is developed.
export type AiV9GauntletBenchmarkOptions = SubjectGauntletOptions & { rivals?: readonly OpponentVersion[] };
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
  generatedLayouts: true,
};

export function v9Gauntlet(rivals?: readonly OpponentVersion[]): SubjectGauntlet {
  if (!rivals || rivals.join(",") === V9_RIVALS[0].join(",")) return V9_GAUNTLET;
  const named = [...rivals].sort().join("+");
  return { ...V9_GAUNTLET, groups: [rivals], name: `AI V9 vs ${named} Benchmark`, evaluationName: `v9 1v${rivals.length} vs ${named}` };
}

export function createAiV9GauntletBenchmarkInput(options: AiV9GauntletBenchmarkOptions = {}): AiV9GauntletBenchmarkInput {
  return createSubjectGauntletInput(v9Gauntlet(options.rivals), options);
}

export function runAiV9GauntletBenchmarkParallel(options: AiV9GauntletBenchmarkOptions = {}): Promise<AiV9GauntletBenchmarkResult> {
  return runSubjectGauntletParallel(v9Gauntlet(options.rivals), options);
}

// Several seeds in one worker pool (see @@@gauntlet-seed-pool): each seed's result as its own run reports it, and the pool.
export function runAiV9GauntletBenchmarkSeedsParallel(options: AiV9GauntletBenchmarkOptions, seeds: readonly string[]): Promise<{ results: AiV9GauntletBenchmarkResult[]; pool: SubjectGauntletPool }> {
  return runSubjectGauntletSeedsParallel(v9Gauntlet(options.rivals), options, seeds);
}

export function runAiV9GauntletBenchmarkDetailsParallel(options: AiV9GauntletBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  return runSubjectGauntletDetailsParallel(v9Gauntlet(options.rivals), options, filter);
}

export function summarizeAiV9GauntletBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV9GauntletBenchmarkResult {
  return summarizeSubjectGauntlet(V9_GAUNTLET, input);
}
