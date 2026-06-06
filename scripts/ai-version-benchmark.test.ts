import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("AI version benchmark CLI", () => {
  it("prints the formal benchmark manifest without running simulations in dry-run mode", () => {
    const output = JSON.parse(runVersionBenchmarkCli({ AI_BENCHMARK_DRY_RUN: "1", AI_GAUNTLET_SEED: "version-cli-seed", AI_GAUNTLET_MAP_COUNT: "2" }));

    expect(output).toMatchObject({
      name: "AI Version Benchmark",
      seed: "version-cli-seed",
      mapCount: 2,
      full: false,
      workers: 1,
      dashboardPath: ".benchmark-dashboard",
    });
    expect(output.selectedRichScoreMapIds).toHaveLength(2);
    expect(output.manifest.evaluationCount).toBe(6);
    expect(output.manifest.matchCount).toBe(16);
    expect(output.manifest.evaluations[0].matches[0]).toMatchObject({
      name: `${output.selectedRichScoreMapIds[0]} 1v2`,
      commandPlanner: "present",
      agents: {
        v2: { adapter: "external", team: "north", race: "grove", aiVersion: "v2" },
        v1a: { adapter: "external", team: "south", race: "grove", aiVersion: "v1" },
        v1b: { adapter: "external", team: "south", race: "grove", aiVersion: "v1" },
      },
    });
    expect(output.manifest.evaluations[0].matches[1].agents.v2.disabledBehaviors).toEqual(["workerHarassment"]);
    expect(output.manifest.evaluations[4].matches[0]).toMatchObject({
      name: "combatArena 15v20 early mixed",
      mapId: "combatArena",
      winnerMode: "combatElimination",
      scenario: { units: 35 },
    });
  });
});

function runVersionBenchmarkCli(env: Record<string, string>) {
  return execFileSync("npx", ["tsx", "scripts/ai-version-benchmark.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", AI_BENCHMARK_WORKERS: "1", ...env },
  });
}
