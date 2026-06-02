import { describe, expect, it } from "vitest";
import { createInteractivePlaytestSession } from "../sdk/playtest";
import { createAiInteractivePlaytestRuntime, stepAiInteractivePlaytestSession, stepAiInteractivePlaytestUntil } from "./playtest";
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
});
