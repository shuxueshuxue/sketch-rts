import { availableParallelism } from "node:os";
import { recordAiVersionBenchmarkDashboardRun } from "../src/ai/benchmark/dashboard-store";

const mapCount = process.env.AI_GAUNTLET_MAP_COUNT ? Number.parseInt(process.env.AI_GAUNTLET_MAP_COUNT, 10) : 17;
const SCORE_SUCCESS_GATE = 1;
const seed = process.env.AI_GAUNTLET_SEED;
const workers = process.env.AI_BENCHMARK_WORKERS ? Number.parseInt(process.env.AI_BENCHMARK_WORKERS, 10) : Math.max(1, availableParallelism() - 1);

const run = await recordAiVersionBenchmarkDashboardRun({
  seed,
  mapCount: Number.isFinite(mapCount) && mapCount > 0 ? mapCount : 17,
  full: process.env.AI_GAUNTLET_FULL === "1",
  workers,
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: benchmarkPassed(run.scoreSummary.successRate, [...run.probeSummaries, ...run.combatSummaries].map((summary) => summary.successRate), run.sanitySummary.failures),
      id: run.id,
      createdAt: run.createdAt,
      seed: run.seed,
      selectedRichScoreMapIds: run.selectedRichScoreMapIds,
      scoreSummary: run.scoreSummary,
      scoreControlSummary: run.scoreControlSummary,
      probeSummaries: run.probeSummaries,
      combatSummaries: run.combatSummaries,
      sanitySummary: run.sanitySummary,
      elapsedMs: run.report.elapsedMs,
      cpuMs: run.report.cpuMs,
      workers,
      dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
    },
    null,
    2,
  )}\n`,
);

if (!benchmarkPassed(run.scoreSummary.successRate, [...run.probeSummaries, ...run.combatSummaries].map((summary) => summary.successRate), run.sanitySummary.failures)) {
  throw new Error("AI version benchmark failed: v2 did not satisfy the 100% gate across melee score, probes, combat, and 1v1 sanity");
}

function benchmarkPassed(scoreRate: number, laneRates: number[], sanityFailures: number) {
  return scoreRate >= SCORE_SUCCESS_GATE && laneRates.every((rate) => rate >= SCORE_SUCCESS_GATE) && sanityFailures === 0;
}
