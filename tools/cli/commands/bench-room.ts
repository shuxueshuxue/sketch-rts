import { parseArgs, stringOption, UsageError, type CommandSpec } from "../args";
import { cells, metricSummary, type RoomResult } from "../lib/bench-summary";
import { emit, EXIT, progress, table } from "../output";
import { Machine, quote, resolveRef } from "../runner";

export const spec: CommandSpec = {
  name: "bench room",
  summary: "Play the room AIs' bench on two commits (same games) and compare wins, flipped games and direct metrics.",
  usage: "bench room [--base origin/main] [--ref HEAD] [--with-local] [--subjects …] [--rivals v8,v9] [--seeds v5-final-1] [--maps 20] [--metrics clear,bases@4,trade@15] [--workers 46] [--on M] [--json]",
  options: [
    { name: "base", description: "the commit to compare against", default: "origin/main" },
    { name: "ref", description: "the commit under test", default: "HEAD" },
    { name: "with-local", description: "bench the working tree's uncommitted changes on top of --ref", boolean: true },
    { name: "subjects", description: "room AIs", default: "v9_archer,v9_summoner,v9_knight" },
    { name: "rivals", description: "one duel bench per rival", default: "v8,v9" },
    { name: "seeds", description: "map-selection seeds", default: "v5-final-1" },
    { name: "maps", description: "maps per seed; each map is played with both races (40 games per cell at 20)", default: "20" },
    { name: "metrics", description: "direct measures (bases@N, workers@N, spent@N, trade@N, clear, hire, upgrade@K.L)", default: "" },
    { name: "workers", description: "parallel games per commit", default: "46" },
    { name: "on", description: "machine from ~/.config/sketch/machines.json" },
    { name: "json", description: "one JSON object on stdout instead of tables", boolean: true },
  ],
};

const csv = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

async function bench(machine: Machine, dir: string, label: string, options: { subjects: string[]; rivals: string[]; seeds: string[]; maps: string; metrics: string[]; workers: string }) {
  const results = new Map<string, RoomResult[]>();
  for (const rival of options.rivals) {
    const out = machine.path("runs", machine.runId, label, rival);
    const flags = [`--subjects ${options.subjects.join(",")}`, `--rivals ${rival}`, `--seeds ${options.seeds.join(",")}`, `--map-count ${options.maps}`,
      `--workers ${options.workers}`, `--out-dir ${quote(out)}`, `--label ${label}`, ...(options.metrics.length ? [`--metrics ${options.metrics.join(",")}`] : [])];
    const run = await machine.run(`mkdir -p ${quote(out)} && cd ${quote(dir)} && npx tsx scripts/ai-room-gauntlet-benchmark.ts ${flags.join(" ")} > ${quote(out)}.out 2>&1`, { quiet: true });
    if (run.code !== 0) throw new Error(`The ${label} bench against ${rival} failed on ${machine.name}:\n${(await machine.read(`${out}.out`)).slice(-2000)}`);
    for (const subject of options.subjects) for (const seed of options.seeds) {
      const result = JSON.parse(await machine.read(`${out}/${label}-${subject}-${seed}.log`)) as RoomResult;
      const key = `${subject}|${rival}`;
      results.set(key, [...(results.get(key) ?? []), result]);
    }
  }
  return results;
}

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const json = parsed.options.json === true;
  const options = {
    subjects: csv(stringOption(parsed, "subjects")), rivals: csv(stringOption(parsed, "rivals")), seeds: csv(stringOption(parsed, "seeds")),
    maps: stringOption(parsed, "maps")!, metrics: csv(stringOption(parsed, "metrics")), workers: stringOption(parsed, "workers")!,
  };
  if (!/^\d+$/.test(options.maps) || !/^\d+$/.test(options.workers)) throw new UsageError("--maps and --workers take whole numbers");
  const machine = Machine.open(stringOption(parsed, "on"));
  const base = resolveRef(stringOption(parsed, "base")!, false);
  const ref = resolveRef(stringOption(parsed, "ref")!, parsed.options["with-local"] === true);
  progress(`base ${base.slice(0, 10)}  ref ${ref.slice(0, 10)}  on ${machine.name}: ${options.subjects.length} subjects x ${options.rivals.length} rivals x ${options.seeds.length} seeds x ${options.maps} maps x 2 races`);
  const baseDir = await machine.copy(base);
  const refDir = await machine.copy(ref);
  progress("playing both benches");
  const [baseResults, refResults] = await Promise.all([bench(machine, baseDir, "base", options), bench(machine, refDir, "ref", options)]);
  const compared = cells(baseResults, refResults);
  const total = (side: "base" | "ref") => compared.reduce((sum, cell) => sum + cell[side].wins, 0);
  const metricRows = options.subjects.flatMap((subject) => options.metrics.map((metric) => {
    const all = (results: Map<string, RoomResult[]>) => [...results].filter(([key]) => key.startsWith(`${subject}|`)).flatMap(([, list]) => list);
    return { subject, metric, base: metricSummary(all(baseResults), subject, metric), ref: metricSummary(all(refResults), subject, metric) };
  }));
  // A first-minute metric the subject never reached in some games says how many: "7.2 / 6.9 (12 never)".
  const side = (summary: ReturnType<typeof metricSummary>, absent: string) => summary ? `${fmt(summary.own)} / ${fmt(summary.rival)}${summary.missing ? ` (${summary.missing} never)` : ""}` : absent;
  const fmt = (value: number | null | undefined) => value === null || value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(3);
  // Each game's metric values too, keyed "<subject>|<rival>" then by game, so a measure can be traced to the maps it comes from.
  const perGame = (results: Map<string, RoomResult[]>) => Object.fromEntries([...results].map(([key, list]) => [key, Object.assign({}, ...list.map((result) => result.metrics ?? {}))]));
  const data = { base, ref, machine: machine.name, games: compared.reduce((sum, cell) => sum + cell.ref.games, 0), totals: { base: total("base"), ref: total("ref") }, cells: compared, metrics: metricRows,
    ...(options.metrics.length ? { gameMetrics: { base: perGame(baseResults), ref: perGame(refResults) } } : {}) };
  const human = [
    table(["subject", "rival", "base", "ref", "flipped games"], compared.map((cell) => [cell.subject, cell.rival, `${cell.base.wins}/${cell.base.games}`, `${cell.ref.wins}/${cell.ref.games}`, cell.flips.length])),
    `total wins: base ${data.totals.base}  ref ${data.totals.ref}`,
    ...(metricRows.length ? ["", "metrics (subject / its rival; trade@N is the rival's losses over the subject's, higher is better for the subject)",
      table(["subject", "metric", "base", "ref"], metricRows.map((row) => [row.subject, row.metric,
        side(row.base, "n/a (commit predates this metric)"), side(row.ref, "n/a")]))] : []),
  ].join("\n");
  emit(json, human, data);
  return EXIT.ok;
}
