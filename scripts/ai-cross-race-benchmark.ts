import { createAiCrossRaceBenchmarkInput, runAiCrossRaceBenchmarkParallel } from "../src/ai/benchmark/control";
import { describeBenchmarkInput } from "../src/sdk/benchmark/manifest";
import { boolFlag, flag, printJson, requiredFlag, requiredNumberFlag, workerCountFromArgs } from "./benchmark-cli";

const args = process.argv.slice(2);

if (boolFlag(args, "help") || boolFlag(args, "h")) {
  printHelp();
  process.exit(0);
}

const options = {
  ...(flag(args, "seed") ? { seed: requiredFlag(args, "seed") } : {}),
  ...(flag(args, "map-count") ? { mapCount: requiredNumberFlag(args, "map-count") } : {}),
  ...(boolFlag(args, "full") ? { full: true } : {}),
  ...(flag(args, "max-ticks") ? { maxTicks: requiredNumberFlag(args, "max-ticks") } : {}),
  ...(flag(args, "think-interval") ? { thinkInterval: requiredNumberFlag(args, "think-interval") } : {}),
  workers: workerCountFromArgs(args),
};

if (boolFlag(args, "dry-run")) {
  const { input, selection } = createAiCrossRaceBenchmarkInput(options);
  printJson({
    name: input.name,
    seed: selection.seed,
    selectedMapIds: selection.mapIds,
    matchCount: input.evaluations.reduce((total, evaluation) => total + evaluation.matches.length, 0),
    matches: input.evaluations.flatMap((evaluation) => evaluation.matches.map((match) => match.name)),
    manifest: describeBenchmarkInput(input),
  });
  process.exit(0);
}

printJson(await runAiCrossRaceBenchmarkParallel(options));

function printHelp() {
  console.log(`Usage:
  npm run benchmark:ai-cross-race -- --seed ember-grove-50-2026-06-08 --map-count 50
  npm run benchmark:ai-cross-race -- --seed ember-grove-50-2026-06-08 --map-count 50 --dry-run
  npm run benchmark:ai-cross-race -- --full --workers 95`);
}
