import { availableParallelism } from "node:os";
import { createAiVersionBenchmarkInput } from "../src/ai/benchmark/presets";
import { runAiBenchmarkRunnerParityProbe } from "../src/ai/benchmark/parity";
import { recordAiVersionBenchmarkDashboardRun } from "../src/ai/benchmark/dashboard-store";
import { describeBenchmarkInput } from "../src/sdk/benchmark/manifest";

const mapCount = process.env.AI_GAUNTLET_MAP_COUNT ? Number.parseInt(process.env.AI_GAUNTLET_MAP_COUNT, 10) : 18;
const SCORE_SUCCESS_GATE = 1;
const seed = process.env.AI_GAUNTLET_SEED;
const workers = process.env.AI_BENCHMARK_WORKERS ? Number.parseInt(process.env.AI_BENCHMARK_WORKERS, 10) : Math.max(1, availableParallelism() - 1);
const options = {
  seed,
  mapCount: Number.isFinite(mapCount) && mapCount > 0 ? mapCount : 18,
  full: process.env.AI_GAUNTLET_FULL === "1",
  workers,
};

if (process.env.AI_BENCHMARK_DRY_RUN === "1") {
  const { input, selection } = createAiVersionBenchmarkInput(options);
  process.stdout.write(
    `${JSON.stringify(
      {
        name: input.name,
        seed: selection.seed,
        selectedRichScoreMapIds: selection.mapIds,
        mapCount: selection.mapIds.length,
        full: options.full,
        workers,
        dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
        manifest: describeBenchmarkInput(input),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (process.env.AI_BENCHMARK_PARITY_PROBE === "1") {
  const { input, selection } = createAiVersionBenchmarkInput({ ...options, maxTicks: 1 });
  const controlMatch = input.evaluations.find((evaluation) => evaluation.name === "1v1 score control")?.matches[0];
  if (!controlMatch) throw new Error("AI version benchmark parity probe could not find a 1v1 score control match");
  const proof = await runAiBenchmarkRunnerParityProbe({
    name: "AI Version Benchmark Runner Parity Probe",
    evaluations: [{ name: "1v1 score control", tag: "melee", matches: [controlMatch] }],
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        name: "AI Version Benchmark Runner Parity Probe",
        seed: selection.seed,
        selectedRichScoreMapIds: selection.mapIds,
        matchName: controlMatch.name,
        setupEqual: proof.setupEqual,
        coreResultEqual: proof.coreResultEqual,
        serialManifest: proof.serialManifest,
        parallelManifest: proof.parallelManifest,
        serial: parityReportSummary(proof.serialReport),
        parallel: parityReportSummary(proof.parallelReport),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const run = await recordAiVersionBenchmarkDashboardRun(options);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: benchmarkPassed(run.scoreSummary.successRate, [...run.probeSummaries, ...run.combatSummaries].map((summary) => summary.successRate)),
      id: run.id,
      createdAt: run.createdAt,
      seed: run.seed,
      selectedRichScoreMapIds: run.selectedRichScoreMapIds,
      scoreSummary: run.scoreSummary,
      scoreControlSummary: run.scoreControlSummary,
      probeSummaries: run.probeSummaries,
      combatSummaries: run.combatSummaries,
      elapsedMs: run.report.elapsedMs,
      cpuMs: run.report.cpuMs,
      workers,
      dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
    },
    null,
    2,
  )}\n`,
);

if (!benchmarkPassed(run.scoreSummary.successRate, [...run.probeSummaries, ...run.combatSummaries].map((summary) => summary.successRate))) {
  throw new Error("AI version benchmark failed: v2 did not satisfy the 100% gate across melee score, probes, and combat");
}

function benchmarkPassed(scoreRate: number, laneRates: number[]) {
  return scoreRate >= SCORE_SUCCESS_GATE && laneRates.every((rate) => rate >= SCORE_SUCCESS_GATE);
}

function parityReportSummary(report: Awaited<ReturnType<typeof runAiBenchmarkRunnerParityProbe>>["serialReport"]) {
  const match = report.evaluations[0]?.matches[0];
  if (!match) throw new Error("Parity report did not include a match");
  return {
    map: match.setup.map.id,
    players: match.setup.players,
    result: match.result,
  };
}
