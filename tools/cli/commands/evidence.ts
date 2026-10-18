import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs, stringOption, UsageError, type CommandSpec } from "../args";
import { emit, EXIT, progress } from "../output";
import { Machine, quote } from "../runner";
import { gitOut } from "../git";

// Raw evidence (traces, archives, videos, frame dumps) lives in a store outside the repository, on the machine whose
// "evidence" directory machines.json names (the A100's /codegeex/jeffry/sketch-rts-evidence). An object there is
// sha256/<sha256 of its bytes>, so a push never overwrites anything and a pointer can be checked on the way back. The repo
// keeps a pointer: <path>.evidence.json, a few hundred bytes a PR can commit and cite. A directory travels as one
// gzipped tar. Which files must leave the repo is scripts/check-file-sizes.sh's call (`sketch evidence check`).

export type EvidencePointer = { sha256: string; bytes: number; name: string; kind: "file" | "dir"; machine: string; pushed: string; pr?: number };

export const POINTER_SUFFIX = ".evidence.json";

export const push = {
  spec: {
    name: "evidence push",
    summary: "Copy a file or directory to the evidence store and write <path>.evidence.json, the pointer to commit.",
    usage: "evidence push <file|dir> [--pr N] [--on M] [--json]",
    options: [
      { name: "pr", description: "the PR the evidence belongs to (kept in the pointer)" },
      { name: "on", description: "machine from ~/.config/sketch/machines.json whose evidence store takes it" },
      { name: "json", description: "the pointer as JSON instead of a sentence", boolean: true },
    ],
  } satisfies CommandSpec,

  async run(argv: string[]) {
    const parsed = parseArgs(push.spec, argv);
    const [target] = parsed.positionals;
    if (!target || parsed.positionals.length > 1) throw new UsageError(`usage: sketch ${push.spec.usage}`);
    const pr = stringOption(parsed, "pr");
    if (pr !== undefined && !/^\d+$/.test(pr)) throw new UsageError("--pr takes a PR number");
    const path = resolve(target.replace(/\/+$/, ""));
    if (!existsSync(path)) throw new UsageError(`No such file or directory: ${target}`);
    const machine = Machine.open(stringOption(parsed, "on"));
    const kind = statSync(path).isDirectory() ? "dir" : "file";
    const scratch = mkdtempSync(join(tmpdir(), "sketch-evidence-"));
    try {
      const bytesFile = kind === "file" ? path : packDirectory(path, join(scratch, `${basename(path)}.tar.gz`));
      const sha256 = await hashFile(bytesFile);
      const bytes = statSync(bytesFile).size;
      const object = machine.evidencePath(sha256);
      const held = await machine.run(`test "$(stat -c %s ${quote(object)} 2>/dev/null || stat -f %z ${quote(object)} 2>/dev/null)" = ${bytes}`, { quiet: true });
      if (held.code === 0) progress(`${machine.name} already holds ${sha256.slice(0, 12)}`);
      else {
        progress(`pushing ${basename(path)} (${Math.ceil(bytes / 1024)} KB) to ${machine.name}`);
        const partial = `${object}.partial`;
        await machine.runOk(`mkdir -p ${quote(dirname(object))} && cat > ${quote(partial)} && mv ${quote(partial)} ${quote(object)}`, { input: createReadStream(bytesFile), quiet: true });
      }
      const pointer: EvidencePointer = { sha256, bytes, name: basename(path), kind, machine: machine.name, pushed: gitOut(["rev-parse", "HEAD"]).trim(), ...(pr ? { pr: Number(pr) } : {}) };
      const pointerFile = `${path}${POINTER_SUFFIX}`;
      writeFileSync(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`);
      emit(parsed.options.json === true, `wrote ${pointerFile}; commit it in place of ${basename(path)}`, { pointer: pointerFile, ...pointer });
      return EXIT.ok;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

export const get = {
  spec: {
    name: "evidence get",
    summary: "Fetch what a <path>.evidence.json pointer names, check its sha256, and place it beside the pointer.",
    usage: "evidence get <pointer.evidence.json> [--out PATH] [--on M]",
    options: [
      { name: "out", description: "where to put it (default: the pointer's path without .evidence.json)" },
      { name: "on", description: "machine to fetch from (default: the one the pointer names)" },
    ],
  } satisfies CommandSpec,

  async run(argv: string[]) {
    const parsed = parseArgs(get.spec, argv);
    const [pointerFile] = parsed.positionals;
    if (!pointerFile || !pointerFile.endsWith(POINTER_SUFFIX) || parsed.positionals.length > 1) throw new UsageError(`usage: sketch ${get.spec.usage}`);
    const pointer = JSON.parse(readFileSync(pointerFile, "utf8")) as EvidencePointer;
    const out = resolve(stringOption(parsed, "out") ?? pointerFile.slice(0, -POINTER_SUFFIX.length));
    if (existsSync(out)) throw new Error(`${out} already exists; move it away or pass --out`);
    const machine = Machine.open(stringOption(parsed, "on") ?? pointer.machine);
    const scratch = mkdtempSync(join(tmpdir(), "sketch-evidence-"));
    try {
      const fetched = join(scratch, "object");
      const file = createWriteStream(fetched);
      const written = once(file, "finish");
      progress(`fetching ${pointer.name} (${Math.ceil(pointer.bytes / 1024)} KB) from ${machine.name}`);
      await machine.runOk(`cat ${quote(machine.evidencePath(pointer.sha256))}`, { output: file, quiet: true });
      await written;
      const sha256 = await hashFile(fetched);
      if (sha256 !== pointer.sha256) throw new Error(`${machine.name} returned ${sha256} for ${pointer.sha256}; the store's copy is damaged`);
      if (pointer.kind === "file") copyFileSync(fetched, out);
      else unpackDirectory(fetched, out);
      process.stdout.write(`${out}\n`);
      return EXIT.ok;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

export const check = {
  spec: {
    name: "evidence check",
    summary: "List files this branch adds or changes that are over the repository's size limit (scripts/check-file-sizes.sh).",
    usage: "evidence check [--base origin/main] [--ref HEAD]",
    options: [
      { name: "base", description: "the branch's base", default: "origin/main" },
      { name: "ref", description: "the commit checked", default: "HEAD" },
    ],
  } satisfies CommandSpec,

  async run(argv: string[]) {
    const parsed = parseArgs(check.spec, argv);
    const root = gitOut(["rev-parse", "--show-toplevel"]).trim();
    // The limit and the rule are the script's alone, the same one CI runs (.github/workflows/file-size-check.yml).
    const result = spawnSync(join(root, "scripts", "check-file-sizes.sh"), [stringOption(parsed, "base")!, stringOption(parsed, "ref")!], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    return result.status === 0 ? EXIT.ok : result.status === 1 ? EXIT.found : EXIT.error;
  },
};

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function packDirectory(dir: string, archive: string) {
  // Sorted names, fixed owner and times: the same directory packs to the same bytes, so a second push finds the object held.
  const tar = archive.replace(/\.gz$/, "");
  spawnOk("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "--mtime=@0", "-cf", tar, "-C", dirname(dir), basename(dir)]);
  spawnOk("gzip", ["-n", tar]);
  return archive;
}

function unpackDirectory(archive: string, out: string) {
  const scratch = `${out}.partial`;
  rmSync(scratch, { recursive: true, force: true });
  spawnOk("mkdir", ["-p", scratch]);
  spawnOk("tar", ["-xzf", archive, "-C", scratch]);
  const [inner] = spawnSync("ls", ["-A", scratch], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  if (!inner) throw new Error("The archive is empty");
  spawnOk("mv", [join(scratch, inner), out]);
  rmSync(scratch, { recursive: true, force: true });
}

function spawnOk(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
