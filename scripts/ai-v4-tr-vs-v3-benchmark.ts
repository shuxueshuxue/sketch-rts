import { createAiV4TrVsV3BenchmarkInput, recordAiV4TrVsV3BenchmarkDashboardRun, runAiV4TrVsV3BenchmarkDetailsParallel, runAiV4TrVsV3BenchmarkParallel, summarizeAiV4TrVsV3Benchmark } from "../src/ai/benchmark/control";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50
  npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50 --dry-run
  npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50 --dashboard
  npm run benchmark:ai-v4-tr-vs-v3 -- --full --workers 95`,
  createInput: createAiV4TrVsV3BenchmarkInput,
  run: async (options) => {
    if (boolFlag(args, "dashboard")) {
      if (boolFlag(args, "details")) throw new Error("--dashboard cannot be combined with --details");
      const run = await recordAiV4TrVsV3BenchmarkDashboardRun(options);
      const breakdown = summarizeAiV4TrVsV3Benchmark({ seed: run.seed, selectedMapIds: run.selectedRichScoreMapIds, report: run.report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
      return {
        id: run.id,
        kind: run.kind,
        createdAt: run.createdAt,
        seed: run.seed,
        targetPlayerId: run.targetPlayerId,
        selectedRichScoreMapIds: run.selectedRichScoreMapIds,
        primarySummary: run.primarySummary,
        evaluationSummaries: run.evaluationSummaries,
        byV3Race: breakdown.byV3Race,
        elapsedMs: run.report.elapsedMs,
        cpuMs: run.report.cpuMs,
        workers: options.workers,
        dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
      };
    }
    return boolFlag(args, "details") ? runAiV4TrVsV3BenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV4TrVsV3BenchmarkParallel(options);
  },
});
