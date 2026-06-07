import { availableParallelism } from "node:os";

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
