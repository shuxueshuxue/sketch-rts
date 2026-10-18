import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs, stringOption, UsageError, type CommandSpec } from "../args";
import { browserConfig, COMPOSE, localRunDir, pull, runScene, sceneFile, type BrowserRun } from "../lib/browser-run";
import { emit, EXIT, progress, table } from "../output";
import { Machine, quote, resolveRef } from "../runner";
import { push } from "./evidence";
import { sizesOption } from "./yatu";

export const spec: CommandSpec = {
  name: "shot",
  summary: "Scenes on two commits, stitched before|after per shot into webp images ranked by how much changed.",
  usage: "shot <scene> | --suite NAME --before REF --after REF [--at 5,30] [--sizes desktop,phone] [--locale en-US] [--out DIR] [--pr N] [--on M] [--json]",
  options: [
    { name: "suite", description: "a fixed set of scenes from tools/cli/scenes/suites.json (render, perf) instead of one scene" },
    { name: "before", description: "the commit on the left" },
    { name: "after", description: "the commit on the right" },
    { name: "at", description: "after the scene, also shoot at these game seconds (comma-separated)" },
    { name: "sizes", description: "viewports for every shot: desktop (1600x900), phone (390x844)", default: "desktop" },
    { name: "locale", description: "the browser's language, which the game speaks (zh-CN for Chinese)", default: "en-US" },
    { name: "out", description: "move the images here from ~/.cache/sketch-cli/runs/<run id>/shot" },
    { name: "pr", description: "push the images to the evidence store for this PR and leave a pointer" },
    { name: "on", description: "machine from ~/.config/sketch/machines.json" },
    { name: "json", description: "one JSON object on stdout instead of a table", boolean: true },
  ],
};

// Scene runs at once on one machine: each takes a port of its range and a browser.
const PARALLEL = 3;

export function suiteScenes(name: string): string[] {
  const suites = JSON.parse(readFileSync(fileURLToPath(new URL("../scenes/suites.json", import.meta.url)), "utf8")) as Record<string, string[]>;
  const scenes = suites[name];
  if (!scenes) throw new UsageError(`No suite "${name}" in tools/cli/scenes/suites.json: ${Object.keys(suites).join(", ")}`);
  return scenes;
}

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]!); }
  }));
  return results;
}

