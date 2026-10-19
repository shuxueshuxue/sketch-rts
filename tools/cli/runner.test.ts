import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Machine } from "./runner";
import * as output from "./output";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks(); });

// Two independent object databases share the same machine's completed tree cache.
// The other driver's extra commit is deliberately never fetched into this driver.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sketch-shared-copy-")), cwd = process.cwd();
  const repo = join(root, "driver"), other = join(root, "other-driver"), cache = join(root, "machine");
  mkdirSync(repo);
  const git = (at: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: at, encoding: "utf8" }).trim();
  git(repo, "init", "-q");
  writeFileSync(join(repo, "package.json"), '{"name":"copy-fixture","version":"1.0.0"}\n');
  const lock = '{"name":"copy-fixture","lockfileVersion":3,"packages":{}}\n';
  writeFileSync(join(repo, "package-lock.json"), lock);
  writeFileSync(join(repo, "file.txt"), "before\n"); writeFileSync(join(repo, "removed.txt"), "remove me\n");
  git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(root, "clone", "--quiet", "--no-hardlinks", repo, other);
  writeFileSync(join(other, "foreign-only.txt"), "only on another driver\n");
  git(other, "add", "."); git(other, "commit", "-qm", "other driver's unpushed commit");
  const foreign = git(other, "rev-parse", "HEAD");
  writeFileSync(join(repo, "file.txt"), "after\n"); rmSync(join(repo, "removed.txt"));
  writeFileSync(join(repo, "added.txt"), "new\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "target");
  const target = git(repo, "rev-parse", "HEAD"), blob = git(repo, "rev-parse", "HEAD:file.txt");
  // Preinstalled dependencies keep the integration test offline; copy still runs
  // its real archive/diff streams, shell locking, staging and completion marker.
  const shared = join(cache, "node_modules", createHash("sha256").update(lock).digest("hex").slice(0, 16));
  mkdirSync(join(shared, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(shared, ".sketch-complete"), "");
  const signals = ["SIGINT", "SIGTERM"] as const;
  const before = signals.map(signal => process.listeners(signal));
  const machine = new Machine("shared", { root: cache });
  const handlers = signals.map((signal, i) => process.listeners(signal).filter(handler => !before[i]!.includes(handler)));
  cleanups.push(() => {
    process.chdir(cwd);
    signals.forEach((signal, i) => handlers[i]!.forEach(handler => process.removeListener(signal, handler)));
    rmSync(root, { recursive: true, force: true });
  });
  const hold = (sha: string, source = repo, sourceCommit = sha) => {
    const dir = join(cache, "trees", sha); mkdirSync(dir, { recursive: true });
    execFileSync("tar", ["-x", "-C", dir], { input: execFileSync("git", ["archive", sourceCommit], { cwd: source }) });
    writeFileSync(join(dir, ".sketch-complete"), "");
    return dir;
  };
  const progress = vi.spyOn(output, "progress").mockImplementation(() => {});
  process.chdir(repo);
  return { machine, base, target, foreign, blob, hold, other,
    messages: () => progress.mock.calls.map(([message]) => message).join("\n") };
}

function expectTarget(dir: string) {
  expect(readFileSync(join(dir, "file.txt"), "utf8")).toBe("after\n");
  expect(readFileSync(join(dir, "added.txt"), "utf8")).toBe("new\n");
  expect(existsSync(join(dir, "removed.txt"))).toBe(false);
  expect(existsSync(join(dir, "foreign-only.txt"))).toBe(false);
  expect(existsSync(join(dir, ".sketch-complete"))).toBe(true);
}

describe("copies in a cache shared by independent drivers", () => {
  it("copies the full tree with an explanation when the cached commit is absent locally", async () => {
    const f = fixture(), held = f.hold(f.foreign, f.other);
    expect(spawnSync("git", ["cat-file", "-e", `${f.foreign}^{commit}`], { stdio: "ignore" }).status).not.toBe(0);
    expectTarget(await f.machine.copy(f.target));
    expect(f.messages()).toMatch(/unavailable locally.*full copy/s);
    expect(f.messages()).toContain(f.foreign.slice(0, 10));
    expect(existsSync(join(held, "foreign-only.txt"))).toBe(true);
  });

  it("skips foreign commits and still uses a locally available incremental base", async () => {
    const f = fixture(); f.hold(f.foreign, f.other); f.hold(f.base);
    expectTarget(await f.machine.copy(f.target));
    expect(f.messages()).toContain(`from its copy of ${f.base.slice(0, 10)}`);
    expect(f.messages()).toMatch(/unavailable locally/);
    expect(f.messages()).not.toContain("full copy");
  });

  it("requires a local commit, rather than accepting an arbitrary existing Git object", async () => {
    const f = fixture(); f.hold(f.blob, f.other, f.foreign);
    expectTarget(await f.machine.copy(f.target));
    expect(f.messages()).toMatch(/unavailable locally.*full copy/s);
  });

  it("reuses an already complete target even when the cache also contains a foreign commit", async () => {
    const f = fixture(); f.hold(f.foreign, f.other); const target = f.hold(f.target);
    expect(await f.machine.copy(f.target)).toBe(target);
    expectTarget(target);
    expect(f.messages()).toBe("");
  });
});
