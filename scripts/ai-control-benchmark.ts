import { createAiMeleeControlBenchmarkInput, runAiMeleeControlBenchmarkDetailsParallel, runAiMeleeControlBenchmarkParallel } from "../src/ai/benchmark/control";
import { benchmarkFilterFromArgs, boolFlag, commonAiBenchmarkOptionsFromArgs, flag, requiredNumberFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --worker-harassment 0
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --worker-harassment 1
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --dry-run
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --maps amberReach,saltwindBasin,quietMire --details
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --match "amberReach 1v1 control south" --details
  npm run benchmark:ai-control -- --full --workers 95`,
  optionsFromArgs: controlOptionsFromArgs,
  createInput: createAiMeleeControlBenchmarkInput,
  run: (options) => (boolFlag(args, "details") ? runAiMeleeControlBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiMeleeControlBenchmarkParallel(options)),
});

function controlOptionsFromArgs(args: readonly string[]) {
  return {
    ...commonAiBenchmarkOptionsFromArgs(args),
    ...(flag(args, "worker-harassment") ? { workerHarassment: workerHarassmentFlag(args) } : {}),
  };
}

function workerHarassmentFlag(args: string[]): 0 | 0.5 | 1 {
  const value = requiredNumberFlag(args, "worker-harassment");
  if (value !== 0 && value !== 0.5 && value !== 1) throw new Error("--worker-harassment must be 0, 0.5, or 1");
  return value;
}
