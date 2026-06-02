import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("AI playtest CLI", () => {
  it("prints the persisted AI memory used by manual playtest commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "duel.json");

    runPlaytestCli("new", "--file", file, "--map", "bareDuel", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("build", "--file", file, "--kind", "barracks", "--x", "420", "--y", "380");

    const memory = JSON.parse(runPlaytestCli("memory", "--file", file));

    expect(memory.v2.unitClaims).toEqual({
      "unit-v2-worker-1": expect.objectContaining({
        kind: "build",
        targetId: "build:barracks:420:380",
      }),
    });
  });

  it("includes AI memory claims in the standard status summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "duel.json");

    runPlaytestCli("new", "--file", file, "--map", "bareDuel", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("build", "--file", file, "--kind", "barracks", "--x", "420", "--y", "380");

    const status = JSON.parse(runPlaytestCli("status", "--file", file));

    expect(status.aiMemory.v2.claims).toEqual([
      expect.objectContaining({
        unitId: "unit-v2-worker-1",
        kind: "build",
        targetId: "build:barracks:420:380",
        expiresGameSecond: 45,
      }),
    ]);
  });
});

function runPlaytestCli(...args: string[]) {
  return execFileSync(join(process.cwd(), "node_modules", ".bin", "tsx"), ["scripts/ai-playtest.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
