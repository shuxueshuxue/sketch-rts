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
        v2: { controller: "external-agent", team: "north", race: "grove", aiVersion: "v2" },
        v1a: { controller: "external-agent", team: "south", race: "grove", aiVersion: "v1" },
        v1b: { controller: "external-agent", team: "south", race: "grove", aiVersion: "v1" },
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

  it("prints a serial/parallel runner parity proof without writing a dashboard run", () => {
    const output = JSON.parse(runVersionBenchmarkCli({ AI_BENCHMARK_PARITY_PROBE: "1", AI_GAUNTLET_SEED: "version-cli-seed", AI_GAUNTLET_MAP_COUNT: "18" }));

    expect(output).toMatchObject({
      name: "AI Version Benchmark Runner Parity Probe",
      seed: "version-cli-seed",
      mapCount: 18,
      probeCount: 6,
      setupEqual: true,
      coreResultEqual: true,
      directResultEqual: true,
    });
    expect(output.selectedRichScoreMapIds).toHaveLength(18);
    expect(output.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(output.catalogHash).toMatch(/^[0-9a-f]{64}$/);
    expect(output.dashboardPath).toBe(".benchmark-dashboard");
    expect(output.probes.map((probe: { evaluationName: string }) => probe.evaluationName)).toEqual(["1v2 score", "1v1 score control", "1v3 probe", "2v3 probe", "15v20 mixed combat", "10v12 mixed combat"]);
    expect(output.probes.every((probe: { setupEqual: boolean; coreResultEqual: boolean; directResultEqual: boolean }) => probe.setupEqual && probe.coreResultEqual && probe.directResultEqual)).toBe(true);
    expect(output.probes[0].serialManifest.commandPlanner).toBe("present");
    expect(output.probes[0].parallelManifest.commandPlanner).toBe("absent");
    expect(output.probes[0].serial).toMatchObject({ map: output.selectedRichScoreMapIds[0], result: { tick: 1, timeout: true } });
    expect(output.probes[0].parallel).toEqual(output.probes[0].serial);
    expect(output.serialReport).toBeUndefined();
    expect(output.parallelReport).toBeUndefined();
  });
});

function runVersionBenchmarkCli(env: Record<string, string>) {
  return execFileSync("npx", ["tsx", "scripts/ai-version-benchmark.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", AI_BENCHMARK_WORKERS: "1", ...env },
  });
}