/** The overview: every pair, most changed first, then the scenes that did not finish on both sides. */
function overview(title: string, pairs: { image: string; scene: string; shot: string; diff: number }[], failures: { scene: string; label: string; failure: string }[]) {
  const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#f4f1ea;color:#222}h2{font-size:15px;margin:24px 0 6px}img{max-width:100%;border:1px solid #bbb}.diff{color:#a33}pre{white-space:pre-wrap;background:#fff;padding:8px}</style>
<h1>${escape(title)}</h1>
${failures.length ? `<h2>Did not finish</h2>${failures.map((f) => `<p><b>${escape(f.scene)}</b> (${escape(f.label)})</p><pre>${escape(f.failure)}</pre>`).join("")}` : ""}
${pairs.map((pair) => `<h2>${escape(pair.scene)} · ${escape(pair.shot)} <span class="diff">${(pair.diff * 100).toFixed(1)}% changed</span></h2><a href="${escape(pair.image)}"><img src="${escape(pair.image)}" loading="lazy"></a>`).join("\n")}
`;
}

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const suite = stringOption(parsed, "suite");
  const beforeRef = stringOption(parsed, "before"), afterRef = stringOption(parsed, "after");
  if ((suite ? parsed.positionals.length !== 0 : parsed.positionals.length !== 1) || !beforeRef || !afterRef) throw new UsageError(`usage: sketch ${spec.usage}`);
  const at = (stringOption(parsed, "at") ?? "").split(",").filter(Boolean).map((value) => {
    if (!/^\d+(\.\d+)?$/.test(value)) throw new UsageError(`--at takes game seconds: ${value}`);
    return Number(value);
  });
  const scenes = (suite ? suiteScenes(suite) : parsed.positionals).map((name) => ({ name: basename(name).replace(/\.ts$/, ""), file: sceneFile(name) }));
  const sizes = sizesOption(stringOption(parsed, "sizes"));
  const machine = Machine.open(stringOption(parsed, "on"));
  const { browser } = browserConfig(machine);
  const before = resolveRef(beforeRef, false), after = resolveRef(afterRef, false);
  const locale = stringOption(parsed, "locale");
  // Both copies first, so the scenes running at once find them made.
  await machine.copy(before); const dir = await machine.copy(after);
  const runs = await pool(scenes.flatMap((scene) => (["before", "after"] as const).map((side) => ({ scene, side }))), PARALLEL, ({ scene, side }) =>
    runScene(machine, side === "before" ? before : after, scene.file, `${scene.name}.${side}`, sizes, at, locale));
  const sideOf = (scene: string, side: string) => runs.find((run) => run.label === `${scene}.${side}`)!;
  const failed = runs.filter((run) => !run.ok);
  // A scene's own check that holds on before and fails on after is what this PR broke; one failing on both was broken already.
  const broken = scenes.filter((scene) => sideOf(scene.name, "before").ok && !sideOf(scene.name, "after").ok && sideOf(scene.name, "after").code === 1).map((scene) => scene.name);

  const key = (shot: { name: string; size: string }) => `${shot.name}-${shot.size}`;
  const composeDir = machine.path("runs", machine.runId, "shot");
  const pairs = scenes.filter((scene) => sideOf(scene.name, "before").ok && sideOf(scene.name, "after").ok).flatMap((scene) => {
    const afterShots = new Map(sideOf(scene.name, "after").shots.map((shot) => [key(shot), shot]));
    return sideOf(scene.name, "before").shots.filter((shot) => afterShots.has(key(shot))).map((shot) => ({
      scene: scene.name, shot: key(shot), before: shot.file, after: afterShots.get(key(shot))!.file,
      out: `${composeDir}/${scenes.length > 1 ? `${scene.name}--` : ""}${key(shot)}.webp`,
      labels: [`before ${before.slice(0, 7)}`, `after ${after.slice(0, 7)}`] as [string, string],
    }));
  });
  const unpaired = scenes.flatMap((scene) => {
    const sides = [sideOf(scene.name, "before"), sideOf(scene.name, "after")];
    if (!sides.every((run) => run.ok)) return [];
    return sides.flatMap((run) => run.shots.map(key)).filter((k) => !pairs.some((pair) => pair.scene === scene.name && pair.shot === k)).map((k) => `${scene.name}/${k}`);
  });
  const diffs = new Map<string, number>();
  if (pairs.length) {
    progress(`stitching ${pairs.length} pairs on ${machine.name}`);
    const driver = `${composeDir}/compose.mts`;
    await machine.runOk(`mkdir -p ${quote(composeDir)} && cat > ${quote(driver)}`, { input: Readable.from([COMPOSE]), quiet: true });
    // The dom read back with each side's picture travels with the images.
    await machine.runOk(pairs.map((pair) => `cp ${quote(`${pair.before}.json`)} ${quote(pair.out.replace(/\.webp$/, ".before.json"))} && cp ${quote(`${pair.after}.json`)} ${quote(pair.out.replace(/\.webp$/, ".after.json"))}`).join(" && "), { quiet: true });
    const composed = await machine.runOk(`cd ${quote(dir)} && node_modules/.bin/tsx ${quote(driver)} ${quote(JSON.stringify({ playwright: browser.playwright, browsersPath: browser.browsersPath, pairs }))} && rm -f ${quote(driver)}`, { quiet: true });
    for (const line of composed.stdout.split("\n").filter((line) => line.startsWith("{"))) { const { out, diff } = JSON.parse(line) as { out: string; diff: number }; diffs.set(basename(out), diff); }
  }
  const local = join(localRunDir(machine), "shot");
  await pull(machine, composeDir, local);
  const ranked = pairs.map((pair) => ({ image: basename(pair.out), scene: pair.scene, shot: pair.shot, diff: diffs.get(basename(pair.out)) ?? NaN })).sort((a, b) => b.diff - a.diff);
  const failures = failed.map((run) => ({ scene: run.label.replace(/\.(before|after)$/, ""), label: `${run.label.endsWith(".before") ? "before" : "after"} ${run.sha.slice(0, 7)}`, failure: run.failure ?? `exit ${run.code}` }));
  writeFileSync(join(local, "index.html"), overview(`${suite ? `suite ${suite}` : scenes[0]!.name}: ${before.slice(0, 7)} → ${after.slice(0, 7)}`, ranked, failures));

  let where = local, pointer: string | undefined;
  const out = stringOption(parsed, "out"), pr = stringOption(parsed, "pr");
  if (out) { renameSync(local, resolve(out)); where = resolve(out); }
  if (pr) {
    if (await push.run([where, "--on", machine.name, "--pr", pr]) !== EXIT.ok) throw new Error("pushing the shots to the evidence store failed");
    pointer = `${where}.evidence.json`;
  }
  emit(parsed.options.json === true, [
    table(["changed", "scene", "image"], ranked.map((pair) => [`${(pair.diff * 100).toFixed(1)}%`, pair.scene, join(where, pair.image)])),
    ...(failures.length ? [table(["scene", "side", "failure"], failures.map((f) => [f.scene, f.label, f.failure.split("\n")[0]!.slice(0, 160)]))] : []),
    ...(broken.length ? [`broken by ${after.slice(0, 7)} (passes on ${before.slice(0, 7)}): ${broken.join(", ")}`] : []),
    ...(unpaired.length ? [`not on both commits: ${unpaired.join(", ")}`] : []),
    `overview: ${join(where, "index.html")}`,
    ...(pointer ? [`pointer: ${pointer}`] : []),
  ].join("\n"), { before, after, dir: where, overview: join(where, "index.html"), images: ranked, failures, broken, unpaired, pointer, errors: runs.flatMap((run) => run.errors) });
  return shotExit(runs, broken);
}

/** 2 when the environment failed a run, 1 when a scene's own check passes on before and fails on after, else 0. */
export function shotExit(runs: readonly BrowserRun[], broken: readonly string[]) {
  if (runs.some((run) => run.code !== 0 && run.code !== 1)) return EXIT.error;
  return broken.length ? EXIT.found : EXIT.ok;
}
