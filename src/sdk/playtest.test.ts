import { describe, expect, it } from "vitest";
import {
  applyInteractivePlaytestCommand,
  createInteractivePlaytestSession,
  inspectInteractivePlaytestUnits,
  restoreInteractivePlaytestSession,
  serializeInteractivePlaytestSession,
  stepInteractivePlaytestSession,
  stepInteractivePlaytestUntil,
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

  it("summarizes controlled units with health, orders, and carried items for tactical steering", () => {
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
            { id: "v2-wounded", owner: "v2", kind: "footman", x: 320, y: 780, hp: 42 },
            { id: "v2-rod", owner: "v2", kind: "archer", x: 300, y: 830, order: { type: "attackMove", x: 1200, y: 800 } },
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 1200, y: 790 },
          ],
          addItems: [{ id: "rod", kind: "lightningRod", x: 0, y: 0, carrierId: "v2-rod", cooldownRemaining: 0 }],
        },
      },
    });

    const summary = summarizeInteractivePlaytestSession(session);

    expect(summary.controlledUnits).toEqual([
      expect.objectContaining({ id: "v2-wounded", kind: "footman", hp: 42, order: { type: "idle" }, carriedItems: [] }),
      expect.objectContaining({
        id: "v2-rod",
        kind: "archer",
        order: { type: "attackMove", x: 1200, y: 800 },
        carriedItems: [{ id: "rod", kind: "lightningRod", cooldownRemaining: 0 }],
      }),
    ]);
  });

  it("inspects all units by owner so tactical target ids are visible", () => {
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
            { id: "v2-rod", owner: "v2", kind: "archer", x: 300, y: 830, order: { type: "attackMove", x: 1200, y: 800 } },
            { id: "v1a-target", owner: "v1a", kind: "footman", x: 1200, y: 790, hp: 72 },
          ],
          addItems: [{ id: "rod", kind: "lightningRod", x: 0, y: 0, carrierId: "v2-rod", cooldownRemaining: 0 }],
        },
      },
    });

    const inspection = inspectInteractivePlaytestUnits(session, { owner: "all" });

    expect(inspection.units).toEqual([
      expect.objectContaining({
        id: "v1a-target",
        owner: "v1a",
        hp: 72,
      }),
      expect.objectContaining({
        id: "v2-rod",
        owner: "v2",
        order: { type: "attackMove", x: 1200, y: 800 },
        carriedItems: [{ id: "rod", kind: "lightningRod", cooldownRemaining: 0 }],
      }),
    ]);
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

  it("summarizes combat-elimination playtests by surviving combat units rather than buildings", () => {
    const contested = createInteractivePlaytestSession({
      mapId: "combatArena",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      winnerMode: "combatElimination",
      options: {
        players: ["v2", "v1a"],
        teams: { v2: "north", v1a: "south" },
        scenario: {
          replaceDefaultUnits: true,
          replaceDefaultBuildings: true,
          replaceDefaultResources: true,
          addUnits: [
            { id: "v2-footman", owner: "v2", kind: "footman", x: 520, y: 800 },
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 1080, y: 800 },
          ],
          addBuildings: [{ id: "v1a-anchor", owner: "v1a", kind: "townHall", x: 1450, y: 800, complete: true }],
        },
      },
    });

    stepInteractivePlaytestSession(contested, 1);
    expect(summarizeInteractivePlaytestSession(contested)).toMatchObject({
      winner: null,
      runState: { winner: null, timeout: false },
    });

    const survivor = createInteractivePlaytestSession({
      mapId: "combatArena",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      winnerMode: "combatElimination",
      options: {
        players: ["v2", "v1a"],
        teams: { v2: "north", v1a: "south" },
        scenario: {
          replaceDefaultUnits: true,
          replaceDefaultBuildings: true,
          replaceDefaultResources: true,
          addUnits: [{ id: "v2-footman", owner: "v2", kind: "footman", x: 520, y: 800 }],
          addBuildings: [{ id: "v1a-anchor", owner: "v1a", kind: "townHall", x: 1450, y: 800, complete: true }],
        },
      },
    });

    stepInteractivePlaytestSession(survivor, 1);
    expect(summarizeInteractivePlaytestSession(survivor)).toMatchObject({
      winner: "v2",
      runState: { winner: "v2", timeout: false },
    });
  });

  it("expands and creeps camps through reusable high-level commands", () => {
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
          replaceDefaultMercenaryCamps: true,
          addUnits: [
            { id: "v2-worker", owner: "v2", kind: "worker", x: 260, y: 280 },
            { id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 300 },
            { id: "wild-camp-1", owner: "neutral", kind: "wildling", x: 900, y: 920 },
          ],
          addBuildings: [{ id: "v2-main", owner: "v2", kind: "townHall", x: 230, y: 260 }],
          addResources: [
            { id: "gold-v2-main", kind: "goldMine", x: 260, y: 260, amount: 6000 },
            { id: "gold-natural", kind: "goldMine", x: 760, y: 760, amount: 6000 },
          ],
          addMercenaryCamps: [{ id: "camp-natural", x: 900, y: 900, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }],
        },
      },
    });

    applyInteractivePlaytestCommand(session, { type: "expand", resourceId: "gold-natural" });
    expect(session.game.buildings.find((building) => building.owner === "v2" && building.kind === "townHall" && building.id !== "v2-main")).toMatchObject({
      x: 760,
      y: 760,
      complete: false,
    });

    applyInteractivePlaytestCommand(session, { type: "creepCamp", campId: "camp-natural", unitIds: "combat" });
    expect(session.game.units.find((unit) => unit.id === "v2-footman")?.order).toEqual({ type: "attackMove", x: 900, y: 900 });
  });

  it("steps until first enemy contact and exposes fight and timeout state in the summary", () => {
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
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 430, y: 780 },
          ],
        },
      },
    });

    applyInteractivePlaytestCommand(session, { type: "attackMove", unitIds: "combat", x: 430, y: 780 });
    const result = stepInteractivePlaytestUntil(session, { type: "firstFight" }, {
      maxTicks: 5,
      scriptedPlayers: {
        v1a: () => [
          {
            playerId: "v1a",
            source: "scripted-ai",
            scriptId: "test-opponent",
            command: { type: "attackMove", unitIds: ["v1a-footman"], x: 320, y: 780 },
          },
        ],
      },
    });

    expect(result.conditionMet).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(summarizeInteractivePlaytestSession(session)).toMatchObject({
      fight: { state: "contactRecorded", firstFightGameSecond: expect.any(Number) },
      runState: { winner: null, timeout: false },
    });
  });
});
