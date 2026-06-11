import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { benchmarkDashboardLogsDir, benchmarkDashboardRunsDir, listBenchmarkDashboardRuns, listBenchmarkDashboardRunsPage, readBenchmarkDashboardRun, readBenchmarkDashboardRunPage, recordBenchmarkDashboardReportRun, recordAiVersionBenchmarkDashboardRun } from "./dashboard-store";

describe("benchmark dashboard store", () => {
  it("lists dashboard summaries with backend pagination metadata", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-page-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      for (let index = 0; index < 5; index += 1) {
        await writeFile(
          path.join(runsDir, `run-${index}.json`),
          JSON.stringify(specializedRunFile({ id: `run-${index}`, createdAt: `2026-01-01T00:0${index}:00.000Z`, tag: index % 2 === 0 ? "melee" : "combat" })),
        );
      }

      const page = await listBenchmarkDashboardRunsPage({ rootDir, page: 2, pageSize: 2 });

      expect(page).toMatchObject({
        page: 2,
        pageSize: 2,
        totalRuns: 5,
        totalPages: 3,
        tags: ["combat", "melee"],
      });
      expect(page.runs.map((run) => run.id)).toEqual(["run-2", "run-1"]);
      expect(page.runs.every((run) => !("report" in run))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("filters dashboard summary pages by tag before slicing", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-tag-page-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      for (let index = 0; index < 6; index += 1) {
        await writeFile(
          path.join(runsDir, `run-${index}.json`),
          JSON.stringify(specializedRunFile({ id: `run-${index}`, createdAt: `2026-01-01T00:0${index}:00.000Z`, tag: index % 2 === 0 ? "melee" : "combat" })),
        );
      }

      const page = await listBenchmarkDashboardRunsPage({ rootDir, page: 2, pageSize: 2, tag: "melee" });

      expect(page).toMatchObject({
        page: 2,
        pageSize: 2,
        totalRuns: 3,
        totalPages: 2,
      });
      expect(page.runs.map((run) => run.id)).toEqual(["run-0"]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("reads a dashboard run with backend match pagination", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-match-page-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      await writeFile(
        path.join(runsDir, "paged-run.json"),
        JSON.stringify(specializedRunFile({ id: "paged-run", createdAt: "2026-01-01T00:00:00.000Z", tag: "melee", matchCount: 5 })),
      );

      const page = await readBenchmarkDashboardRunPage("paged-run", { rootDir, matchPage: 2, matchPageSize: 2 });

      expect(page).toMatchObject({
        matchPage: 2,
        matchPageSize: 2,
        totalMatches: 5,
        totalMatchPages: 3,
      });
      expect(page.report.evaluations[0]?.matchCount).toBe(5);
      expect(page.report.evaluations[0]?.matches.map((match) => match.name)).toEqual(["paged-run match 2", "paged-run match 3"]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("filters a paged dashboard run detail by evaluation tag before slicing matches", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-match-tag-page-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      const run = specializedRunFile({ id: "tagged-run", createdAt: "2026-01-01T00:00:00.000Z", tag: "melee", matchCount: 3 });
      run.report.evaluations.push(specializedRunFile({ id: "tagged-run-combat", createdAt: "2026-01-01T00:00:00.000Z", tag: "combat", matchCount: 4 }).report.evaluations[0]!);
      run.report.evaluationCount = 2;
      run.report.matchCount = 7;
      await writeFile(path.join(runsDir, "tagged-run.json"), JSON.stringify(run));

      const page = await readBenchmarkDashboardRunPage("tagged-run", { rootDir, tag: "combat", matchPage: 1, matchPageSize: 2 });

      expect(page).toMatchObject({
        matchPage: 1,
        matchPageSize: 2,
        totalMatches: 4,
        totalMatchPages: 2,
      });
      expect(page.report.evaluations.map((evaluation) => evaluation.tag)).toEqual(["combat"]);
      expect(page.report.evaluations[0]?.matches.map((match) => match.name)).toEqual(["tagged-run-combat match 0", "tagged-run-combat match 1"]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("records standard AI benchmark runs and lists latest summaries first", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const first = await recordAiVersionBenchmarkDashboardRun(
        { seed: "store-first", mapCount: 1, maxTicks: 1 },
        { rootDir, now: () => new Date("2026-01-01T00:00:00.000Z") },
      );
      const second = await recordAiVersionBenchmarkDashboardRun(
        { seed: "store-second", mapCount: 18, maxTicks: 1 },
        { rootDir, now: () => new Date("2026-01-01T00:01:00.000Z") },
      );

      const summaries = await listBenchmarkDashboardRuns({ rootDir });
      expect(summaries.map((summary) => summary.id)).toEqual([second.id, first.id]);
      expect(summaries[0]).toMatchObject({
        kind: "ai-version-benchmark",
        seed: "store-second",
        mapPoolSize: 64,
        matchCount: 52,
      });
      expect(summaries[0]?.cpuMs).toBeGreaterThanOrEqual(0);
      expect(summaries[0]?.selectedRichScoreMapIds).toHaveLength(18);
      expect(summaries[0]?.tags).toEqual(["combat", "melee"]);
      expect(summaries[0]?.probeSummaries?.map((summary) => summary.name)).toEqual(["1v3 probe", "2v3 probe"]);
      expect(summaries[0]?.combatSummaries?.map((summary) => summary.name)).toEqual(["15v20 mixed combat", "10v12 mixed combat"]);

      const detail = await readBenchmarkDashboardRun(second.id, { rootDir });
      expect(detail.report.cpuMs).toBeGreaterThanOrEqual(0);
      expect(detail.report.evaluations.map((evaluation) => evaluation.name)).toEqual(["1v2 score", "1v1 score control", "1v3 probe", "2v3 probe", "15v20 mixed combat", "10v12 mixed combat"]);
      expect(detail.report.evaluations.map((evaluation) => evaluation.tag)).toEqual(["melee", "melee", "melee", "melee", "combat", "combat"]);
      expect(detail.report.evaluations.map((evaluation) => evaluation.matches.length)).toEqual([12, 24, 3, 3, 5, 5]);
      expect([detail.report.evaluations[0]!, ...detail.report.evaluations.slice(2, 4)].flatMap((evaluation) => evaluation.matches.map((match) => match.setup.map.id))).toEqual(detail.selectedRichScoreMapIds);
      expect(detail.report.evaluations[1]!.matches.map((match) => match.setup.map.id)).toEqual(detail.report.evaluations[0]!.matches.flatMap((match) => [match.setup.map.id, match.setup.map.id]));
      expect(detail.report.evaluations.slice(4).flatMap((evaluation) => evaluation.matches.map((match) => match.setup.map.id))).toEqual(Array.from({ length: 10 }, () => "combatArena"));
      await expect(readFile(path.join(benchmarkDashboardLogsDir({ rootDir }), `${second.id}.log`), "utf8")).resolves.toContain("cpu time:");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not reuse a fixed timestamp seed for ordinary dashboard runs", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const now = () => new Date("2026-01-01T00:00:00.000Z");
      const first = await recordAiVersionBenchmarkDashboardRun({ mapCount: 1, maxTicks: 1 }, { rootDir, now });
      const second = await recordAiVersionBenchmarkDashboardRun({ mapCount: 1, maxTicks: 1 }, { rootDir, now });

      expect(first.seed).not.toBe(second.seed);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("records specialized benchmark reports with target-player evaluation summaries", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const run = await recordBenchmarkDashboardReportRun(
        {
          kind: "ai-specialized-benchmark",
          seed: "v3-specialized",
          mapPoolSize: 64,
          selectedRichScoreMapIds: ["wildMarches", "emberFen"],
          targetPlayerId: "v3",
          report: {
            name: "AI V3 vs Frozen Production V2 Benchmark",
            startedAt: "2026-06-09T00:00:00.000Z",
            evaluationCount: 1,
            matchCount: 2,
            elapsedMs: 10,
            cpuMs: 20,
            evaluations: [
              {
                name: "v3 race-aware vs v2-prod grove",
                tag: "melee",
                startedAt: "2026-06-09T00:00:00.000Z",
                elapsedMs: 10,
                cpuMs: 20,
                matchCount: 2,
                matches: [
                  {
                    name: "wildMarches v3 north",
                    elapsedMs: 1,
                    cpuMs: 2,
                    setup: { map: { id: "wildMarches" }, players: benchmarkSetupPlayers({ v3Race: "grove" }) },
                    result: { gameSecond: 10, winner: "v3", winnerTeam: "north", players: minimalBenchmarkPlayers() },
                  },
                  {
                    name: "emberFen v3 south",
                    elapsedMs: 1,
                    cpuMs: 2,
                    setup: { map: { id: "emberFen" }, players: benchmarkSetupPlayers({ v3Race: "ember" }) },
                    result: { gameSecond: 12, winner: "v2-prod", winnerTeam: "north", players: minimalBenchmarkPlayers() },
                  },
                ],
              },
            ],
          } as never,
        },
        { rootDir, now: () => new Date("2026-06-09T00:00:00.000Z") },
      );

      expect(run.primarySummary).toMatchObject({ name: "v3 race-aware vs v2-prod grove", wins: 1, losses: 1, failures: 1, successRate: 0.5, matchCount: 2 });
      expect(run.playerRaceSummaries).toMatchObject({
        v3: {
          grove: { wins: 1, losses: 0, matches: 1, winRate: 1 },
          ember: { wins: 0, losses: 1, matches: 1, winRate: 0 },
        },
        "v2-prod": {
          grove: { wins: 1, losses: 1, matches: 2, winRate: 0.5 },
        },
      });
      await expect(listBenchmarkDashboardRuns({ rootDir })).resolves.toMatchObject([
        {
          kind: "ai-specialized-benchmark",
          seed: "v3-specialized",
          primarySummary: { wins: 1, matchCount: 2 },
          evaluationSummaries: [{ name: "v3 race-aware vs v2-prod grove", wins: 1, matchCount: 2 }],
          playerRaceSummaries: {
            v3: {
              grove: { wins: 1, matches: 1 },
              ember: { losses: 1, matches: 1 },
            },
          },
        },
      ]);
      await expect(readBenchmarkDashboardRun(run.id, { rootDir })).resolves.toMatchObject({
        targetPlayerId: "v3",
        primarySummary: { wins: 1, matchCount: 2 },
        playerRaceSummaries: {
          v3: {
            grove: { wins: 1, matches: 1 },
            ember: { losses: 1, matches: 1 },
          },
        },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("derives dashboard summaries from match reports instead of stored summary fields", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      await writeFile(
        path.join(runsDir, "stale-summary.json"),
        JSON.stringify({
          id: "stale-summary",
          kind: "ai-version-benchmark",
          createdAt: "2026-01-01T00:00:00.000Z",
          seed: "stale-seed",
          name: "AI Version Benchmark",
          mapPoolSize: 64,
          selectedRichScoreMapIds: ["map-a", "map-b"],
          scoreSummary: { name: "paired 1v2 score", wins: 2, losses: 0, failures: 0, successRate: 1, matchCount: 2 },
          scoreControlSummary: { name: "1v1 score control", wins: 2, losses: 0, failures: 0, successRate: 1, matchCount: 2 },
          probeSummaries: [],
          combatSummaries: [],
          elapsedMs: 1,
          matchCount: 6,
          report: {
            name: "AI Version Benchmark",
            elapsedMs: 1,
            cpuMs: 1,
            matchCount: 6,
            evaluations: [
              {
                name: "1v2 score",
                tag: "melee",
                startedAt: "2026-01-01T00:00:00.000Z",
                elapsedMs: 1,
                cpuMs: 1,
                matchCount: 2,
                matches: [
                  { name: "map-a 1v2", elapsedMs: 1, cpuMs: 1, setup: { map: { id: "map-a" } }, result: { winnerTeam: "north", players: { v2: { enemyUnitKills: 8 } } } },
                  { name: "map-b 1v2", elapsedMs: 1, cpuMs: 1, setup: { map: { id: "map-b" } }, result: { winnerTeam: "north", players: { v2: { enemyUnitKills: 8 } } } },
                ],
              },
              {
                name: "1v1 score control",
                tag: "melee",
                startedAt: "2026-01-01T00:00:00.000Z",
                elapsedMs: 1,
                cpuMs: 1,
                matchCount: 4,
                matches: [
                  {
                    name: "map-a 1v1 control north",
                    elapsedMs: 1,
                    cpuMs: 1,
                    setup: { map: { id: "map-a" } },
                    result: { winner: "v2", winnerTeam: "north", players: { v2: { enemyUnitKills: 8 }, v1a: { unitsLost: 8, unitsKilledByNeutral: 0 } } },
                  },
                  {
                    name: "map-a 1v1 control south",
                    elapsedMs: 1,
                    cpuMs: 1,
                    setup: { map: { id: "map-a" } },
                    result: { winner: "v2", winnerTeam: "south", players: { v2: { enemyUnitKills: 8 }, v1a: { unitsLost: 8, unitsKilledByNeutral: 0 } } },
                  },
                  {
                    name: "map-b 1v1 control north",
                    elapsedMs: 1,
                    cpuMs: 1,
                    setup: { map: { id: "map-b" } },
                    result: { winner: "v2", winnerTeam: "north", players: { v2: { enemyUnitKills: 8 }, v1a: { unitsLost: 8, unitsKilledByNeutral: 0 } } },
                  },
                  {
                    name: "map-b 1v1 control south",
                    elapsedMs: 1,
                    cpuMs: 1,
                    setup: { map: { id: "map-b" } },
                    result: { winner: "v1a", winnerTeam: "north", players: { v2: { enemyUnitKills: 2 }, v1a: { unitsLost: 2, unitsKilledByNeutral: 0 } } },
                  },
                ],
              },
            ],
          },
          mapCount: 2,
          full: false,
        }),
      );

      await expect(listBenchmarkDashboardRuns({ rootDir })).resolves.toMatchObject([
        {
          scoreSummary: { wins: 1, losses: 1, failures: 1, successRate: 0.5, matchCount: 2 },
          scoreControlSummary: { wins: 3, losses: 1, failures: 1, successRate: 0.75, matchCount: 4 },
        },
      ]);
      await expect(readBenchmarkDashboardRun("stale-summary", { rootDir })).resolves.toMatchObject({
        scoreSummary: { wins: 1, losses: 1, failures: 1, successRate: 0.5, matchCount: 2 },
        scoreControlSummary: { wins: 3, losses: 1, failures: 1, successRate: 0.75, matchCount: 4 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects dashboard run files that do not use the current summary contract", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      await writeFile(
        path.join(runsDir, "bad-run.json"),
        JSON.stringify({
          id: "bad-run",
          kind: "ai-version-benchmark",
          createdAt: "2026-01-01T00:00:00.000Z",
          seed: "old-seed",
          name: "AI Version Benchmark",
          mapPoolSize: 64,
          selectedRichScoreMapIds: ["pearlBog"],
          scoreSummary: { name: "1v2 score", wins: 1, losses: 0, failures: 0, successRate: 1, matchCount: 1 },
          elapsedMs: 1,
          matchCount: 2,
          report: { name: "AI Version Benchmark", elapsedMs: 1, cpuMs: 1, matchCount: 2, evaluations: [] },
          mapCount: 1,
          full: false,
        }),
      );

      await expect(listBenchmarkDashboardRuns({ rootDir })).rejects.toThrow(/current benchmark dashboard run/);
      await expect(readBenchmarkDashboardRun("bad-run", { rootDir })).rejects.toThrow(/current benchmark dashboard run/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function minimalBenchmarkPlayers() {
  return {
    v3: { team: "north", firstEnemyEngagementSecond: 2, firstExpansionMiningSecond: null, enemyUnitKills: 1, neutralUnitKills: 0, unitsLost: 0, unitsKilledByNeutral: 0, totalGoldIncome: 500 },
    "v2-prod": { team: "south", firstEnemyEngagementSecond: 3, firstExpansionMiningSecond: null, enemyUnitKills: 0, neutralUnitKills: 0, unitsLost: 1, unitsKilledByNeutral: 0, totalGoldIncome: 400 },
  };
}

function benchmarkSetupPlayers(input: { v3Race: "grove" | "ember" }) {
  return {
    v3: { team: "north", race: input.v3Race, aiVersion: "v3", controller: "ai", plannerOrigin: "internal", traceSource: "ai" },
    "v2-prod": { team: "south", race: "grove", aiVersion: "v2", controller: "ai", plannerOrigin: "internal", traceSource: "ai" },
  };
}

function specializedRunFile(input: { id: string; createdAt: string; tag: string; matchCount?: number }) {
  const matchCount = input.matchCount ?? 1;
  return {
    id: input.id,
    kind: "ai-specialized-benchmark",
    createdAt: input.createdAt,
    seed: input.id,
    mapPoolSize: 64,
    selectedRichScoreMapIds: ["pearlBog"],
    mapCount: 1,
    full: false,
    targetPlayerId: "v3",
    report: {
      name: "Paged Specialized Benchmark",
      startedAt: input.createdAt,
      evaluationCount: 1,
      matchCount,
      elapsedMs: 10,
      cpuMs: 20,
      evaluations: [
        {
          name: `${input.tag} lane`,
          tag: input.tag,
          startedAt: input.createdAt,
          elapsedMs: 10,
          cpuMs: 20,
          matchCount,
          matches: Array.from({ length: matchCount }, (_, index) => ({
            name: `${input.id} match ${index}`,
            elapsedMs: 1,
            cpuMs: 2,
            setup: { map: { id: "pearlBog" } },
            result: { gameSecond: 10, winner: "v3", winnerTeam: "north", players: minimalBenchmarkPlayers() },
          })),
        },
      ],
    },
  };
}
