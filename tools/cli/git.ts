import { execFileSync, spawn } from "node:child_process";

export function gitOut(args: readonly string[]) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** A streaming git command (for `git archive`); exits non-zero loudly. */
export function git(args: readonly string[]) {
  const child = spawn("git", args, { stdio: ["ignore", "pipe", "inherit"] });
  child.on("close", (code) => { if (code !== 0) { process.stderr.write(`git ${args[0]} failed (${code})\n`); process.exitCode = 2; } });
  return child;
}
