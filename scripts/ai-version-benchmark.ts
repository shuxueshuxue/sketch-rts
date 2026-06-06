import { availableParallelism } from "node:os";
import { createAiVersionBenchmarkInput } from "../src/ai/benchmark/presets";
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
