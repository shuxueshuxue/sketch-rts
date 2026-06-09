import { createAiV3VsProdV2BenchmarkInput, recordAiV3VsProdV2BenchmarkDashboardRun, runAiV3VsProdV2BenchmarkDetailsParallel, runAiV3VsProdV2BenchmarkParallel } from "../src/ai/benchmark/control";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50 --dry-run
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50 --dashboard
  npm run benchmark:ai-v3-vs-prod-v2 -- --full --workers 95`,
  createInput: createAiV3VsProdV2BenchmarkInput,
  run: async (options) => {
    if (boolFlag(args, "dashboard")) {
      if (boolFlag(args, "details")) throw new Error("--dashboard cannot be combined with --details");
      const run = await recordAiV3VsProdV2BenchmarkDashboardRun(options);
      return {
        id: run.id,
        kind: run.kind,
        createdAt: run.createdAt,
        seed: run.seed,
        selectedRichScoreMapIds: run.selectedRichScoreMapIds,
        primarySummary: run.primarySummary,
        evaluationSummaries: run.evaluationSummaries,
        elapsedMs: run.report.elapsedMs,
        cpuMs: run.report.cpuMs,
        workers: options.workers,
        dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
      };
    }
    return boolFlag(args, "details") ? runAiV3VsProdV2BenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV3VsProdV2BenchmarkParallel(options);
  },
});
