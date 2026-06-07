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
  it("prints a reusable command manifest for CLI tooling and help generation", () => {
    const manifest = JSON.parse(runPlaytestCli("commands"));
    const byName = Object.fromEntries(manifest.commands.map((command: { name: string }) => [command.name, command]));

    expect(manifest.version).toBe(1);
    expect(manifest.commands.map((command: { name: string }) => command.name)).toEqual(
      expect.arrayContaining(["new", "status", "plan", "step-until", "attack-move", "retreat-wounded", "pickup-item", "raw"]),
    );
    expect(byName["attack-move"]).toMatchObject({
      category: "tactical",
      summary: expect.stringContaining("attack"),
      requiredFlags: ["file", "x", "y"],
      optionalFlags: ["units"],
    });
    expect(byName["step-until"]).toMatchObject({
      category: "stepping",
      requiredFlags: ["file", "condition"],
      optionalFlags: expect.arrayContaining(["tick", "seconds", "max-ticks"]),
    });
    expect(byName["new"]).toMatchObject({
      category: "session",
      requiredFlags: ["file"],
      optionalFlags: expect.arrayContaining(["map", "from-benchmark", "from-control-benchmark", "from-gauntlet", "assist-you"]),
    });
    expect(manifest.commands.every((command: { example?: string }) => command.example)).toBe(true);
  });

  it("generates help from the command manifest instead of a separate command list", () => {
    const manifest = JSON.parse(runPlaytestCli("commands"));
    const help = runPlaytestCli("help");

    for (const command of manifest.commands as { name: string; example: string }[]) {
      expect(help).toContain(`play:ai -- ${command.name}`);
      expect(help).toContain(command.example);
    }
  });

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

  it("inspects units with the memory claims used by manual commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("attack-move", "--file", file, "--units", "combat", "--x", "1080", "--y", "800");

    const inspection = JSON.parse(runPlaytestCli("inspect-units", "--file", file, "--owner", "all"));

    expect(inspection.units).toHaveLength(35);
    expect(inspection.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "combat-v1a-unit-20",
          owner: "v1a",
          memoryClaim: null,
        }),
        expect.objectContaining({
          id: "combat-v2-unit-1",
          owner: "v2",
          carriedItems: [expect.objectContaining({ kind: "flameCloak" })],
          memoryClaim: expect.objectContaining({
            kind: "attack",
            targetId: "combat-v1a-unit-3",
          }),
        }),
      ])
    );
  });

  it("focuses only nearby attackers through a memory-backed tactical command", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("attack-move", "--file", file, "--units", "combat", "--x", "1080", "--y", "800");
    runPlaytestCli("step", "--file", file, "--ticks", "120");
    const inspection = JSON.parse(runPlaytestCli("inspect-units", "--file", file, "--owner", "v2"));
    const engaged = inspection.units.find((unit: { memoryClaim: { targetId: string } | null }) => unit.memoryClaim?.targetId?.startsWith("combat-v1a-unit-"));
    if (!engaged) throw new Error(`expected an engaged unit: ${JSON.stringify(inspection.units)}`);

    runPlaytestCli("focus-near", "--file", file, "--units", "combat", "--target", engaged.memoryClaim.targetId);
    const focused = JSON.parse(runPlaytestCli("inspect-units", "--file", file, "--owner", "v2"));

    expect(focused.units.filter((unit: { memoryClaim: { targetId: string } | null }) => unit.memoryClaim?.targetId === engaged.memoryClaim.targetId).length).toBeGreaterThan(0);
    expect(focused.units.filter((unit: { order: { type: string; targetId?: string } }) => unit.order.type === "attack" && unit.order.targetId === engaged.memoryClaim.targetId).length).toBeGreaterThan(0);
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

  it("persists per-player assisted script ids for composable CLI control", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you", "--you-scripts", "skirmishPreservation", "--enemy-scripts", "attackWave");

    const persisted = JSON.parse(readFileSync(file, "utf8"));
    expect(persisted.runtime.controlledPlayers).toEqual(["v2", "v1a"]);
    expect(persisted.runtime.scriptIdsByPlayer).toEqual({
      v2: ["skirmishPreservation"],
      v1a: ["attackWave"],
    });
  });

  it("prints planned AI command entries without mutating the playtest file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-10v12", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you");
    const before = readFileSync(file, "utf8");

    const planned = JSON.parse(runPlaytestCli("plan", "--file", file, "--owner", "v2"));
    const after = readFileSync(file, "utf8");

    expect(after).toBe(before);
    expect(planned).toMatchObject({
      tick: 0,
      owner: "v2",
      entries: expect.arrayContaining([expect.objectContaining({ playerId: "v2", scriptId: "attackWave", command: expect.objectContaining({ type: "attackMove" }) })]),
    });
  });

  it("diagnoses a fresh playtest through the reusable diagnosis primitive", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "diagnosis.json");

    const diagnosis = JSON.parse(runPlaytestCli("diagnose", "--file", file, "--setup", "combat-10v12", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you", "--checkpoint-ticks", "45", "--plan-owner", "v2"));
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(diagnosis.samples.map((sample: { tick: number }) => sample.tick)).toEqual([0, 45]);
    expect(diagnosis.samples[0].plans.v2.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: "v2",
          scriptId: "attackWave",
          command: expect.objectContaining({ type: "attackMove" }),
        }),
      ])
    );
    expect(diagnosis.finalSummary.tick).toBe(45);
    expect(persisted.session.save.snapshot.tick).toBe(45);
  });

  it("uses the shared AI think interval by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you");

    const persisted = JSON.parse(readFileSync(file, "utf8"));
    expect(persisted.runtime.thinkInterval).toBe(15);
  });

  it("creates manual sessions from exact benchmark 1v2 matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "benchmark.json");

    const created = JSON.parse(runPlaytestCli("new", "--file", file, "--from-benchmark", "sableRun 1v2", "--benchmark-seed", "willow-27", "--benchmark-map-count", "1", "--you", "v2"));
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(created.id).toBe("interactive-sableRun-1v2");
    expect(created.players.v2).toMatchObject({ bases: 1, workers: 3 });
    expect(created.players.v1a).toMatchObject({ bases: 1, workers: 3 });
    expect(created.players.v1b).toMatchObject({ bases: 1, workers: 3 });
    expect(persisted.session.scriptedPlayers).toEqual(["v1a", "v1b"]);
    expect(persisted.session.save.room.slots.map((slot: { playerId: string; team: string; controller: string }) => ({ playerId: slot.playerId, team: slot.team, controller: slot.controller }))).toEqual([
      { playerId: "v2", team: "north", controller: "human" },
      { playerId: "v1a", team: "south", controller: "ai" },
      { playerId: "v1b", team: "south", controller: "ai" },
    ]);
    expect(persisted.runtime.versions).toMatchObject({ v1a: "v1", v1b: "v1" });
  });

  it("creates side-swapped benchmark control sessions without duplicating preset setup", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "benchmark-control.json");

    runPlaytestCli("new", "--file", file, "--from-benchmark", "sableRun 1v1 control south", "--benchmark-seed", "willow-27", "--benchmark-map-count", "1", "--you", "v2", "--assist-you");
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.session.scriptedPlayers).toEqual(["v1a"]);
    expect(persisted.session.save.room.slots.map((slot: { playerId: string; team: string; controller: string }) => ({ playerId: slot.playerId, team: slot.team, controller: slot.controller }))).toEqual([
      { playerId: "v1a", team: "north", controller: "ai" },
      { playerId: "v2", team: "south", controller: "human" },
    ]);
    expect(persisted.runtime.controlledPlayers).toEqual(["v1a", "v2"]);
    expect(persisted.runtime.versions).toMatchObject({ v2: "v2", v1a: "v1" });
  });

  it("creates exact side-swapped sessions from the all-map control benchmark", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "control-benchmark-south.json");

    runPlaytestCli("new", "--file", file, "--from-control-benchmark", "brackenFord 1v1 control south", "--control-seed", "control-cli-seed", "--control-map-count", "2", "--you", "v2", "--assist-you");
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.session.save.room.slots.map((slot: { playerId: string; team: string; race: string; controller: string }) => ({ playerId: slot.playerId, team: slot.team, race: slot.race, controller: slot.controller }))).toEqual([
      { playerId: "v1a", team: "north", race: "grove", controller: "ai" },
      { playerId: "v2", team: "south", race: "grove", controller: "human" },
    ]);
    expect(persisted.session.scriptedPlayers).toEqual(["v1a"]);
    expect(persisted.runtime.controlledPlayers).toEqual(["v1a", "v2"]);
    expect(persisted.runtime.versions).toMatchObject({ v2: "v2", v1a: "v1" });
  });

  it("creates exact cross-race benchmark sessions for ember versus grove replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "cross-race-benchmark.json");

    runPlaytestCli("new", "--file", file, "--from-cross-race-benchmark", "glassmereFord ember south", "--cross-race-seed", "cross-race-cli-seed", "--cross-race-map-count", "2", "--you", "ember", "--enemy", "grove", "--assist-you");
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.session.save.room.slots.map((slot: { playerId: string; team: string; race: string; controller: string }) => ({ playerId: slot.playerId, team: slot.team, race: slot.race, controller: slot.controller }))).toEqual([
      { playerId: "ember", team: "south", race: "ember", controller: "human" },
      { playerId: "grove", team: "north", race: "grove", controller: "ai" },
    ]);
    expect(persisted.session.scriptedPlayers).toEqual(["grove"]);
    expect(persisted.runtime.controlledPlayers).toEqual(["ember", "grove"]);
    expect(persisted.runtime.versions).toMatchObject({ ember: "v2", grove: "v2" });
  });

  it("creates exact gauntlet 1v3 sessions for assisted v2 replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "gauntlet-1v3.json");

    runPlaytestCli("new", "--file", file, "--from-gauntlet", "internal-only 1v3 lichenCrown 1v3 probe", "--gauntlet-full", "--you", "v2", "--assist-you");
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.session.save.room.slots.map((slot: { playerId: string; team: string; race: string; controller: string }) => ({ playerId: slot.playerId, team: slot.team, race: slot.race, controller: slot.controller }))).toEqual([
      { playerId: "v2", team: "north", race: "grove", controller: "human" },
      { playerId: "v1a", team: "south", race: "grove", controller: "ai" },
      { playerId: "v1b", team: "south", race: "grove", controller: "ai" },
      { playerId: "v1c", team: "south", race: "grove", controller: "ai" },
    ]);
    expect(persisted.session.scriptedPlayers).toEqual(["v1a", "v1b", "v1c"]);
    expect(persisted.runtime.controlledPlayers).toEqual(["v2", "v1a", "v1b", "v1c"]);
    expect(persisted.runtime.versions).toMatchObject({ v2: "v2", v1a: "v1", v1b: "v1", v1c: "v1" });
  });

  it("creates manual side-swapped map sessions with explicit teams", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "manual-control-south.json");

    runPlaytestCli("new", "--file", file, "--map", "amberReach", "--you", "v2", "--enemy", "v1a", "--you-team", "south", "--enemy-team", "north", "--you-race", "grove", "--enemy-race", "grove", "--assist-you");
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.session.save.room.slots.map((slot: { playerId: string; team: string; race: string; controller: string }) => ({ playerId: slot.playerId, team: slot.team, race: slot.race, controller: slot.controller }))).toEqual([
      { playerId: "v2", team: "south", race: "grove", controller: "human" },
      { playerId: "v1a", team: "north", race: "grove", controller: "ai" },
    ]);
    expect(persisted.runtime.controlledPlayers).toEqual(["v2", "v1a"]);
  });

  it("persists per-player disabled benchmark behaviors for exact assisted replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "benchmark-disabled.json");

    runPlaytestCli("new", "--file", file, "--from-benchmark", "silverRidge 1v2", "--benchmark-seed", "willow-27", "--benchmark-map-count", "2", "--you", "v2", "--assist-you");
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.session.scriptedPlayers).toEqual(["v1a", "v1b"]);
    expect(persisted.runtime.disabledBehaviorsByPlayer).toEqual({ v2: ["workerHarassment"] });
  });

  it("lets exact control benchmark sessions use the requested worker harassment mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "control-worker-harassment.json");

    runPlaytestCli(
      "new",
      "--file",
      file,
      "--from-control-benchmark",
      "brackenFord 1v1 control south",
      "--control-seed",
      "control-cli-seed",
      "--control-map-count",
      "2",
      "--control-worker-harassment",
      "0",
      "--you",
      "v2",
      "--assist-you",
    );
    const persisted = JSON.parse(readFileSync(file, "utf8"));

    expect(persisted.runtime.disabledBehaviorsByPlayer).toEqual({ v2: ["workerHarassment"] });
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

  it("picks up a nearby item through the reusable SDK item intent", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "combat.json");

    runPlaytestCli("new", "--file", file, "--setup", "combat-15v20", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a");
    runPlaytestCli("raw", "--file", file, "--json", '{"type":"dropItem","unitId":"combat-v2-unit-5","itemId":"combat-v2-lightningRod-4","x":522,"y":892}');
    runPlaytestCli("pickup-item", "--file", file, "--item", "combat-v2-lightningRod-4");

    const inspection = JSON.parse(runPlaytestCli("inspect-units", "--file", file, "--owner", "v2"));
    expect(inspection.units.some((unit: { carriedItems: { id: string }[] }) => unit.carriedItems.some((item) => item.id === "combat-v2-lightningRod-4"))).toBe(true);
  });

  it("steps until a target game second for reusable tactical checkpoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "duel.json");

    runPlaytestCli("new", "--file", file, "--map", "bareDuel", "--you", "v2", "--enemy", "v1a");
    const stepped = JSON.parse(runPlaytestCli("step-until", "--file", file, "--condition", "time", "--seconds", "4", "--max-ticks", "120"));

    expect(stepped.result).toMatchObject({ conditionMet: true, timedOut: false });
    expect(stepped.summary.gameSecond).toBe(4);
  });

  it("steps until a target tick without requiring a duplicate max tick flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "sketch-ai-playtest-"));
    tempDirs.push(dir);
    const file = join(dir, "duel.json");

    runPlaytestCli("new", "--file", file, "--map", "bareDuel", "--you", "v2", "--enemy", "v1a");
    const stepped = JSON.parse(runPlaytestCli("step-until", "--file", file, "--condition", "tick", "--tick", "320"));

    expect(stepped.result).toMatchObject({ conditionMet: true, timedOut: false, tick: 320 });
    expect(stepped.summary.tick).toBe(320);
  });
});

function runPlaytestCli(...args: string[]) {
  return execFileSync(join(process.cwd(), "node_modules", ".bin", "tsx"), ["scripts/ai-playtest.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
