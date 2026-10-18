import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, type CommandSpec } from "../args";
import { gitOut } from "../git";
import { audit } from "../lib/audit";
import { emit, EXIT, table } from "../output";

export const spec: CommandSpec = {
  name: "scripts audit",
  summary: "List which files under scripts/ are still referenced (package.json, CI, src/, tools/, other live scripts).",
  usage: "scripts audit [--dead] [--check] [--json]",
  options: [
    { name: "dead", description: "list only the unreferenced files", boolean: true },
    { name: "check", description: "exit 1 when any file is unreferenced (for CI)", boolean: true },
    { name: "json", description: "one JSON object on stdout instead of a table", boolean: true },
  ],
};

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const root = gitOut(["rev-parse", "--show-toplevel"]).trim();
  const tracked = (prefix: string) => gitOut(["ls-files", "-z", "--", prefix]).split("\0").filter(Boolean);
  const scripts = tracked("scripts").filter((path) => path.split("/").length === 2)
    .map((path) => ({ name: path.slice("scripts/".length), text: readFileSync(join(root, path), "utf8") }));
  const read = (paths: string[], label: string) => paths.map((path) => ({ label: `${label} ${path}`, text: readFileSync(join(root, path), "utf8") }));
  const roots = [
    ...read(["package.json"], "package.json"),
    ...read(tracked(".github").filter((path) => /\.ya?ml$/.test(path)), "CI"),
    ...read([...tracked("src"), ...tracked("tools")].filter((path) => /\.(ts|tsx|mts|js|mjs|cjs|json)$/.test(path)), "code"),
  ];
  const entries = audit({ scripts, roots });
  const dated = entries.map((entry) => ({ ...entry, lastChange: gitOut(["log", "-1", "--format=%cs", "--", `scripts/${entry.name}`]).trim() }));
  const shown = parsed.options.dead ? dated.filter((entry) => !entry.live) : dated;
  const dead = dated.filter((entry) => !entry.live);
  const human = `${table(["file", "status", "why", "last change"], shown.map((entry) => [entry.name, entry.live ? "live" : "DEAD", entry.why, entry.lastChange]))}\n\n${dated.length} files: ${dated.length - dead.length} live, ${dead.length} unreferenced`;
  emit(parsed.options.json === true, human, { total: dated.length, dead: dead.map((entry) => entry.name), entries: dated });
  return parsed.options.check && dead.length ? EXIT.found : EXIT.ok;
}
