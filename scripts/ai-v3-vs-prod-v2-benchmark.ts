import { createAiV3VsProdV2BenchmarkInput, runAiV3VsProdV2BenchmarkParallel } from "../src/ai/benchmark/control";
import { runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50
  npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50 --dry-run
  npm run benchmark:ai-v3-vs-prod-v2 -- --full --workers 95`,
  createInput: createAiV3VsProdV2BenchmarkInput,
  run: runAiV3VsProdV2BenchmarkParallel,
});
