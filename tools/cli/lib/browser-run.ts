import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { UsageError } from "../args";
import { EXIT, progress } from "../output";
import { quote, type Machine } from "../runner";

// How `sketch yatu` and `sketch shot` run a scene file on one commit: the commit's copy serves itself (dev server, a
// port of the machine's range), the CLI's own browser driver drives it, and the shots come back here.

export type Size = { name: string; width: number; height: number };
export const SIZES: Record<string, Size> = { desktop: { name: "desktop", width: 1600, height: 900 }, phone: { name: "phone", width: 390, height: 844 } };
export type ShotRecord = { name: string; size: string; file: string; dom: Record<string, unknown> };
export type BrowserRun = { sha: string; label: string; ok: boolean; failure?: string; shots: ShotRecord[]; errors: string[]; code: number; localDir: string; remoteDir: string };

// The drivers are this CLI's, not the copy's: an older commit has none.
const DRIVER = readFileSync(fileURLToPath(new URL("../drivers/browser.ts", import.meta.url)), "utf8");
export const COMPOSE = readFileSync(fileURLToPath(new URL("../drivers/compose.ts", import.meta.url)), "utf8");

export function sceneFile(name: string) {
  const path = existsSync(name) ? resolve(name) : fileURLToPath(new URL(`../scenes/${name.replace(/\.ts$/, "")}.ts`, import.meta.url));
  if (!existsSync(path)) throw new UsageError(`No scene "${name}": give a file, or a name under tools/cli/scenes/`);
  return path;
}

export function browserConfig(machine: Machine) {
  const { ports, browser } = machine.config;
  if (!ports) throw new Error(`Machine "${machine.name}" has no "ports" range in machines.json; a browser run serves only inside it (see tools/cli/machines.example.json)`);
  if (!browser) throw new Error(`Machine "${machine.name}" has no "browser" in machines.json: the Playwright install to drive (see tools/cli/machines.example.json)`);
  return { ports, browser };
}

export function localRunDir(machine: Machine) {
  return join(homedir(), ".cache", "sketch-cli", "runs", machine.runId);
}

export async function runScene(machine: Machine, sha: string, scene: string, label: string, sizes: Size[], at: number[] = []): Promise<BrowserRun> {
  const { ports, browser } = browserConfig(machine);
  const dir = await machine.copy(sha);
  const tag = `${machine.runId}-${label}`;
  const driver = `.sketch-browser-${tag}.ts`, sceneName = `.sketch-scene-${tag}.ts`, remoteDir = machine.path("runs", machine.runId, label);
  // Placed at the copy's root under this run's own names: two runs of one commit share its copy.
  await machine.runOk(`cat > ${quote(dir)}/${driver}`, { input: Readable.from([DRIVER]), quiet: true });
  await machine.runOk(`cat > ${quote(dir)}/${sceneName}`, { input: Readable.from([readFileSync(scene, "utf8")]), quiet: true });
  const options = { scene: sceneName, sha, out: remoteDir, ports, playwright: browser.playwright, browsersPath: browser.browsersPath, sizes, label, at };
  progress(`${label}: ${basename(scene)} on ${sha.slice(0, 10)} (${machine.name})`);
  const result = await machine.run(`cd ${quote(dir)} && node_modules/.bin/tsx ${driver} ${quote(JSON.stringify(options))}; code=$?; rm -f ${driver} ${sceneName}; exit $code`, { quiet: true });
  const last = result.stdout.trim().split("\n").at(-1) ?? "";
  let report: { ok: boolean; failure?: string; shots: ShotRecord[]; errors: string[] };
  try { report = JSON.parse(last); }
  catch { throw new Error(`The browser driver on ${machine.name} reported nothing (exit ${result.code}):\n${result.stderr.slice(-2000)}`); }
  const localDir = join(localRunDir(machine), label);
  await pull(machine, remoteDir, localDir);
  return { sha, label, ...report, code: result.code, localDir, remoteDir };
}

/** Copies a run directory from the machine to here. */
export async function pull(machine: Machine, remoteDir: string, localDir: string) {
  mkdirSync(localDir, { recursive: true });
  const untar = spawn("tar", ["-x", "-C", localDir], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve) => untar.on("close", resolve));
  await machine.runOk(`mkdir -p ${quote(remoteDir)} && tar -c -C ${quote(remoteDir)} .`, { output: untar.stdin!, quiet: true });
  untar.stdin!.end();
  await done;
}

/** 2 when the environment failed a run, 1 when a scene's own check did, else 0. */
export function browserRunExit(runs: readonly BrowserRun[]) {
  if (runs.some((run) => run.code !== 0 && run.code !== 1)) return EXIT.error;
  return runs.some((run) => run.code === 1) ? EXIT.found : EXIT.ok;
}
