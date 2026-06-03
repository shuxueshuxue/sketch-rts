import { describe, expect, it } from "vitest";
import { campRoleSummary, runListMeta, scoreControlGameSummary } from "./view-model";

describe("benchmark dashboard view model", () => {
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
      scoreControlSummary: { wins: 6, matchCount: 12 },
      selectedRichScoreMapIds: Array.from({ length: 18 }, (_, index) => `map-${index}`),
      mapPoolSize: 64,
    };

    expect(runListMeta(run as never)).toBe("6/12 1v1 maps · 1/2 1v3 · 2/2 2v3 · 1/1 15v20 · 0/1 10v12 · 18/64 maps");
  });

  it("summarizes raw side-balanced 1v1 games separately from map-level control", () => {
    const run = {
      report: {
        evaluations: [
          {
            name: "1v1 score control",
            tag: "melee",
            matches: [
              {
                result: { winner: "v2", players: { v2: { enemyUnitKills: 4 }, v1a: { unitsLost: 4, unitsKilledByNeutral: 0 } } },
              },
              {
                result: { winner: "v1a", players: { v2: { enemyUnitKills: 1 }, v1a: { unitsLost: 1, unitsKilledByNeutral: 0 } } },
              },
              {
                result: { winner: "v2", players: { v2: { enemyUnitKills: 0 }, v1a: { unitsLost: 4, unitsKilledByNeutral: 4 } } },
              },
            ],
          },
        ],
      },
    };

    expect(scoreControlGameSummary(run as never)).toMatchObject({ name: "1v1 control games", wins: 1, losses: 2, failures: 2, successRate: 1 / 3, matchCount: 3 });
  });

  it("labels unattached neutral camps as route camps instead of free camps", () => {
    expect(campRoleSummary({ freeCamps: 3, guardedCamps: 8 })).toBe("3 route / 8 guarded");
  });
});
