import type { RaceId } from "../../shared/types";
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
  type SubjectGauntletPool,
  type SubjectGauntletInput,
  type SubjectGauntletOptions,
  type SubjectGauntletResult,
} from "./subject-gauntlet";

// @@@v8-gauntlet - V8 alone against V5 and V7 together in every game, blind to which is which (see subject-gauntlet for
// the procedure). The report counts the games in which V8 fielded a shooter or a summoner, which it must not.

export type AiV8GauntletBenchmarkOptions = SubjectGauntletOptions;
export type AiV8GauntletBenchmarkInput = SubjectGauntletInput;

type Tally = { wins: number; matches: number; winRate: number };

export type AiV8GauntletBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v8Wins: number;
  rawMatches: number;
  winRate: number;
  lossesTo: { v5: number; v7: number; timeout: number };
  byPair: Record<string, Tally>;
  byV8Race: Record<RaceId, Tally>;
  byStrategy: Record<string, Tally>;
  plays: Record<string, { won: number; lost: number }>;
  forbiddenGames: number;
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
  nudges?: number;
  nudgeAt?: number;
  byMap: SubjectGauntletResult["byMap"];
};

export const V8_OPPONENT_PAIRS = [["v5", "v7"]] as const;

export const V8_GAUNTLET: SubjectGauntlet = {
  subject: "v8",
  pairs: V8_OPPONENT_PAIRS,
  doctrineTracker: "v8Doctrine",
  watchedKinds: V8_FORBIDDEN_UNIT_KINDS,
  name: "AI V8 vs V5 and V7 Benchmark",
  evaluationName: "v8 1v2 vs v5+v7",
};

export function createAiV8GauntletBenchmarkInput(options: AiV8GauntletBenchmarkOptions = {}): AiV8GauntletBenchmarkInput {
  return createSubjectGauntletInput(V8_GAUNTLET, options);
}

export async function runAiV8GauntletBenchmarkParallel(options: AiV8GauntletBenchmarkOptions = {}): Promise<AiV8GauntletBenchmarkResult> {
  return asV8Result(await runSubjectGauntletParallel(V8_GAUNTLET, options));
}

// Several seeds in one worker pool (see @@@gauntlet-seed-pool): each seed's result as its own run reports it, and the pool.
export async function runAiV8GauntletBenchmarkSeedsParallel(options: AiV8GauntletBenchmarkOptions, seeds: readonly string[]): Promise<{ results: AiV8GauntletBenchmarkResult[]; pool: SubjectGauntletPool }> {
  const { results, pool } = await runSubjectGauntletSeedsParallel(V8_GAUNTLET, options, seeds);
  return { results: results.map(asV8Result), pool };
}

export function runAiV8GauntletBenchmarkDetailsParallel(options: AiV8GauntletBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  return runSubjectGauntletDetailsParallel(V8_GAUNTLET, options, filter);
}

export function summarizeAiV8GauntletBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV8GauntletBenchmarkResult {
  return asV8Result(summarizeSubjectGauntlet(V8_GAUNTLET, input));
}

function asV8Result(result: SubjectGauntletResult): AiV8GauntletBenchmarkResult {
  const { wins, lossesTo, byRace, watchedGames } = result;
  return {
    seed: result.seed,
    selectedMapIds: result.selectedMapIds,
    v8Wins: wins,
    rawMatches: result.rawMatches,
    winRate: result.winRate,
    lossesTo: { v5: lossesTo.v5 ?? 0, v7: lossesTo.v7 ?? 0, timeout: lossesTo.timeout ?? 0 },
    byPair: result.byPair,
    byV8Race: byRace,
    byStrategy: result.byStrategy,
    plays: result.plays,
    forbiddenGames: watchedGames,
    elapsedMs: result.elapsedMs,
    cpuMs: result.cpuMs,
    ...(result.workers !== undefined ? { workers: result.workers } : {}),
    ...(result.nudges !== undefined ? { nudges: result.nudges, nudgeAt: result.nudgeAt } : {}),
    byMap: result.byMap,
  };
}
