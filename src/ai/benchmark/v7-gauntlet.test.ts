import { describe, expect, it } from "vitest";
import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { createAiV7GauntletBenchmarkInput, summarizeAiV7GauntletBenchmark } from "./v7-gauntlet";

describe("v7 gauntlet benchmark", () => {
  it("puts V7 as each race against pairs of V3, V5 and V6 whose ids never name their version", () => {
    const { input, selection } = createAiV7GauntletBenchmarkInput({ seed: "v7-input", mapCount: 12 });
    const matches = input.evaluations.flatMap((evaluation) => evaluation.matches);
    expect(matches.map((match) => match.name)).toEqual(selection.mapIds.flatMap((mapId) => [`${mapId} v7 grove`, `${mapId} v7 ember`]));
    const pairs = new Set<string>();
    const firstIds = new Set<string>();
    const v7Firsts = new Set<boolean>();
    for (const match of matches) {
      expect(Object.keys(match.agents).sort()).toEqual(["p1", "p2", "v7"]);
      const { v7, p1, p2 } = match.agents;
      expect(v7).toMatchObject({ version: "v7", policyVersion: "v7", race: match.name.endsWith("grove") ? "grove" : "ember" });
      expect(p1!.team).toBe(p2!.team);
      expect(v7!.team).not.toBe(p1!.team);
      expect(p1!.version).not.toBe(p2!.version);
      for (const rival of [p1!, p2!]) {
        expect(["v3", "v5", "v6"]).toContain(rival.version);
        expect(rival.policyVersion).toBe(rival.version === "v3" ? (rival.race === "ember" ? "v3-ember" : "v3-grove") : rival.version);
      }
      pairs.add([p1!.version, p2!.version].sort().join("+"));
      firstIds.add(p1!.version!);
      v7Firsts.add(Object.keys(match.agents)[0] === "v7");
    }
    expect(pairs).toEqual(new Set(["v5+v6", "v3+v6", "v3+v5"]));
    // Which version plays under p1 changes from game to game, and V7 starts on either side.
    expect(firstIds.size).toBeGreaterThan(1);
    expect(v7Firsts).toEqual(new Set([true, false]));
    // A map's two games face different pairs.
    for (const mapId of selection.mapIds) {
      const [grove, ember] = matches.filter((match) => match.mapId === mapId).map((match) => [match.agents.p1!.version, match.agents.p2!.version].sort().join("+"));
      expect(grove).not.toBe(ember);
    }
  });

  it("maps the neutral ids back to versions for the report, by pair and by V7's race", () => {
    const match = (name: string, winner: string | null, rivals: Record<string, string>, v7Race: string) => ({
      name,
      result: {
        winner,
        players: { v7: { race: v7Race, aiVersion: `v7 ${v7Race}` }, ...Object.fromEntries(Object.entries(rivals).map(([id, version]) => [id, { race: "grove", aiVersion: `${version} grove` }])) },
        trackers: { aiCommandStats: { owners: { v7: { scripts: { v6General: { commands: 4 }, focusFire: { commands: 2 } } } } }, unitRosterStats: { owners: { v7: { orderedByKind: {}, peakByKind: {} } } } },
      },
    });
    const report = {
      elapsedMs: 1,
      cpuMs: 1,
      evaluations: [
        {
          matches: [
            match("m v7 grove", "v7", { p1: "v5", p2: "v6" }, "grove"),
            match("m v7 ember", "p2", { p1: "v6", p2: "v3" }, "ember"),
            match("n v7 grove", null, { p1: "v3", p2: "v5" }, "grove"),
            match("n v7 ember", "p1", { p1: "v6", p2: "v5" }, "ember"),
          ],
        },
      ],
    } as unknown as BenchmarkReport;
    const result = summarizeAiV7GauntletBenchmark({ seed: "s", selectedMapIds: ["m", "n"], report });
    expect(result).toMatchObject({ v7Wins: 1, rawMatches: 4, lossesTo: { v3: 1, v5: 0, v6: 1, timeout: 1 } });
    expect(result.byPair).toMatchObject({ "v5+v6": { wins: 1, matches: 2 }, "v3+v6": { wins: 0, matches: 1 }, "v3+v5": { wins: 0, matches: 1 } });
    expect(result.byV7Race).toMatchObject({ grove: { wins: 1, matches: 2 }, ember: { wins: 0, matches: 2 } });
    expect(result.plays).toEqual({ v6General: { won: 1, lost: 3 } });
    expect(result.byMap).toEqual([
      { mapId: "m", grove: { pair: "v5+v6", winner: "v7" }, ember: { pair: "v3+v6", winner: "v3" }, wins: 1 },
      { mapId: "n", grove: { pair: "v3+v5", winner: null }, ember: { pair: "v5+v6", winner: "v6" }, wins: 0 },
    ]);
  });
});
