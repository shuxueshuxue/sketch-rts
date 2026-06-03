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
      expect(summaries[0]?.probeSummaries.map((summary) => summary.name)).toEqual(["1v3 probe", "2v3 probe"]);
      expect(summaries[0]?.combatSummaries.map((summary) => summary.name)).toEqual(["15v20 mixed combat", "10v12 mixed combat"]);

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
