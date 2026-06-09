import { describe, expect, it } from "vitest";
import { campRoleSummary, dashboardTags, paginateRuns, playerSetupCells, runListMeta, runMatchesTag, runTags } from "./view-model";

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

    expect(runListMeta(run as never)).toBe("6/12 1v1 control · 1/2 1v3 · 2/2 2v3 · 1/1 15v20 · 0/1 10v12 · 18/64 maps");
  });

  it("renders generic benchmark run metadata from evaluation summaries", () => {
    const run = {
      primarySummary: { name: "v4-tr vs v3 random race", wins: 91, matchCount: 100 },
      evaluationSummaries: [{ name: "v4-tr vs v3 random race", wins: 91, matchCount: 100 }],
      selectedRichScoreMapIds: Array.from({ length: 50 }, (_, index) => `map-${index}`),
      mapPoolSize: 64,
    };

    expect(runListMeta(run as never)).toBe("50/64 maps");
  });

  it("labels unattached neutral camps as route camps instead of free camps", () => {
    expect(campRoleSummary({ freeCamps: 3, guardedCamps: 8 })).toBe("3 route / 8 guarded");
  });

  it("derives tag filters from summaries and full reports", () => {
    const summaryRun = { tags: ["combat", "melee"] };
    const detailRun = { report: { evaluations: [{ tag: "melee" }, { tag: "combat" }, {}] } };

    expect(runTags(summaryRun as never)).toEqual(["combat", "melee"]);
    expect(runTags(detailRun as never)).toEqual(["combat", "melee", "untagged"]);
    expect(dashboardTags([summaryRun as never, detailRun as never])).toEqual(["combat", "melee", "untagged"]);
    expect(runMatchesTag(summaryRun as never, "combat")).toBe(true);
    expect(runMatchesTag(summaryRun as never, "untagged")).toBe(false);
    expect(runMatchesTag(summaryRun as never, "all")).toBe(true);
  });

  it("renders missing historical player diagnostic fields as unavailable", () => {
    expect(playerSetupCells({ team: "north", aiVersion: "v2", race: "grove" } as never, "n/a")).toEqual(["north", "v2", "grove", "n/a", "n/a", "n/a"]);
  });

  it("paginates run summaries and clamps out-of-range pages", () => {
    const runs = Array.from({ length: 25 }, (_, index) => ({ id: `run-${index}` }));

    expect(paginateRuns(runs, { page: 2, pageSize: 10 })).toMatchObject({
      page: 2,
      pageSize: 10,
      totalPages: 3,
      items: runs.slice(10, 20),
    });
    expect(paginateRuns(runs, { page: 9, pageSize: 10 }).page).toBe(3);
    expect(paginateRuns([], { page: 9, pageSize: 10 })).toMatchObject({ page: 1, totalPages: 1, items: [] });
  });
});
