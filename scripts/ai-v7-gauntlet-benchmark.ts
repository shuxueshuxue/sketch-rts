import { createAiV7GauntletBenchmarkInput, runAiV7GauntletBenchmarkDetailsParallel, runAiV7GauntletBenchmarkParallel } from "../src/ai/benchmark/v7-gauntlet";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v7-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50
  npm run benchmark:ai-v7-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --dry-run
  npm run benchmark:ai-v7-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --details --maps openClaims`,
  createInput: createAiV7GauntletBenchmarkInput,
  run: (options) => (boolFlag(args, "details") ? runAiV7GauntletBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV7GauntletBenchmarkParallel(options)),
});
