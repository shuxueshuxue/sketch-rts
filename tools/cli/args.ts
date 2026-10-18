// One argument model for every subcommand: positionals, `--name value`, `--name=value` and boolean `--name`.
// Each subcommand declares its options; anything undeclared is a usage error (exit code 2), never silently ignored.

export type OptionSpec = { name: string; description: string; boolean?: true; default?: string };
export type CommandSpec = { name: string; summary: string; usage: string; options: OptionSpec[] };
export type Parsed = { positionals: string[]; options: Record<string, string | true> };

export class UsageError extends Error {}

export function parseArgs(spec: CommandSpec, argv: readonly string[]): Parsed {
  const known = new Map(spec.options.map((option) => [option.name, option]));
  const positionals: string[] = [];
  const options: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--") { positionals.push(...argv.slice(index + 1)); break; }
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    const [rawName, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const option = known.get(rawName);
    if (!option) throw new UsageError(`Unknown option --${rawName} for "${spec.name}"`);
    if (option.boolean) {
      if (inline !== undefined) throw new UsageError(`--${rawName} takes no value`);
      options[rawName] = true;
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new UsageError(`--${rawName} needs a value`);
    options[rawName] = value;
  }
  for (const option of spec.options) if (options[option.name] === undefined && option.default !== undefined) options[option.name] = option.default;
  return { positionals, options };
}

export function stringOption(parsed: Parsed, name: string): string | undefined {
  const value = parsed.options[name];
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

export function helpText(spec: CommandSpec) {
  const width = Math.max(0, ...spec.options.map((option) => option.name.length)) + 4;
  return [
    `${spec.summary}`, "", `Usage: sketch ${spec.usage}`, "",
    ...spec.options.map((option) => `  --${option.name.padEnd(width)}${option.description}${option.default !== undefined ? ` (default ${option.default})` : ""}`),
  ].join("\n");
}
