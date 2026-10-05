import { describe, expect, it } from "vitest";
import { createAiCrossRaceBenchmarkInput, createAiV3VsProdV2BenchmarkInput, createAiV4TrVsV3BenchmarkInput } from "./benchmark/control";
import { createAiVersionBenchmarkInput } from "./benchmark/presets";
import { createAiPlaytestSetupFromArgs } from "./playtest-session-setup";

describe("AI playtest session setup", () => {
  it("creates importable combat setup descriptions without executing the CLI script", () => {
    const setup = createAiPlaytestSetupFromArgs(["--setup", "combat-10v12", "--recipe", "early-mixed"], "v2", "v1a");

    expect(setup).toMatchObject({
      mapId: "combatArena",
      policyMode: "combat",
      winnerMode: "combatElimination",
      options: {
        players: ["v2", "v1a"],
        teams: { v2: "north", v1a: "south" },
      },
    });
  });

  it("creates exact benchmark playtest setup descriptions for automated failure replay", () => {
    const slot = createAiVersionBenchmarkInput({ seed: "willow-27", mapCount: 1 }).selection.mapIds[0]!;
    const setup = createAiPlaytestSetupFromArgs(["--from-benchmark", `${slot} 1v2`, "--benchmark-seed", "willow-27", "--benchmark-map-count", "1"], "v2", "v1a");

    expect(setup).toMatchObject({
      id: `interactive-${slot}-1v2`,
      mapId: "ladder",
      scriptedPlayers: ["v1a", "v1b"],
      versions: { v2: "v2", v1a: "v1", v1b: "v1" },
      options: {
        layout: { seed: `layout:willow-27:${slot}:0` },
        players: ["v2", "v1a", "v1b"],
        teams: { v2: "north", v1a: "south", v1b: "south" },
      },
    });
  });

  it("creates exact cross-race benchmark playtest setup descriptions for race balance replay", () => {
    const slot = createAiCrossRaceBenchmarkInput({ seed: "cross-race-cli-seed", mapCount: 2 }).selection.mapIds[1]!;
    const setup = createAiPlaytestSetupFromArgs(["--from-cross-race-benchmark", `${slot} ember south`, "--cross-race-seed", "cross-race-cli-seed", "--cross-race-map-count", "2"], "ember", "grove");

    expect(setup).toMatchObject({
      id: `interactive-${slot}-ember-south`,
      mapId: "ladder",
      scriptedPlayers: ["grove"],
      versions: { ember: "v2", grove: "v2" },
      options: {
        layout: { seed: `layout:cross-race-cli-seed:${slot}:1` },
        players: ["ember", "grove"],
        teams: { ember: "south", grove: "north" },
        races: { ember: "ember", grove: "grove" },
      },
    });
  });

  it("creates exact V3 versus frozen V2-prod benchmark setup descriptions for race-aware replay", () => {
    const options = { seed: "v3-frozen-50-2026-06-08", mapCount: 50 };
    // A game where V3 drew ember: the replay must pick V3's ember policy.
    const game = createAiV3VsProdV2BenchmarkInput(options).input.evaluations[0]!.matches.find((match) => match.name.endsWith(" v3 north") && match.agents.v3?.race === "ember")!;
    const slot = game.name.split(" ")[0]!;
    const setup = createAiPlaytestSetupFromArgs(["--from-v3-vs-prod-v2-benchmark", game.name, "--v3-prod-seed", options.seed, "--v3-prod-map-count", "50"], "v3", "v2-prod");

    expect(setup).toMatchObject({
      id: `interactive-${slot}-v3-north`,
      mapId: "ladder",
      scriptedPlayers: ["v2-prod"],
      versions: { v3: "v3-ember", "v2-prod": "v2-prod" },
      options: {
        layout: game.options!.layout!,
        players: ["v3", "v2-prod"],
        teams: { v3: "north", "v2-prod": "south" },
        races: { v3: "ember", "v2-prod": "grove" },
      },
    });
  });

  it("creates exact V4-TR versus V3 benchmark setup descriptions for tower-merc replay", () => {
    const options = { seed: "v4-tr-current-head-50-2026-06-09", mapCount: 50 };
    const game = createAiV4TrVsV3BenchmarkInput(options).input.evaluations[0]!.matches.find((match) => match.name.endsWith(" v4-tr south") && match.agents.v3?.race === "grove")!;
    const slot = game.name.split(" ")[0]!;
    const setup = createAiPlaytestSetupFromArgs(["--from-v4-tr-vs-v3-benchmark", game.name, "--v4-tr-seed", options.seed, "--v4-tr-map-count", "50"], "v4-tr", "v3");

    expect(setup).toMatchObject({
      id: `interactive-${slot}-v4-tr-south`,
      mapId: "ladder",
      scriptedPlayers: ["v3"],
      versions: { "v4-tr": "v4-tr", v3: "v3-grove" },
      options: {
        layout: game.options!.layout!,
        players: ["v4-tr", "v3"],
        teams: { "v4-tr": "south", v3: "north" },
        races: { "v4-tr": "grove", v3: "grove" },
      },
    });
  });

  it("creates exact gauntlet playtest setup descriptions for 1v3 replay", () => {
    // The full gauntlet plays the slots in order: twelve score maps, then the three 1v3 probes from ladder-13.
    const setup = createAiPlaytestSetupFromArgs(["--from-gauntlet", "internal-only 1v3 ladder-13 1v3 probe", "--gauntlet-full", "--gauntlet-seed", "gauntlet-full-seed"], "v2", "v1a");

    expect(setup).toMatchObject({
      id: "interactive-internal-only-1v3-ladder-13-1v3-probe",
      mapId: "ladder",
      thinkInterval: 45,
      scriptedPlayers: ["v1a", "v1b", "v1c"],
      versions: { v2: "v2", v1a: "v1", v1b: "v1", v1c: "v1" },
      options: {
        layout: { seed: "layout:gauntlet-full-seed:ladder-13:0" },
        players: ["v2", "v1a", "v1b", "v1c"],
        teams: { v2: "north", v1a: "south", v1b: "south", v1c: "south" },
        races: { v2: "grove", v1a: "grove", v1b: "grove", v1c: "grove" },
      },
    });
  });
});
