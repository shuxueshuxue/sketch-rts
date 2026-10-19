import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { machineConfig, type MachineConfig } from "./machines";
import { progress } from "./output";
import { git, gitOut } from "./git";
import { UsageError } from "./args";

// The one way the CLI runs work, here or on another machine.
// - Every command runs in its own process group (setsid(2)), and a run kills only the groups it started, by id. Nothing is
//   ever killed by name: `pkill -f <name>` matched its own shell at least three times on 2026-10-17.
// - Every path it writes is under the machine's root; anything else is refused before it runs.
// - A copy of the repo is made per commit (trees/<sha>), never by overlaying files on another tree.

export type RunResult = { code: number; stdout: string; stderr: string };

export class Machine {
  readonly runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  private readonly groups = new Set<string>();

  constructor(readonly name: string, readonly config: MachineConfig) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void this.killAll().finally(() => process.exit(130)); });
  }

  static open(name: string | undefined) {
    const { name: chosen, config } = machineConfig(name);
    return new Machine(chosen, config);
  }

  get remote() { return this.config.ssh !== undefined; }

  /** A path under the machine's root; the only kind of path the CLI writes to. */
  path(...parts: string[]) {
    for (const part of parts) if (part.split("/").includes("..")) throw new Error(`Refusing a path outside ${this.config.root}: ${parts.join("/")}`);
    return [this.config.root, ...parts].join("/");
  }

  /** An object in the machine's evidence store; the store is the one place besides the root the CLI writes to. */
  evidencePath(sha256: string) {
    if (!this.config.evidence) throw new Error(`Machine "${this.name}" has no evidence store; set "evidence" for it in machines.json (see tools/cli/machines.example.json)`);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Not a sha256: ${sha256}`);
    return `${this.config.evidence}/sha256/${sha256}`;
  }

  /**
   * Runs a shell script on the machine in a fresh process group; stdin may be piped in (a tar stream), and stdout may be
   * piped out (bytes, which the collected string would mangle).
   */
  run(script: string, options: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; quiet?: boolean } = {}): Promise<RunResult> {
    const marker = `__sketch_pgid_${this.runId}__`;
    const wrapped = [
      this.config.prelude ?? "",
      `mkdir -p ${quote(this.config.root)}`,
      // The script's own group: its pid is its group id, reported on stderr so the run can kill exactly it. A background
      // job's stdin is /dev/null in a non-interactive shell, so the piped input is handed over explicitly; and a bash
      // reading an ssh socket sources ~/.bashrc, which on the A100 resets HOME and PATH, hence --norc.
      // setsid(2) through perl: macOS has no setsid(1), and both machines have perl.
      `exec 3<&0; perl -MPOSIX -e ${quote('POSIX::setsid() or die "setsid: $!\n"; exec @ARGV or die "exec: $!\n"')} bash --norc --noprofile -c ${quote(script)} <&3 & child=$!; exec 3<&-; echo "${marker}$child" >&2; wait $child`,
    ].filter(Boolean).join("\n");
    const [command, args] = this.remote
      ? ["ssh", [...this.config.ssh!, `bash -c ${quote(wrapped)}`]] as const
      : ["bash", ["-c", wrapped]] as const;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"] });
      if (options.input) {
        child.stdin!.on("error", (error) => reject(new Error(`On ${this.name} the command stopped reading its input: ${error.message}`)));
        options.input.pipe(child.stdin!);
      }
      let stdout = "", stderr = "", group: string | undefined;
      if (options.output) child.stdout!.pipe(options.output);
      else child.stdout!.on("data", (chunk) => { stdout += chunk; });
      child.stderr!.on("data", (chunk) => {
        const text = String(chunk);
        const found = text.match(new RegExp(`${marker}(\\d+)`));
        if (found) { group = found[1]; this.groups.add(group!); }
        const rest = text.replace(new RegExp(`${marker}\\d+\\n?`), "");
        stderr += rest;
        if (!options.quiet && rest) process.stderr.write(rest);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (group) this.groups.delete(group);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }

  async runOk(script: string, options: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; quiet?: boolean } = {}) {
    const result = await this.run(script, options);
    if (result.code !== 0) throw new Error(`On ${this.name} failed (exit ${result.code}): ${script.split("\n")[0]}\n${result.stderr.slice(-2000)}`);
    return result;
  }

  /** Kills the process groups this run started, and nothing else. */
  async killAll() {
    const groups = [...this.groups];
    if (groups.length === 0) return;
    const kill = groups.map((group) => `kill -TERM -- -${group} 2>/dev/null`).join("; ");
    const [command, args] = this.remote ? ["ssh", [...this.config.ssh!, kill]] as const : ["bash", ["-c", kill]] as const;
    await new Promise((resolve) => spawn(command, args, { stdio: "ignore" }).on("close", resolve));
  }

  /**
   * A clean copy of the repo at `sha` under trees/<sha>, reused when already there. Everything tracked outside docs/,
   * plus docs/ text files up to 1 MB (the tests that read docs/ scan them; the screenshots and proof dumps would make
   * the copy 1.4 GB). When the machine already holds a copy of a nearby commit, that copy is duplicated there and only
   * the diff travels; otherwise the tree travels as one gzipped tar (the ThinkPad-to-A100 link moves about 200 KB/s).
   * node_modules is a directory of links into one shared install per package-lock, so each copy keeps its own caches
   * (a shared node_modules/.vite raced between copies on mac1).
   * A copy is usable only once its .sketch-complete marker is written, and it is built under the copy's lock (see
   * lockedBuild): two runs of one commit (a test diff and a bench) build it once, and neither removes a copy the other
   * already reads.
   */
  async copy(sha: string) {
    const dir = this.path("trees", sha);
    const listing = await this.run(`cd ${quote(this.path("trees"))} 2>/dev/null && ls -d */.sketch-complete 2>/dev/null`, { quiet: true });
    const held = listing.stdout.split("\n").map((line) => line.split("/")[0]!).filter((name) => /^[0-9a-f]{40}$/.test(name));
    if (held.includes(sha)) return dir;
    const shared = await this.installNodeModules(sha);
    const staging = this.path("trees", `${sha}.partial-${this.runId}`);
    const { best: near, unavailable } = nearestCommit(sha, held);
    if (unavailable.length) {
      const commits = unavailable.slice(0, 5).map(commit => commit.slice(0, 10)).join(", ") + (unavailable.length > 5 ? `, and ${unavailable.length - 5} more` : "");
      progress(`cached commits unavailable locally on ${this.name}: ${commits}${near ? "; skipping them" : "; no usable incremental base, falling back to full copy"}`);
    }
    let fill: string, input: NodeJS.ReadableStream;
    if (near) {
      progress(`copying ${sha.slice(0, 10)} to ${this.name} from its copy of ${near.sha.slice(0, 10)} (${near.changed} files differ)`);
      fill = `cp -a ${quote(this.path("trees", near.sha))} ${quote(staging)} && rm -f ${quote(staging)}/.sketch-complete && (cd ${quote(staging)} && git apply --allow-empty --whitespace=nowarn --unsafe-paths -)`;
      input = git(["diff", "--binary", "--no-renames", near.sha, sha, "--", ...COPY_PATHSPEC]).stdout!;
    } else {
      const files = copiedFiles(sha);
      progress(`copying ${sha.slice(0, 10)} to ${this.name} (${files.length} files, gzipped)`);
      fill = `mkdir -p ${quote(staging)} && tar -xz -C ${quote(staging)}`;
      input = gzipped(git(["archive", "--format=tar", sha, "--", ...files]).stdout!);
    }
    await this.runOk(lockedBuild(dir, [
      // Under the lock nobody else builds this copy, so whatever is there without its marker is a failed build's.
      `rm -rf ${quote(dir)} ${quote(dir)}.partial-*`,
      fill,
      `rm -rf ${quote(staging)}/node_modules && mkdir -p ${quote(staging)}/node_modules && (cd ${quote(staging)}/node_modules && for entry in ${quote(shared)}/node_modules/* ${quote(shared)}/node_modules/.bin; do ln -sfn "$entry" .; done)`,
      `mv ${quote(staging)} ${quote(dir)}`,
      `touch ${quote(dir)}/.sketch-complete`,
    ].join(" && ")), { input, quiet: true });
    return dir;
  }

  /** The shared install for `sha`'s package-lock (node_modules/<lock hash>), made once under its lock like a copy. */
  private async installNodeModules(sha: string) {
    const lock = gitOut(["show", `${sha}:package-lock.json`]);
    const hash = createHash("sha256").update(lock).digest("hex").slice(0, 16);
    const shared = this.path("node_modules", hash);
    const installed = await this.run(`test -f ${quote(shared)}/.sketch-complete`, { quiet: true });
    if (installed.code === 0) return shared;
    progress(`installing node_modules ${hash} on ${this.name} (once per package-lock)`);
    await this.runOk(lockedBuild(shared, [
      `rm -rf ${quote(shared)} && mkdir -p ${quote(shared)}`,
      `tar -x -C ${quote(shared)}`,
      `cd ${quote(shared)} && npm ci --no-audit --no-fund`,
      `touch ${quote(shared)}/.sketch-complete`,
    ].join(" && ")), { input: git(["archive", "--format=tar", sha, "--", "package.json", "package-lock.json"]).stdout! });
    return shared;
  }

  async read(path: string) {
    if (!path.startsWith(this.config.root)) throw new Error(`Refusing to read outside ${this.config.root}: ${path}`);
    return (await this.runOk(`cat ${quote(path)}`, { quiet: true })).stdout;
  }
}

// The shell that builds `target` (a copy or a shared install) at most once at a time on its machine: it takes
// <target>.lock with mkdir (atomic, and there on macOS, which has no flock) and records its pid there. A run that finds
// the lock taken waits; when the target's marker appears it uses what the other built, and when the lock's owner has
// died (a killed run) it takes the lock over. The builder writes the marker last, so a target without one is never used.
// The input of a run that finds the target built is read and dropped, so the sending side never sees a broken pipe.
export function lockedBuild(target: string, body: string) {
  const lock = quote(`${target}.lock`), done = quote(`${target}/.sketch-complete`);
  return [
    `mkdir -p ${quote(target.slice(0, target.lastIndexOf("/")))}`,
    `while ! mkdir ${lock} 2>/dev/null; do`,
    `  if [ -f ${done} ]; then cat > /dev/null; exit 0; fi`,
    `  owner=$(cat ${lock}/pid 2>/dev/null)`,
    `  if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then rm -rf ${lock}; else sleep 2; fi`,
    `done`,
    `echo $$ > ${lock}/pid`,
    `trap ${quote(`rm -rf ${lock}`)} EXIT`,
    `if [ -f ${done} ]; then cat > /dev/null; exit 0; fi`,
    body,
  ].join("\n");
}

function gzipped(stream: NodeJS.ReadableStream) {
  const gzip = spawn("gzip", ["-1"], { stdio: ["pipe", "pipe", "inherit"] });
  stream.pipe(gzip.stdin!);
  return gzip.stdout!;
}

// What a copy holds: everything outside docs/, and docs/ text. As a pathspec for diffs between copies, and as a file
// list (with docs/ text capped at 1 MB) for a full copy.
const DOCS_TEXT = ["md", "ts", "js", "mjs", "cjs", "json", "txt", "html", "css"];
const COPY_PATHSPEC = [".", ":(exclude)docs", ...DOCS_TEXT.map((ext) => `:(glob)docs/**/*.${ext}`)];

function copiedFiles(sha: string) {
  return gitOut(["ls-tree", "-r", "-l", "-z", sha]).split("\0").flatMap((line) => {
    const match = line.match(/^\S+ blob \S+\s+(\d+)\t(.+)$/s);
    if (!match) return [];
    const [, size, file] = match;
    if (!file!.startsWith("docs/")) return [file!];
    return DOCS_TEXT.some((ext) => file!.endsWith(`.${ext}`)) && Number(size) <= 1_048_576 ? [file!] : [];
  });
}

/** Pick the local commit differing by the fewest files (fewer than 2000).
 * Remote copies can come from other drivers' unpushed or --with-local commits. */
function nearestCommit(sha: string, held: readonly string[]) {
  let best: { sha: string; changed: number } | undefined;
  const unavailable: string[] = [];
  for (const candidate of held) {
    const object = spawnSync("git", ["cat-file", "-t", candidate], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (object.status !== 0 || object.stdout.trim() !== "commit") { unavailable.push(candidate); continue; }
    const changed = gitOut(["diff", "--name-only", "--no-renames", candidate, sha, "--", ...COPY_PATHSPEC]).split("\n").filter(Boolean).length;
    if (changed < 2000 && (!best || changed < best.changed)) best = { sha: candidate, changed };
  }
  return { best, unavailable };
}

export function quote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The commit to test: a ref, or with --with-local that ref with the working tree's uncommitted changes laid on it. */
export function resolveRef(ref: string, withLocal: boolean) {
  const target = gitOut(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  if (!withLocal) return target;
  // @@@with-local - The working tree's changes are what differs from its HEAD (untracked files too, as git add -A sees
  // them), read through a throwaway index so neither the index nor a stash is touched. On another ref they are merged in
  // three ways from HEAD, as a cherry-pick would; a conflict refuses the run. (`git stash create` built on HEAD whatever
  // --ref named, and left new files out.)
  const head = gitOut(["rev-parse", "HEAD"]).trim(), local = workingTree();
  if (local === gitOut(["rev-parse", `${head}^{tree}`]).trim()) return target;
  let tree = local;
  if (target !== head) {
    const merged = spawnSync("git", ["merge-tree", "--write-tree", "--merge-base", head, target, commitTree(local, head, "the working tree")], { encoding: "utf8" });
    if (merged.status !== 0) throw new UsageError(`The working tree's changes do not apply cleanly on ${ref}:\n${merged.stdout.split("\n").slice(1).join("\n").trim()}`);
    tree = merged.stdout.split("\n")[0]!.trim();
  }
  return commitTree(tree, target, `sketch --with-local: the working tree's changes on ${ref}`);
}

function workingTree() {
  const index = join(mkdtempSync(join(tmpdir(), "sketch-index-")), "index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    execFileSync("git", ["read-tree", "HEAD"], { env });
    execFileSync("git", ["add", "-A", "."], { env, cwd: gitOut(["rev-parse", "--show-toplevel"]).trim() });
    return execFileSync("git", ["write-tree"], { env, encoding: "utf8" }).trim();
  } finally {
    rmSync(dirname(index), { recursive: true, force: true });
  }
}

// A throwaway commit, named for the CLI: a machine without a git identity makes it too.
function commitTree(tree: string, parent: string, message: string) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "sketch", GIT_AUTHOR_EMAIL: "sketch@localhost", GIT_COMMITTER_NAME: "sketch", GIT_COMMITTER_EMAIL: "sketch@localhost" };
  return execFileSync("git", ["commit-tree", tree, "-p", parent, "-m", message], { env, encoding: "utf8" }).trim();
}
