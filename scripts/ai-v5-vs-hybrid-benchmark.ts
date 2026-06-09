import { createAiV5VsHybridBenchmarkInput, recordAiV5VsHybridBenchmarkDashboardRun, runAiV5VsHybridBenchmarkDetailsParallel, runAiV5VsHybridBenchmarkParallel } from "../src/ai/benchmark/control";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50
  npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50 --dry-run
  npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50 --dashboard
  npm run benchmark:ai-v5-vs-hybrid -- --full --workers 95`,
  createInput: createAiV5VsHybridBenchmarkInput,
  run: async (options) => {
    if (boolFlag(args, "dashboard")) {
      if (boolFlag(args, "details")) throw new Error("--dashboard cannot be combined with --details");
      const run = await recordAiV5VsHybridBenchmarkDashboardRun(options);
      return {
        id: run.id,
        kind: run.kind,
        createdAt: run.createdAt,
        seed: run.seed,
        targetPlayerId: run.targetPlayerId,
        selectedRichScoreMapIds: run.selectedRichScoreMapIds,
        primarySummary: run.primarySummary,
        evaluationSummaries: run.evaluationSummaries,
        elapsedMs: run.report.elapsedMs,
        cpuMs: run.report.cpuMs,
        workers: options.workers,
        dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
      };
    }
    return boolFlag(args, "details") ? runAiV5VsHybridBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV5VsHybridBenchmarkParallel(options);
  },
});
