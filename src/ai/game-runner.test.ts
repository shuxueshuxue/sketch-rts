import { describe, expect, it } from "vitest";
import { AI_SCRIPT_LIBRARY, type AiPolicyMemory, type AiScript } from "./policy";
import { issuePlayerCommand } from "../shared/sim";
import { runAiGame, runAiGameLoop } from "./game-runner";
import { sketchScene } from "../sdk/scene";

describe("SDK game runner", () => {
  it("exposes a reusable match loop with command and step observations", () => {
    const commands: string[] = [];
    let stepObservations = 0;

    const result = runAiGameLoop(
      {
        name: "runner-loop-hooks",
        mapId: "bareDuel",
        agents: {
          v2: { controller: "external-agent", team: "north", race: "grove", version: "v2" },
          v1: { controller: "external-agent", team: "south", race: "grove", version: "v1" },
        },
        maxTicks: 120,
        thinkInterval: 45,
      },
      {
        afterCommand(context) {
          commands.push(`${context.tick}:${context.owner}:${context.scriptId}:${context.command.type}`);
          expect(context.before.tick).toBe(context.tick);
          expect(context.after.tick).toBe(context.tick);
        },
        afterStep(context) {
          stepObservations += 1;
          expect(context.after.tick).toBe(context.before.tick + 1);
        },
      },
    );

    expect(result.game.tick).toBe(120);
    expect(commands.some((entry) => entry.includes(":mine"))).toBe(true);
    expect(stepObservations).toBe(120);
  });

  it("uses one runGame entry for local preset-agent matches", () => {
    const report = runAiGame({
      name: "sdk-run-game-smoke",
      mapId: "bareDuel",
      agents: {
        alpha: { controller: "external-agent", team: "north", race: "grove", version: "v1" },
        beta: { controller: "internal-ai", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: 180,
      thinkInterval: 45,
      sampleInterval: 60,
    });

    expect(report.tick).toBe(180);
    expect(report.commandsByOwner.alpha).toBeGreaterThan(0);
    expect(report.commandsByOwner.beta).toBeGreaterThan(0);
    expect(report.commandCounts.mine).toBeGreaterThan(0);
    expect(report.timeline.length).toBeGreaterThanOrEqual(3);
    expect(report.snapshot.players.alpha).toBeDefined();
    expect(report.snapshot.players.beta).toBeDefined();
  });

  it("can record command traces from the same runGame entry", () => {
    const report = runAiGame({
      name: "sdk-run-game-trace",
      mapId: "bareDuel",
      agents: {
        alpha: { controller: "external-agent", team: "north", race: "grove", version: "v1" },
        beta: { controller: "internal-ai", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: 90,
      thinkInterval: 45,
      trace: { commands: true },
    });

    expect(report.commands.length).toBeGreaterThan(0);
    expect(report.commands[0]?.tick).toBe(0);
    expect(report.commands[0]?.owner).toMatch(/alpha|beta/);
    expect(report.commands[0]?.scriptId).toBeTruthy();
    expect(report.commands.some((entry) => entry.source === "external-agent")).toBe(true);
    expect(report.commands.some((entry) => entry.source === "internal-ai")).toBe(true);
  });

  it("can override one agent script stack while preserving the shared runGame frame", () => {
    const report = runAiGame({
      name: "sdk-run-game-agent-script-override",
      mapId: "bareDuel",
      agents: {
        alpha: { controller: "external-agent", team: "north", race: "grove", version: "v1", scripts: [AI_SCRIPT_LIBRARY.economy] },
        beta: { controller: "internal-ai", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: 90,
      thinkInterval: 45,
      trace: { commands: true },
    });

    expect(new Set(report.commands.filter((entry) => entry.owner === "alpha").map((entry) => entry.scriptId))).toEqual(new Set(["economy"]));
    expect(report.commands.some((entry) => entry.owner === "beta" && entry.scriptId !== "economy")).toBe(true);
  });

  it("can execute a reported v2 agent through the v1 reset policy", () => {
    const seenVersions: string[] = [];
    const scripts: AiScript[] = [
      {
        id: "runner-policy-version-probe",
        phase: "economy",
        run(_snapshot, _owner, options) {
          seenVersions.push(options.version ?? "none");
          return undefined;
        },
      },
    ];

    runAiGame({
      name: "sdk-run-game-policy-version",
      mapId: "bareDuel",
      agents: {
        v2: { controller: "external-agent", team: "north", race: "grove", version: "v2", versionLabel: "v2", policyVersion: "v1", scripts },
        v1: { controller: "external-agent", team: "south", race: "grove", version: "v1", versionLabel: "v1", scripts },
      },
      maxTicks: 1,
      thinkInterval: 1,
    });

    expect(seenVersions).toEqual(["v1", "v1"]);
  });

  it("keeps one growing memory object per SDK loop agent", () => {
    const seen: AiPolicyMemory[] = [];
    const scripts: AiScript[] = [
      {
        id: "runner-memory-probe",
        phase: "economy",
        run(snapshot, _owner, options) {
          seen.push(options.memory);
          options.memory.jobs.push({ id: `tick-${snapshot.tick}`, kind: "runner-probe", createdTick: snapshot.tick, updatedTick: snapshot.tick });
          return undefined;
        },
      },
    ];

    runAiGameLoop({
      name: "runner-memory-provider",
      mapId: "bareDuel",
      agents: {
        alpha: { controller: "external-agent", team: "north", race: "grove", version: "v2", scripts },
        beta: { controller: "external-agent", team: "south", race: "grove", version: "v1", scripts: [AI_SCRIPT_LIBRARY.economy] },
      },
      maxTicks: 2,
      thinkInterval: 1,
    });

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]?.jobs.map((job) => job.id)).toEqual(["tick-0", "tick-1"]);
  });

  it("plans mixed internal/external controllers from the same simulation frame", () => {
    const agents = {
      v2: { controller: "internal-ai", team: "north", race: "grove", version: "v2" },
      v1a: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
      v1b: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
    } as const;
    const internal = runAiGame({
      name: "runner-frame-internal",
      mapId: "wildMarches",
      agents,
      maxTicks: 3600,
      thinkInterval: 45,
      sampleInterval: 1200,
    });
    const mixed = runAiGame({
      name: "runner-frame-mixed",
      mapId: "wildMarches",
      agents: { ...agents, v2: { ...agents.v2, controller: "external-agent" } },
      maxTicks: 3600,
      thinkInterval: 45,
      sampleInterval: 1200,
    });

    expect(mixed.goldSpent).toEqual(internal.goldSpent);
    expect(mixed.commandCounts).toEqual(internal.commandCounts);
    expect(mixed.timeline.at(-1)?.teams).toEqual(internal.timeline.at(-1)?.teams);
  });

  it("can disable worker pressure through an agent strategy parameter", () => {
    const report = runAiGame({
      name: "bluebell-worker-pressure-disabled",
      mapId: "bluebellHeath",
      agents: {
        v2: { controller: "external-agent", team: "north", race: "grove", version: "v2", disabledBehaviors: ["workerHarassment"] },
        v1a: { controller: "external-agent", team: "south", race: "grove", version: "v1" },
        v1b: { controller: "external-agent", team: "south", race: "grove", version: "v1" },
        v1c: { controller: "external-agent", team: "south", race: "grove", version: "v1" },
      },
      maxTicks: 2_200,
      thinkInterval: 45,
      trace: { commands: true },
    });

    const earlyWorkerPressure = report.commands.filter((entry) => entry.owner === "v2" && entry.scriptId === "workerPressure");

    expect(earlyWorkerPressure).toHaveLength(0);
  });

  it("reports completed bases, expansions, and actively mined bases for gauntlet economy analysis", () => {
    const scene = sketchScene("sdk-run-game-economy-report")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1400, 700, { id: "v2-natural" })
      .worker("v2", 520, 520, { id: "v2-main-worker" })
      .worker("v2", 1420, 720, { id: "v2-natural-worker" })
      .goldMine("v2-main-mine", 580, 520, 4000)
      .goldMine("v2-natural-mine", 1480, 720, 4000)
      .townHall("v1", 3400, 3400)
      .worker("v1", 3380, 3380)
      .goldMine("v1-main-mine", 3320, 3380, 4000)
      .build();
    const game = scene.createGame();
    issuePlayerCommand(game, "v2", { type: "mine", unitIds: ["v2-main-worker"], resourceId: "v2-main-mine" });
    issuePlayerCommand(game, "v2", { type: "mine", unitIds: ["v2-natural-worker"], resourceId: "v2-natural-mine" });

    const report = runAiGame({
      name: "sdk-run-game-economy-report",
      game,
      agents: {
        v2: { controller: "external-agent", team: "north", race: "grove", version: "v2" },
        v1: { controller: "external-agent", team: "south", race: "grove", version: "v1" },
      },
      maxTicks: 0,
      thinkInterval: 45,
    });

    expect(report.bases.v2).toBe(2);
    expect(report.expansions.v2).toBe(1);
    expect(report.miningBases.v2).toBe(2);
    expect(report.economy.v2).toMatchObject({ bases: 2, expansions: 1, miningBases: 2 });
    expect(report.economyTimings.v2).toMatchObject({ firstExpansionTick: 0, firstMiningExpansionTick: 0, maxBases: 2, maxMiningBases: 2 });
    expect(report.economyTimings.v1).toMatchObject({ firstExpansionTick: null, firstMiningExpansionTick: null, maxBases: 1, maxMiningBases: 0 });
  });

  it("exposes neutral-caused unit losses on the standard run report surface", () => {
    const scene = sketchScene("sdk-run-game-killed-by-neutral")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 500, { id: "doomed-footman", hp: 1 })
      .unit("neutral", "mossGnawer", 728, 500, { id: "neutral-killer", order: { type: "attack", targetId: "doomed-footman" } })
      .townHall("v1", 3400, 3400)
      .build();

    const report = runAiGame({
      name: "sdk-run-game-killed-by-neutral",
      game: scene.createGame(),
      agents: {
        v2: { controller: "external-agent", team: "north", race: "grove", version: "v2" },
        v1: { controller: "external-agent", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: 1,
      thinkInterval: 45,
    });

    expect(report.unitsKilledByNeutral.v2).toBe(1);
    expect(report.unitsKilledByNeutral.v1).toBe(0);
  });

  it("keeps official-map opening build zones out of neutral camp aggro", () => {
    const report = runAiGame({
      name: "camp-rush-opening-safety",
      mapId: "campRush",
      agents: {
        v2: { controller: "internal-ai", team: "north", race: "grove", version: "v2" },
        v1a: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
        v1b: { controller: "internal-ai", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: 360,
      thinkInterval: 45,
      sampleInterval: 180,
    });

    expect(report.unitsLost.neutral).toBe(0);
    expect(report.timeline.at(-1)?.players.v1a?.workers).toBeGreaterThanOrEqual(3);
    expect(report.timeline.at(-1)?.players.v1b?.workers).toBeGreaterThanOrEqual(3);
  });

  it("records the clean expansion route without turning one scripted duel into a release balance gate", () => {
    const report = runAiGame({
      name: "v2-single-v1-clean-expansion-sanity",
      mapId: "openClaims",
      agents: {
        v2: { controller: "external-agent", team: "north", race: "grove", version: "v2" },
        v1: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
      },
      maxTicks: 24_000,
      thinkInterval: 45,
      sampleInterval: 2_400,
    });

    expect(report.timeout).toBe(false);
    expect(report.winner).toMatch(/v1|v2/);
    expect(report.economyTimings.v2?.firstExpansionTick).not.toBeNull();
    expect(report.timeline.at(-1)?.players.v2).toBeDefined();
    expect(report.commandsByOwner.v2).toBeGreaterThan(0);
  });
});
