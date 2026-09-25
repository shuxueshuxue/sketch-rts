import { describe, expect, it } from "vitest";
import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { createAiV6GauntletBenchmarkInput, summarizeAiV6GauntletBenchmark } from "./v6-gauntlet";

describe("v6 gauntlet benchmark", () => {
  it("puts V6 alone against V3 and V5 on both sides of every map", () => {
    const { input, selection } = createAiV6GauntletBenchmarkInput({ seed: "v6-input", mapCount: 4 });
    const matches = input.evaluations.flatMap((evaluation) => evaluation.matches);
    expect(matches.map((match) => match.name)).toEqual(selection.mapIds.flatMap((mapId) => [`${mapId} v6 north`, `${mapId} v6 south`]));
    for (const match of matches) {
      const { v6, v3, v5 } = match.agents;
      expect(Object.keys(match.agents).sort()).toEqual(["v3", "v5", "v6"]);
      expect(v6).toMatchObject({ version: "v6", policyVersion: "v6" });
      expect(v5).toMatchObject({ version: "v5", policyVersion: "v5" });
      expect(v3!.policyVersion).toBe(v3!.race === "ember" ? "v3-ember" : "v3-grove");
      expect(v3!.team).toBe(v5!.team);
      expect(v6!.team).not.toBe(v3!.team);
      expect(match.name.endsWith(v6!.team!)).toBe(true);
    }
    const races = new Set(matches.map((match) => match.agents.v6!.race));
    expect(races).toEqual(new Set(["grove", "ember"]));
  });

  it("counts wins and losses by winner and flags any game where V6 ordered or fielded a shooter", () => {
    const match = (name: string, winner: string, v6Roster: object) => ({
      name,
      result: {
        winner,
        players: { v6: { race: "grove" }, v3: { race: "ember" }, v5: { race: "grove" } },
        trackers: { unitRosterStats: { owners: { v6: v6Roster } } },
      },
    });
    const clean = { orderedByKind: { footman: 9 }, peakByKind: { footman: 6 } };
    const report = {
      elapsedMs: 1,
      cpuMs: 1,
      evaluations: [
        {
          matches: [
            match("m v6 north", "v6", clean),
            match("m v6 south", "v5", { orderedByKind: {}, peakByKind: { contractArcher: 1 } }),
            match("n v6 north", "v3", { orderedByKind: { archer: 1 }, peakByKind: {} }),
            match("n v6 south", "v6", clean),
          ],
        },
      ],
    } as unknown as BenchmarkReport;
    const result = summarizeAiV6GauntletBenchmark({ seed: "s", selectedMapIds: ["m", "n"], report });
    expect(result).toMatchObject({ v6Wins: 2, rawMatches: 4, lossesTo: { v3: 1, v5: 1, timeout: 0 }, shooterViolations: ["m v6 south", "n v6 north"] });
    expect(result.byMap).toEqual([
      { mapId: "m", northWinner: "v6", southWinner: "v5", wins: 1 },
      { mapId: "n", northWinner: "v3", southWinner: "v6", wins: 1 },
    ]);
  });
});
