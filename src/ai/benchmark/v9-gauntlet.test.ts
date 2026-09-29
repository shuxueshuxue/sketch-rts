import { describe, expect, it } from "vitest";
import type { BenchmarkReport } from "../../sdk/benchmark/core";
import { createAiV9GauntletBenchmarkInput, summarizeAiV9GauntletBenchmark } from "./v9-gauntlet";

describe("v9 gauntlet benchmark", () => {
  it("puts V9 as each race against V5, V7 and V8 together, whose ids never name their version", () => {
    const { input, selection } = createAiV9GauntletBenchmarkInput({ seed: "v9-input", mapCount: 12 });
    const matches = input.evaluations.flatMap((evaluation) => evaluation.matches);
    expect(matches.map((match) => match.name)).toEqual(selection.mapIds.flatMap((mapId) => [`${mapId} v9 grove`, `${mapId} v9 ember`]));
    const firstIds = new Set<string>();
    const v9Firsts = new Set<boolean>();
    for (const match of matches) {
      expect(Object.keys(match.agents).sort()).toEqual(["p1", "p2", "p3", "v9"]);
      const { v9, p1, p2, p3 } = match.agents;
      expect(v9).toMatchObject({ version: "v9", policyVersion: "v9", race: match.name.endsWith("grove") ? "grove" : "ember" });
      const rivals = [p1!, p2!, p3!];
      expect(new Set(rivals.map((rival) => rival.team))).toEqual(new Set([p1!.team]));
      expect(v9!.team).not.toBe(p1!.team);
      expect(rivals.map((rival) => rival.version).sort()).toEqual(["v5", "v7", "v8"]);
      for (const rival of rivals) expect(rival.policyVersion).toBe(rival.version);
      firstIds.add(p1!.version!);
      v9Firsts.add(Object.keys(match.agents)[0] === "v9");
    }
    // Which version plays under p1 changes from game to game, and V9 starts on either side.
    expect(firstIds.size).toBeGreaterThan(1);
    expect(v9Firsts).toEqual(new Set([true, false]));
  });

  it("nudges V9 and each rival in turn", () => {
    const { input } = createAiV9GauntletBenchmarkInput({ seed: "v9-nudge", mapCount: 3, nudges: 4 });
    const nudged = input.evaluations.flatMap((evaluation) => evaluation.matches).slice(0, 4) as { nudge?: { who: string } }[];
    expect(nudged.map((match) => match.nudge?.who)).toEqual(["v9", "v8", "v5", "v7"]);
  });

  it("maps the neutral ids back to versions for the report", () => {
    const match = (name: string, winner: string | null, rivals: Record<string, string>, v9Race: string) => ({
      name,
      result: {
        winner,
        players: { v9: { race: v9Race, aiVersion: `v9 ${v9Race}` }, ...Object.fromEntries(Object.entries(rivals).map(([id, version]) => [id, { race: "grove", aiVersion: `${version} grove` }])) },
        trackers: { aiCommandStats: { owners: { v9: { scripts: { v6General: { commands: 4 } } } } }, unitRosterStats: { owners: { v9: { orderedByKind: { archer: 2 }, peakByKind: {} } } } },
      },
    });
    const report = {
      elapsedMs: 1,
      cpuMs: 1,
      evaluations: [
        {
          matches: [
            match("m v9 grove", "v9", { p1: "v5", p2: "v8", p3: "v7" }, "grove"),
            match("m v9 ember", "p2", { p1: "v7", p2: "v8", p3: "v5" }, "ember"),
          ],
        },
      ],
    } as unknown as BenchmarkReport;
    const result = summarizeAiV9GauntletBenchmark({ seed: "s", selectedMapIds: ["m"], report });
    expect(result).toMatchObject({ subject: "v9", wins: 1, rawMatches: 2, lossesTo: { v5: 0, v7: 0, v8: 1, timeout: 0 }, watchedGames: 2 });
    expect(result.byPair).toEqual({ "v5+v7+v8": { wins: 1, matches: 2, winRate: 0.5 } });
    expect(result.byMap).toEqual([{ mapId: "m", grove: { pair: "v5+v7+v8", winner: "v9" }, ember: { pair: "v5+v7+v8", winner: "v8" }, wins: 1 }]);
  });
});
