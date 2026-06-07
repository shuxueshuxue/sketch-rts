import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("AI cross-race benchmark CLI", () => {
  it("prints selected v2 ember versus v2 grove matches without running simulations in dry-run mode", () => {
    const output = JSON.parse(runCrossRaceBenchmarkCli("--seed", "cross-race-cli-seed", "--map-count", "2", "--dry-run"));

    expect(output).toMatchObject({
      name: "AI Cross-Race Benchmark",
      seed: "cross-race-cli-seed",
      matchCount: 4,
    });
    expect(output.selectedMapIds).toHaveLength(2);
    expect(output.matches).toEqual(output.selectedMapIds.flatMap((mapId: string) => [`${mapId} ember north`, `${mapId} ember south`]));
    expect(output.manifest.evaluations[0]).toMatchObject({
      name: "v2 ember vs v2 grove",
      tag: "melee",
      matchCount: 4,
    });
    expect(output.manifest.evaluations[0].matches[0]).toMatchObject({
      name: output.matches[0],
      commandPlanner: "present",
      agents: {
        ember: { controller: "external-agent", team: "north", race: "ember", aiVersion: "v2 ember" },
        grove: { controller: "external-agent", team: "south", race: "grove", aiVersion: "v2 grove" },
      },
    });
    expect(output.manifest.evaluations[0].matches[1].agents).toMatchObject({
      ember: { team: "south", race: "ember" },
      grove: { team: "north", race: "grove" },
    });
  });
});

function runCrossRaceBenchmarkCli(...args: string[]) {
  return execFileSync("npx", ["tsx", "scripts/ai-cross-race-benchmark.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}
