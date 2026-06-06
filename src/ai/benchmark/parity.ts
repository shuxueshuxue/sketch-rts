import { describeBenchmarkInput, type BenchmarkInputManifest } from "../../sdk/benchmark/manifest";
import { runBenchmark, type BenchmarkInput, type BenchmarkMatchReport, type BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import type { AiGameAgent } from "../game-runner";
import { serializableAiBenchmarkInput } from "./presets";

export type AiBenchmarkRunnerParityProof = {
  serialManifest: BenchmarkInputManifest;
  parallelManifest: BenchmarkInputManifest;
  serialReport: NormalizedBenchmarkReport;
  parallelReport: NormalizedBenchmarkReport;
  setupEqual: boolean;
  coreResultEqual: boolean;
};

export type NormalizedBenchmarkReport = {
  name: string;
  evaluationCount: number;
  matchCount: number;
  evaluations: NormalizedBenchmarkEvaluationReport[];
};

export type NormalizedBenchmarkEvaluationReport = {
  name: string;
  tag?: string;
  matchCount: number;
  matches: NormalizedBenchmarkMatchReport[];
};

export type NormalizedBenchmarkMatchReport = Pick<BenchmarkMatchReport, "name" | "setup"> & {
  result: Omit<BenchmarkMatchReport["result"], "trackers">;
};

export async function runAiBenchmarkRunnerParityProbe(input: BenchmarkInput<AiGameAgent>): Promise<AiBenchmarkRunnerParityProof> {
  const serialManifest = describeBenchmarkInput(input);
  const parallelInput = serializableAiBenchmarkInput(input);
  const parallelManifest = describeBenchmarkInput(parallelInput);
  const serialReport = normalizeBenchmarkReport(runBenchmark(input));
  const parallelReport = normalizeBenchmarkReport(
    await runBenchmarkParallel(parallelInput, {
      workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
      workers: 1,
    }),
  );

  return {
    serialManifest,
    parallelManifest,
    serialReport,
    parallelReport,
    setupEqual: sameJson(reportSetups(serialReport), reportSetups(parallelReport)),
    coreResultEqual: sameJson(reportResults(serialReport), reportResults(parallelReport)),
  };
}

function normalizeBenchmarkReport(report: BenchmarkReport): NormalizedBenchmarkReport {
  return {
    name: report.name,
    evaluationCount: report.evaluationCount,
    matchCount: report.matchCount,
    evaluations: report.evaluations.map((evaluation) => ({
      name: evaluation.name,
      ...(evaluation.tag ? { tag: evaluation.tag } : {}),
      matchCount: evaluation.matchCount,
      matches: evaluation.matches.map((match) => {
        const { trackers: _trackers, ...result } = match.result;
        return {
          name: match.name,
          setup: match.setup,
          result,
        };
      }),
    })),
  };
}

function reportSetups(report: NormalizedBenchmarkReport) {
  return report.evaluations.map((evaluation) => evaluation.matches.map((match) => match.setup));
}

function reportResults(report: NormalizedBenchmarkReport) {
  return report.evaluations.map((evaluation) => evaluation.matches.map((match) => match.result));
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
