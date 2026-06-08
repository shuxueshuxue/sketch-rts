import { availableParallelism } from "node:os";
import type { SdkGameAgent } from "../src/sdk/game-runner";
import type { BenchmarkInput } from "../src/sdk/benchmark/core";
import { describeBenchmarkInput } from "../src/sdk/benchmark/manifest";

export type CommonAiBenchmarkCliOptions = {
  seed?: string;
  mapCount?: number;
  full?: boolean;
  maxTicks?: number;
  thinkInterval?: number;
  workers: number;
};

export type AiBenchmarkCliSelection = {
  seed: string;
  mapIds: readonly string[];
};

export type AiBenchmarkInputBundle<TAgent extends SdkGameAgent = SdkGameAgent> = {
  input: BenchmarkInput<TAgent>;
  selection: AiBenchmarkCliSelection;
};

export type AiBenchmarkCliConfig<TOptions extends CommonAiBenchmarkCliOptions, TAgent extends SdkGameAgent = SdkGameAgent> = {
  args: readonly string[];
  usage: string;
  createInput: (options: TOptions) => AiBenchmarkInputBundle<TAgent>;
  run: (options: TOptions) => Promise<unknown> | unknown;
  optionsFromArgs?: (args: readonly string[]) => TOptions;
};

export function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

export function boolFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function requiredFlag(args: readonly string[], name: string): string {
  const value = flag(args, name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

export function requiredNumberFlag(args: readonly string[], name: string): number {
  const raw = requiredFlag(args, name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a finite number`);
  return parsed;
}

export function csvFlag(args: readonly string[], name: string): string[] {
  return requiredFlag(args, name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function workerCountFromArgs(args: readonly string[]) {
  return flag(args, "workers") ? requiredNumberFlag(args, "workers") : Math.max(1, availableParallelism() - 1);
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function commonAiBenchmarkOptionsFromArgs(args: readonly string[]): CommonAiBenchmarkCliOptions {
  return {
    ...(flag(args, "seed") ? { seed: requiredFlag(args, "seed") } : {}),
    ...(flag(args, "map-count") ? { mapCount: requiredNumberFlag(args, "map-count") } : {}),
    ...(boolFlag(args, "full") ? { full: true } : {}),
    ...(flag(args, "max-ticks") ? { maxTicks: requiredNumberFlag(args, "max-ticks") } : {}),
    ...(flag(args, "think-interval") ? { thinkInterval: requiredNumberFlag(args, "think-interval") } : {}),
    workers: workerCountFromArgs(args),
  };
}

export function aiBenchmarkDryRunManifest<TAgent extends SdkGameAgent>(bundle: AiBenchmarkInputBundle<TAgent>) {
  return {
    name: bundle.input.name,
    seed: bundle.selection.seed,
    selectedMapIds: bundle.selection.mapIds,
    matchCount: bundle.input.evaluations.reduce((total, evaluation) => total + evaluation.matches.length, 0),
    matches: bundle.input.evaluations.flatMap((evaluation) => evaluation.matches.map((match) => match.name)),
    manifest: describeBenchmarkInput(bundle.input),
  };
}

export async function runAiBenchmarkCli<TOptions extends CommonAiBenchmarkCliOptions, TAgent extends SdkGameAgent = SdkGameAgent>(config: AiBenchmarkCliConfig<TOptions, TAgent>) {
  if (boolFlag(config.args, "help") || boolFlag(config.args, "h")) {
    console.log(config.usage);
    return;
  }

  const options = config.optionsFromArgs ? config.optionsFromArgs(config.args) : (commonAiBenchmarkOptionsFromArgs(config.args) as TOptions);

  if (boolFlag(config.args, "dry-run")) {
    printJson(aiBenchmarkDryRunManifest(config.createInput(options)));
    return;
  }

  printJson(await config.run(options));
}
