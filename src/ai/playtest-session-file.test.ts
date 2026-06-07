import { describe, expect, it } from "vitest";
import { restoreInteractivePlaytestSession } from "../sdk/playtest";
import { createAiPlaytestFileFromArgs } from "./playtest-session-file";

describe("AI playtest session file", () => {
  it("creates the same serialized session/runtime payload that the CLI persists", () => {
    const file = createAiPlaytestFileFromArgs([
      "--id",
      "scripted-combat",
      "--setup",
      "combat-10v12",
      "--recipe",
      "early-mixed",
      "--you",
      "v2",
      "--enemy",
      "v1a",
      "--assist-you",
      "--you-scripts",
      "skirmishPreservation",
      "--enemy-scripts",
      "attackWave",
      "--think-interval",
      "7",
    ]);
    const session = restoreInteractivePlaytestSession(file.session);

    expect(file.session).toMatchObject({
      schemaVersion: 3,
      id: "scripted-combat",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      winnerMode: "combatElimination",
    });
    expect(session.game.map.id).toBe("combatArena");
    expect(file.runtime).toMatchObject({
      controlledPlayers: ["v2", "v1a"],
      thinkInterval: 7,
      versions: { v2: "v2", v1a: "v1" },
      policyMode: "combat",
      scriptIdsByPlayer: {
        v2: ["skirmishPreservation"],
        v1a: ["attackWave"],
      },
    });
  });
});
