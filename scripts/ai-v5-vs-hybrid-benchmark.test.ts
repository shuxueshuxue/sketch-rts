import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

describe("AI V5 versus hybrid V3 plus V4-TR benchmark CLI", () => {
  it("prints a dry-run manifest with simultaneous V3 and V4-TR allied opponents", () => {
    const output = JSON.parse(runV5BenchmarkCli(["--seed", "v5-hybrid-cli-seed", "--map-count", "4", "--dry-run"]));

    expect(output).toMatchObject({
      name: "AI V5 vs Hybrid V3 plus V4-TR Benchmark",
      seed: "v5-hybrid-cli-seed",
      matchCount: 8,
    });
    expect(output.selectedMapIds).toHaveLength(4);
    expect(output.matches).toEqual(output.selectedMapIds.flatMap((mapId: string) => [`${mapId} v5 north`, `${mapId} v5 south`]));
    const matches = output.manifest.evaluations[0].matches as Array<{ agents: Record<string, { team: string; race: string; aiVersion: string; policyVersion?: string }> }>;
    const first = matches[0]!;

    expect(Object.keys(first.agents).sort()).toEqual(["v3", "v4-tr", "v5"]);
    expect(first.agents.v5.team).not.toBe(first.agents.v3.team);
    expect(first.agents.v3.team).toBe(first.agents["v4-tr"].team);
    expect(new Set(matches.map((match) => match.agents.v5.race))).toEqual(new Set(["grove", "ember"]));
    expect(new Set(matches.map((match) => match.agents.v3.race))).toEqual(new Set(["grove", "ember"]));
    expect(matches.every((match) => match.agents["v4-tr"].race === "grove" && match.agents["v4-tr"].policyVersion === "v4-tr")).toBe(true);
    expect(matches.every((match) => match.agents.v5.policyVersion === "v5")).toBe(true);
  });

  it("seed-randomizes which allied opponent receives the first opposing slot", () => {
    const output = JSON.parse(runV5BenchmarkCli(["--seed", "v5-hybrid-cli-seed", "--map-count", "8", "--dry-run"]));
    const matches = output.manifest.evaluations[0].matches as Array<{ agents: Record<string, { team: string }> }>;
    const opponentOrders = new Set(
      matches.map((match) =>
        Object.keys(match.agents)
          .filter((owner) => owner !== "v5")
          .join(","),
      ),
    );

    expect(opponentOrders).toEqual(new Set(["v3,v4-tr", "v4-tr,v3"]));
  });

  it("samples V5 and V3 race choices independently across the match set", () => {
    const output = JSON.parse(runV5BenchmarkCli(["--seed", "v5-hybrid-cli-seed", "--map-count", "16", "--dry-run"]));
    const matches = output.manifest.evaluations[0].matches as Array<{ agents: Record<string, { race: string }> }>;
    const racePairs = new Set(matches.map((match) => `${match.agents.v5.race}->${match.agents.v3.race}`));

    expect(racePairs).toEqual(new Set(["grove->grove", "grove->ember", "ember->grove", "ember->ember"]));
  });

  it("samples V3 race independently from the allied opponent slot order", () => {
    const output = JSON.parse(runV5BenchmarkCli(["--seed", "v5-hybrid-cli-seed", "--map-count", "16", "--dry-run"]));
    const matches = output.manifest.evaluations[0].matches as Array<{ agents: Record<string, { race: string }> }>;
    const raceAndOrder = new Set(
      matches.map((match) => {
        const opponentOrder = Object.keys(match.agents)
          .filter((owner) => owner !== "v5")
          .join(",");
        return `${match.agents.v3.race}|${opponentOrder}`;
      }),
    );

    expect(raceAndOrder).toEqual(new Set(["grove|v3,v4-tr", "grove|v4-tr,v3", "ember|v3,v4-tr", "ember|v4-tr,v3"]));
  });

  it("records dashboard runs for standard V5 hybrid benchmark executions", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "v5-dashboard-"));
    try {
      const output = JSON.parse(runV5BenchmarkCli(["--seed", "v5-dashboard-smoke", "--map-count", "1", "--max-ticks", "1", "--workers", "1", "--dashboard"], { AI_BENCHMARK_DASHBOARD_DIR: rootDir }));

      expect(output).toMatchObject({
        kind: "ai-specialized-benchmark",
        seed: "v5-dashboard-smoke",
        targetPlayerId: "v5",
        primarySummary: { name: "v5 hybrid 1v2 vs v3 plus v4-tr", matchCount: 2 },
        dashboardPath: rootDir,
      });
      expect(output.report).toBeUndefined();
      const storedRun = JSON.parse(await readFile(path.join(rootDir, "run-contract-v2", "runs", `${output.id}.json`), "utf8"));
      expect(storedRun).toMatchObject({
        id: output.id,
        kind: "ai-specialized-benchmark",
        targetPlayerId: "v5",
        report: { name: "AI V5 vs Hybrid V3 plus V4-TR Benchmark", matchCount: 2 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function runV5BenchmarkCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync("npx", ["tsx", "scripts/ai-v5-vs-hybrid-benchmark.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env, FORCE_COLOR: "0" },
  });
}
