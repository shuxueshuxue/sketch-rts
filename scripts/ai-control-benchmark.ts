import { createAiMeleeControlBenchmarkInput, runAiMeleeControlBenchmarkDetailsParallel, runAiMeleeControlBenchmarkParallel } from "../src/ai/benchmark/control";
import { describeBenchmarkInput } from "../src/sdk/benchmark/manifest";
import { boolFlag, csvFlag, flag, printJson, requiredFlag, requiredNumberFlag, workerCountFromArgs } from "./benchmark-cli";

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
  ...(flag(args, "worker-harassment") ? { workerHarassment: workerHarassmentFlag(args) } : {}),
  workers: workerCountFromArgs(args),
};

if (boolFlag(args, "dry-run")) {
  const { input, selection } = createAiMeleeControlBenchmarkInput(options);
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

if (boolFlag(args, "details")) {
  printJson(await runAiMeleeControlBenchmarkDetailsParallel(options, controlFilterFromArgs(args)));
  process.exit(0);
}

printJson(await runAiMeleeControlBenchmarkParallel(options));

function controlFilterFromArgs(args: string[]) {
  return {
    ...(flag(args, "maps") ? { mapIds: csvFlag(args, "maps") } : {}),
    ...(flag(args, "match") ? { matchNames: [requiredFlag(args, "match")] } : {}),
  };
}

function workerHarassmentFlag(args: string[]): 0 | 0.5 | 1 {
  const value = requiredNumberFlag(args, "worker-harassment");
  if (value !== 0 && value !== 0.5 && value !== 1) throw new Error("--worker-harassment must be 0, 0.5, or 1");
  return value;
}

function printHelp() {
  console.log(`Usage:
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --worker-harassment 0
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --worker-harassment 1
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --dry-run
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --maps amberReach,saltwindBasin,quietMire --details
  npm run benchmark:ai-control -- --seed moonwell-layout-50-2026-06-04 --map-count 50 --match "amberReach 1v1 control south" --details
  npm run benchmark:ai-control -- --full --workers 95`);
}
