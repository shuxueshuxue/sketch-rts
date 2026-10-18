import { readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { parseArgs, stringOption, UsageError, type CommandSpec } from "../args";
import { browserConfig, browserRunExit, COMPOSE, localRunDir, pull, runScene, sceneFile } from "../lib/browser-run";
import { emit, EXIT, progress, table } from "../output";
import { Machine, quote, resolveRef } from "../runner";
import { push } from "./evidence";
import { sizesOption } from "./yatu";

export const spec: CommandSpec = {
  name: "shot",
  summary: "The same scene on two commits, stitched before|after per shot into webp images, pushed to the evidence store.",
  usage: "shot <scene> --before REF --after REF [--at 5,30] [--sizes desktop,phone] [--out DIR] [--pr N] [--on M] [--json]",
  options: [
    { name: "before", description: "the commit on the left" },
    { name: "after", description: "the commit on the right" },
    { name: "at", description: "after the scene, also shoot at these game seconds (comma-separated)" },
    { name: "sizes", description: "viewports for every shot: desktop (1600x900), phone (390x844)", default: "desktop" },
    { name: "out", description: "write the images to this directory instead of the evidence store" },
    { name: "pr", description: "the PR the evidence belongs to (kept in the pointer)" },
    { name: "on", description: "machine from ~/.config/sketch/machines.json" },
    { name: "json", description: "one JSON object on stdout instead of a table", boolean: true },
  ],
};

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const [name] = parsed.positionals;
  const beforeRef = stringOption(parsed, "before"), afterRef = stringOption(parsed, "after");
  if (!name || parsed.positionals.length > 1 || !beforeRef || !afterRef) throw new UsageError(`usage: sketch ${spec.usage}`);
  const at = (stringOption(parsed, "at") ?? "").split(",").filter(Boolean).map((value) => {
    if (!/^\d+(\.\d+)?$/.test(value)) throw new UsageError(`--at takes game seconds: ${value}`);
    return Number(value);
  });
  const scene = sceneFile(name), sizes = sizesOption(stringOption(parsed, "sizes"));
  const machine = Machine.open(stringOption(parsed, "on"));
  const { browser } = browserConfig(machine);
  const before = resolveRef(beforeRef, false), after = resolveRef(afterRef, false);
  const runs = [await runScene(machine, before, scene, "before", sizes, at), await runScene(machine, after, scene, "after", sizes, at)];
  if (runs.some((run) => !run.ok)) {
    emit(parsed.options.json === true, table(["run", "failure"], runs.filter((run) => !run.ok).map((run) => [run.label, run.failure ?? ""])), { runs });
    return browserRunExit(runs);
  }
  const key = (shot: { name: string; size: string }) => `${shot.name}-${shot.size}`;
  const afterShots = new Map(runs[1]!.shots.map((shot) => [key(shot), shot]));
  const pairs = runs[0]!.shots.filter((shot) => afterShots.has(key(shot))).map((shot) => ({
    before: shot.file, after: afterShots.get(key(shot))!.file, out: machine.path("runs", machine.runId, "shot", `${key(shot)}.webp`),
    labels: [`before ${before.slice(0, 7)}`, `after ${after.slice(0, 7)}`] as [string, string],
  }));
  const unpaired = [...runs[0]!.shots, ...runs[1]!.shots].map(key).filter((k) => !pairs.some((pair) => pair.out.endsWith(`/${k}.webp`)));
  if (pairs.length === 0) throw new Error(`The two commits took no shot of the same name: ${unpaired.join(", ")}`);
  progress(`stitching ${pairs.length} pairs on ${machine.name}`);
  const composeDir = machine.path("runs", machine.runId, "shot");
  const driver = `${composeDir}/compose.ts`, dir = await machine.copy(after);
  await machine.runOk(`mkdir -p ${quote(composeDir)} && cat > ${quote(driver)}`, { input: Readable.from([COMPOSE]), quiet: true });
  // The dom read back with each side's picture travels with the images.
  await machine.runOk(pairs.map((pair) => `cp ${quote(`${pair.before}.json`)} ${quote(pair.out.replace(/\.webp$/, ".before.json"))} && cp ${quote(`${pair.after}.json`)} ${quote(pair.out.replace(/\.webp$/, ".after.json"))}`).join(" && "), { quiet: true });
  await machine.runOk(`cd ${quote(dir)} && node_modules/.bin/tsx ${quote(driver)} ${quote(JSON.stringify({ playwright: browser.playwright, browsersPath: browser.browsersPath, pairs }))} && rm -f ${quote(driver)}`, { quiet: true });
  const local = join(localRunDir(machine), "shot");
  await pull(machine, composeDir, local);
  let where = local, pointer: string | undefined;
  const out = stringOption(parsed, "out");
  if (out) { renameSync(local, resolve(out)); where = resolve(out); }
  else {
    const args = [local, "--on", machine.name, ...(stringOption(parsed, "pr") ? ["--pr", stringOption(parsed, "pr")!] : [])];
    if (await push.run(args) !== EXIT.ok) throw new Error("pushing the shots to the evidence store failed");
    pointer = `${local}.evidence.json`;
  }
  const images = readdirSync(where).filter((file) => file.endsWith(".webp")).sort();
  emit(parsed.options.json === true, [table(["image"], images.map((image) => [join(where, image)])), ...(unpaired.length ? [`not on both commits: ${unpaired.join(", ")}`] : []),
    ...(pointer ? [`pointer: ${pointer}`] : [])].join("\n"), { before, after, dir: where, images, unpaired, pointer, errors: runs.flatMap((run) => run.errors) });
  return browserRunExit(runs);
}
