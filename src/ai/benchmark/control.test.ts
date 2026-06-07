import { describe, expect, it } from "vitest";
import { createAiCrossRaceBenchmarkInput, createAiMeleeControlBenchmarkInput, summarizeAiMeleeControlBenchmark, summarizeAiMeleeControlBenchmarkDetails } from "./control";
import type { BenchmarkReport } from "../../sdk/benchmark/core";

describe("AI melee control benchmark", () => {
  it("creates side-balanced v2 ember versus v2 grove cross-race matches", () => {
    const { input, selection } = createAiCrossRaceBenchmarkInput({ seed: "cross-race-seed", mapCount: 2 });

    expect(selection.mapIds).toHaveLength(2);
    expect(input.evaluations).toHaveLength(1);
    expect(input.evaluations[0]!.name).toBe("v2 ember vs v2 grove");
    expect(input.evaluations[0]!.matches.map((match) => match.name)).toEqual(selection.mapIds.flatMap((mapId) => [`${mapId} ember north`, `${mapId} ember south`]));
    expect(input.evaluations[0]!.matches[0]!.agents.ember).toMatchObject({ team: "north", race: "ember", version: "v2", versionLabel: "v2 ember" });
    expect(input.evaluations[0]!.matches[0]!.agents.grove).toMatchObject({ team: "south", race: "grove", version: "v2", versionLabel: "v2 grove" });
    expect(input.evaluations[0]!.matches[1]!.agents.ember).toMatchObject({ team: "south", race: "ember", version: "v2", versionLabel: "v2 ember" });
    expect(input.evaluations[0]!.matches[1]!.agents.grove).toMatchObject({ team: "north", race: "grove", version: "v2", versionLabel: "v2 grove" });
  });

  it("creates side-balanced 1v1 control matches for every selected map", () => {
    const { input, selection } = createAiMeleeControlBenchmarkInput({ seed: "control-seed", mapCount: 3 });

    expect(selection.mapIds).toHaveLength(3);
    expect(input.evaluations).toHaveLength(1);
    expect(input.evaluations[0]!.matches.map((match) => match.name)).toEqual(selection.mapIds.flatMap((mapId) => [`${mapId} 1v1 control north`, `${mapId} 1v1 control south`]));
    expect(input.evaluations[0]!.matches).toHaveLength(6);
    expect(input.evaluations[0]!.matches[0]!.agents.v2).toMatchObject({ team: "north", race: "grove", version: "v2" });
    expect(input.evaluations[0]!.matches[1]!.agents.v2).toMatchObject({ team: "south", race: "grove", version: "v2" });
    expect(input.evaluations[0]!.matches[1]!.agents.v1a).toMatchObject({ team: "north", race: "grove", version: "v1" });
  });

  it("can force worker harassment fully on or off instead of using the alternating release gate", () => {
    const disabled = createAiMeleeControlBenchmarkInput({ seed: "control-seed", mapCount: 2, workerHarassment: 0 }).input.evaluations[0]!.matches;
    const enabled = createAiMeleeControlBenchmarkInput({ seed: "control-seed", mapCount: 2, workerHarassment: 1 }).input.evaluations[0]!.matches;
    const alternating = createAiMeleeControlBenchmarkInput({ seed: "control-seed", mapCount: 2, workerHarassment: 0.5 }).input.evaluations[0]!.matches;

    expect(disabled.every((match) => match.agents.v2?.disabledBehaviors?.includes("workerHarassment"))).toBe(true);
    expect(enabled.every((match) => !match.agents.v2?.disabledBehaviors?.includes("workerHarassment"))).toBe(true);
    expect(alternating.map((match) => match.agents.v2?.disabledBehaviors?.includes("workerHarassment") ?? false)).toEqual([false, false, true, true]);
  });

  it("summarizes raw side wins and map split buckets from a control report", () => {
    const report = {
      name: "AI 1v1 Control Benchmark",
      startedAt: "2026-06-04T00:00:00.000Z",
      evaluationCount: 1,
      matchCount: 6,
      elapsedMs: 10,
      cpuMs: 20,
      evaluations: [
        {
          name: "1v1 score control",
          startedAt: "2026-06-04T00:00:00.000Z",
          elapsedMs: 10,
          cpuMs: 20,
          matchCount: 6,
          matches: [
            match("alpha 1v1 control north", "alpha", "v2"),
            match("alpha 1v1 control south", "alpha", "v2"),
            match("beta 1v1 control north", "beta", "v1a"),
            match("beta 1v1 control south", "beta", "v2"),
            match("gamma 1v1 control north", "gamma", "v1a"),
            match("gamma 1v1 control south", "gamma", null),
          ],
        },
      ],
    } as unknown as BenchmarkReport;

    const result = summarizeAiMeleeControlBenchmark({ seed: "control-seed", selectedMapIds: ["alpha", "beta", "gamma"], report, workers: 4 });

    expect(result).toMatchObject({
      seed: "control-seed",
      rawWins: 3,
      rawMatches: 6,
      bothSideMapWins: 1,
      split: 1,
      bothSideLosses: 1,
      workers: 4,
    });
    expect(result.byMap).toEqual([
      { mapId: "alpha", northWinner: "v2", southWinner: "v2", wins: 2 },
      { mapId: "beta", northWinner: "v1a", southWinner: "v2", wins: 1 },
      { mapId: "gamma", northWinner: "v1a", southWinner: null, wins: 0 },
    ]);
  });

  it("includes AI command stats in focused match details when the worker reports them", () => {
    const report = {
      name: "AI 1v1 Control Benchmark",
      startedAt: "2026-06-04T00:00:00.000Z",
      evaluationCount: 1,
      matchCount: 1,
      elapsedMs: 10,
      cpuMs: 20,
      evaluations: [
        {
          name: "1v1 score control",
          startedAt: "2026-06-04T00:00:00.000Z",
          elapsedMs: 10,
          cpuMs: 20,
          matchCount: 1,
          matches: [
            {
              ...match("alpha 1v1 control north", "alpha", "v2"),
              result: {
                winner: "v2",
                winnerTeam: "north",
                gameSecond: 12,
                timeout: false,
                players: {},
                trackers: {
                  aiCommandStats: {
                    owners: {
                      v2: {
                        scripts: {
                          workerPressure: { commands: 2, byType: { focusFire: 2 } },
                          earlyHarassment: { commands: 1, byType: { move: 1 } },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    } as unknown as BenchmarkReport;

    const result = summarizeAiMeleeControlBenchmarkDetails({ seed: "control-seed", selectedMapIds: ["alpha"], report, workers: 1 });

    expect(result.matches[0]!.aiCommandStats).toMatchObject({
      owners: {
        v2: {
          scripts: {
            workerPressure: { commands: 2, byType: { focusFire: 2 } },
            earlyHarassment: { commands: 1, byType: { move: 1 } },
          },
        },
      },
    });
  });

  it("includes wounded moon well stats in focused match details when the worker reports them", () => {
    const report = {
      name: "AI 1v1 Control Benchmark",
      startedAt: "2026-06-04T00:00:00.000Z",
      evaluationCount: 1,
      matchCount: 1,
      elapsedMs: 10,
      cpuMs: 20,
      evaluations: [
        {
          name: "1v1 score control",
          startedAt: "2026-06-04T00:00:00.000Z",
          elapsedMs: 10,
          cpuMs: 20,
          matchCount: 1,
          matches: [
            {
              ...match("alpha 1v1 control north", "alpha", "v2"),
              result: {
                winner: "v2",
                winnerTeam: "north",
                gameSecond: 12,
                timeout: false,
                players: {},
                trackers: {
                  woundedMoonWellStats: {
                    owners: {
                      v2: {
                        lowHpSamples: 4,
                        lowHpInHealingRangeSamples: 1,
                        lowHpFarFromMoonWellSamples: 3,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    } as unknown as BenchmarkReport;

    const result = summarizeAiMeleeControlBenchmarkDetails({ seed: "control-seed", selectedMapIds: ["alpha"], report, workers: 1 });

    expect(result.matches[0]!.woundedMoonWellStats).toMatchObject({
      owners: {
        v2: {
          lowHpSamples: 4,
          lowHpInHealingRangeSamples: 1,
          lowHpFarFromMoonWellSamples: 3,
        },
      },
    });
  });

  it("includes army balance stats in focused match details when the worker reports them", () => {
    const report = {
      name: "AI 1v1 Control Benchmark",
      startedAt: "2026-06-04T00:00:00.000Z",
      evaluationCount: 1,
      matchCount: 1,
      elapsedMs: 10,
      cpuMs: 20,
      evaluations: [
        {
          name: "1v1 score control",
          startedAt: "2026-06-04T00:00:00.000Z",
          elapsedMs: 10,
          cpuMs: 20,
          matchCount: 1,
          matches: [
            {
              ...match("alpha 1v1 control north", "alpha", "v2"),
              result: {
                winner: "v2",
                winnerTeam: "north",
                gameSecond: 12,
                timeout: false,
                players: {},
                trackers: {
                  armyBalanceStats: {
                    owners: {
                      v2: {
                        samples: 12,
                        minPowerLead: -4,
                        minPowerLeadSecond: 3,
                        maxPowerLead: 8,
                        maxPowerLeadSecond: 9,
                        firstPositivePowerLeadSecond: 7,
                        firstLocalCombatSecond: 5,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    } as unknown as BenchmarkReport;

    const result = summarizeAiMeleeControlBenchmarkDetails({ seed: "control-seed", selectedMapIds: ["alpha"], report, workers: 1 });

    expect(result.matches[0]!.armyBalanceStats).toMatchObject({
      owners: {
        v2: {
          samples: 12,
          minPowerLead: -4,
          maxPowerLead: 8,
          firstPositivePowerLeadSecond: 7,
          firstLocalCombatSecond: 5,
        },
      },
    });
  });

  it("includes expansion claim timeline samples in focused match details when the worker reports them", () => {
    const report = {
      name: "AI 1v1 Control Benchmark",
      startedAt: "2026-06-04T00:00:00.000Z",
      evaluationCount: 1,
      matchCount: 1,
      elapsedMs: 10,
      cpuMs: 20,
      evaluations: [
        {
          name: "1v1 score control",
          startedAt: "2026-06-04T00:00:00.000Z",
          elapsedMs: 10,
          cpuMs: 20,
          matchCount: 1,
          matches: [
            {
              ...match("alpha 1v1 control north", "alpha", "v2"),
              result: {
                winner: "v2",
                winnerTeam: "north",
                gameSecond: 12,
                timeout: false,
                players: {},
                trackers: {
                  expansionClaimTimeline: {
                    owners: {
                      v2: {
                        commands: [{ second: 10, unitCount: 4, x: 1200, y: 900 }],
                        samples: [{ second: 15, alive: 4, lowHp: 2, neutralGuardsNearTarget: 1, enemyCombatNearGroup: 0 }],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    } as unknown as BenchmarkReport;

    const result = summarizeAiMeleeControlBenchmarkDetails({ seed: "control-seed", selectedMapIds: ["alpha"], report, workers: 1 });

    expect(result.matches[0]!.expansionClaimTimeline).toMatchObject({
      owners: {
        v2: {
          commands: [{ second: 10, unitCount: 4, x: 1200, y: 900 }],
          samples: [{ second: 15, alive: 4, lowHp: 2, neutralGuardsNearTarget: 1 }],
        },
      },
    });
  });
});

function match(name: string, mapId: string, winner: string | null) {
  return {
    name,
    elapsedMs: 1,
    cpuMs: 1,
    setup: { map: { id: mapId } },
    result: { winner },
  };
}
