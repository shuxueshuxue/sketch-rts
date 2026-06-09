import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createAiV4TrVsV3BenchmarkInput } from "../src/ai/benchmark/control";
import type { AiGameAgent } from "../src/ai/game-runner";
import { runBenchmark, type BenchmarkTracker } from "../src/sdk/benchmark/core";
import type { UnitKind } from "../src/shared/types";

describe("AI V4-TR versus V3 benchmark CLI", () => {
  it("prints a dry-run manifest with fixed V4-TR and random V3 races", () => {
    const output = JSON.parse(runV4BenchmarkCli(["--seed", "v4-tr-cli-seed", "--map-count", "4", "--dry-run"]));

    expect(output).toMatchObject({
      name: "AI V4-TR vs V3 Benchmark",
      seed: "v4-tr-cli-seed",
      matchCount: 8,
    });
    expect(output.selectedMapIds).toHaveLength(4);
    expect(output.matches).toEqual(output.selectedMapIds.flatMap((mapId: string) => [`${mapId} v4-tr north`, `${mapId} v4-tr south`]));
    const agents = output.manifest.evaluations[0].matches.flatMap((match: { agents: Record<string, { team: string; race: string; aiVersion: string; policyVersion?: string }> }) => Object.entries(match.agents));
    const v4Agents = agents.filter(([owner]) => owner === "v4-tr").map(([, agent]) => agent);
    const v3Agents = agents.filter(([owner]) => owner === "v3").map(([, agent]) => agent);

    expect(v4Agents.every((agent) => agent.race === "grove" && agent.aiVersion === "v4-tr" && agent.policyVersion === "v4-tr")).toBe(true);
    expect(new Set(v3Agents.map((agent) => agent.race))).toEqual(new Set(["grove", "ember"]));
    expect(new Set(v3Agents.map((agent) => agent.aiVersion))).toEqual(new Set(["v3 grove", "v3 ember"]));
    expect(new Set(v3Agents.map((agent) => agent.policyVersion))).toEqual(new Set(["v3-grove", "v3-ember"]));
  });

  it("records dashboard runs for standard V4-TR benchmark executions", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "v4-dashboard-"));
    try {
      const output = JSON.parse(runV4BenchmarkCli(["--seed", "v4-dashboard-smoke", "--map-count", "1", "--max-ticks", "1", "--workers", "1", "--dashboard"], { AI_BENCHMARK_DASHBOARD_DIR: rootDir }));

      expect(output).toMatchObject({
        kind: "ai-specialized-benchmark",
        seed: "v4-dashboard-smoke",
        targetPlayerId: "v4-tr",
        primarySummary: { name: "v4-tr tower merc vs v3 random race", matchCount: 2 },
        dashboardPath: rootDir,
      });
      expect(output.report).toBeUndefined();
      const storedRun = JSON.parse(await readFile(path.join(rootDir, "run-contract-v2", "runs", `${output.id}.json`), "utf8"));
      expect(storedRun).toMatchObject({
        id: output.id,
        kind: "ai-specialized-benchmark",
        targetPlayerId: "v4-tr",
        report: { name: "AI V4-TR vs V3 Benchmark", matchCount: 2 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not train ordinary combat units during benchmark execution", () => {
    const { input } = createAiV4TrVsV3BenchmarkInput({ seed: "v4-tr-train-tracker", mapCount: 1, maxTicks: 600 });
    input.evaluations[0]!.matches = input.evaluations[0]!.matches.slice(0, 1);
    const trainKinds: UnitKind[] = [];
    const tracker: BenchmarkTracker<AiGameAgent, undefined, UnitKind[]> = {
      id: "v4-tr-train-kinds",
      onCommand(_state, context) {
        if (context.owner === "v4-tr" && context.command.type === "train") trainKinds.push(context.command.unitKind);
      },
      finish() {
        return trainKinds;
      },
    };

    runBenchmark({ ...input, trackers: [tracker] });

    expect(trainKinds.length).toBeGreaterThan(0);
    expect(new Set(trainKinds)).toEqual(new Set(["worker"]));
  });
});

function runV4BenchmarkCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync("npx", ["tsx", "scripts/ai-v4-tr-vs-v3-benchmark.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env, FORCE_COLOR: "0" },
  });
}
