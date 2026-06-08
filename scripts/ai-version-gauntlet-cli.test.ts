import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI version gauntlet CLI", () => {
  it("is exposed as a first-class benchmark npm script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["benchmark:ai-gauntlet"]).toBe("tsx scripts/ai-version-gauntlet.ts");
  });

  it("prints a dry-run catalog from the shared flag surface without running matches", () => {
    const output = JSON.parse(runGauntletCli("--seed", "gauntlet-cli-seed", "--map-count", "2", "--dry-run"));

    expect(output).toMatchObject({
      name: "AI Version Gauntlet",
      gauntletMode: "sample",
      mapSelectionSeed: "gauntlet-cli-seed",
      scoreCaseCount: 2,
      oneVThreeCaseCount: 0,
      twoVThreeCaseCount: 0,
      robustnessCaseCount: 3,
      matchCount: 20,
    });
    expect(output.selectedRichScoreMapIds).toHaveLength(2);
    expect(output.matches[0]).toMatchObject({
      name: `internal-only score ${output.selectedRichScoreMapIds[0]} official triangle`,
      lane: "score",
      controllerCase: "internal-only",
      players: ["v2", "v1a", "v1b"],
      agents: {
        v2: { controller: "internal-ai", team: "north", race: "grove", aiVersion: "v2" },
        v1a: { controller: "internal-ai", team: "south", race: "grove", aiVersion: "v1" },
        v1b: { controller: "internal-ai", team: "south", race: "grove", aiVersion: "v1" },
      },
    });
  });
});

function runGauntletCli(...args: string[]) {
  return execFileSync("npx", ["tsx", "scripts/ai-version-gauntlet.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}
