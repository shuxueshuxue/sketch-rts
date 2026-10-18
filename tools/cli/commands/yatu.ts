import { parseArgs, stringOption, UsageError, type CommandSpec } from "../args";
import { browserRunExit, runScene, sceneFile, SIZES, type BrowserRun } from "../lib/browser-run";
import { emit, table } from "../output";
import { Machine, resolveRef } from "../runner";

export const spec: CommandSpec = {
  name: "yatu",
  summary: "Run a scene file in a real browser against each commit's own dev server, and bring back its shots.",
  usage: "yatu <scene> [--ref HEAD] [--ref2 REF] [--sizes desktop] [--locale en-US] [--with-local] [--on M] [--json]",
  options: [
    { name: "ref", description: "the commit to run", default: "HEAD" },
    { name: "ref2", description: "a second commit to run the same scene on" },
    { name: "sizes", description: "viewports for every shot: desktop (1600x900), phone (390x844)", default: "desktop" },
    { name: "locale", description: "the browser's language, which the game speaks (zh-CN for Chinese)", default: "en-US" },
    { name: "with-local", description: "run the working tree's uncommitted changes on top of --ref", boolean: true },
    { name: "on", description: "machine from ~/.config/sketch/machines.json" },
    { name: "json", description: "one JSON object on stdout instead of a table", boolean: true },
  ],
};

export function sizesOption(value: string | undefined) {
  return (value ?? "desktop").split(",").map((name) => {
    const size = SIZES[name];
    if (!size) throw new UsageError(`Unknown size "${name}": ${Object.keys(SIZES).join(", ")}`);
    return size;
  });
}

export async function run(argv: string[]) {
  const parsed = parseArgs(spec, argv);
  const [name] = parsed.positionals;
  if (!name || parsed.positionals.length > 1) throw new UsageError(`usage: sketch ${spec.usage}`);
  const scene = sceneFile(name);
  const machine = Machine.open(stringOption(parsed, "on"));
  const sizes = sizesOption(stringOption(parsed, "sizes"));
  const refs = [resolveRef(stringOption(parsed, "ref")!, parsed.options["with-local"] === true)];
  const second = stringOption(parsed, "ref2");
  if (second) refs.push(resolveRef(second, false));
  const runs: BrowserRun[] = [];
  // One after the other: each commit's server and browser on their own, and the second copy made from the first.
  for (const [index, sha] of refs.entries()) runs.push(await runScene(machine, sha, scene, refs.length > 1 ? `ref${index + 1}-${sha.slice(0, 7)}` : sha.slice(0, 7), sizes, [], stringOption(parsed, "locale")));
  const rows = runs.flatMap((run) => [
    ...run.shots.map((shot) => [run.label, shot.name, shot.size, shot.file.replace(run.remoteDir, run.localDir)]),
    ...(run.ok ? [] : [[run.label, "FAILED", "", run.failure ?? ""]]),
    ...run.errors.map((error) => [run.label, "page", "", error]),
  ]);
  emit(parsed.options.json === true, table(["run", "shot", "size", "file / message"], rows),
    { runs: runs.map(({ sha, label, ok, failure, errors, localDir, shots }) => ({ sha, label, ok, failure, errors, localDir, shots: shots.map((shot) => ({ ...shot, file: shot.file.replace(runs.find((run) => run.label === label)!.remoteDir, localDir) })) })) });
  return browserRunExit(runs);
}
