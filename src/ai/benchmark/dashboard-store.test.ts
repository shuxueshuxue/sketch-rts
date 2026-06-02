import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { benchmarkDashboardLogsDir, benchmarkDashboardRunsDir, listBenchmarkDashboardRuns, readBenchmarkDashboardRun, recordAiVersionBenchmarkDashboardRun } from "./dashboard-store";

describe("benchmark dashboard store", () => {
  it("records standard AI benchmark runs and lists latest summaries first", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const first = await recordAiVersionBenchmarkDashboardRun(
        { seed: "store-first", mapCount: 17, maxTicks: 1 },
        { rootDir, now: () => new Date("2026-01-01T00:00:00.000Z") },
      );
      const second = await recordAiVersionBenchmarkDashboardRun(
        { seed: "store-second", mapCount: 17, maxTicks: 1 },
        { rootDir, now: () => new Date("2026-01-01T00:01:00.000Z") },
      );

      const summaries = await listBenchmarkDashboardRuns({ rootDir });
      expect(summaries.map((summary) => summary.id)).toEqual([second.id, first.id]);
      expect(summaries[0]).toMatchObject({
        kind: "ai-version-benchmark",
        seed: "store-second",
        mapPoolSize: 64,
        matchCount: 23,
      });
      expect(summaries[0]?.cpuMs).toBeGreaterThanOrEqual(0);
      expect(summaries[0]?.selectedRichScoreMapIds).toHaveLength(17);
      expect(summaries[0]?.probeSummaries.map((summary) => summary.name)).toEqual(["1v3 probe", "2v3 probe"]);
      expect(summaries[0]?.combatSummaries.map((summary) => summary.name)).toEqual(["15v20 mixed combat", "10v12 mixed combat"]);

      const detail = await readBenchmarkDashboardRun(second.id, { rootDir });
      expect(detail.report.cpuMs).toBeGreaterThanOrEqual(0);
      expect(detail.report.evaluations.map((evaluation) => evaluation.name)).toEqual(["1v2 score", "1v3 probe", "2v3 probe", "1v1 sanity", "15v20 mixed combat", "10v12 mixed combat"]);
      expect(detail.report.evaluations.map((evaluation) => evaluation.tag)).toEqual(["melee", "melee", "melee", "melee", "combat", "combat"]);
      expect(detail.report.evaluations.map((evaluation) => evaluation.matches.length)).toEqual([10, 2, 2, 3, 3, 3]);
      expect(detail.report.evaluations.slice(0, 4).flatMap((evaluation) => evaluation.matches.map((match) => match.setup.map.id))).toEqual(detail.selectedRichScoreMapIds);
      expect(detail.report.evaluations.slice(4).flatMap((evaluation) => evaluation.matches.map((match) => match.setup.map.id))).toEqual(["combatArena", "combatArena", "combatArena", "combatArena", "combatArena", "combatArena"]);
      await expect(readFile(path.join(benchmarkDashboardLogsDir({ rootDir }), `${second.id}.log`), "utf8")).resolves.toContain("cpu time:");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not reuse a fixed timestamp seed for ordinary dashboard runs", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const now = () => new Date("2026-01-01T00:00:00.000Z");
      const first = await recordAiVersionBenchmarkDashboardRun({ mapCount: 1, maxTicks: 1_000 }, { rootDir, now });
      const second = await recordAiVersionBenchmarkDashboardRun({ mapCount: 1, maxTicks: 1_000 }, { rootDir, now });

      expect(first.seed).not.toBe(second.seed);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("normalizes older dashboard run files that do not have probe or combat summaries", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "benchmark-dashboard-"));
    try {
      const runsDir = benchmarkDashboardRunsDir({ rootDir });
      await mkdir(runsDir, { recursive: true });
      await writeFile(
        path.join(runsDir, "old-run.json"),
        JSON.stringify({
          id: "old-run",
          kind: "ai-version-benchmark",
          createdAt: "2026-01-01T00:00:00.000Z",
          seed: "old-seed",
          name: "AI Version Benchmark",
          mapPoolSize: 64,
          selectedRichScoreMapIds: ["pearlBog"],
          scoreSummary: { name: "1v2 score", wins: 1, losses: 0, failures: 0, successRate: 1, matchCount: 1 },
          sanitySummary: { name: "1v1 sanity", wins: 1, losses: 0, failures: 0, successRate: 1, matchCount: 1 },
          elapsedMs: 1,
          matchCount: 2,
          report: { name: "AI Version Benchmark", elapsedMs: 1, cpuMs: 1, matchCount: 2, evaluations: [] },
          mapCount: 1,
          full: false,
        }),
      );

      await expect(listBenchmarkDashboardRuns({ rootDir })).resolves.toMatchObject([{ probeSummaries: [], combatSummaries: [] }]);
      await expect(readBenchmarkDashboardRun("old-run", { rootDir })).resolves.toMatchObject({ probeSummaries: [], combatSummaries: [] });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
