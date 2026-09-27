import { createAiV8GauntletBenchmarkInput, runAiV8GauntletBenchmarkDetailsParallel, runAiV8GauntletBenchmarkParallel } from "../src/ai/benchmark/v8-gauntlet";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v8-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50
  npm run benchmark:ai-v8-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --dry-run
  npm run benchmark:ai-v8-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --details --maps openClaims`,
  createInput: createAiV8GauntletBenchmarkInput,
  run: (options) => (boolFlag(args, "details") ? runAiV8GauntletBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV8GauntletBenchmarkParallel(options)),
});
