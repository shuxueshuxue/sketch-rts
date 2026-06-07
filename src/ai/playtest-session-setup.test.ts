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
});
