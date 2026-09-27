import type { RaceId } from "../../shared/types";
import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { SUMMONING_UNIT_KINDS } from "../policy/versions";
import type { AiMeleeControlMatchDetailsResult } from "./control";
import {
  createSubjectGauntletInput,
  runSubjectGauntletDetailsParallel,
  runSubjectGauntletParallel,
  summarizeSubjectGauntlet,
  type SubjectGauntlet,
  type SubjectGauntletInput,
  type SubjectGauntletOptions,
  type SubjectGauntletResult,
} from "./subject-gauntlet";

// @@@v8-gauntlet - V8 alone against a pair drawn from V5+V7, V3+V7 and V3+V5, blind to which is which (see
// subject-gauntlet for the procedure). The report counts the games in which V8 fielded a summoning unit, which it must not.

export type AiV8GauntletBenchmarkOptions = SubjectGauntletOptions;
export type AiV8GauntletBenchmarkInput = SubjectGauntletInput;

type Tally = { wins: number; matches: number; winRate: number };

export type AiV8GauntletBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v8Wins: number;
  rawMatches: number;
  winRate: number;
  lossesTo: { v3: number; v5: number; v7: number; timeout: number };
  byPair: Record<string, Tally>;
  byV8Race: Record<RaceId, Tally>;
  byStrategy: Record<string, Tally>;
  plays: Record<string, { won: number; lost: number }>;
  summonerGames: number;
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
  byMap: SubjectGauntletResult["byMap"];
};

export const V8_OPPONENT_PAIRS = [
  ["v5", "v7"],
  ["v3", "v7"],
  ["v3", "v5"],
] as const;

export const V8_GAUNTLET: SubjectGauntlet = {
  subject: "v8",
  pairs: V8_OPPONENT_PAIRS,
  doctrineTracker: "v8Doctrine",
  watchedKinds: SUMMONING_UNIT_KINDS,
  name: "AI V8 vs pairs of V3, V5 and V7 Benchmark",
  evaluationName: "v8 1v2 vs pairs of v3, v5, v7",
};

export function createAiV8GauntletBenchmarkInput(options: AiV8GauntletBenchmarkOptions = {}): AiV8GauntletBenchmarkInput {
  return createSubjectGauntletInput(V8_GAUNTLET, options);
}

export async function runAiV8GauntletBenchmarkParallel(options: AiV8GauntletBenchmarkOptions = {}): Promise<AiV8GauntletBenchmarkResult> {
  return asV8Result(await runSubjectGauntletParallel(V8_GAUNTLET, options));
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
    lossesTo: { v3: lossesTo.v3 ?? 0, v5: lossesTo.v5 ?? 0, v7: lossesTo.v7 ?? 0, timeout: lossesTo.timeout ?? 0 },
    byPair: result.byPair,
    byV8Race: byRace,
    byStrategy: result.byStrategy,
    plays: result.plays,
    summonerGames: watchedGames,
    elapsedMs: result.elapsedMs,
    cpuMs: result.cpuMs,
    ...(result.workers !== undefined ? { workers: result.workers } : {}),
    byMap: result.byMap,
  };
}
