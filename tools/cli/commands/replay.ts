import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs, stringOption, UsageError, type CommandSpec } from "../args";
import { emit, EXIT, progress, table } from "../output";
import { Machine, quote, resolveRef } from "../runner";

export const spec: CommandSpec = {
  name: "replay",
  summary: "Play one room-gauntlet game and print what the armies, the general and the scripts did; --fork plays one moment on two commits.",
  usage: "replay <subject> <rival> <seed> \"<match>\" [--ref HEAD] [--from 0] [--to 18000] [--every 600] [--show army,general,orders,losses] [--fork TICK --after REF] [--on M] [--json]",
  options: [
    { name: "ref", description: "the commit to play (with --fork: the one that plays up to the fork)", default: "HEAD" },
    { name: "with-local", description: "play the working tree's uncommitted changes on top of --ref", boolean: true },
    { name: "from", description: "first tick sampled", default: "0" },
    { name: "to", description: "last tick played", default: "18000" },
    { name: "every", description: "ticks between samples (20 ticks = 1 s)", default: "600" },
    { name: "show", description: "views: army, general, orders, losses", default: "army,general,losses" },
    { name: "fork", description: "tick at which the game is saved and continued on --ref and on --after" },
    { name: "after", description: "with --fork: the commit that continues the saved moment" },
    { name: "on", description: "machine from ~/.config/sketch/machines.json" },
    { name: "json", description: "every sample as JSON instead of tables", boolean: true },
  ],
};

type Sample = { tick: number; views: { army?: Record<string, { units: number; center?: number[]; spread?: number; inContact?: number; hp?: number; orders?: Record<string, number> }>; general?: Record<string, unknown>; orders?: Record<string, number>; losses?: Record<string, number> } };

const number = (parsed: ReturnType<typeof parseArgs>, name: string) => {
  const value = stringOption(parsed, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`--${name} takes a tick count`);
  return Number(value);
};

// The driver is this CLI's, not the copy's: an older commit has none. It is placed at the copy's root (its imports
// rewritten to match) and runs against that commit's own src/.
const DRIVER = readFileSync(fileURLToPath(new URL("../drivers/replay.ts", import.meta.url)), "utf8").replaceAll("../../../src/", "./src/");

async function play(machine: Machine, dir: string, options: Record<string, unknown>) {
  await machine.runOk(`cat > ${quote(dir)}/.sketch-replay.ts`, { input: Readable.from([DRIVER]), quiet: true });
  const result = await machine.runOk(`cd ${quote(dir)} && npx tsx .sketch-replay.ts ${quote(JSON.stringify(options))}`, { quiet: true });
  return result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Sample);
}

function row(sample: Sample) {
  const army = (name: string) => {
    const side = sample.views.army?.[name];
    if (!side) return "";
    if (!side.units) return "0";
    return `${side.units} hp${side.hp}% contact${side.inContact} spread${side.spread} ${Object.entries(side.orders ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([order, count]) => `${order}:${count}`).join(" ")}`;
  };
  const general = sample.views.general ? `${sample.views.general.mode ?? "-"}${sample.views.general.target ? `@${(sample.views.general.target as number[]).join(",")}` : ""}${sample.views.general.creep ? ` creep:${sample.views.general.creep}` : ""}` : "";
  const losses = sample.views.losses ? `${sample.views.losses.room ?? 0} / ${sample.views.losses.rival ?? 0}` : "";
  const orders = sample.views.orders ? Object.entries(sample.views.orders).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, count]) => `${key}:${count}`).join(", ") : "";
  return [`${(sample.tick / 1200).toFixed(2)}m`, army("room"), army("rival"), general, losses, orders];
}

const HEADERS = ["time", "room army", "rival army", "general", "lost room/rival", "room orders since last sample"];

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const [subject, rival, seed, matchName] = parsed.positionals;
  if (!subject || !rival || !seed || !matchName) throw new UsageError(`usage: sketch ${spec.usage}`);
  const json = parsed.options.json === true;
  const machine = Machine.open(stringOption(parsed, "on"));
  const ref = resolveRef(stringOption(parsed, "ref")!, parsed.options["with-local"] === true);
  const base = { subject, rival, seed, match: matchName, from: number(parsed, "from")!, to: number(parsed, "to")!, every: number(parsed, "every")!,
    show: (stringOption(parsed, "show") ?? "").split(",").filter(Boolean) };
  const fork = number(parsed, "fork"), afterRef = stringOption(parsed, "after");
  if ((fork === undefined) !== (afterRef === undefined)) throw new UsageError("--fork and --after go together");
  const dir = await machine.copy(ref);
  if (fork === undefined) {
    progress(`playing ${matchName} on ${ref.slice(0, 10)} to tick ${base.to}`);
    const samples = await play(machine, dir, base);
    emit(json, table(HEADERS, samples.map(row)), { ref, samples });
    return EXIT.ok;
  }
  const after = resolveRef(afterRef!, false);
  const afterDir = await machine.copy(after);
  const file = machine.path("runs", machine.runId, `moment-${fork}.json`);
  await machine.runOk(`mkdir -p ${quote(machine.path("runs", machine.runId))}`, { quiet: true });
  progress(`playing ${matchName} on ${ref.slice(0, 10)} to the fork at tick ${fork}`);
  await play(machine, dir, { ...base, from: Number.MAX_SAFE_INTEGER, save: { at: fork, file } });
  progress(`continuing tick ${fork} on ${ref.slice(0, 10)} and on ${after.slice(0, 10)}`);
  const [before, changed] = await Promise.all([play(machine, dir, { ...base, from: Math.max(fork, base.from), load: file }), play(machine, afterDir, { ...base, from: Math.max(fork, base.from), load: file })]);
  const lostAfterFork = (samples: Sample[]) => samples.reduce((sum, sample) => ({ room: sum.room + (sample.views.losses?.room ?? 0), rival: sum.rival + (sample.views.losses?.rival ?? 0) }), { room: 0, rival: 0 });
  const totals = { [ref.slice(0, 10)]: lostAfterFork(before), [after.slice(0, 10)]: lostAfterFork(changed) };
  const human = [
    `--ref ${ref.slice(0, 10)} from the fork`, table(HEADERS, before.map(row)), "",
    `--after ${after.slice(0, 10)} from the fork`, table(HEADERS, changed.map(row)), "",
    `gold lost after tick ${fork} (room / rival): ${Object.entries(totals).map(([commit, value]) => `${commit} ${value.room} / ${value.rival}`).join("   ")}`,
  ].join("\n");
  emit(json, human, { ref, after, fork, totals, samples: { ref: before, after: changed } });
  return EXIT.ok;
}
