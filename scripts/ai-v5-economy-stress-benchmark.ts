import { createAiV5EconomyStressBenchmarkInput, runAiV5EconomyStressBenchmarkParallel } from "../src/ai/benchmark/control";
import { commonAiBenchmarkOptionsFromArgs, flag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

await runAiBenchmarkCli({
  args,
  usage: `Usage:
  npm run benchmark:ai-v5-economy-stress -- --seed v5-economy-stress-2026-06-12 --sample-count 50
  npm run benchmark:ai-v5-economy-stress -- --seed v5-economy-stress-2026-06-12 --sample-count 50 --dry-run
  npm run benchmark:ai-v5-economy-stress -- --sample-count 100 --workers 95`,
  createInput: createAiV5EconomyStressBenchmarkInput,
  run: runAiV5EconomyStressBenchmarkParallel,
  optionsFromArgs: (rawArgs) => ({
    ...commonAiBenchmarkOptionsFromArgs(rawArgs),
    ...(flag(rawArgs, "sample-count") ? { sampleCount: Number(flag(rawArgs, "sample-count")) } : {}),
  }),
});
