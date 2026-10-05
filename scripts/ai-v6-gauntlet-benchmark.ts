import { createAiV6GauntletBenchmarkInput, runAiV6GauntletBenchmarkDetailsParallel, runAiV6GauntletBenchmarkParallel } from "../src/ai/benchmark/v6-gauntlet";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v6-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50
  npm run benchmark:ai-v6-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --dry-run
  npm run benchmark:ai-v6-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --details --maps openClaims`,
  createInput: createAiV6GauntletBenchmarkInput,
  run: (options) => (boolFlag(args, "details") ? runAiV6GauntletBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV6GauntletBenchmarkParallel(options)),
});
