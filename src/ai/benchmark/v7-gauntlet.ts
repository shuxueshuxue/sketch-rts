import type { RaceId } from "../../shared/types";
import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { SHOOTER_UNIT_KINDS } from "../policy/versions";
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

// @@@v7-gauntlet - V7 alone against a pair drawn from V5+V6, V3+V6 and V3+V5, blind to which is which (see
// subject-gauntlet for the procedure).

export type AiV7GauntletBenchmarkOptions = SubjectGauntletOptions;
export type AiV7GauntletBenchmarkInput = SubjectGauntletInput;

type Tally = { wins: number; matches: number; winRate: number };

export type AiV7GauntletBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v7Wins: number;
  rawMatches: number;
  winRate: number;
  lossesTo: { v3: number; v5: number; v6: number; timeout: number };
  byPair: Record<string, Tally>;
  byV7Race: Record<RaceId, Tally>;
  byStrategy: Record<string, Tally>;
  plays: Record<string, { won: number; lost: number }>;
  // Games in which V7 trained, hired or fielded a shooter (allowed; counted to see the style it plays).
  shooterGames: number;
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
  byMap: SubjectGauntletResult["byMap"];
};

export const V7_OPPONENT_PAIRS = [
  ["v5", "v6"],
  ["v3", "v6"],
  ["v3", "v5"],
] as const;

export const V7_GAUNTLET: SubjectGauntlet = {
  subject: "v7",
  pairs: V7_OPPONENT_PAIRS,
  doctrineTracker: "v7Doctrine",
  watchedKinds: SHOOTER_UNIT_KINDS,
  name: "AI V7 vs pairs of V3, V5 and V6 Benchmark",
  evaluationName: "v7 1v2 vs pairs of v3, v5, v6",
};

export function createAiV7GauntletBenchmarkInput(options: AiV7GauntletBenchmarkOptions = {}): AiV7GauntletBenchmarkInput {
  return createSubjectGauntletInput(V7_GAUNTLET, options);
}

export async function runAiV7GauntletBenchmarkParallel(options: AiV7GauntletBenchmarkOptions = {}): Promise<AiV7GauntletBenchmarkResult> {
  return asV7Result(await runSubjectGauntletParallel(V7_GAUNTLET, options));
}

export function runAiV7GauntletBenchmarkDetailsParallel(options: AiV7GauntletBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  return runSubjectGauntletDetailsParallel(V7_GAUNTLET, options, filter);
}

export function summarizeAiV7GauntletBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV7GauntletBenchmarkResult {
  return asV7Result(summarizeSubjectGauntlet(V7_GAUNTLET, input));
}

// V7's report keeps the shape its readers know (v7Wins, byV7Race, shooterGames).
function asV7Result(result: SubjectGauntletResult): AiV7GauntletBenchmarkResult {
  const { subject: _subject, wins, lossesTo, byRace, watchedGames, ...rest } = result;
  return {
    seed: rest.seed,
    selectedMapIds: rest.selectedMapIds,
    v7Wins: wins,
    rawMatches: rest.rawMatches,
    winRate: rest.winRate,
    lossesTo: { v3: lossesTo.v3 ?? 0, v5: lossesTo.v5 ?? 0, v6: lossesTo.v6 ?? 0, timeout: lossesTo.timeout ?? 0 },
    byPair: rest.byPair,
    byV7Race: byRace,
    byStrategy: rest.byStrategy,
    plays: rest.plays,
    shooterGames: watchedGames,
    elapsedMs: rest.elapsedMs,
    cpuMs: rest.cpuMs,
    ...(rest.workers !== undefined ? { workers: rest.workers } : {}),
    byMap: rest.byMap,
  };
}
