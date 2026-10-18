import { parseArgs, stringOption, type CommandSpec } from "../args";
import { diff, outcomes, settle, type TestOutcome, type VitestJson } from "../lib/vitest-report";
import { emit, EXIT, progress, table } from "../output";
import { Machine, quote, resolveRef } from "../runner";

export const spec: CommandSpec = {
  name: "test diff",
  summary: "Run the same tests on two commits in clean copies and report only what this change broke (or fixed).",
  usage: "test diff [--base origin/main] [--ref HEAD] [--with-local] [--on MACHINE] [--json] [test files or dirs…]",
  options: [
    { name: "base", description: "the commit to compare against", default: "origin/main" },
    { name: "ref", description: "the commit under test", default: "HEAD" },
    { name: "with-local", description: "test the working tree's uncommitted changes on top of --ref", boolean: true },
    { name: "on", description: "machine from ~/.config/sketch/machines.json" },
    { name: "json", description: "one JSON object on stdout instead of tables", boolean: true },
  ],
};

async function vitest(machine: Machine, dir: string, label: string, targets: string[]) {
  const out = machine.path("runs", machine.runId, `${label}.json`);
  const files = targets.length ? targets.map(quote).join(" ") : "--dir src";
  // vitest exits non-zero when anything fails; the report, not the exit code, is what is read.
  await machine.run(`mkdir -p ${quote(machine.path("runs", machine.runId))} && cd ${quote(dir)} && npx vitest run ${files} --reporter=json --outputFile=${quote(out)} > /dev/null 2> ${quote(out)}.log`, { quiet: true });
  const text = await machine.read(out).catch((error: Error) => { throw new Error(`vitest wrote no report for ${label} on ${machine.name}: ${error.message}`); });
  return outcomes(JSON.parse(text) as VitestJson, dir);
}

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const json = parsed.options.json === true;
  const machine = Machine.open(stringOption(parsed, "on"));
  const base = resolveRef(stringOption(parsed, "base")!, false);
  const ref = resolveRef(stringOption(parsed, "ref")!, parsed.options["with-local"] === true);
  if (base === ref) throw new Error(`--base and --ref are the same commit ${base.slice(0, 10)}`);
  progress(`base ${base.slice(0, 10)}  ref ${ref.slice(0, 10)}  on ${machine.name}`);
  // One after the other: the second copy is made from the first and only the diff travels.
  const baseDir = await machine.copy(base);
  const refDir = await machine.copy(ref);
  progress("running both suites");
  const [baseRun, refRun] = await Promise.all([vitest(machine, baseDir, "base", parsed.positionals), vitest(machine, refDir, "ref", parsed.positionals)]);
  const first = diff(baseRun, refRun);
  const suspects = [...first.newFailures, ...first.newTestsFailing];
  // Each suspect file runs again alone, on both sides one after the other, so load from the other suite is gone.
  // A "fix" gets the same treatment from the other side: it counts only if the base fails it again alone.
  let settled: ReturnType<typeof settle> = { confirmed: [], flaky: [] }, fixed = first.newPasses;
  if (suspects.length || first.newPasses.length) {
    const files = [...new Set([...suspects, ...first.newPasses].map((suspect) => suspect.file))];
    progress(`re-running ${suspects.length + first.newPasses.length} suspect test(s) in ${files.length} file(s) alone`);
    const refAgain = await vitest(machine, refDir, "ref-rerun", files);
    const baseAgain = await vitest(machine, baseDir, "base-rerun", files);
    settled = settle(suspects, baseAgain, refAgain);
    fixed = first.newPasses.filter((pass) => baseAgain.get(pass.id)?.status === "failed" && refAgain.get(pass.id)?.status === "passed");
  }
  const counts = (outcomesMap: Map<string, TestOutcome>) => [...outcomesMap.values()].reduce((total, outcome) => ({ ...total, [outcome.status]: (total[outcome.status] ?? 0) + 1 }), {} as Record<string, number>);
  const data = {
    base, ref, machine: machine.name,
    totals: { base: counts(baseRun), ref: counts(refRun) },
    newFailures: settled.confirmed.map(({ id, message }) => ({ id, message: message.split("\n")[0] ?? "" })),
    flaky: settled.flaky.map(({ id, timed, message }) => ({ id, timed, message: message.split("\n")[0] ?? "" })),
    newPasses: fixed.map(({ id }) => id),
    baseBroken: first.baseBroken.map(({ id }) => id),
  };
  const section = (title: string, rows: string[][], headers: string[]) => rows.length ? `\n${title} (${rows.length})\n${table(headers, rows)}` : `\n${title}: none`;
  const human = [
    `base ${base.slice(0, 10)}: ${JSON.stringify(data.totals.base)}   ref ${ref.slice(0, 10)}: ${JSON.stringify(data.totals.ref)}`,
    section("NEW FAILURES (fail on ref, pass on base, again when run alone)", data.newFailures.map((failure) => [failure.id, failure.message.slice(0, 100)]), ["test", "first line"]),
    section("Flaky on ref, passed when run alone", data.flaky.map((failure) => [failure.id, failure.timed ? "timing" : "", failure.message.slice(0, 80)]), ["test", "kind", "first line"]),
    section("Fixed by ref (failed on base again alone)", data.newPasses.map((id) => [id]), ["test"]),
    section("Already broken on base (not counted)", data.baseBroken.map((id) => [id]), ["test"]),
  ].join("\n");
  emit(json, human, data);
  return data.newFailures.length ? EXIT.found : EXIT.ok;
}
