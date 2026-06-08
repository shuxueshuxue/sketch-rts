import { createAiCrossRaceBenchmarkInput, runAiCrossRaceBenchmarkParallel } from "../src/ai/benchmark/control";
import { runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-cross-race -- --seed ember-grove-50-2026-06-08 --map-count 50
  npm run benchmark:ai-cross-race -- --seed ember-grove-50-2026-06-08 --map-count 50 --dry-run
  npm run benchmark:ai-cross-race -- --full --workers 95`,
  createInput: createAiCrossRaceBenchmarkInput,
  run: runAiCrossRaceBenchmarkParallel,
});
