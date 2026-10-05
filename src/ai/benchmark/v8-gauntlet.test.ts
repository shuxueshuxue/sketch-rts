import { describe, expect, it } from "vitest";
import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { createAiV8GauntletBenchmarkInput, summarizeAiV8GauntletBenchmark } from "./v8-gauntlet";

describe("v8 gauntlet benchmark", () => {
  it("puts V8 as each race against V5 and V7 together, whose ids never name their version", () => {
    const { input, selection } = createAiV8GauntletBenchmarkInput({ seed: "v8-input", mapCount: 12 });
    const matches = input.evaluations.flatMap((evaluation) => evaluation.matches);
    expect(matches.map((match) => match.name)).toEqual(selection.mapIds.flatMap((mapId) => [`${mapId} v8 grove`, `${mapId} v8 ember`]));
    const pairs = new Set<string>();
    const firstIds = new Set<string>();
    const v8Firsts = new Set<boolean>();
    for (const match of matches) {
      expect(Object.keys(match.agents).sort()).toEqual(["p1", "p2", "v8"]);
      const { v8, p1, p2 } = match.agents;
      expect(v8).toMatchObject({ version: "v8", policyVersion: "v8", race: match.name.endsWith("grove") ? "grove" : "ember" });
      expect(p1!.team).toBe(p2!.team);
      expect(v8!.team).not.toBe(p1!.team);
      expect(p1!.version).not.toBe(p2!.version);
      for (const rival of [p1!, p2!]) {
        expect(["v5", "v7"]).toContain(rival.version);
        expect(rival.policyVersion).toBe(rival.version);
      }
      pairs.add([p1!.version, p2!.version].sort().join("+"));
      firstIds.add(p1!.version!);
      v8Firsts.add(Object.keys(match.agents)[0] === "v8");
    }
    expect(pairs).toEqual(new Set(["v5+v7"]));
    // Which version plays under p1 changes from game to game, and V8 starts on either side.
    expect(firstIds.size).toBeGreaterThan(1);
    expect(v8Firsts).toEqual(new Set([true, false]));
  });

  it("maps the neutral ids back to versions for the report, by pair and by V8's race", () => {
    const match = (name: string, winner: string | null, rivals: Record<string, string>, v8Race: string) => ({
      name,
      result: {
        winner,
        players: { v8: { race: v8Race, aiVersion: `v8 ${v8Race}` }, ...Object.fromEntries(Object.entries(rivals).map(([id, version]) => [id, { race: "grove", aiVersion: `${version} grove` }])) },
        trackers: { aiCommandStats: { owners: { v8: { scripts: { v6General: { commands: 4 }, focusFire: { commands: 2 } } } } }, unitRosterStats: { owners: { v8: { orderedByKind: {}, peakByKind: {} } } } },
      },
    });
    const report = {
      elapsedMs: 1,
      cpuMs: 1,
      evaluations: [
        {
          matches: [
            match("m v8 grove", "v8", { p1: "v5", p2: "v7" }, "grove"),
            match("m v8 ember", "p2", { p1: "v7", p2: "v5" }, "ember"),
            match("n v8 grove", null, { p1: "v5", p2: "v7" }, "grove"),
            match("n v8 ember", "p1", { p1: "v7", p2: "v5" }, "ember"),
          ],
        },
      ],
    } as unknown as BenchmarkReport;
    const result = summarizeAiV8GauntletBenchmark({ seed: "s", selectedMapIds: ["m", "n"], report });
    expect(result).toMatchObject({ v8Wins: 1, rawMatches: 4, lossesTo: { v5: 1, v7: 1, timeout: 1 } });
    expect(result.byPair).toEqual({ "v5+v7": { wins: 1, matches: 4, winRate: 0.25 } });
    expect(result.byV8Race).toMatchObject({ grove: { wins: 1, matches: 2 }, ember: { wins: 0, matches: 2 } });
    expect(result.plays).toEqual({ v6General: { won: 1, lost: 3 } });
    expect(result.byMap).toEqual([
      { mapId: "m", grove: { pair: "v5+v7", winner: "v8" }, ember: { pair: "v5+v7", winner: "v5" }, wins: 1 },
      { mapId: "n", grove: { pair: "v5+v7", winner: null }, ember: { pair: "v5+v7", winner: "v7" }, wins: 0 },
    ]);
  });
});
