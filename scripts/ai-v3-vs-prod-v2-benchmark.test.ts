import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

describe("AI V3 versus frozen production V2 benchmark CLI", () => {
  it("prints a dry-run manifest with random V3 races and Grove-only V2-prod", () => {
    const output = JSON.parse(runV3BenchmarkCli(["--seed", "v3-prod-cli-seed", "--map-count", "4", "--dry-run"]));

    expect(output).toMatchObject({
      name: "AI V3 vs Frozen Production V2 Benchmark",
      seed: "v3-prod-cli-seed",
      matchCount: 8,
    });
    expect(output.selectedMapIds).toHaveLength(4);
    expect(output.matches).toEqual(output.selectedMapIds.flatMap((mapId: string) => [`${mapId} v3 north`, `${mapId} v3 south`]));
    const agents = output.manifest.evaluations[0].matches.flatMap((match: { agents: Record<string, { team: string; race: string; aiVersion: string; policyVersion?: string }> }) => Object.entries(match.agents));
    const prodAgents = agents.filter(([owner]) => owner === "v2-prod").map(([, agent]) => agent);
    const v3Agents = agents.filter(([owner]) => owner === "v3").map(([, agent]) => agent);

    expect(prodAgents.every((agent) => agent.race === "grove" && agent.aiVersion === "v2-prod grove" && agent.policyVersion === "v2-prod")).toBe(true);
    expect(new Set(v3Agents.map((agent) => agent.race))).toEqual(new Set(["grove", "ember"]));
    expect(new Set(v3Agents.map((agent) => agent.aiVersion))).toEqual(new Set(["v3 grove", "v3 ember"]));
    expect(new Set(v3Agents.map((agent) => agent.policyVersion))).toEqual(new Set(["v3-grove", "v3-ember"]));
  });

  it("prints focused match diagnostics for one V3 versus frozen V2-prod match", () => {
    const output = JSON.parse(runV3BenchmarkCli(["--seed", "v3-frozen-smoke-2026-06-08", "--map-count", "2", "--match", "wildMarches v3 north", "--max-ticks", "1", "--workers", "1", "--details"]));

    expect(output).toMatchObject({
      seed: "v3-frozen-smoke-2026-06-08",
      selectedMapIds: ["wildMarches", "emberFen"],
      matchCount: 1,
      matches: [
        {
          name: "wildMarches v3 north",
          mapId: "wildMarches",
          players: {
            v3: { team: "north", race: "ember" },
            "v2-prod": { team: "south", race: "grove" },
          },
        },
      ],
    });
  });

  it("records dashboard runs for standard V3 benchmark executions", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "v3-dashboard-"));
    try {
      const output = JSON.parse(runV3BenchmarkCli(["--seed", "v3-dashboard-smoke", "--map-count", "1", "--max-ticks", "1", "--workers", "1", "--dashboard"], { AI_BENCHMARK_DASHBOARD_DIR: rootDir }));

      expect(output).toMatchObject({
        kind: "ai-specialized-benchmark",
        seed: "v3-dashboard-smoke",
        primarySummary: { name: "v3 race-aware vs v2-prod grove", matchCount: 2 },
        evaluationSummaries: [{ name: "v3 race-aware vs v2-prod grove", matchCount: 2 }],
        dashboardPath: rootDir,
      });
      expect(output.report).toBeUndefined();
      const storedRun = JSON.parse(await readFile(path.join(rootDir, "run-contract-v2", "runs", `${output.id}.json`), "utf8"));
      expect(storedRun).toMatchObject({
        id: output.id,
        kind: "ai-specialized-benchmark",
        targetPlayerId: "v3",
        report: { name: "AI V3 vs Frozen Production V2 Benchmark", matchCount: 2 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function runV3BenchmarkCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync("npx", ["tsx", "scripts/ai-v3-vs-prod-v2-benchmark.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env, FORCE_COLOR: "0" },
  });
}
