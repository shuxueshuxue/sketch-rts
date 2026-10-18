import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./args";

// Where a subcommand runs. A machine is an ssh target (or this one), the one directory it may write under, and the
// shell lines that set up its environment (PATH, HOME/TMPDIR redirects). The file lives outside the repo:
// ~/.config/sketch/machines.json, or the path in SKETCH_MACHINES; tools/cli/machines.example.json shows the shape.
export type MachineConfig = {
  /** ssh arguments up to the host, e.g. ["-F", "~/YellowPage/ssh_config", "zhipu-a100-102"]; absent for this machine. */
  ssh?: string[];
  /** The only directory the CLI writes under on that machine. */
  root: string;
  /** Shell lines run before every command there. */
  prelude?: string;
  /** The evidence store on that machine (see `sketch evidence`): files named by their sha256, never rewritten. */
  evidence?: string;
  /** The ports `sketch yatu` / `sketch shot` may serve on (each run also takes port + 20000 for vite's HMR): a lane's own
   * range on a shared machine, so a run never lands on another lane's server. */
  ports?: [number, number];
  /** The Playwright install a browser run drives (not a repo dependency), and where its browsers are. */
  browser?: { playwright: string; browsersPath?: string; args?: string[] };
};

export type MachinesFile = { default?: string; machines: Record<string, MachineConfig> };

const LOCAL: MachineConfig = { root: join(homedir(), ".cache", "sketch-cli") };

export function machinesPath() {
  return process.env.SKETCH_MACHINES ?? join(homedir(), ".config", "sketch", "machines.json");
}

export function loadMachines(): MachinesFile {
  const path = machinesPath();
  if (!existsSync(path)) return { default: "local", machines: { local: LOCAL } };
  const file = JSON.parse(readFileSync(path, "utf8")) as MachinesFile;
  return { ...file, machines: { local: LOCAL, ...file.machines } };
}

export function machineConfig(name: string | undefined): { name: string; config: MachineConfig } {
  const file = loadMachines();
  const chosen = name ?? file.default ?? "local";
  const config = file.machines[chosen];
  if (!config) throw new UsageError(`Unknown machine "${chosen}"; ${machinesPath()} defines: ${Object.keys(file.machines).join(", ")}`);
  return { name: chosen, config: config.ssh ? { ...config, ssh: config.ssh.map(expandHome) } : config };
}

function expandHome(arg: string) {
  return arg.startsWith("~/") ? join(homedir(), arg.slice(2)) : arg;
}
