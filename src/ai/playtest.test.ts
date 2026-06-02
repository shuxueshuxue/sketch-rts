import { describe, expect, it } from "vitest";
import { createInteractivePlaytestSession } from "../sdk/playtest";
import { createAiInteractivePlaytestRuntime, stepAiInteractivePlaytestSession, stepAiInteractivePlaytestUntil } from "./playtest";

describe("AI interactive playtest wiring", () => {
  it("steps scripted opponents through the shared AI runtime with durable memory", () => {
    const session = createInteractivePlaytestSession({
      mapId: "combatArena",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      options: {
        players: ["v2", "v1a"],
        teams: { v2: "north", v1a: "south" },
        scenario: {
          replaceDefaultUnits: true,
          replaceDefaultBuildings: true,
          replaceDefaultResources: true,
          addUnits: [
            { id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 780 },
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 1200, y: 790 },
          ],
        },
      },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { thinkInterval: 1, version: "v1" });

    stepAiInteractivePlaytestSession(session, runtime, 2);

    expect(session.game.tick).toBe(2);
    expect(session.transcript.at(-1)).toMatchObject({ type: "step", fromTick: 0, toTick: 2 });
    expect(runtime.memories.v1a).toBeDefined();
  });

  it("steps until an SDK playtest condition without bypassing the shared AI runtime", () => {
    const session = createInteractivePlaytestSession({
      mapId: "combatArena",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      options: {
        players: ["v2", "v1a"],
        teams: { v2: "north", v1a: "south" },
        scenario: {
          replaceDefaultUnits: true,
          replaceDefaultBuildings: true,
          replaceDefaultResources: true,
          addUnits: [
            { id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 780, order: { type: "attackMove", x: 430, y: 780 } },
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 430, y: 780 },
          ],
        },
      },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { thinkInterval: 1, version: "v1" });

    const result = stepAiInteractivePlaytestUntil(session, runtime, { type: "firstFight" }, { maxTicks: 5 });

    expect(result.conditionMet).toBe(true);
    expect(session.events.firstFightTick).not.toBeNull();
  });
});
