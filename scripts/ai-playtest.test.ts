import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("records CLI attack-move as durable attack memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "duel.json");

    runPlaytestCli("new", "--file", file, "--map", "bareDuel", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("attack-move", "--file", file, "--units", "workers", "--x", "3604.48", "--y", "2048");

    const status = JSON.parse(runPlaytestCli("status", "--file", file));

    expect(status.aiMemory.v2.jobs).toEqual([expect.objectContaining({ id: "attackWave:v1a", kind: "attackWave" })]);
    expect(status.aiMemory.v2.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "attack",
          targetId: "building-v1a-townhall",
        }),
      ])
    );
  });

  it("creates reusable combat playtest setups that can be steered with memory-backed commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    const created = JSON.parse(runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a"));

    expect(created.players.v2).toMatchObject({ combatUnits: 15, workers: 0, bases: 1 });
    expect(created.players.v1a).toMatchObject({ combatUnits: 20, workers: 0, bases: 1 });

    runPlaytestCli("attack-move", "--file", file, "--units", "combat", "--x", "1080", "--y", "800");
    const status = JSON.parse(runPlaytestCli("status", "--file", file));

    expect(status.aiMemory.v2.jobs).toEqual([expect.objectContaining({ id: "attackWave:v1a", kind: "attackWave" })]);
    expect(status.aiMemory.v2.claims.filter((claim: { kind: string }) => claim.kind === "attack")).toHaveLength(15);
  });

  it("runs assisted combat playtests in combat policy mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you");

    const persisted = JSON.parse(readFileSync(file, "utf8"));
    expect(persisted.runtime.policyMode).toBe("combat");
    expect(persisted.session.winnerMode).toBe("combatElimination");
  });

  it("retreats wounded units through a memory-backed tactical command", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("attack-move", "--file", file, "--units", "combat", "--x", "1080", "--y", "800");
    runPlaytestCli("step", "--file", file, "--ticks", "180");
    runPlaytestCli("retreat-wounded", "--file", file, "--hp-ratio", "0.95");

    const status = JSON.parse(runPlaytestCli("status", "--file", file));

    expect(status.aiMemory.v2.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "retreat",
          targetId: "retreat",
        }),
      ])
    );
  });
});

function runPlaytestCli(...args: string[]) {
  return execFileSync(join(process.cwd(), "node_modules", ".bin", "tsx"), ["scripts/ai-playtest.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
