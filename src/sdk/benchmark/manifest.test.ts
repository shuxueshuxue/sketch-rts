import { describe, expect, it } from "vitest";
import type { AiGameAgent } from "../../ai/game-runner";
import type { BenchmarkInput } from "./core";
import { describeBenchmarkInput } from "./manifest";

describe("benchmark manifest", () => {
  it("describes benchmark setup facts without running matches", () => {
    const input: BenchmarkInput<AiGameAgent> = {
      name: "Manifest Probe",
      evaluations: [
        {
          name: "duel",
          tag: "melee",
          matches: [
            {
              name: "bareDuel probe",
              mapId: "bareDuel",
              options: {
                scenario: {
                  addLandmarks: [{ id: "manifest-landmark", kind: "ridge", x: 100, y: 120, size: 12, rotation: 0 }],
                },
              },
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2", version: "v2", disabledBehaviors: ["workerHarassment"] },
                v1a: { adapter: "internal", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
              },
              commandPlanner: () => [],
              maxTicks: 120,
              thinkInterval: 15,
            },
          ],
        },
      ],
    };

    expect(describeBenchmarkInput(input)).toEqual({
      name: "Manifest Probe",
      evaluationCount: 1,
      matchCount: 1,
      evaluations: [
        {
          name: "duel",
          tag: "melee",
          matchCount: 1,
          matches: [
            {
              name: "bareDuel probe",
              mapId: "bareDuel",
              maxTicks: 120,
              thinkInterval: 15,
              commandPlanner: "present",
              hasPrebuiltGame: false,
              scenario: { units: 0, buildings: 0, resources: 0, mercenaryCamps: 0, items: 0, landmarks: 1 },
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", aiVersion: "v2", disabledBehaviors: ["workerHarassment"] },
                v1a: { adapter: "internal", team: "south", race: "grove", aiVersion: "v1" },
              },
            },
          ],
        },
      ],
    });
  });
});
