// The fixed set of V8 gauntlet games the sim-perf scripts play (sim-perf-fixed-set, sim-scale-probe), by index.
import { createAiV8GauntletBenchmarkInput } from "../src/ai/benchmark/v8-gauntlet";
import type { AiGameAgent } from "../src/ai/game-runner";
import type { BenchmarkMatchInput } from "../src/sdk/benchmark/core";

// Five seeds x four games: each seed's first map in both races, plus two maps further down the list (one per race).
const SEEDS = ["v5-extra-1", "v5-extra-3", "v5-hybrid-50-holdout-a", "v5-hybrid-50-2026-06-12", "v5-extra-7"];
const INDICES = [0, 1, 33, 66];

export type FixedGame = { seed: string; match: BenchmarkMatchInput<AiGameAgent> };

export function fixedSetGames(): FixedGame[] {
  return SEEDS.flatMap((seed) => {
    const matches = createAiV8GauntletBenchmarkInput({ seed, mapCount: 50 }).input.evaluations[0]!.matches;
    return INDICES.map((index) => ({ seed, match: matches[index]! }));
  });
}
