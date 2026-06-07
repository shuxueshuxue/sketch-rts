import { availableParallelism } from "node:os";
import { createAiCrossRaceBenchmarkInput, runAiCrossRaceBenchmarkParallel } from "../src/ai/benchmark/control";
import { describeBenchmarkInput } from "../src/sdk/benchmark/manifest";

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
  workers: flag(args, "workers") ? requiredNumberFlag(args, "workers") : Math.max(1, availableParallelism() - 1),
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

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

function requiredNumberFlag(args: string[], name: string): number {
  const raw = requiredFlag(args, name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a finite number`);
  return parsed;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage:
  npm run benchmark:ai-cross-race -- --seed ember-grove-50-2026-06-08 --map-count 50
  npm run benchmark:ai-cross-race -- --seed ember-grove-50-2026-06-08 --map-count 50 --dry-run
  npm run benchmark:ai-cross-race -- --full --workers 95`);
}
