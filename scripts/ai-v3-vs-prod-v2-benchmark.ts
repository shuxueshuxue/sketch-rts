import { createAiV3VsProdV2BenchmarkInput, runAiV3VsProdV2BenchmarkDetailsParallel, runAiV3VsProdV2BenchmarkParallel } from "../src/ai/benchmark/control";
import { benchmarkFilterFromArgs, boolFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50 --dry-run
  npm run benchmark:ai-v3-vs-prod-v2 -- --full --workers 95`,
  createInput: createAiV3VsProdV2BenchmarkInput,
  run: (options) => (boolFlag(args, "details") ? runAiV3VsProdV2BenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV3VsProdV2BenchmarkParallel(options)),
});
