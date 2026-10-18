// Which files under scripts/ are still in use. A script is in use when something that runs the project names it
// (package.json, a CI workflow, src/ or tools/), when vitest runs it (*.test.*), or when a script in use names it
// (followed transitively). A doc naming a script does not keep it: the docs keep the evidence of finished
// investigations, and their proof scripts with them. Pure: the command wrapper feeds it file contents.

export type AuditInput = {
  /** scripts/ entries: file name and its text. */
  scripts: { name: string; text: string }[];
  /** Text of everything outside scripts/ that can name a script, labelled for the report. */
  roots: { label: string; text: string }[];
};

export type AuditEntry = { name: string; live: boolean; why: string };

function names(text: string, script: string) {
  const stem = script.replace(/\.[^.]+$/, "");
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The stem as a whole path segment, with or without its extension: `scripts/x.ts`, `./x`, `"x.mjs"`.
  return new RegExp(`(^|[\\s/"'\`(])${escaped}(\\.[a-z]+)?(?=$|[\\s"'\`),;:])`, "m").test(text);
}

export function audit(input: AuditInput): AuditEntry[] {
  const why = new Map<string, string>();
  for (const script of input.scripts) {
    if (/\.test\.[a-z]+$/.test(script.name)) { why.set(script.name, "vitest runs it"); continue; }
    const root = input.roots.find((candidate) => names(candidate.text, script.name));
    if (root) why.set(script.name, root.label);
  }
  const frontier = [...why.keys()];
  const byName = new Map(input.scripts.map((script) => [script.name, script]));
  while (frontier.length) {
    const live = byName.get(frontier.pop()!)!;
    for (const script of input.scripts) {
      if (why.has(script.name) || !names(live.text, script.name)) continue;
      why.set(script.name, `used by ${live.name}`);
      frontier.push(script.name);
    }
  }
  return input.scripts.map((script) => ({ name: script.name, live: why.has(script.name), why: why.get(script.name) ?? "unreferenced" }));
}
