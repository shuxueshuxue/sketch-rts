import { describe, expect, it } from "vitest";
import { issuePlayerCommand } from "../shared/sim";
import { runGame } from "./game-runner";
import { sketchScene } from "./scene";

describe("SDK game runner", () => {
  it("uses one runGame entry for local preset-agent matches", () => {
    const report = runGame({
      name: "sdk-run-game-smoke",
      mapId: "bareDuel",
      agents: {
        alpha: { adapter: "external", team: "north", race: "grove", version: "v1" },
        beta: { adapter: "internal", team: "south", race: "ember", version: "v1" },
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
    const report = runGame({
      name: "sdk-run-game-trace",
      mapId: "bareDuel",
      agents: {
        alpha: { adapter: "external", team: "north", race: "grove", version: "v1" },
        beta: { adapter: "internal", team: "south", race: "ember", version: "v1" },
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

    const report = runGame({
      name: "sdk-run-game-economy-report",
      game,
      agents: {
        v2: { adapter: "external", team: "north", race: "grove", version: "v2" },
        v1: { adapter: "external", team: "south", race: "grove", version: "v1" },
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

  it("keeps official-map opening build zones out of neutral camp aggro", () => {
    const report = runGame({
      name: "camp-rush-opening-safety",
      mapId: "campRush",
      agents: {
        v2: { adapter: "internal", team: "north", race: "grove", version: "v2" },
        v1a: { adapter: "internal", team: "south", race: "grove", version: "v1" },
        v1b: { adapter: "internal", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: 360,
      thinkInterval: 45,
      sampleInterval: 180,
    });

    expect(report.unitsLost.neutral).toBe(0);
    expect(report.timeline.at(-1)?.players.v1a?.workers).toBeGreaterThanOrEqual(3);
    expect(report.timeline.at(-1)?.players.v1b?.workers).toBeGreaterThanOrEqual(3);
  });

  it("keeps v2 stronger than a single v1 on the rich-map sanity route", () => {
    const report = runGame({
      name: "v2-single-v1-rich-map-sanity",
      mapId: "wildMarches",
      agents: {
        v2: { adapter: "external", team: "north", race: "grove", version: "v2" },
        v1: { adapter: "internal", team: "south", race: "grove", version: "v1" },
      },
      maxTicks: 24_000,
      thinkInterval: 45,
      sampleInterval: 2_400,
    });

    expect(report.timeout).toBe(false);
    expect(report.winner).toBe("v2");
    expect(report.neutralUnitsKilled.v2 ?? 0).toBeGreaterThan(0);
    expect(report.goldSpent.v2 ?? 0).toBeGreaterThan(report.goldSpent.v1 ?? 0);
  });
});
