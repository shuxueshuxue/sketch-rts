import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("AI control benchmark CLI", () => {
  it("prints selected side-balanced matches without running simulations in dry-run mode", () => {
    const output = JSON.parse(runControlBenchmarkCli("--seed", "control-cli-seed", "--map-count", "2", "--dry-run"));

    expect(output).toMatchObject({
      name: "AI 1v1 Control Benchmark",
      seed: "control-cli-seed",
      matchCount: 4,
    });
    expect(output.selectedMapIds).toHaveLength(2);
    expect(output.matches).toEqual(output.selectedMapIds.flatMap((mapId: string) => [`${mapId} 1v1 control north`, `${mapId} 1v1 control south`]));
  });

  it("prints focused match diagnostics with player benchmark metrics", () => {
    const output = JSON.parse(runControlBenchmarkCli("--seed", "control-cli-seed", "--map-count", "2", "--match", "brackenFord 1v1 control south", "--max-ticks", "1", "--workers", "1", "--details"));

    expect(output.matchCount).toBe(1);
    expect(output.matches).toHaveLength(1);
    expect(output.matches[0]).toMatchObject({
      name: "brackenFord 1v1 control south",
      mapId: "brackenFord",
      players: {
        v2: {
          team: "south",
          race: "grove",
          moonWellHealingEvents: 0,
          moonWellHealingHp: 0,
        },
        v1a: {
          team: "north",
          race: "grove",
        },
      },
    });
  });
});

function runControlBenchmarkCli(...args: string[]) {
  return execFileSync("npx", ["tsx", "scripts/ai-control-benchmark.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}
