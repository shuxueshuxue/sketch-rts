import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("AI V3 versus frozen production V2 benchmark CLI", () => {
  it("prints a dry-run manifest with random V3 races and Grove-only V2-prod", () => {
    const output = JSON.parse(runV3BenchmarkCli("--seed", "v3-prod-cli-seed", "--map-count", "4", "--dry-run"));

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
});

function runV3BenchmarkCli(...args: string[]) {
  return execFileSync("npx", ["tsx", "scripts/ai-v3-vs-prod-v2-benchmark.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}
