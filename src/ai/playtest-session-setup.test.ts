import { describe, expect, it } from "vitest";
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
    const setup = createAiPlaytestSetupFromArgs(["--from-benchmark", "sableRun 1v2", "--benchmark-seed", "willow-27", "--benchmark-map-count", "1"], "v2", "v1a");

    expect(setup).toMatchObject({
      id: "interactive-sableRun-1v2",
      mapId: "sableRun",
      scriptedPlayers: ["v1a", "v1b"],
      versions: { v2: "v2", v1a: "v1", v1b: "v1" },
      options: {
        players: ["v2", "v1a", "v1b"],
        teams: { v2: "north", v1a: "south", v1b: "south" },
      },
    });
  });

  it("creates exact cross-race benchmark playtest setup descriptions for race balance replay", () => {
    const setup = createAiPlaytestSetupFromArgs(["--from-cross-race-benchmark", "glassmereFord ember south", "--cross-race-seed", "cross-race-cli-seed", "--cross-race-map-count", "2"], "ember", "grove");

    expect(setup).toMatchObject({
      id: "interactive-glassmereFord-ember-south",
      mapId: "glassmereFord",
      scriptedPlayers: ["grove"],
      versions: { ember: "v2", grove: "v2" },
      options: {
        players: ["ember", "grove"],
        teams: { ember: "south", grove: "north" },
        races: { ember: "ember", grove: "grove" },
      },
    });
  });

  it("creates exact V3 versus frozen V2-prod benchmark setup descriptions for race-aware replay", () => {
    const setup = createAiPlaytestSetupFromArgs(["--from-v3-vs-prod-v2-benchmark", "cobaltVale v3 north", "--v3-prod-seed", "v3-frozen-50-2026-06-08", "--v3-prod-map-count", "50"], "v3", "v2-prod");

    expect(setup).toMatchObject({
      id: "interactive-cobaltVale-v3-north",
      mapId: "cobaltVale",
      scriptedPlayers: ["v2-prod"],
      versions: { v3: "v3-ember", "v2-prod": "v2-prod" },
      options: {
        players: ["v3", "v2-prod"],
        teams: { v3: "north", "v2-prod": "south" },
        races: { v3: "ember", "v2-prod": "grove" },
      },
    });
  });

  it("creates exact gauntlet playtest setup descriptions for 1v3 replay", () => {
    const setup = createAiPlaytestSetupFromArgs(["--from-gauntlet", "internal-only 1v3 lichenCrown 1v3 probe", "--gauntlet-full"], "v2", "v1a");

    expect(setup).toMatchObject({
      id: "interactive-internal-only-1v3-lichenCrown-1v3-probe",
      mapId: "lichenCrown",
      thinkInterval: 45,
      scriptedPlayers: ["v1a", "v1b", "v1c"],
      versions: { v2: "v2", v1a: "v1", v1b: "v1", v1c: "v1" },
      options: {
        players: ["v2", "v1a", "v1b", "v1c"],
        teams: { v2: "north", v1a: "south", v1b: "south", v1c: "south" },
        races: { v2: "grove", v1a: "grove", v1b: "grove", v1c: "grove" },
      },
    });
  });
});
