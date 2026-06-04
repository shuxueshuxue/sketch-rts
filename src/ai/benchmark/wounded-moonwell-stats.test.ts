import { describe, expect, it } from "vitest";
import { runBenchmark, type BenchmarkTracker } from "../../sdk/benchmark/core";
import { sketchScene } from "../../sdk/scene";
import type { AiGameAgent } from "../game-runner";
import { createWoundedMoonWellStatsTracker, type WoundedMoonWellStats } from "./wounded-moonwell-stats";

describe("wounded moon well stats tracker", () => {
  it("separates low-health combat samples in healing range from safe far-away samples", () => {
    const scene = sketchScene("wounded-moonwell-distance")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "moonWell", 580, 500)
      .unit("v2", "footman", 620, 500, { id: "near-wounded", hp: 40 })
      .unit("v2", "lancer", 1500, 1500, { id: "far-wounded", hp: 50, order: { type: "idle" } })
      .townHall("v1a", 3400, 3400)
      .unit("v1a", "footman", 3400, 3320)
      .build();
    const agents: Record<string, AiGameAgent> = {
      v2: { adapter: "external", team: "north", race: "grove", version: "v2", versionLabel: "v2" },
      v1a: { adapter: "external", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
    };

    const report = runBenchmark({
      name: "wounded moon well tracker",
      trackers: [createWoundedMoonWellStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>],
      evaluations: [
        {
          name: "distance buckets",
          matches: [
            {
              name: "one near one far",
              game: scene.createGame(),
              agents,
              maxTicks: 1,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    const stats = report.evaluations[0]!.matches[0]!.result.trackers.woundedMoonWellStats as WoundedMoonWellStats;

    expect(stats.owners.v2).toMatchObject({
      lowHpSamples: 2,
      lowHpWithMoonWellSamples: 2,
      lowHpInHealingRangeSamples: 1,
      lowHpFarFromMoonWellSamples: 1,
      lowHpSafeFarFromMoonWellSamples: 1,
      lowHpIdleOrMoveFarFromMoonWellSamples: 1,
      lowHpByNearestMoonWellDistance: {
        healingRange: 1,
        far: 1,
      },
    });
  });

  it("attributes safe far-away low-health samples to each unit's recent AI command script", () => {
    const scene = sketchScene("wounded-moonwell-command-attribution")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "moonWell", 580, 500)
      .unit("v2", "footman", 1500, 1500, { id: "far-wounded", hp: 40 })
      .townHall("v1a", 3400, 3400)
      .build();
    const agents: Record<string, AiGameAgent> = {
      v2: { adapter: "external", team: "north", race: "grove", version: "v2", versionLabel: "v2" },
      v1a: { adapter: "external", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
    };

    const report = runBenchmark({
      name: "wounded moon well tracker attribution",
      trackers: [createWoundedMoonWellStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>],
      evaluations: [
        {
          name: "recent command scripts",
          matches: [
            {
              name: "objective claimed wounded unit",
              game: scene.createGame(),
              agents,
              maxTicks: 1,
              thinkInterval: 1,
              commandPlanner: ({ owner, source }) =>
                owner === "v2"
                  ? [
                      {
                        playerId: "v2",
                        source,
                        scriptId: "objectiveControl",
                        command: { type: "attackMove", unitIds: ["far-wounded"], x: 1900, y: 1900 },
                      },
                    ]
                  : [],
            },
          ],
        },
      ],
    });

    const stats = report.evaluations[0]!.matches[0]!.result.trackers.woundedMoonWellStats as WoundedMoonWellStats;

    expect(stats.owners.v2).toMatchObject({
      lowHpSafeFarFromMoonWellSamples: 1,
      lowHpSafeFarByRecentCommandScript: { objectiveControl: 1 },
      lowHpSafeFarByRecentCommandType: { attackMove: 1 },
      lowHpSafeFarByRecentCommandScriptAndType: { "objectiveControl:attackMove": 1 },
      lowHpSafeFarRecentTargetSamples: 1,
      lowHpSafeFarRecentTargetFarFromMoonWellSamples: 1,
      lowHpSafeFarRecentTargetFarByScriptAndType: { "objectiveControl:attackMove": 1 },
    });
    expect(stats.owners.v2!.avgLowHpSafeFarRecentTargetMoonWellDistance).toBeGreaterThan(1_000);
  });
});
