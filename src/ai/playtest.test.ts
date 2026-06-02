import { describe, expect, it } from "vitest";
import { createInteractivePlaytestSession } from "../sdk/playtest";
import { applyAiInteractivePlaytestCommand, createAiInteractivePlaytestRuntime, stepAiInteractivePlaytestSession, stepAiInteractivePlaytestUntil, summarizeAiInteractivePlaytestSession } from "./playtest";
import type { AiScript } from "./policy";

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

  it("can assist the controlled side with the same durable AI memory runtime", () => {
    const session = createInteractivePlaytestSession({
      mapId: "bareDuel",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      options: { players: ["v2", "v1a"], teams: { v2: "north", v1a: "south" } },
    });
    const scripts: AiScript[] = [
      {
        id: "playtest-memory-probe",
        phase: "economy",
        run(snapshot, _owner, options) {
          options.memory.jobs.push({ id: `tick-${snapshot.tick}`, kind: "playtest-probe", createdTick: snapshot.tick, updatedTick: snapshot.tick });
          return undefined;
        },
      },
    ];
    const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled: true, scripts, thinkInterval: 1, versions: { v2: "v2", v1a: "v1" } });

    stepAiInteractivePlaytestSession(session, runtime, 2);

    expect(runtime.controlledPlayers).toEqual(["v2", "v1a"]);
    expect(runtime.memories.v2!.jobs.map((job) => job.id)).toEqual(["tick-0", "tick-1"]);
    expect(runtime.memories.v1a!.jobs.map((job) => job.id)).toEqual(["tick-0", "tick-1"]);
  });

  it("records manual CLI-style objectives into the controlled player's AI memory", () => {
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
            { id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 300 },
            { id: "wild-camp-1", owner: "neutral", kind: "wildling", x: 900, y: 920 },
          ],
          addMercenaryCamps: [{ id: "camp-natural", x: 900, y: 900, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }],
        },
      },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled: true, thinkInterval: 45, versions: { v2: "v2", v1a: "v1" } });

    applyAiInteractivePlaytestCommand(session, runtime, { type: "creepCamp", campId: "camp-natural", unitIds: "combat" });

    expect(runtime.memories.v2!.unitClaims["v2-footman"]).toMatchObject({
      kind: "creep",
      targetId: "wild-camp-1",
      x: 900,
      y: 920,
      sinceTick: 0,
    });
  });

  it("records manual attack-move commands as attack-wave memory", () => {
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
          addUnits: [{ id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 300 }],
          addBuildings: [{ id: "v1a-main", owner: "v1a", kind: "townHall", x: 900, y: 300, complete: true }],
        },
      },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled: true, thinkInterval: 45, versions: { v2: "v2", v1a: "v1" } });

    applyAiInteractivePlaytestCommand(session, runtime, { type: "attackMove", unitIds: "combat", x: 900, y: 300 });

    expect(runtime.memories.v2!.strategicPlan).toMatchObject({
      focusTargetOwner: "v1a",
      focusTargetSinceTick: 0,
      focusTargetUpdatedTick: 0,
    });
    expect(runtime.memories.v2!.jobs).toEqual([{ id: "attackWave:v1a", kind: "attackWave", createdTick: 0, updatedTick: 0 }]);
    expect(runtime.memories.v2!.unitClaims["v2-footman"]).toMatchObject({
      kind: "attack",
      targetId: "v1a-main",
      x: 900,
      y: 300,
      sinceTick: 0,
    });
  });

  it("records manual focus-fire commands as attack-wave memory", () => {
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
            { id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 300 },
            { id: "v1a-footman", owner: "v1a", kind: "footman", x: 600, y: 300 },
          ],
        },
      },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled: true, thinkInterval: 45, versions: { v2: "v2", v1a: "v1" } });

    applyAiInteractivePlaytestCommand(session, runtime, { type: "focusFire", unitIds: "combat", targetId: "v1a-footman" });

    expect(runtime.memories.v2!.jobs).toEqual([{ id: "attackWave:v1a", kind: "attackWave", createdTick: 0, updatedTick: 0 }]);
    expect(runtime.memories.v2!.unitClaims["v2-footman"]).toMatchObject({
      kind: "attack",
      targetId: "v1a-footman",
      x: 600,
      y: 300,
      sinceTick: 0,
    });
  });

  it("creates controlled-player memory for manual-only CLI commands without enabling AI assist", () => {
    const session = createInteractivePlaytestSession({
      mapId: "bareDuel",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      options: { players: ["v2", "v1a"], teams: { v2: "north", v1a: "south" } },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled: false, thinkInterval: 45, versions: { v1a: "v1" } });

    applyAiInteractivePlaytestCommand(session, runtime, { type: "build", buildingKind: "barracks", x: 420, y: 380 });

    expect(runtime.controlledPlayers).toEqual(["v1a"]);
    expect(Object.values(runtime.memories.v2!.unitClaims)).toEqual([
      expect.objectContaining({
        kind: "build",
        targetId: "build:barracks:420:380",
      }),
    ]);
  });

  it("summarizes strategic memory timing in game seconds", () => {
    const session = createInteractivePlaytestSession({
      mapId: "bareDuel",
      controlledPlayer: "v2",
      scriptedPlayers: ["v1a"],
      options: { players: ["v2", "v1a"], teams: { v2: "north", v1a: "south" } },
    });
    const runtime = createAiInteractivePlaytestRuntime(session, { assistControlled: true, thinkInterval: 45, versions: { v2: "v2", v1a: "v1" } });
    runtime.memories.v2!.strategicPlan = { focusTargetOwner: "v1a", focusTargetSinceTick: 40, focusTargetUpdatedTick: 100, expansionAttemptTick: 140 };

    const summary = summarizeAiInteractivePlaytestSession(session, runtime);
    const v2Memory = summary.aiMemory.v2;
    if (!v2Memory) throw new Error("missing v2 memory summary");

    expect(v2Memory.strategicPlan).toEqual({
      focusTargetOwner: "v1a",
      focusTargetSinceGameSecond: 2,
      focusTargetUpdatedGameSecond: 5,
      expansionAttemptGameSecond: 7,
    });
  });
});
