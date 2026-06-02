import { describe, expect, it } from "vitest";
import { campRoleSummary, combatSummariesFor, probeSummariesFor, runListMeta } from "./view-model";

describe("benchmark dashboard view model", () => {
  it("renders older dashboard runs without probe summaries", () => {
    const oldRun = {
      sanitySummary: { wins: 2, matchCount: 2 },
      selectedRichScoreMapIds: ["a", "b", "c"],
      mapPoolSize: 64,
    };

    expect(probeSummariesFor(oldRun)).toEqual([]);
    expect(combatSummariesFor(oldRun)).toEqual([]);
    expect(runListMeta(oldRun as never)).toBe("2/2 sanity · 3/64 maps");
  });

  it("renders probe and combat summaries when the run contains tagged lanes", () => {
    const run = {
      probeSummaries: [
        { name: "1v3 probe", wins: 1, matchCount: 2 },
        { name: "2v3 probe", wins: 2, matchCount: 2 },
      ],
      combatSummaries: [
        { name: "15v20 mixed combat", wins: 1, matchCount: 1 },
        { name: "10v12 mixed combat", wins: 0, matchCount: 1 },
      ],
      sanitySummary: { wins: 3, matchCount: 3 },
      selectedRichScoreMapIds: Array.from({ length: 17 }, (_, index) => `map-${index}`),
      mapPoolSize: 64,
    };

    expect(runListMeta(run as never)).toBe("1/2 1v3 · 2/2 2v3 · 1/1 15v20 · 0/1 10v12 · 3/3 sanity · 17/64 maps");
  });

  it("labels unattached neutral camps as route camps instead of free camps", () => {
    expect(campRoleSummary({ freeCamps: 3, guardedCamps: 8 })).toBe("3 route / 8 guarded");
  });
});
