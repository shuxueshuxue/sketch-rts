import { availableParallelism } from "node:os";
import { createAiMeleeControlBenchmarkInput, runAiMeleeControlBenchmarkDetailsParallel, runAiMeleeControlBenchmarkParallel } from "../src/ai/benchmark/control";

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
  workers: flag(args, "workers") ? requiredNumberFlag(args, "workers") : Math.max(1, availableParallelism() - 1),
};

if (boolFlag(args, "dry-run")) {
  const { input, selection } = createAiMeleeControlBenchmarkInput(options);
  printJson({
    name: input.name,
    seed: selection.seed,
    selectedMapIds: selection.mapIds,
    matchCount: input.evaluations.reduce((total, evaluation) => total + evaluation.matches.length, 0),
    matches: input.evaluations.flatMap((evaluation) => evaluation.matches.map((match) => match.name)),
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

function csvFlag(args: string[], name: string): string[] {
  return requiredFlag(args, name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

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

function workerHarassmentFlag(args: string[]): 0 | 0.5 | 1 {
  const value = requiredNumberFlag(args, "worker-harassment");
  if (value !== 0 && value !== 0.5 && value !== 1) throw new Error("--worker-harassment must be 0, 0.5, or 1");
  return value;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
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
