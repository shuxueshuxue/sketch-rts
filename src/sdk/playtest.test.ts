import { describe, expect, it } from "vitest";
import {
  applyInteractivePlaytestCommand,
  createInteractivePlaytestSession,
  restoreInteractivePlaytestSession,
  serializeInteractivePlaytestSession,
  stepInteractivePlaytestSession,
  summarizeInteractivePlaytestSession,
} from "./playtest";
import type { CommandFrameEntry } from "./commands/frame";

describe("interactive playtest SDK", () => {
  it("persists an inspectable session and applies composable commands through the simulation command path", () => {
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
            { id: "v2-archer", owner: "v2", kind: "archer", x: 290, y: 830 },
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 1200, y: 790 },
          ],
        },
      },
    });

    expect(summarizeInteractivePlaytestSession(session)).toMatchObject({
      tick: 0,
      gameSecond: 0,
      controlledPlayer: "v2",
      players: {
        v2: { combatUnits: 2, workers: 0, bases: 0 },
        v1a: { combatUnits: 1, workers: 0, bases: 0 },
      },
    });

    applyInteractivePlaytestCommand(session, { type: "attackMove", unitIds: "combat", x: 1200, y: 800 });
    expect(session.game.units.filter((unit) => unit.owner === "v2").map((unit) => unit.order)).toEqual([
      { type: "attackMove", x: 1200, y: 800 },
      { type: "attackMove", x: 1200, y: 800 },
    ]);

    const restored = restoreInteractivePlaytestSession(serializeInteractivePlaytestSession(session));
    const scripted: CommandFrameEntry<"scripted-ai"> = {
      playerId: "v1a",
      source: "scripted-ai",
      scriptId: "test-opponent",
      command: { type: "attackMove", unitIds: ["v1a-footman"], x: 320, y: 800 },
    };
    stepInteractivePlaytestSession(restored, 3, { scriptedPlayers: { v1a: () => [scripted] } });

    expect(restored.game.tick).toBe(3);
    expect(restored.game.units.find((unit) => unit.id === "v1a-footman")?.order).toEqual({ type: "attackMove", x: 320, y: 800 });
    expect(restored.transcript.map((entry) => entry.type)).toEqual(["command", "step"]);
  });

  it("fails loudly when a high-level selector resolves to no valid controlled units", () => {
    const session = createInteractivePlaytestSession({
      mapId: "combatArena",
      controlledPlayer: "v2",
      scriptedPlayers: [],
      options: {
        players: ["v2"],
        teams: { v2: "north" },
        scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true },
      },
    });

    expect(() => applyInteractivePlaytestCommand(session, { type: "attackMove", unitIds: "combat", x: 800, y: 800 })).toThrow("No v2 units match selector combat");
  });
});
