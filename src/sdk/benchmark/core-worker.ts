import { runBenchmarkMatch, type BenchmarkMatchInput, type BenchmarkMatchReport } from "./core";
import type { SdkGameAgent } from "../game-runner";

export function runBenchmarkParallelMatch(match: BenchmarkMatchInput<SdkGameAgent>): BenchmarkMatchReport {
  return runBenchmarkMatch(match);
}
